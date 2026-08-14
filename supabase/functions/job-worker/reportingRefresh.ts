type RpcErrorLike = {
  code?: string | null;
  message?: string | null;
};

export const rpcErrorToError = (
  operation: string,
  error: RpcErrorLike | null | undefined,
): Error | null => {
  if (!error) return null;

  const code = error.code?.trim();
  const message = error.message?.trim() || "Unknown database error";
  return new Error(
    `${operation} failed${code ? ` (${code})` : ""}: ${message}`,
  );
};

export const throwOnRpcError = (
  operation: string,
  error: RpcErrorLike | null | undefined,
): void => {
  const normalizedError = rpcErrorToError(operation, error);
  if (normalizedError) throw normalizedError;
};
