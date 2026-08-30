export const parseAllowedOrigins = (value?: string | null) =>
  (value ?? "")
    .split(",")
    .map((item) => item.trim())
    .filter((item) => item.length > 0);

export const isAllowedOrigin = (
  origin: string | null,
  allowedOrigins: string[],
) => {
  if (!origin) return false;
  // Workspace origins must be provider-managed entries in the exact
  // allowlist. Do not infer trust from a hostname pattern: archived or
  // attacker-controlled DNS must not receive credentialed CORS access.
  return allowedOrigins.some((candidate) => candidate === origin);
};
