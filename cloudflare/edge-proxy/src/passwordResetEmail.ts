import {
  applyEmailTheme,
  buildEmailBrandHeaderHtml,
  withEmailBrandLogoAttachment,
} from "../../../supabase/functions/_shared/emailBranding.ts";

const CONTACT_SUPPORT_URL = "https://itemtraxx.com/contact-support";
const RESET_EXPIRY_MINUTES = 60;

const escapeHtml = (value: string) =>
  value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");

const normalizeDisplayName = (name?: string | null) =>
  name?.replace(/\s+/g, " ").trim() || null;

const buildGreeting = (name?: string | null) => {
  const normalizedName = normalizeDisplayName(name);
  return normalizedName ? `Hi ${escapeHtml(normalizedName)},` : "Hello,";
};

const buildTextGreeting = (name?: string | null) => {
  const normalizedName = normalizeDisplayName(name);
  return normalizedName ? `Hi ${normalizedName},` : "Hello,";
};

export type PasswordResetEmail = {
  html: string;
  text: string;
  attachments: Array<Record<string, unknown>>;
};

/**
 * Build the password-reset email using the same branded presentation layer as
 * the existing transactional ItemTraxx emails. The text part remains a
 * complete fallback for clients that do not render HTML.
 */
export const buildPasswordResetEmail = ({
  name,
  url,
}: {
  name?: string | null;
  url: string;
}): PasswordResetEmail => {
  const safeUrl = escapeHtml(url);
  const greeting = buildGreeting(name);
  const textGreeting = buildTextGreeting(name);

  const html = applyEmailTheme(`<!doctype html>
<html>
  <body style="margin:0;padding:0;background:#f6f5f2;font-family:Arial,Helvetica,sans-serif;color:#171717;">
    <div style="display:none;max-height:0;overflow:hidden;opacity:0;">
      Reset your ItemTraxx password securely.
    </div>
    <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="background:#f6f5f2;padding:24px 12px;">
      <tr>
        <td align="center">
          <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="max-width:560px;background:#ffffff;border:1px solid #d8d6d1;border-radius:0;overflow:hidden;">
            <tr>
              <td style="padding:24px 28px 14px 28px;background:#ffffff;border-bottom:1px solid #e7e5df;color:#171717;">
                ${buildEmailBrandHeaderHtml({ brandName: "ItemTraxx" })}
              </td>
            </tr>
            <tr>
              <td style="padding:28px;">
                <h1 style="margin:0 0 12px 0;font-size:22px;line-height:1.3;color:#171717;">Reset your ItemTraxx password</h1>
                <p style="margin:0 0 18px 0;font-size:15px;line-height:1.6;color:#343330;">${greeting}</p>
                <p style="margin:0 0 22px 0;font-size:15px;line-height:1.6;color:#343330;">
                  We received a request to reset the password for your ItemTraxx account. Click the button below to choose a new password.
                </p>
                <p style="margin:0 0 24px 0;text-align:center;">
                  <a href="${safeUrl}" style="display:inline-block;padding:13px 24px;border-radius:8px;background:#0f172a;color:#ffffff;font-size:15px;font-weight:700;line-height:1.2;text-decoration:none;">Reset password</a>
                </p>
                <p style="margin:0 0 14px 0;font-size:14px;line-height:1.6;color:#68645f;">
                  This single-use link expires in ${RESET_EXPIRY_MINUTES} minutes.
                </p>
                <p style="margin:0;font-size:14px;line-height:1.6;color:#68645f;">
                  If you did not request this, you can safely ignore this email. Your password will not change unless you use the link above.
                </p>
                <div style="height:1px;line-height:1px;background:#d8d6d1;margin:24px 0 18px 0;">&nbsp;</div>
                <p style="margin:0;font-size:12px;line-height:1.6;color:#8b8680;">
                  If the button does not work, copy and paste this URL into your browser:<br />
                  <span style="overflow-wrap:anywhere;word-break:break-word;">${safeUrl}</span>
                </p>
              </td>
            </tr>
            <tr>
              <td style="padding:16px 24px;border-top:1px solid #e7e5df;background:#fbfaf8;">
                <p style="margin:0;font-size:12px;line-height:1.6;color:#68645f;">
                  <a href="${CONTACT_SUPPORT_URL}" style="color:#171717;text-decoration:underline;text-underline-offset:2px;">Contact support</a>
                </p>
                <p style="margin:6px 0 0 0;font-size:12px;line-height:1.6;color:#8b8680;">
                  &copy; 2026 ItemTraxx Co. All rights reserved.
                </p>
              </td>
            </tr>
          </table>
        </td>
      </tr>
    </table>
  </body>
</html>`);

  const text = [
    textGreeting,
    "",
    "We received a request to reset the password for your ItemTraxx account.",
    `Reset your password: ${url}`,
    "",
    `This single-use link expires in ${RESET_EXPIRY_MINUTES} minutes.`,
    "If you did not request this, you can safely ignore this email. Your password will not change unless you use the link.",
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
