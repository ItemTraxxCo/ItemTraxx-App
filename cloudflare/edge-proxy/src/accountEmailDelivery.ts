import {
  buildEmailChangeApprovalEmail,
  buildEmailVerificationEmail,
  buildWorkspaceAccountInvitationEmail,
} from "./accountEmails.ts";

export type AccountEmailEnvironment = {
  RESEND_API_KEY?: string;
  ITX_RESEND_API_KEY?: string;
  ITX_RESEND_FROM?: string;
  ITX_EMAIL_NOTIFICATIONS?: string;
  ITX_EMAIL_NOREPLY?: string;
  ITX_EMAIL_FROM?: string;
};

export type AccountEmailRequest =
  | {
    kind: "workspace-account-invitation";
    to: string;
    url: string;
    accountRole: "tenant_account" | "workspace_admin";
  }
  | {
    kind: "email-change-approval";
    to: string;
    url: string;
    newEmail: string;
  }
  | {
    kind: "email-change-verification";
    to: string;
    url: string;
  };

const firstConfiguredValue = (...values: Array<string | undefined>) =>
  values.find((value) => typeof value === "string" && value.trim())?.trim() ??
  "";

const renderMessage = (message: AccountEmailRequest) => {
  if (message.kind === "workspace-account-invitation") {
    return {
      subject: "You’re invited to ItemTraxx",
      ...buildWorkspaceAccountInvitationEmail({
        url: message.url,
        accountRole: message.accountRole,
      }),
    };
  }
  if (message.kind === "email-change-approval") {
    return {
      subject: "Approve your ItemTraxx email change",
      ...buildEmailChangeApprovalEmail({
        url: message.url,
        newEmail: message.newEmail,
      }),
    };
  }
  return {
    subject: "Verify your new ItemTraxx sign-in email",
    ...buildEmailVerificationEmail({ url: message.url }),
  };
};

export const sendAccountEmail = async (
  env: AccountEmailEnvironment,
  message: AccountEmailRequest,
) => {
  const apiKey = firstConfiguredValue(env.RESEND_API_KEY, env.ITX_RESEND_API_KEY);
  const from = firstConfiguredValue(
    env.ITX_RESEND_FROM,
    env.ITX_EMAIL_NOTIFICATIONS,
    env.ITX_EMAIL_NOREPLY,
    env.ITX_EMAIL_FROM,
  );
  if (!apiKey || !from) throw new Error("Account email delivery is not configured");

  const email = renderMessage(message);
  const response = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      from,
      to: [message.to],
      subject: email.subject,
      html: email.html,
      text: email.text,
      attachments: email.attachments,
    }),
  });
  if (!response.ok) {
    throw new Error(`Account email delivery failed (${response.status})`);
  }
};
