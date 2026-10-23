import {
  buildEmailChangeApprovalEmail,
  buildEmailVerificationEmail,
  buildWorkspaceAccountInvitationEmail,
} from "./accountEmails.ts";

Deno.test("workspace invitations name the organization and are branded", () => {
  const organizationName = "Northview & West <Campus>";
  const email = buildWorkspaceAccountInvitationEmail({
    url: `https://itemtraxx.com/accept-invitation#token=${"0123456789abcdef".repeat(4)}`,
    organizationName,
  });
  if (
    !email.html.includes("You have been invited to join Northview &amp; West &lt;Campus&gt; on ItemTraxx.") ||
    !email.html.includes("Review invitation")
  ) {
    throw new Error("workspace invitation does not identify the organization");
  }
  if (!email.text.includes(`You have been invited to join ${organizationName} on ItemTraxx.`)) {
    throw new Error("plain-text invitation does not preserve the organization name");
  }
  if (email.html.includes("Tenant Account") || email.html.includes("Workspace Admin")) {
    throw new Error("workspace invitation still exposes the account role in its copy");
  }
  if (!email.text.includes(`https://itemtraxx.com/accept-invitation#token=${"0123456789abcdef".repeat(4)}`)) {
    throw new Error("plain-text invitation is missing the single-use link");
  }
  if (!email.attachments.some((attachment) => attachment.content_id === "itemtraxx-logo-light")) {
    throw new Error("branded invitation is missing the inline ItemTraxx logo");
  }
});

Deno.test("email-change approval escapes the proposed address and requires the second mailbox check", () => {
  const email = buildEmailChangeApprovalEmail({
    url: `https://itemtraxx.com/account/email-change#step=approve&token=${"0123456789abcdef".repeat(4)}`,
    newEmail: '<script>alert("x")</script>@example.com',
  });
  if (email.html.includes("<script>alert")) {
    throw new Error("proposed email is not HTML escaped");
  }
  if (!email.html.includes("&lt;script&gt;")) {
    throw new Error("approval email omits the safely escaped proposed address");
  }
  if (!email.text.includes("Approve email change")) {
    throw new Error("approval email is missing the user action");
  }
  if (email.text.includes("<script") || email.text.includes("</script>")) {
    throw new Error("plain-text approval email contains an HTML script tag");
  }
});

Deno.test("new-address verification email uses its dedicated final step", () => {
  const email = buildEmailVerificationEmail({
    url: `https://itemtraxx.com/account/email-change#step=verify&token=${"0123456789abcdef".repeat(4)}`,
  });
  if (!email.html.includes("Verify new email") || !email.text.includes("Verify new email")) {
    throw new Error("final email verification message is missing its action");
  }
});
