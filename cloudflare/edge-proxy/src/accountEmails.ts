import {
  applyEmailTheme,
  buildEmailBrandHeaderHtml,
  withEmailBrandLogoAttachment,
} from "../../../supabase/functions/_shared/emailBranding.ts";

const CONTACT_SUPPORT_URL = "https://itemtraxx.com/contact-support";

const escapeHtml = (value: string) =>
  value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");

const buildBrandedMessage = ({
  preheader,
  title,
  body,
  buttonLabel,
  url,
  expiration,
}: {
  preheader: string;
  title: string;
  body: string;
  buttonLabel: string;
  url: string;
  expiration: string;
}) => {
  const safeUrl = escapeHtml(url);
  const html = applyEmailTheme(`<!doctype html>
<html>
  <body style="margin:0;padding:0;background:#f6f5f2;font-family:Arial,Helvetica,sans-serif;color:#171717;">
    <div style="display:none;max-height:0;overflow:hidden;opacity:0;">${escapeHtml(preheader)}</div>
    <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="background:#f6f5f2;padding:24px 12px;">
      <tr><td align="center">
        <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="max-width:560px;background:#ffffff;border:1px solid #d8d6d1;overflow:hidden;">
          <tr><td style="padding:24px 28px 14px;background:#ffffff;border-bottom:1px solid #e7e5df;color:#171717;">${buildEmailBrandHeaderHtml({ brandName: "ItemTraxx" })}</td></tr>
          <tr><td style="padding:28px;">
            <h1 style="margin:0 0 16px;font-size:22px;line-height:1.3;color:#171717;">${escapeHtml(title)}</h1>
            <p style="margin:0 0 22px;font-size:15px;line-height:1.6;color:#343330;">${body}</p>
            <p style="margin:0 0 24px;text-align:center;"><a href="${safeUrl}" style="display:inline-block;padding:13px 24px;border-radius:8px;background:#0f172a;color:#ffffff;font-size:15px;font-weight:700;line-height:1.2;text-decoration:none;">${escapeHtml(buttonLabel)}</a></p>
            <p style="margin:0 0 14px;font-size:14px;line-height:1.6;color:#68645f;">${escapeHtml(expiration)}</p>
            <p style="margin:0;font-size:14px;line-height:1.6;color:#68645f;">If you did not request this, you can safely ignore this email.</p>
            <div style="height:1px;line-height:1px;background:#d8d6d1;margin:24px 0 18px;">&nbsp;</div>
            <p style="margin:0;font-size:12px;line-height:1.6;color:#8b8680;">If the button does not work, copy and paste this URL into your browser:<br /><span style="overflow-wrap:anywhere;word-break:break-word;">${safeUrl}</span></p>
          </td></tr>
          <tr><td style="padding:16px 24px;border-top:1px solid #e7e5df;background:#fbfaf8;">
            <p style="margin:0;font-size:12px;line-height:1.6;color:#68645f;"><a href="${CONTACT_SUPPORT_URL}" style="color:#171717;text-decoration:underline;text-underline-offset:2px;">Contact support</a></p>
            <p style="margin:6px 0 0;font-size:12px;line-height:1.6;color:#8b8680;">&copy; 2026 ItemTraxx Co. All rights reserved.</p>
          </td></tr>
        </table>
      </td></tr>
    </table>
  </body>
</html>`);

  const text = [
    title,
    "",
    body.replace(/<[^>]*>/g, ""),
    `${buttonLabel}: ${url}`,
    "",
    expiration,
    "If you did not request this, you can safely ignore this email.",
    "",
    `Need help? ${CONTACT_SUPPORT_URL}`,
  ].join("\n");
  const payload = withEmailBrandLogoAttachment({ html, text });
  return {
    html: String(payload.html),
    text: String(payload.text),
    attachments: Array.isArray(payload.attachments) ? payload.attachments : [],
  };
};

export const buildWorkspaceAccountInvitationEmail = ({
  url,
  accountRole,
}: {
  url: string;
  accountRole: "tenant_account" | "workspace_admin";
}) => {
  const roleLabel = accountRole === "workspace_admin"
    ? "Workspace Admin"
    : "Tenant Account";
  return buildBrandedMessage({
    preheader: "You have an ItemTraxx account invitation.",
    title: "You’re invited to ItemTraxx",
    body: `You have been invited to set up an ItemTraxx ${roleLabel} account. Use the link below to review the invitation and choose a password.`,
    buttonLabel: "Review invitation",
    url,
    expiration: "This single-use invitation expires in 72 hours.",
  });
};

export const buildEmailChangeApprovalEmail = ({
  url,
  newEmail,
}: {
  url: string;
  newEmail: string;
}) =>
  buildBrandedMessage({
    preheader: "Approve your ItemTraxx sign-in email change.",
    title: "Approve your email change",
    body: `We received a request to change the sign-in email for your ItemTraxx account to <strong>${escapeHtml(newEmail)}</strong>. Approve the request from your current email address. We will then send a separate verification link to the new address.`,
    buttonLabel: "Approve email change",
    url,
    expiration: "This single-use approval link expires in 60 minutes.",
  });

export const buildEmailVerificationEmail = ({ url }: { url: string }) =>
  buildBrandedMessage({
    preheader: "Verify your new ItemTraxx sign-in email.",
    title: "Verify your new email",
    body: "Approve this link to finish changing the sign-in email on your ItemTraxx account.",
    buttonLabel: "Verify new email",
    url,
    expiration: "This single-use verification link expires in 60 minutes.",
  });
