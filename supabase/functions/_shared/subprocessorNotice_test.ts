import { assertEquals, assertStringIncludes } from "https://deno.land/std@0.177.0/testing/asserts.ts";
import {
  buildSubprocessorEmailSubject,
  buildSubprocessorNoticeHtml,
  buildSubprocessorNoticePlainText,
  formatSubprocessorPreview,
} from "./subprocessorNotice.ts";

const BASE = {
  vendor: "Resend",
  changeType: "added" as const,
  effectiveDate: "2026-08-01",
};

// --- subject ---

Deno.test("buildSubprocessorEmailSubject: added", () => {
  assertEquals(
    buildSubprocessorEmailSubject("Resend", "added"),
    "ItemTraxx Data Processing Notice: Subprocessor Added — Resend",
  );
});

Deno.test("buildSubprocessorEmailSubject: replaced", () => {
  assertEquals(
    buildSubprocessorEmailSubject("PostHog", "replaced"),
    "ItemTraxx Data Processing Notice: Subprocessor Replaced — PostHog",
  );
});

Deno.test("buildSubprocessorEmailSubject: removed", () => {
  assertEquals(
    buildSubprocessorEmailSubject("Sentry", "removed"),
    "ItemTraxx Data Processing Notice: Subprocessor Removed — Sentry",
  );
});

// --- HTML content ---

Deno.test("buildSubprocessorNoticeHtml: contains vendor name", () => {
  const html = buildSubprocessorNoticeHtml(BASE);
  assertStringIncludes(html, "Resend");
});

Deno.test("buildSubprocessorNoticeHtml: contains effective date", () => {
  const html = buildSubprocessorNoticeHtml(BASE);
  assertStringIncludes(html, "August 1, 2026");
});

Deno.test("buildSubprocessorNoticeHtml: contains change type label for added", () => {
  const html = buildSubprocessorNoticeHtml(BASE);
  assertStringIncludes(html, "has been added as a subprocessor");
});

Deno.test("buildSubprocessorNoticeHtml: contains change type label for replaced", () => {
  const html = buildSubprocessorNoticeHtml({ ...BASE, changeType: "replaced" });
  assertStringIncludes(html, "is replacing an existing subprocessor");
});

Deno.test("buildSubprocessorNoticeHtml: contains change type label for removed", () => {
  const html = buildSubprocessorNoticeHtml({ ...BASE, changeType: "removed" });
  assertStringIncludes(html, "has been removed as a subprocessor");
});

Deno.test("buildSubprocessorNoticeHtml: optional description rendered", () => {
  const html = buildSubprocessorNoticeHtml({ ...BASE, description: "Used for transactional email delivery." });
  assertStringIncludes(html, "Used for transactional email delivery.");
});

Deno.test("buildSubprocessorNoticeHtml: omits description block when absent", () => {
  const html = buildSubprocessorNoticeHtml(BASE);
  assertEquals(html.includes("Details:"), false);
});

Deno.test("buildSubprocessorNoticeHtml: escapes HTML in vendor name", () => {
  const html = buildSubprocessorNoticeHtml({ ...BASE, vendor: '<script>alert("xss")</script>' });
  assertEquals(html.includes("<script>"), false);
  assertStringIncludes(html, "&lt;script&gt;");
});

Deno.test("buildSubprocessorNoticeHtml: escapes HTML in description", () => {
  const html = buildSubprocessorNoticeHtml({ ...BASE, description: '<img src=x onerror="bad()">' });
  assertEquals(html.includes("<img"), false);
  assertStringIncludes(html, "&lt;img");
});

Deno.test("buildSubprocessorNoticeHtml: custom legalHubUrl used", () => {
  const html = buildSubprocessorNoticeHtml({ ...BASE, legalHubUrl: "https://example.com/dpa" });
  assertStringIncludes(html, "https://example.com/dpa");
});

Deno.test("buildSubprocessorNoticeHtml: custom contactSupportUrl used", () => {
  const html = buildSubprocessorNoticeHtml({ ...BASE, contactSupportUrl: "https://example.com/support" });
  assertStringIncludes(html, "https://example.com/support");
});

Deno.test("buildSubprocessorNoticeHtml: falls back to default URLs", () => {
  const html = buildSubprocessorNoticeHtml(BASE);
  assertStringIncludes(html, "https://www.itemtraxx.com/legal");
  assertStringIncludes(html, "https://www.itemtraxx.com/contact-support");
});

Deno.test("buildSubprocessorNoticeHtml: logo img rendered when logoUrl provided", () => {
  const html = buildSubprocessorNoticeHtml({ ...BASE, logoUrl: "https://example.com/logo.png" });
  assertStringIncludes(html, 'src="https://example.com/logo.png"');
});

Deno.test("buildSubprocessorNoticeHtml: text fallback when logoUrl absent", () => {
  const html = buildSubprocessorNoticeHtml(BASE);
  assertStringIncludes(html, "ItemTraxx</span>");
});

// --- plain text ---

Deno.test("buildSubprocessorNoticePlainText: contains vendor and date", () => {
  const text = buildSubprocessorNoticePlainText(BASE);
  assertStringIncludes(text, "Resend");
  assertStringIncludes(text, "August 1, 2026");
});

Deno.test("buildSubprocessorNoticePlainText: optional description present", () => {
  const text = buildSubprocessorNoticePlainText({ ...BASE, description: "For email delivery." });
  assertStringIncludes(text, "For email delivery.");
});

Deno.test("buildSubprocessorNoticePlainText: omits description line when absent", () => {
  const text = buildSubprocessorNoticePlainText(BASE);
  assertEquals(text.includes("Details:"), false);
});

Deno.test("buildSubprocessorNoticePlainText: objection rights section present", () => {
  const text = buildSubprocessorNoticePlainText(BASE);
  assertStringIncludes(text, "YOUR RIGHTS");
  assertStringIncludes(text, "object to this change in writing");
});

// --- preview ---

Deno.test("formatSubprocessorPreview: returns correct shape", () => {
  const preview = formatSubprocessorPreview(BASE, 7);
  assertEquals(preview.targetCount, 7);
  assertEquals(preview.objectionDeadline, "2026-08-01");
  assertStringIncludes(preview.subject, "Resend");
  assertStringIncludes(preview.html, "Resend");
  assertStringIncludes(preview.text, "Resend");
});

Deno.test("formatSubprocessorPreview: zero recipients allowed", () => {
  const preview = formatSubprocessorPreview(BASE, 0);
  assertEquals(preview.targetCount, 0);
});
