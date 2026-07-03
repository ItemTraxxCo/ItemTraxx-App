export const parseAllowedOrigins = (value?: string | null) =>
  (value ?? "")
    .split(",")
    .map((item) => item.trim())
    .filter((item) => item.length > 0);

export const isAllowedOrigin = (origin: string | null, allowedOrigins: string[]) => {
  if (!origin) return false;
  return allowedOrigins.some((candidate) => candidate === origin);
};
