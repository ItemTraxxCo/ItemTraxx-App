type SanitizeOptions = {
  maxLen: number;
};

const blockedPattern =
  /(\bselect\b|\binsert\b|\bupdate\b|\bdelete\b|\bdrop\b|\btruncate\b|\balter\b|\bcreate\b|--|;|\/\*|\*\/)/i;

export const sanitizeInput = (value: string, options: SanitizeOptions) => {
  const trimmed = value.trim();

  if (trimmed.length > options.maxLen) {
    return {
      value: trimmed.slice(0, options.maxLen),
      error: `Input must be ${options.maxLen} characters or less.`,
    };
  }

  if (blockedPattern.test(trimmed)) {
    return {
      value: trimmed,
      error: "Input contains blocked characters or keywords.",
    };
  }

  return { value: trimmed, error: "" };
};
