import { ValidationError } from "./validation.ts";

const DEFAULT_MAX_JSON_BYTES = 1024 * 1024;

const validateDeclaredLength = (req: Request, maxBytes: number) => {
  const declared = req.headers.get("content-length");
  if (declared === null) return;
  if (!/^\d+$/.test(declared.trim())) {
    throw new ValidationError("Invalid Content-Length.", 400);
  }

  const declaredBytes = Number(declared);
  if (!Number.isSafeInteger(declaredBytes)) {
    throw new ValidationError("Invalid Content-Length.", 400);
  }
  if (declaredBytes > maxBytes) {
    throw new ValidationError("Request body is too large.", 413);
  }
};

export const readBoundedBodyBytes = async (
  req: Request,
  maxBytes: number,
) => {
  validateDeclaredLength(req, maxBytes);

  const body = req.body;
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
        throw new ValidationError("Request body is too large.", 413);
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }

  const bytes = new Uint8Array(totalBytes);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return bytes;
};

export const readJsonBody = async <T = any>(
  req: Request,
  maxBytes = DEFAULT_MAX_JSON_BYTES,
): Promise<T> => {
  const bytes = await readBoundedBodyBytes(req, maxBytes);

  try {
    return JSON.parse(new TextDecoder().decode(bytes)) as T;
  } catch {
    throw new ValidationError("Invalid request");
  }
};
