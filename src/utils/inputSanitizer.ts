import { z } from "zod";

type SanitizeOptions = {
  maxLen: number;
};

const blockedPattern =
  /(\bselect\b|\binsert\b|\bupdate\b|\bdelete\b|\bdrop\b|\btruncate\b|\balter\b|\bcreate\b|--|;|\/\*|\*\/)/i;

export const sanitizeInput = (value: string, options: SanitizeOptions) => {
  const trimmed = value.trim();
  const schema = z
    .string()
    .max(options.maxLen, `Input must be ${options.maxLen} characters or less.`)
    .refine((val) => !blockedPattern.test(val), {
      message: "Input contains blocked characters or keywords.",
    });

  const result = schema.safeParse(trimmed);
  if (!result.success) {
    return {
      value: trimmed.slice(0, options.maxLen),
      error: result.error.issues[0]?.message ?? "Invalid input.",
    };
  }

  return { value: trimmed, error: "" };
};
