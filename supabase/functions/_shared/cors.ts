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

/**
 * Resolve the CORS decision and response headers for one request.
 *
 * - No Origin header (server-to-server, same-origin): allowed, and no
 *   Access-Control-Allow-Origin header is emitted.
 * - Origin on the exact allowlist: allowed, and the origin is echoed back.
 * - Any other Origin: not allowed, and no Access-Control-Allow-Origin header
 *   is emitted. Callers must reject the request (403) themselves.
 *
 * `baseHeaders` carries the per-function Allow-Headers / Allow-Methods / Vary
 * values. The returned `headers` is always a fresh object, so callers may
 * extend it without mutating the shared base.
 */
export const resolveCorsHeaders = <T extends Record<string, string>>(
  req: Request,
  baseHeaders: T,
  allowedOriginsValue: string | null | undefined = Deno.env.get(
    "ITX_ALLOWED_ORIGINS",
  ),
) => {
  const origin = req.headers.get("Origin");
  const allowedOrigins = parseAllowedOrigins(allowedOriginsValue);

  const hasOrigin = !!origin;
  const originAllowed = !hasOrigin || isAllowedOrigin(origin, allowedOrigins);

  const headers: T & { "Access-Control-Allow-Origin"?: string } =
    hasOrigin && originAllowed
      ? { ...baseHeaders, "Access-Control-Allow-Origin": origin as string }
      : { ...baseHeaders };

  return { hasOrigin, originAllowed, headers };
};
