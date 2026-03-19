import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2";

export type EmailDeliveryStatus = "queued" | "sent" | "failed";

export type EmailLogContext = {
  emailType: string;
  recipientEmail: string;
  subject: string;
  provider?: string;
  requestContext?: Record<string, unknown> | null;
  triggeredByUserId?: string | null;
  jobId?: string | null;
  tenantId?: string | null;
  districtId?: string | null;
  metadata?: Record<string, unknown> | null;
};

const MAX_TEXT_LENGTH = 2000;

const trimText = (value: unknown, max = MAX_TEXT_LENGTH) => {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed ? trimmed.slice(0, max) : null;
};

const insertEmailLog = async (
  adminClient: SupabaseClient,
  context: EmailLogContext,
) => {
  const { data, error } = await adminClient
    .from("email_delivery_logs")
    .insert({
      email_type: context.emailType,
      recipient_email: context.recipientEmail,
      subject: context.subject,
      provider: context.provider ?? "resend",
      status: "queued",
      request_context: context.requestContext ?? null,
      triggered_by_user_id: context.triggeredByUserId ?? null,
      job_id: context.jobId ?? null,
      tenant_id: context.tenantId ?? null,
      district_id: context.districtId ?? null,
      metadata: context.metadata ?? null,
    })
    .select("id")
    .single();

  if (error || !data?.id) {
    throw error ?? new Error("Unable to create email log row.");
  }

  return data.id as string;
};

const updateEmailLog = async (
  adminClient: SupabaseClient,
  logId: string,
  updates: {
    status: EmailDeliveryStatus;
    providerMessageId?: string | null;
    errorMessage?: string | null;
    metadata?: Record<string, unknown> | null;
  },
) => {
  const { error } = await adminClient
    .from("email_delivery_logs")
    .update({
      status: updates.status,
      provider_message_id: trimText(updates.providerMessageId, 255),
      error_message: trimText(updates.errorMessage),
      metadata: updates.metadata ?? null,
      sent_at: updates.status === "sent" ? new Date().toISOString() : null,
      updated_at: new Date().toISOString(),
    })
    .eq("id", logId);

  if (error) {
    throw error;
  }
};

export const sendLoggedResendEmail = async (
  adminClient: SupabaseClient,
  apiKey: string,
  resendPayload: Record<string, unknown>,
  context: EmailLogContext,
) => {
  let logId: string | null = null;
  try {
    logId = await insertEmailLog(adminClient, context);
  } catch {
    logId = null;
  }

  try {
    const response = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(resendPayload),
    });

    const responseBody = await response.json().catch(() => null) as Record<string, unknown> | null;

    if (!response.ok) {
      const errorMessage = typeof responseBody?.message === "string"
        ? responseBody.message
        : `Email send failed: ${response.status}`;
      if (logId) {
        await updateEmailLog(adminClient, logId, {
          status: "failed",
          errorMessage,
          metadata: {
            ...(context.metadata ?? {}),
            response_status: response.status,
            response_body: responseBody,
          },
        });
      }
      throw new Error(`Email send failed: ${response.status} ${errorMessage}`);
    }

    if (logId) {
      await updateEmailLog(adminClient, logId, {
        status: "sent",
        providerMessageId: typeof responseBody?.id === "string" ? responseBody.id : null,
        metadata: {
          ...(context.metadata ?? {}),
          response_status: response.status,
          response_body: responseBody,
        },
      });
    }

    return responseBody;
  } catch (error) {
    if (logId) {
      try {
        await updateEmailLog(adminClient, logId, {
          status: "failed",
          errorMessage: error instanceof Error ? error.message : "Email send failed.",
          metadata: context.metadata ?? null,
        });
      } catch {
        // Ignore secondary log update failures so the original send error still surfaces.
      }
    }
    throw error;
  }
};
