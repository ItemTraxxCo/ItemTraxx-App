const lower = (value: string | null | undefined) => (value ?? "").toLowerCase();

const isLocalhostHost = (hostname: string) => {
  if (!hostname) return false;
  if (hostname === "localhost" || hostname === "127.0.0.1" || hostname === "0.0.0.0") {
    return true;
  }
  if (hostname.startsWith("192.168.") || hostname.startsWith("10.")) {
    return true;
  }
  const match172 = hostname.match(/^172\.(\d{1,3})\./);
  if (!match172) return false;
  const secondOctet = Number(match172[1]);
  return Number.isFinite(secondOctet) && secondOctet >= 16 && secondOctet <= 31;
};

export const isLocalhostBypassRequest = (req: Request) => {
  const origin = req.headers.get("origin") ?? req.headers.get("Origin");
  if (!origin) return false;
  try {
    const hostname = new URL(origin).hostname.toLowerCase();
    return isLocalhostHost(hostname);
  } catch {
    return false;
  }
};

export const isKillSwitchEnabled = () =>
  lower(Deno.env.get("ITX_ITEMTRAXX_KILLSWITCH_ENABLED")) === "true";

export const isKillSwitchWriteBlocked = (req: Request) =>
  isKillSwitchEnabled() && !isLocalhostBypassRequest(req);
