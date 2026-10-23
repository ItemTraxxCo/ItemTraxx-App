export const isWorkspaceInvitationToken = (value: unknown): value is string =>
  typeof value === "string" && /^[0-9a-f]{64}$/.test(value);

export const meetsWorkspaceInvitePasswordPolicy = (value: string) =>
  value.length >= 12 && /[a-z]/.test(value) && /[A-Z]/.test(value) &&
  /[0-9]/.test(value) && /[^A-Za-z0-9]/.test(value);
