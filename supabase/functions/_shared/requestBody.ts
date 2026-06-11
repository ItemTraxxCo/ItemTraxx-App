import { ValidationError } from "./validation.ts";

const DEFAULT_MAX_JSON_BYTES = 1024 * 1024;

export const readJsonBody = async <T = any>(
  req: Request,
  maxBytes = DEFAULT_MAX_JSON_BYTES,
): Promise<T> => {
  const contentLength = Number(req.headers.get("content-length") ?? "0");
  if (Number.isFinite(contentLength) && contentLength > maxBytes) {
    throw new ValidationError("Request body is too large.", 413);
  }

  const bytes = new Uint8Array(await req.arrayBuffer());
  if (bytes.byteLength > maxBytes) {
    throw new ValidationError("Request body is too large.", 413);
  }

  try {
    return JSON.parse(new TextDecoder().decode(bytes)) as T;
  } catch {
    throw new ValidationError("Invalid request");
  }
};
