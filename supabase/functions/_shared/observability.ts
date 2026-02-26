export const getRequestId = (req: Request) =>
  req.headers.get("x-request-id") ?? crypto.randomUUID();

export const logInfo = (
  event: string,
  requestId: string,
  extra: Record<string, unknown> = {},
) => {
  console.info(event, { request_id: requestId, ...extra });
};

export const logError = (
  event: string,
  requestId: string,
  error: unknown,
  extra: Record<string, unknown> = {},
) => {
  console.error(event, {
    request_id: requestId,
    message: error instanceof Error ? error.message : "Unknown error",
    stack: error instanceof Error ? error.stack : undefined,
    ...extra,
  });
};
