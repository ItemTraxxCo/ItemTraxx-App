export type SubprocessorChangeType = "added" | "replaced" | "removed";

export interface SubprocessorNoticePayload {
  vendor: string;
  changeType: SubprocessorChangeType;
  effectiveDate: string; // YYYY-MM-DD
  description?: string;
  logoUrl?: string | null;
  legalHubUrl?: string;
  contactSupportUrl?: string;
}

export interface SubprocessorPreview {
  subject: string;
  html: string;
  text: string;
  targetCount: number;
  objectionDeadline: string;
}

const escapeHtml = (s: string): string =>
  s
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");

function changeTypeLabel(t: SubprocessorChangeType): string {
  if (t === "added") return "has been added as a subprocessor";
  if (t === "replaced") return "is replacing an existing subprocessor";
  return "has been removed as a subprocessor";
}

function changeTypeSuffix(t: SubprocessorChangeType): string {
  if (t === "added") return "Added";
  if (t === "replaced") return "Replaced";
  return "Removed";
}

function formatDateLabel(iso: string): string {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(iso)) return iso;
  const [year, month, day] = iso.split("-").map(Number);
  const parsed = new Date(Date.UTC(year, month - 1, day));
  if (
    parsed.getUTCFullYear() !== year ||
    parsed.getUTCMonth() !== month - 1 ||
    parsed.getUTCDate() !== day
  ) {
    return iso;
  }
  const months = [
    "January",
    "February",
    "March",
    "April",
    "May",
    "June",
    "July",
    "August",
    "September",
    "October",
    "November",
    "December",
  ];
  return `${months[month - 1]} ${day}, ${year}`;
}

export function buildSubprocessorEmailSubject(
  vendor: string,
  changeType: SubprocessorChangeType,
): string {
  return `ItemTraxx Data Processing Notice: Subprocessor ${
    changeTypeSuffix(changeType)
  } — ${vendor}`;
}

export function buildSubprocessorNoticeHtml(
  p: SubprocessorNoticePayload,
): string {
  const legalHubUrl = p.legalHubUrl ?? "https://www.itemtraxx.com/legal";
  const contactSupportUrl = p.contactSupportUrl ??
    "https://www.itemtraxx.com/contact-support";
  const effectiveDateLabel = formatDateLabel(p.effectiveDate);
  const vendorSafe = escapeHtml(p.vendor);
  const descriptionBlock = p.description
    ? `<tr><td style="padding:0 0 10px;font-size:14px;color:#444444;line-height:1.6;"><strong>Details:</strong> ${
      escapeHtml(p.description)
    }</td></tr>`
    : "";

  const logoBlock = p.logoUrl
    ? `<img src="${
      escapeHtml(p.logoUrl)
    }" alt="ItemTraxx" height="40" style="display:block;border:0;" />`
    : `<span style="font-size:18px;font-weight:700;color:#111111;">ItemTraxx</span>`;

  return `<!DOCTYPE html>
<html lang="en">
<head><meta charset="UTF-8" /><meta name="viewport" content="width=device-width,initial-scale=1" /></head>
<body style="margin:0;padding:0;background:#f5f5f5;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Helvetica,Arial,sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" role="presentation">
    <tr>
      <td align="center" style="padding:32px 16px;">
        <table width="600" cellpadding="0" cellspacing="0" role="presentation" style="max-width:600px;background:#ffffff;border-radius:8px;border:1px solid #e5e5e5;">
          <tr>
            <td style="padding:28px 32px 20px;border-bottom:1px solid #e5e5e5;">
              ${logoBlock}
            </td>
          </tr>
          <tr>
            <td style="padding:28px 32px 0;">
              <table width="100%" cellpadding="0" cellspacing="0" role="presentation">
                <tr>
                  <td style="padding:0 0 16px;">
                    <h1 style="margin:0;font-size:20px;font-weight:700;color:#111111;line-height:1.3;">
                      Data Processing Notice: Subprocessor ${
    escapeHtml(changeTypeSuffix(p.changeType))
  }
                    </h1>
                  </td>
                </tr>
                <tr>
                  <td style="padding:0 0 20px;font-size:15px;color:#444444;line-height:1.6;">
                    You are receiving this notice because your organization has an active ItemTraxx service
                    agreement that includes a Data Processing Addendum. Under that agreement, ItemTraxx is
                    required to notify you at least 30 days before adding or replacing a subprocessor.
                  </td>
                </tr>
                <tr>
                  <td style="padding:0 0 24px;">
                    <table width="100%" cellpadding="16" cellspacing="0" role="presentation"
                      style="background:#f9f9f9;border:1px solid #e5e5e5;border-radius:6px;">
                      <tr>
                        <td style="padding:0 0 10px;font-size:14px;color:#444444;line-height:1.6;">
                          <strong>Subprocessor:</strong> ${vendorSafe}
                        </td>
                      </tr>
                      <tr>
                        <td style="padding:0 0 10px;font-size:14px;color:#444444;line-height:1.6;">
                          <strong>Change:</strong> ${vendorSafe} ${
    escapeHtml(changeTypeLabel(p.changeType))
  }
                        </td>
                      </tr>
                      <tr>
                        <td style="padding:0 0 10px;font-size:14px;color:#444444;line-height:1.6;">
                          <strong>Effective date:</strong> ${
    escapeHtml(effectiveDateLabel)
  }
                        </td>
                      </tr>
                      ${descriptionBlock}
                    </table>
                  </td>
                </tr>
                <tr>
                  <td style="padding:0 0 20px;font-size:15px;color:#444444;line-height:1.6;">
                    Under your Data Processing Addendum, you may object to this change in writing before
                    the effective date (<strong>${
    escapeHtml(effectiveDateLabel)
  }</strong>). If you have
                    questions, wish to object, or need a copy of the updated DPA, please contact us.
                  </td>
                </tr>
                <tr>
                  <td style="padding:0 0 28px;">
                    <table cellpadding="0" cellspacing="0" role="presentation">
                      <tr>
                        <td style="padding-right:12px;">
                          <a href="${escapeHtml(contactSupportUrl)}"
                            style="display:inline-block;padding:10px 18px;background:#111111;color:#ffffff;font-size:14px;font-weight:600;text-decoration:none;border-radius:5px;">
                            Contact Support
                          </a>
                        </td>
                        <td>
                          <a href="${escapeHtml(legalHubUrl)}"
                            style="display:inline-block;padding:10px 18px;background:#ffffff;color:#111111;font-size:14px;font-weight:600;text-decoration:none;border-radius:5px;border:1px solid #cccccc;">
                            View DPA &amp; Legal Docs
                          </a>
                        </td>
                      </tr>
                    </table>
                  </td>
                </tr>
              </table>
            </td>
          </tr>
          <tr>
            <td style="padding:18px 32px;border-top:1px solid #e5e5e5;font-size:12px;color:#888888;line-height:1.5;">
              This is a required legal notice sent to customers with an active Data Processing Addendum.
              ItemTraxx Co &middot; 670 San Antonio Rd, Palo Alto, CA 94306, USA &middot; support@itemtraxx.com
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>`;
}

export function buildSubprocessorNoticePlainText(
  p: SubprocessorNoticePayload,
): string {
  const legalHubUrl = p.legalHubUrl ?? "https://www.itemtraxx.com/legal";
  const contactSupportUrl = p.contactSupportUrl ??
    "https://www.itemtraxx.com/contact-support";
  const effectiveDateLabel = formatDateLabel(p.effectiveDate);
  const descriptionLine = p.description ? `Details: ${p.description}\n` : "";

  return `ItemTraxx Data Processing Notice: Subprocessor ${
    changeTypeSuffix(p.changeType)
  }

You are receiving this notice because your organization has an active ItemTraxx service agreement
that includes a Data Processing Addendum. Under that agreement, ItemTraxx is required to notify
you at least 30 days before adding or replacing a subprocessor.

CHANGE DETAILS
--------------
Subprocessor: ${p.vendor}
Change: ${p.vendor} ${changeTypeLabel(p.changeType)}
Effective date: ${effectiveDateLabel}
${descriptionLine}
YOUR RIGHTS
-----------
Under your Data Processing Addendum, you may object to this change in writing before the effective
date (${effectiveDateLabel}). If you have questions, wish to object, or need a copy of the updated
DPA, please contact us before that date.

Contact Support: ${contactSupportUrl}
View DPA & Legal Docs: ${legalHubUrl}

---
This is a required legal notice sent to customers with an active Data Processing Addendum.
ItemTraxx Co · 670 San Antonio Rd, Palo Alto, CA 94306, USA · support@itemtraxx.com
`;
}

export function formatSubprocessorPreview(
  p: SubprocessorNoticePayload,
  targetCount: number,
): SubprocessorPreview {
  return {
    subject: buildSubprocessorEmailSubject(p.vendor, p.changeType),
    html: buildSubprocessorNoticeHtml(p),
    text: buildSubprocessorNoticePlainText(p),
    targetCount,
    objectionDeadline: p.effectiveDate,
  };
}
