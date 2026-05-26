export class ValidationError extends Error {
  status = 400;

  constructor(message = "Invalid request") {
    super(message);
    this.name = "ValidationError";
  }
}

type TextOptions = {
  minLen?: number;
  maxLen: number;
  pattern?: RegExp;
  transform?: "lowercase" | "uppercase";
  allowEmpty?: boolean;
};

const CONTROL_CHARS = /[\u0000-\u001F\u007F]/;
export const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
export const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
export const STUDENT_ID_PATTERN = /^[0-9]{4}[A-Z]{2}$/;
export const USERNAME_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]{2,38}[A-Za-z0-9]$/;
export const BARCODE_PATTERN = /^[A-Za-z0-9._:@/#-]{1,64}$/;

export const asRecord = (value: unknown, message = "Invalid request") => {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new ValidationError(message);
  }
  return value as Record<string, unknown>;
};

const normalizeText = (value: string, options: TextOptions) => {
  const trimmed = value.trim();
  if (!options.allowEmpty && !trimmed) {
    throw new ValidationError("Invalid request");
  }
  if (CONTROL_CHARS.test(trimmed)) {
    throw new ValidationError("Invalid request");
  }
  if (trimmed.length > options.maxLen) {
    throw new ValidationError("Invalid request");
  }
  if (options.minLen && trimmed.length < options.minLen) {
    throw new ValidationError("Invalid request");
  }
  if (options.pattern && !options.pattern.test(trimmed)) {
    throw new ValidationError("Invalid request");
  }
  if (options.transform === "lowercase") return trimmed.toLowerCase();
  if (options.transform === "uppercase") return trimmed.toUpperCase();
  return trimmed;
};

export const requireText = (value: unknown, options: TextOptions) => {
  if (typeof value !== "string") {
    throw new ValidationError("Invalid request");
  }
  return normalizeText(value, options);
};

export const optionalText = (value: unknown, options: TextOptions) => {
  if (value === undefined || value === null) return "";
  if (typeof value !== "string") {
    throw new ValidationError("Invalid request");
  }
  const trimmed = value.trim();
  if (!trimmed) return "";
  return normalizeText(trimmed, options);
};

export const requireUuid = (value: unknown) =>
  requireText(value, { maxLen: 36, pattern: UUID_PATTERN });

export const optionalUuid = (value: unknown) => {
  if (value === undefined || value === null || value === "") return "";
  return requireUuid(value);
};

export const requireEnum = <T extends string>(value: unknown, allowed: ReadonlySet<T>) => {
  if (typeof value !== "string") {
    throw new ValidationError("Invalid request");
  }
  const normalized = value.trim() as T;
  if (!allowed.has(normalized)) {
    throw new ValidationError("Invalid request");
  }
  return normalized;
};

export const optionalEnum = <T extends string>(
  value: unknown,
  allowed: ReadonlySet<T>,
  fallback: T,
) => {
  if (value === undefined || value === null || value === "") return fallback;
  return requireEnum(value, allowed);
};

export const requireEmail = (value: unknown) =>
  requireText(value, {
    maxLen: 254,
    pattern: EMAIL_PATTERN,
    transform: "lowercase",
  });

export const optionalEmail = (value: unknown) => {
  if (value === undefined || value === null || value === "") return "";
  return requireEmail(value);
};

export const optionalPositiveInteger = (value: unknown, max: number) => {
  if (value === undefined || value === null || value === "") return null;
  const parsed = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    throw new ValidationError("Invalid request");
  }
  const rounded = Math.round(parsed);
  if (rounded > max) {
    throw new ValidationError("Invalid request");
  }
  return rounded;
};

export const requireTextArray = (
  value: unknown,
  options: TextOptions & { minItems: number; maxItems: number },
) => {
  if (!Array.isArray(value)) {
    throw new ValidationError("Invalid request");
  }
  if (value.length < options.minItems || value.length > options.maxItems) {
    throw new ValidationError("Invalid request");
  }
  return value.map((entry) => requireText(entry, options));
};

export const rejectUnexpectedKeys = (
  value: Record<string, unknown>,
  allowedKeys: ReadonlySet<string>,
) => {
  for (const key of Object.keys(value)) {
    if (!allowedKeys.has(key)) {
      throw new ValidationError("Invalid request");
    }
  }
};
