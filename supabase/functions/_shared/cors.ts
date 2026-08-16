export const parseAllowedOrigins = (value?: string | null) =>
  (value ?? "")
    .split(",")
    .map((item) => item.trim())
    .filter((item) => item.length > 0);

const RESERVED_WORKSPACE_SLUGS = new Set([
  "app",
  "internal",
  "status",
  "www",
  "itxdemo",
  "pentest",
  "pentest2",
  "testdist",
  "testtenant-15da6e97",
]);

const isWorkspaceAppOrigin = (origin: string) => {
  try {
    const url = new URL(origin);
    const match = url.hostname.toLowerCase().match(
      /^([a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)\.app\.itemtraxx\.com$/,
    );
    return url.protocol === "https:" && url.port === "" && !!match?.[1] &&
      !RESERVED_WORKSPACE_SLUGS.has(match[1]);
  } catch {
    return false;
  }
};

export const isAllowedOrigin = (
  origin: string | null,
  allowedOrigins: string[],
) => {
  if (!origin) return false;
  if (isWorkspaceAppOrigin(origin)) return true;
  return allowedOrigins.some((candidate) => candidate === origin);
};
