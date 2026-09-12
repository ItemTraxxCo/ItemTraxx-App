import { buildPasswordResetEmail } from "./passwordResetEmail.ts";

export type PasswordResetDeliveryEnvironment = {
  RESEND_API_KEY?: string;
  ITX_RESEND_API_KEY?: string;
  ITX_RESEND_FROM?: string;
  ITX_EMAIL_NOTIFICATIONS?: string;
  ITX_EMAIL_NOREPLY?: string;
  ITX_EMAIL_FROM?: string;
};

export type PasswordResetDeliveryOutcome =
  | { status: "sent"; providerMessageId: string | null }
  | { status: "failed"; message: string };

type PasswordResetUser = {
  email: string;
  name?: string | null;
};

const outcomes = new WeakMap<Request, PasswordResetDeliveryOutcome>();

const firstConfiguredValue = (...values: Array<string | undefined>) =>
  values.find((value) => typeof value === "string" && value.trim())?.trim() ??
  "";

const recordOutcome = (
  request: Request | undefined,
  outcome: PasswordResetDeliveryOutcome,
) => {
  if (request) outcomes.set(request, outcome);
};

const failure = (request: Request | undefined, message: string): never => {
  recordOutcome(request, { status: "failed", message });
  throw new Error(message);
};

/**
 * Returns the delivery result associated with one Better Auth request. A
 * WeakMap keeps concurrent reset requests isolated without retaining request
 * objects after the Worker has finished handling them.
 */
export const getPasswordResetDelivery = (request: Request) => outcomes.get(request);

/**
 * Send a reset email and record whether Resend accepted it. Better Auth's
 * requestPasswordReset endpoint intentionally hides callback failures, so the
 * caller must inspect this outcome before reporting success for privileged
 * reset operations or returning the public reset response.
 */
export const sendPasswordResetEmail = async ({
  env,
  user,
  url,
  request,
}: {
  env: PasswordResetDeliveryEnvironment;
  user: PasswordResetUser;
  url: string;
  request?: Request;
}) => {
  const apiKey = firstConfiguredValue(env.RESEND_API_KEY, env.ITX_RESEND_API_KEY);
  const from = firstConfiguredValue(
    env.ITX_RESEND_FROM,
    env.ITX_EMAIL_NOTIFICATIONS,
    env.ITX_EMAIL_NOREPLY,
    env.ITX_EMAIL_FROM,
  );
  if (!apiKey || !from) {
    return failure(request, "Password reset email delivery is not configured");
  }

  try {
    const email = buildPasswordResetEmail({ name: user.name, url });
    const response = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        from,
        to: [user.email],
        subject: "Reset your ItemTraxx password",
        html: email.html,
        text: email.text,
        attachments: email.attachments,
      }),
    });

    const responseBody = await response.json().catch(() => null) as {
      id?: unknown;
    } | null;
    if (!response.ok) {
      return failure(
        request,
        `Password reset email delivery failed (${response.status})`,
      );
    }

    recordOutcome(request, {
      status: "sent",
      providerMessageId: typeof responseBody?.id === "string"
        ? responseBody.id
        : null,
    });
  } catch (cause) {
    if (request && outcomes.get(request)?.status !== "failed") {
      recordOutcome(request, {
        status: "failed",
        message: "Password reset email delivery failed",
      });
    }
    if (cause instanceof Error) throw cause;
    throw new Error("Password reset email delivery failed");
  }
};
