type ConsoleLevel = "log" | "info" | "warn" | "error";

export type ConsoleEntry = {
  level: ConsoleLevel;
  message: string;
  timestamp: string;
};

export type NetworkEntry = {
  method: string;
  url: string;
  status: number | null;
  ok: boolean;
  duration_ms: number;
  request_id: string | null;
  timestamp: string;
  error?: string;
};

const MAX_CONSOLE_ENTRIES = 80;
const MAX_NETWORK_ENTRIES = 40;
const MAX_SERIALIZED_LENGTH = 600;

const consoleEntries: ConsoleEntry[] = [];
const networkEntries: NetworkEntry[] = [];
let installed = false;

const redactSensitiveText = (value: string) =>
  value
    .replace(/Bearer\s+[A-Za-z0-9._-]+/gi, "Bearer [REDACTED]")
    .replace(/\beyJ[A-Za-z0-9._-]+\b/g, "[REDACTED_JWT]")
    .replace(/\bsb_(publishable|secret)_[A-Za-z0-9._-]+\b/g, "sb_[REDACTED]")
    .replace(/\b(?:apikey|api_key|x-api-key)\s*[:=]\s*[^\s,;]+/gi, "api_key=[REDACTED]")
    .replace(/\b(?:tenant|tenant_id|profile_id)\s*[:=]\s*[0-9a-f-]{16,}/gi, "[REDACTED_ID]")
    .replace(/\b(?:\d[ -]*?){13,19}\b/g, "[REDACTED_CARD]")
    .replace(/https?:\/\/[^\s"']+/gi, "[REDACTED_URL]")
    .replace(/\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi, "[REDACTED_EMAIL]")
    .replace(
      /(?<!\w)(?:\+?\d{1,3}[\s.-]?)?(?:\(?\d{3}\)?[\s.-]?\d{3}[\s.-]?\d{4})(?!\w)/g,
      "[REDACTED_PHONE]"
    );

const pushBounded = <T>(buffer: T[], value: T, max: number) => {
  buffer.push(value);
  if (buffer.length > max) {
    buffer.splice(0, buffer.length - max);
  }
};

const serializeArg = (value: unknown): string => {
  if (typeof value === "string") {
    return redactSensitiveText(value);
  }
  if (value instanceof Error) {
    return redactSensitiveText(`${value.name}: ${value.message}`);
  }
  try {
    return redactSensitiveText(JSON.stringify(value));
  } catch {
    return redactSensitiveText(String(value));
  }
};

const serializeArgs = (args: unknown[]) =>
  args
    .map((arg) => serializeArg(arg))
    .join(" ")
    .slice(0, MAX_SERIALIZED_LENGTH);

const recordConsoleEntry = (level: ConsoleLevel, args: unknown[]) => {
  if (!allowsDiagnostics(readCookieConsent())) return;
  pushBounded(
    consoleEntries,
    {
      level,
      message: serializeArgs(args),
      timestamp: new Date().toISOString(),
    },
    MAX_CONSOLE_ENTRIES
  );
};

const normalizeUrl = (input: string) => {
  try {
    const url = new URL(input, window.location.origin);
    return `${url.origin}${url.pathname}`;
  } catch {
    return redactSensitiveText(input);
  }
};

const shouldSkipNetworkCapture = (url: string) =>
  url.includes("/functions/v1/client-error-report") || url.includes("/functions/client-error-report");

const recordNetworkEntry = (entry: NetworkEntry) => {
  if (!allowsDiagnostics(readCookieConsent()) || shouldSkipNetworkCapture(entry.url)) {
    return;
  }
  pushBounded(networkEntries, entry, MAX_NETWORK_ENTRIES);
};

export const installClientDiagnostics = () => {
  if (installed || typeof window === "undefined") {
    return;
  }
  installed = true;

  for (const level of ["log", "info", "warn", "error"] as const) {
    const original = console[level].bind(console);
    console[level] = ((...args: unknown[]) => {
      recordConsoleEntry(level, args);
      original(...args);
    }) as typeof console[typeof level];
  }

  const originalFetch = window.fetch.bind(window);
  window.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
    const startedAt = performance.now();
    const method =
      (input instanceof Request ? input.method : undefined) ??
      init?.method ??
      "GET";
    const rawUrl = input instanceof Request ? input.url : String(input);
    const url = normalizeUrl(rawUrl);

    try {
      const response = await originalFetch(input, init);
      recordNetworkEntry({
        method,
        url: redactSensitiveText(url),
        status: response.status,
        ok: response.ok,
        duration_ms: Math.round(performance.now() - startedAt),
        request_id: response.headers.get("x-request-id"),
        timestamp: new Date().toISOString(),
      });
      return response;
    } catch (error) {
      recordNetworkEntry({
        method,
        url: redactSensitiveText(url),
        status: null,
        ok: false,
        duration_ms: Math.round(performance.now() - startedAt),
        request_id: null,
        timestamp: new Date().toISOString(),
        error:
          error instanceof Error
            ? redactSensitiveText(error.message)
            : "Network request failed.",
      });
      throw error;
    }
  };
};

export const getClientDiagnosticsSnapshot = () => ({
  console: [...consoleEntries],
  network: [...networkEntries],
});
import { allowsDiagnostics, readCookieConsent } from "./cookieConsentService";
