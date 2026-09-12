import { buildPasswordResetEmail } from "./passwordResetEmail.ts";

const assert = (condition: unknown, message: string) => {
  if (!condition) throw new Error(message);
};

Deno.test("password reset email uses branded HTML and a complete text fallback", () => {
  const url =
    "https://edge.itemtraxx.com/api/auth/reset-password/token?callbackURL=https%3A%2F%2Fitemtraxx.com%2Freset-password&source=test";
  const email = buildPasswordResetEmail({ name: "Ada Lovelace", url });

  assert(email.html.includes("Reset your ItemTraxx password"), "missing reset heading");
  assert(email.html.includes("Reset password"), "missing reset CTA");
  assert(email.html.includes("Hi Ada Lovelace,"), "missing escaped greeting");
  assert(email.html.includes("&amp;source=test"), "URL was not HTML-escaped");
  assert(email.text.includes(`Reset your password: ${url}`), "missing text reset URL");
  assert(email.text.includes("This single-use link expires in 60 minutes."), "missing expiry text");
  assert(email.attachments.some((attachment) => attachment.content_id === "itemtraxx-logo-light"), "missing branded logo attachment");
});

Deno.test("password reset email escapes user-controlled names in HTML", () => {
  const email = buildPasswordResetEmail({
    name: "<script>alert('xss')</script>",
    url: "https://edge.itemtraxx.com/reset",
  });

  assert(!email.html.includes("<script>alert('xss')</script>"), "raw user HTML was emitted");
  assert(email.html.includes("&lt;script&gt;alert(&#39;xss&#39;)&lt;/script&gt;"), "escaped user name missing");
});
