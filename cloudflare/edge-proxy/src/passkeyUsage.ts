type PasskeyUsageAdapter = {
  update: (args: {
    model: string;
    where: Array<{ field: string; value: string }>;
    update: Record<string, unknown>;
  }) => Promise<unknown>;
};

type PasskeyUsageLogger = {
  error: (message: string, error?: unknown) => void;
};

/**
 * Records the most recent successful WebAuthn authentication for one
 * credential. Better Auth intentionally leaves this metadata out of its
 * default passkey schema, so keep it as a best-effort account-security
 * inventory field on the same credential row.
 */
export const recordPasskeyUsage = async ({
  adapter,
  logger,
  credentialId,
  now = new Date(),
}: {
  adapter: PasskeyUsageAdapter;
  logger: PasskeyUsageLogger;
  credentialId: unknown;
  now?: Date;
}) => {
  const id = typeof credentialId === "string" ? credentialId.trim() : "";
  if (!id) return false;

  try {
    await adapter.update({
      model: "passkey",
      where: [{ field: "credentialID", value: id }],
      update: { lastUsedAt: now },
    });
    return true;
  } catch (error) {
    logger.error("Unable to record passkey usage", error);
    return false;
  }
};
