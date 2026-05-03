import { copyFile, mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, "..");
const outDir = path.join(repoRoot, "tmp", "email-previews");

const logoSource = path.join(repoRoot, "public", "brand", "logo-light.png");
const logoFileName = "brand-logo.png";
const logoUrl = `./${logoFileName}`;
const passwordResetUrl = "https://itemtraxx.com/forgot-password";
const contactSupportUrl = "https://itemtraxx.com/contact-support";

const escapeHtml = (value) =>
  String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");

const brandHeader = () =>
  [
    `<img`,
    ` src="${logoUrl}"`,
    ` alt="ItemTraxx"`,
    ` width="150"`,
    ` height="50"`,
    ` style="display:block;width:150px;height:50px;max-width:150px;border:0;outline:none;text-decoration:none;"`,
    ` />`,
  ].join("");

const paragraph = (content) =>
  `<p style="margin:0 0 14px 0;font-size:15px;line-height:1.6;color:#343330;">${content}</p>`;

const mutedParagraph = (content) =>
  `<p style="margin:0;font-size:14px;line-height:1.6;color:#68645f;">${content}</p>`;

const details = (rows) =>
  `<p style="margin:0 0 14px 0;font-size:15px;line-height:1.7;color:#343330;">${rows
    .map(([label, value]) => `<strong>${escapeHtml(label)}:</strong> ${escapeHtml(value)}`)
    .join("<br />")}</p>`;

const divider = () =>
  `<div style="height:1px;line-height:1px;background:#d8d6d1;margin:0 0 22px 0;">&nbsp;</div>`;

const callout = (content, large = false) =>
  `<div style="margin:0 0 18px 0;padding:16px 18px;border-radius:0;background:#fbfaf8;border:1px solid #d8d6d1;font-size:${
    large ? "28px" : "14px"
  };line-height:${large ? "1.2" : "1.7"};font-weight:${
    large ? "700" : "400"
  };letter-spacing:${large ? "0.22em" : "0"};color:#171717;text-align:${
    large ? "center" : "left"
  };">${content}</div>`;

const footer = (supportEmail, prefix = "Need help? Contact") => {
  const email = escapeHtml(supportEmail);
  return `<tr>
              <td style="padding:16px 24px;border-top:1px solid #e7e5df;background:#fbfaf8;">
                <p style="margin:0;font-size:12px;line-height:1.6;color:#68645f;">
                  ${escapeHtml(prefix)}
                  <a href="mailto:${email}" style="color:#171717;text-decoration:underline;text-underline-offset:2px;">${email}</a>
                </p>
                <p style="margin:6px 0 0 0;font-size:12px;line-height:1.6;color:#8b8680;">
                  &copy; 2026 ItemTraxx Co. All rights reserved.
                </p>
              </td>
            </tr>`;
};

const shell = ({ title, body, supportEmail = "support@itemtraxx.com", footerPrefix }) => `<!doctype html>
<html>
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width,initial-scale=1" />
    <title>${escapeHtml(title)}</title>
  </head>
  <body style="margin:0;padding:0;background:#f6f5f2;font-family:Arial,Helvetica,sans-serif;color:#171717;">
    <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="background:#f6f5f2;padding:24px 12px;">
      <tr>
        <td align="center">
          <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="max-width:560px;background:#ffffff;border:1px solid #d8d6d1;border-radius:0;overflow:hidden;">
            <tr>
              <td style="padding:24px 28px 14px 28px;background:#ffffff;border-bottom:1px solid #e7e5df;color:#171717;">
                ${brandHeader()}
              </td>
            </tr>
            <tr>
              <td style="padding:28px;">
                <h2 style="margin:0 0 12px 0;font-size:22px;line-height:1.3;color:#171717;">${escapeHtml(title)}</h2>
                ${body}
              </td>
            </tr>
            ${footer(supportEmail, footerPrefix)}
          </table>
        </td>
      </tr>
    </table>
  </body>
</html>`;

const previews = [
  {
    file: "login-notification.html",
    label: "Login notification",
    html: shell({
      title: "New login to ItemTraxx",
      body:
        paragraph("We noticed a tenant admin sign in to your ItemTraxx account from a new device or browser.") +
        divider() +
        details([
          ["Sign-in type", "Tenant admin sign in"],
          ["Tenant", "Demo School Equipment Room"],
          ["Platform", "Arc on macOS"],
          ["Location", "Los Angeles, United States (203.0.113.24)"],
          ["Time", "2026-05-02T23:45:00.000Z (UTC)"],
        ]) +
        divider() +
        mutedParagraph(
          `If this wasn't you, <a href="${passwordResetUrl}" style="color:#171717;text-decoration:underline;text-underline-offset:2px;">reset your password</a> and <a href="${contactSupportUrl}" style="color:#171717;text-decoration:underline;text-underline-offset:2px;">contact support immediately</a>.`
        ),
      footerPrefix: "Contact support:",
    }),
  },
  {
    file: "super-admin-verification.html",
    label: "Super admin verification",
    html: shell({
      title: "Your Verification Code",
      body:
        paragraph("Use the following 6-digit verification code to finish signing in to ItemTraxx super admin.") +
        callout("482913", true) +
        mutedParagraph("This code expires in 10 minutes and can only be used once.") +
        mutedParagraph(
          `If this wasn't you, <a href="${passwordResetUrl}" style="color:#171717;text-decoration:underline;text-underline-offset:2px;">reset your password</a> and <a href="${contactSupportUrl}" style="color:#171717;text-decoration:underline;text-underline-offset:2px;">contact support immediately</a>.`
        ),
    }),
  },
  {
    file: "sales-inquiry-internal.html",
    label: "Sales inquiry internal",
    html: shell({
      title: "New Sales Inquiry",
      body:
        paragraph("A new sales inquiry was submitted through the ItemTraxx pricing/contact flow.") +
        details([
          ["Plan", "ItemTraxx Organization Scale Plan"],
          ["Name", "Jordan Smith"],
          ["Organization", "Demo High School"],
          ["Reply email", "jordan@example.com"],
          ["Lead ID", "lead_012345"],
        ]) +
        paragraph("<strong>Details</strong>") +
        callout("We need checkout and return tracking for three equipment rooms and a small IT loaner pool."),
      supportEmail: "sales@itemtraxx.com",
      footerPrefix: "Reply contact:",
    }),
  },
  {
    file: "sales-confirmation.html",
    label: "Sales confirmation",
    html: shell({
      title: "We Received Your Sales Inquiry",
      body:
        paragraph("Hi Jordan,") +
        paragraph("Thanks for contacting the ItemTraxx team. We received your request and will follow up with a quote within 2 business days.") +
        details([
          ["Plan", "ItemTraxx Organization Scale Plan"],
          ["Organization", "Demo High School"],
        ]) +
        mutedParagraph("If you need to add anything else, you can reply directly to this email."),
      supportEmail: "sales@itemtraxx.com",
    }),
  },
  {
    file: "support-request-internal.html",
    label: "Support request internal",
    html: shell({
      title: "New Support Request",
      body:
        paragraph("A new support request was submitted through the ItemTraxx support form.") +
        details([
          ["Name", "Alex Rivera"],
          ["Reply email", "alex@example.com"],
          ["Category", "Account access"],
          ["Subject", "Unable to access tenant admin"],
        ]) +
        paragraph("<strong>Message</strong>") +
        callout("The admin login worked yesterday, but today it returns an access denied message."),
      footerPrefix: "Reply contact:",
    }),
  },
  {
    file: "support-confirmation.html",
    label: "Support confirmation",
    html: shell({
      title: "We Received Your Support Request",
      body:
        paragraph("Hi Alex,") +
        paragraph("We received your support request and will respond as soon as possible.") +
        details([
          ["Category", "Account access"],
          ["Subject", "Unable to access tenant admin"],
        ]) +
        mutedParagraph("If you need to add anything else, reply directly to this email."),
    }),
  },
  {
    file: "district-support.html",
    label: "District support request",
    html: shell({
      title: "District Support Request",
      body:
        paragraph("A district admin submitted a support request through the district workspace.") +
        details([
          ["District ID", "dist_012345"],
          ["Requester", "Morgan Lee"],
          ["Requester Email", "morgan@example.com"],
          ["Priority", "High"],
          ["Subject", "Checkout queue is blocked"],
        ]) +
        paragraph("<strong>Message</strong>") +
        callout("Operators are unable to complete checkout at the main desk."),
      footerPrefix: "Reply contact:",
    }),
  },
];

const indexHtml = `<!doctype html>
<html>
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width,initial-scale=1" />
    <title>ItemTraxx Email Previews</title>
    <style>
      :root { color-scheme: light; font-family: Arial, Helvetica, sans-serif; background: #f6f5f2; color: #171717; }
      body { margin: 0; padding: 32px; }
      main { max-width: 920px; margin: 0 auto; }
      h1 { margin: 0 0 10px; font-size: 28px; }
      p { margin: 0 0 24px; color: #68645f; line-height: 1.6; }
      ul { list-style: none; padding: 0; margin: 0; display: grid; gap: 10px; }
      a { display: block; padding: 16px 18px; background: #fff; border: 1px solid #d8d6d1; color: #171717; text-decoration: none; }
      a:hover { border-color: #171717; }
      code { background: #fff; border: 1px solid #d8d6d1; padding: 2px 5px; }
    </style>
  </head>
  <body>
    <main>
      <h1>ItemTraxx Email Previews</h1>
      <p>These are local browser previews for layout review only. Real email clients can render HTML differently. Generated in <code>tmp/email-previews</code>.</p>
      <ul>
        ${previews.map((preview) => `<li><a href="./${preview.file}">${escapeHtml(preview.label)}</a></li>`).join("\n        ")}
      </ul>
    </main>
  </body>
</html>`;

await mkdir(outDir, { recursive: true });
await copyFile(logoSource, path.join(outDir, logoFileName));
await Promise.all(previews.map((preview) => writeFile(path.join(outDir, preview.file), preview.html)));
await writeFile(path.join(outDir, "index.html"), indexHtml);

console.log(`Wrote ${previews.length} email previews to ${outDir}`);
console.log(`Open ${path.join(outDir, "index.html")}`);
