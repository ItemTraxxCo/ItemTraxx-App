export const MAX_PROXY_REQUEST_BODY_BYTES = 1024 * 1024;
export const MAX_SUPPORT_REQUEST_BODY_BYTES = 12 * 1024 * 1024;

export const getFunctionRequestBodyLimit = (functionName: string) =>
  functionName === "contact-support-submit"
    ? MAX_SUPPORT_REQUEST_BODY_BYTES
    : MAX_PROXY_REQUEST_BODY_BYTES;

export class RequestBodyLimitError extends Error {
  readonly status: 400 | 413;

  constructor(message: string, status: 400 | 413) {
    super(message);
    this.name = "RequestBodyLimitError";
    this.status = status;
  }
}

const validateDeclaredLength = (request: Request, maxBytes: number) => {
  const declared = request.headers.get("content-length");
  if (declared === null) return;

  if (!/^\d+$/.test(declared.trim())) {
    throw new RequestBodyLimitError("Invalid Content-Length.", 400);
  }

  const declaredBytes = Number(declared);
  if (!Number.isSafeInteger(declaredBytes)) {
    throw new RequestBodyLimitError("Invalid Content-Length.", 400);
  }
  if (declaredBytes > maxBytes) {
    throw new RequestBodyLimitError("Request body is too large.", 413);
  }
};

export const readBoundedRequestBody = async (
  request: Request,
  maxBytes = MAX_PROXY_REQUEST_BODY_BYTES,
): Promise<Uint8Array> => {
  validateDeclaredLength(request, maxBytes);

  const body = request.body;
  if (!body) return new Uint8Array();

  const reader = body.getReader();
  const chunks: Uint8Array[] = [];
  let totalBytes = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      if (!value || value.byteLength === 0) continue;

      totalBytes += value.byteLength;
      if (totalBytes > maxBytes) {
        await reader.cancel("request body exceeds the configured byte limit");
        throw new RequestBodyLimitError("Request body is too large.", 413);
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }

  const result = new Uint8Array(totalBytes);
  let offset = 0;
  for (const chunk of chunks) {
    result.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return result;
};
