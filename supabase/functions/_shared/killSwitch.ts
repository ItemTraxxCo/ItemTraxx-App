const lower = (value: string | null | undefined) => (value ?? "").toLowerCase();

export const DEFAULT_KILL_SWITCH_MESSAGE =
  "Unfortunately ItemTraxx is currently unavailable. We apologize for any inconvenience and are working to restore access as soon as possible. Please see the status page for more information.";

const isLocalhostHost = (hostname: string) => {
  if (!hostname) return false;
  if (hostname === "localhost" || hostname === "127.0.0.1" || hostname === "0.0.0.0") {
    return true;
  }
  return false;
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

export const resolveKillSwitchMessage = () => {
  const raw = Deno.env.get("ITX_ITEMTRAXX_KILLSWITCH_MESSAGE");
  return raw && raw.trim() ? raw.trim() : DEFAULT_KILL_SWITCH_MESSAGE;
};

export const isKillSwitchWriteBlocked = (req: Request) =>
  isKillSwitchEnabled() && !isLocalhostBypassRequest(req);
