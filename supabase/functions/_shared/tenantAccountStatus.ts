export const setTenantAccountStatusSafely = async <T>(options: {
  isActive: boolean;
  updateStatus: (isActive: boolean) => Promise<T>;
  revokeSessions: () => Promise<void>;
}): Promise<T> => {
  if (options.isActive) {
    // A disabled account may retain Better Auth sessions if an earlier
    // suspension failed while revoking. Never restore access until revocation
    // succeeds for all sessions that exist at this point.
    await options.revokeSessions();
    return await options.updateStatus(true);
  }

  // Disable profile-based access first. If revocation fails, the account stays
  // suspended and a later restore must successfully revoke again before it can
  // become active.
  const updated = await options.updateStatus(false);
  await options.revokeSessions();
  return updated;
};
