import {
  isWorkspaceInvitationToken,
  meetsWorkspaceInvitePasswordPolicy,
} from "./invitationPolicy.ts";

Deno.test("workspace invitations require the current password strength policy", () => {
  if (!meetsWorkspaceInvitePasswordPolicy("StrongPassword7!")) {
    throw new Error("a password meeting the policy was rejected");
  }
  for (const weak of ["short", "lowercasepassword7!", "NoDigitsOrSymbol", "NoSymbol12345"]) {
    if (meetsWorkspaceInvitePasswordPolicy(weak)) {
      throw new Error(`weak password was accepted: ${weak}`);
    }
  }
  if (!isWorkspaceInvitationToken("a".repeat(64)) || isWorkspaceInvitationToken("short")) {
    throw new Error("invitation token format validation is incorrect");
  }
});
