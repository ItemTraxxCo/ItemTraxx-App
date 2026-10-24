export const setWorkspaceAdminStatusSafely = async <T>(options: {
  isActive: boolean;
  validateTarget: () => Promise<boolean>;
  updateStatus: (isActive: boolean) => Promise<T>;
  revokeSessions: () => Promise<void>;
}): Promise<T> => {
  if (options.isActive) {
    // A previous suspension can leave sessions live if revocation failed after
    // the profile was made inactive. Verify workspace scope before revoking,
    // then revoke all existing sessions before restoring access.
    const targetWasActive = await options.validateTarget();
    if (!targetWasActive) await options.revokeSessions();
    return await options.updateStatus(true);
  }

  // The caller's update is workspace-scoped. Do not revoke a profile's global
  // Better Auth sessions until that scoped update proves the target belongs to
  // this workspace. If subsequent revocation fails, the profile remains
  // inactive; a later reactivation must revoke any remaining sessions first.
  const updated = await options.updateStatus(false);
  await options.revokeSessions();
  return updated;
};
