export const parseAllowedOrigins = (value?: string | null) =>
  (value ?? "")
    .split(",")
    .map((item) => item.trim())
    .filter((item) => item.length > 0);

const matchesWildcardOrigin = (origin: string, candidate: string) => {
  if (!candidate.includes("*")) return false;

  try {
    const originUrl = new URL(origin);
    const protocolMatch = candidate.match(/^(https?:)\/\//i);
    if (!protocolMatch) return false;
    const candidateProtocol = protocolMatch[1].toLowerCase();
    if (originUrl.protocol.toLowerCase() !== candidateProtocol) return false;

    const candidateHost = candidate.slice(protocolMatch[0].length).split("/")[0]?.toLowerCase() ?? "";
    if (!candidateHost.startsWith("*.")) return false;

    const suffix = candidateHost.slice(2);
    const hostname = originUrl.hostname.toLowerCase();
    return hostname !== suffix && hostname.endsWith(`.${suffix}`);
  } catch {
    return false;
  }
};

export const isAllowedOrigin = (origin: string | null, allowedOrigins: string[]) => {
  if (!origin) return false;
  return allowedOrigins.some((candidate) => candidate === origin || matchesWildcardOrigin(origin, candidate));
};
