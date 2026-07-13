import { sendLoggedResendEmail } from "../../_shared/emailDeliveryLog.ts";
import {
  buildSubprocessorEmailSubject,
  buildSubprocessorNoticeHtml,
  buildSubprocessorNoticePlainText,
  formatSubprocessorPreview,
  type SubprocessorChangeType,
} from "../../_shared/subprocessorNotice.ts";
import {
  optionalText,
  requireText,
  ValidationError,
} from "../../_shared/validation.ts";
import type { SupabaseAdminClient, SuperOpsContext } from "../context.ts";

export const SUBPROCESSOR_ACTIONS = [
  "preview_subprocessor_notice",
  "announce_subprocessor_change",
  "list_subprocessor_notices",
] as const;

const parseEffectiveDateUtc = (value: string) => {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    throw new ValidationError("effective_date must be YYYY-MM-DD", 400);
  }
  const [year, month, day] = value.split("-").map(Number);
  const parsed = new Date(Date.UTC(year, month - 1, day));
  if (
    parsed.getUTCFullYear() !== year ||
    parsed.getUTCMonth() !== month - 1 ||
    parsed.getUTCDate() !== day
  ) {
    throw new ValidationError("effective_date must be a valid date", 400);
  }
  return parsed;
};

const loadSubprocessorNoticeRecipients = async (
  adminClient: SupabaseAdminClient,
) => {
  const [districtResult, leadResult] = await Promise.all([
    adminClient
      .from("districts")
      .select("billing_email")
      .eq("billing_status", "active")
      .not("billing_email", "is", null),
    adminClient
      .from("sales_leads")
      .select("reply_email")
      .eq("lead_state", "converted_to_customer")
      .not("reply_email", "is", null),
  ]);

  if (districtResult.error || leadResult.error) {
    throw new Error("Unable to load subprocessor notice recipients.");
  }

  const recipients = new Set<string>();
  for (const row of districtResult.data ?? []) {
    if (typeof row.billing_email === "string" && row.billing_email.trim()) {
      recipients.add(row.billing_email.trim().toLowerCase());
    }
  }
  for (const row of leadResult.data ?? []) {
    if (typeof row.reply_email === "string" && row.reply_email.trim()) {
      recipients.add(row.reply_email.trim().toLowerCase());
    }
  }

  return Array.from(recipients);
};

export const handleSubprocessorsAction = async (
  context: SuperOpsContext,
): Promise<Response | null> => {
  const {
    action,
    payload,
    adminClient,
    user,
    profile,
    jsonResponse,
    writeAudit,
  } = context;

  if (action === "preview_subprocessor_notice") {
    const vendor = requireText(payload.vendor, { maxLen: 256 });
    const rawChangeType = requireText(payload.change_type, { maxLen: 32 });
    if (!["added", "replaced", "removed"].includes(rawChangeType)) {
      throw new ValidationError(
        "change_type must be 'added', 'replaced', or 'removed'",
        400,
      );
    }
    const changeType = rawChangeType as SubprocessorChangeType;
    const effectiveDate = requireText(payload.effective_date, { maxLen: 10 });
    const effectiveDateUtc = parseEffectiveDateUtc(effectiveDate);
    const todayUtc = new Date();
    todayUtc.setUTCHours(0, 0, 0, 0);
    const thirtyDaysOut = new Date(todayUtc);
    thirtyDaysOut.setUTCDate(thirtyDaysOut.getUTCDate() + 30);
    if (effectiveDateUtc < thirtyDaysOut) {
      throw new ValidationError(
        "effective_date must be at least 30 days from today",
        400,
      );
    }
    const description = optionalText(payload.description, { maxLen: 2048 }) ||
      undefined;

    const recipients = await loadSubprocessorNoticeRecipients(adminClient);

    const logoUrl = Deno.env.get("ITX_EMAIL_LOGO_URL")?.trim() || null;
    const legalHubUrl = Deno.env.get("ITX_LEGAL_HUB_URL")?.trim() ||
      "https://www.itemtraxx.com/legal";
    const contactSupportUrl = Deno.env.get("ITX_CONTACT_SUPPORT_URL")?.trim() ||
      "https://www.itemtraxx.com/contact-support";

    const preview = formatSubprocessorPreview(
      {
        vendor,
        changeType,
        effectiveDate,
        description,
        logoUrl,
        legalHubUrl,
        contactSupportUrl,
      },
      recipients.length,
    );

    return jsonResponse(200, { preview });
  }

  // ── Subprocessor notice: announce (sends emails + creates DB record) ─────────
  if (action === "announce_subprocessor_change") {
    const vendor = requireText(payload.vendor, { maxLen: 256 });
    const rawChangeType = requireText(payload.change_type, { maxLen: 32 });
    if (!["added", "replaced", "removed"].includes(rawChangeType)) {
      throw new ValidationError(
        "change_type must be 'added', 'replaced', or 'removed'",
        400,
      );
    }
    const changeType = rawChangeType as SubprocessorChangeType;
    const effectiveDate = requireText(payload.effective_date, { maxLen: 10 });
    const effectiveDateUtc = parseEffectiveDateUtc(effectiveDate);
    const todayUtc = new Date();
    todayUtc.setUTCHours(0, 0, 0, 0);
    const thirtyDaysOut = new Date(todayUtc);
    thirtyDaysOut.setUTCDate(thirtyDaysOut.getUTCDate() + 30);
    if (effectiveDateUtc < thirtyDaysOut) {
      throw new ValidationError(
        "effective_date must be at least 30 days from today",
        400,
      );
    }
    const description = optionalText(payload.description, { maxLen: 2048 }) ||
      undefined;

    const resendApiKey = Deno.env.get("ITX_RESEND_API_KEY");
    if (!resendApiKey) {
      return jsonResponse(503, { error: "Email service not configured." });
    }
    const emailFrom = Deno.env.get("ITX_EMAIL_FROM") ??
      "ItemTraxx <noreply@itemtraxx.com>";
    const logoUrl = Deno.env.get("ITX_EMAIL_LOGO_URL")?.trim() || null;
    const legalHubUrl = Deno.env.get("ITX_LEGAL_HUB_URL")?.trim() ||
      "https://www.itemtraxx.com/legal";
    const contactSupportUrl = Deno.env.get("ITX_CONTACT_SUPPORT_URL")?.trim() ||
      "https://www.itemtraxx.com/contact-support";

    const recipients = await loadSubprocessorNoticeRecipients(adminClient);

    // Create record in pending state before sending.
    const { data: changeRecord, error: insertError } = await adminClient
      .from("subprocessor_changes")
      .insert({
        vendor,
        change_type: changeType,
        effective_date: effectiveDate,
        description: description ?? null,
        status: "pending",
        created_by_email: profile.auth_email ?? user.email ?? null,
      })
      .select("id")
      .single();

    if (insertError || !changeRecord) {
      return jsonResponse(500, {
        error: "Failed to create subprocessor change record.",
      });
    }
    const changeId: string = changeRecord.id;

    const noticePayload = {
      vendor,
      changeType,
      effectiveDate,
      description,
      logoUrl,
      legalHubUrl,
      contactSupportUrl,
    };
    const subject = buildSubprocessorEmailSubject(vendor, changeType);
    const html = buildSubprocessorNoticeHtml(noticePayload);
    const text = buildSubprocessorNoticePlainText(noticePayload);

    let sentCount = 0;
    const emailBatchSize = 25;
    for (
      let offset = 0;
      offset < recipients.length;
      offset += emailBatchSize
    ) {
      const batch = recipients.slice(offset, offset + emailBatchSize);
      const emailResults = await Promise.allSettled(
        batch.map((recipientEmail) =>
          sendLoggedResendEmail(
            adminClient,
            resendApiKey,
            { from: emailFrom, to: [recipientEmail], subject, html, text },
            {
              emailType: "subprocessor_change_notice",
              recipientEmail,
              subject,
              provider: "resend",
              requestContext: {
                source: "super-ops/announce_subprocessor_change",
              },
              triggeredByUserId: user.id,
              tenantId: null,
              districtId: null,
              metadata: { changeId, vendor, changeType, effectiveDate },
            },
          )
        ),
      );

      for (const result of emailResults) {
        if (result.status === "fulfilled") sentCount++;
      }
    }

    const noticeSentAt = new Date().toISOString();
    const { data: updatedChange, error: updateError } = await adminClient
      .from("subprocessor_changes")
      .update({
        status: recipients.length === 0 || sentCount > 0 ? "sent" : "failed",
        notice_sent_at: noticeSentAt,
        objection_deadline: effectiveDate,
        recipients_count: sentCount,
      })
      .eq("id", changeId)
      .select("id")
      .single();

    if (updateError || !updatedChange) {
      return jsonResponse(500, {
        error: "Notice delivery completed, but its status could not be saved.",
      });
    }

    await writeAudit(
      "announce_subprocessor_change",
      "subprocessor_change",
      changeId,
      {
        vendor,
        changeType,
        effectiveDate,
        recipientsCount: sentCount,
      },
    );

    return jsonResponse(200, {
      changeId,
      vendor,
      changeType,
      effectiveDate,
      objectionDeadline: effectiveDate,
      noticeSentAt,
      recipientsCount: sentCount,
      totalTargets: recipients.length,
    });
  }

  // ── Subprocessor notice: list ────────────────────────────────────────────────
  if (action === "list_subprocessor_notices") {
    const { data: notices, error: listError } = await adminClient
      .from("subprocessor_changes")
      .select(
        "id,vendor,change_type,effective_date,description,notice_sent_at,objection_deadline,recipients_count,status,created_by_email,created_at",
      )
      .order("created_at", { ascending: false })
      .limit(100);

    if (listError) {
      if (listError.code === "42P01") {
        return jsonResponse(503, {
          error: "Subprocessor changes table not found. Run latest SQL setup.",
        });
      }
      return jsonResponse(500, {
        error: "Failed to fetch subprocessor notices.",
      });
    }

    return jsonResponse(200, { notices: notices ?? [] });
  }

  return null;
};
