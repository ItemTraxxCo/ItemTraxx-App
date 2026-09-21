import { getClientDiagnosticsSnapshot } from "./clientDiagnostics";
import { invokeEdgeFunction } from "./edgeFunctionClient";
import { getAuthState } from "../store/authState";
import { getWorkspaceState } from "../store/workspaceState";

const INVALID_REPORT_CONTROL_CHARS =
  /[\u0000-\u0008\u000B-\u000C\u000E-\u001F\u007F\u200B-\u200F\u202A-\u202E\u2060-\u206F\uFEFF]/g;
const MAX_DIAGNOSTICS_BYTES = 20_000;
const MAX_DIAGNOSTIC_STRING_LENGTH = 600;
const MAX_CONSOLE_ENTRIES = 80;
const MAX_NETWORK_ENTRIES = 40;

export type FatalErrorReportDraft = {
  title: string;
  message: string;
  reason: string;
  error_name?: string;
  stack?: string;
  context?: string;
};

const normalizeReportText = (
  value: unknown,
  maxLength: number,
  options: { allowLineBreaks?: boolean } = {},
) => {
  if (typeof value !== "string") return "";

  let normalized = value.normalize("NFC").replace(/\r\n?/g, "\n");
  if (!options.allowLineBreaks) {
    normalized = normalized.replace(/[\t\n\r]+/g, " ");
  }
  normalized = normalized.replace(INVALID_REPORT_CONTROL_CHARS, " ");
  if (!options.allowLineBreaks) {
    normalized = normalized.replace(/[ \t]+/g, " ");
  }
  return normalized.trim().slice(0, maxLength);
};

type ReportRecord = Record<string, unknown>;

const asRecord = (value: unknown): ReportRecord | null =>
  value && typeof value === "object" && !Array.isArray(value)
    ? value as ReportRecord
    : null;

const jsonByteLength = (value: unknown) =>
  new TextEncoder().encode(JSON.stringify(value) ?? "").byteLength;

const normalizeDiagnosticEntry = (value: unknown): ReportRecord | null => {
  const record = asRecord(value);
  if (!record) return null;

  const normalized: ReportRecord = {};
  for (const [key, entry] of Object.entries(record)) {
    if (typeof entry === "string") {
      normalized[key] = normalizeReportText(
        entry,
        MAX_DIAGNOSTIC_STRING_LENGTH,
        { allowLineBreaks: key === "message" || key === "error" },
      );
    } else if (typeof entry === "number" && Number.isFinite(entry)) {
      normalized[key] = entry;
    } else if (typeof entry === "boolean" || entry === null) {
      normalized[key] = entry;
    }
  }
  return normalized;
};

const normalizeDiagnostics = (value: unknown): ReportRecord => {
  if (value === undefined || value === null) return {};

  const source = asRecord(value);
  if (!source) return { diagnostics_truncated: true };

  let truncated = Object.keys(source).some(
    (key) => key !== "console" && key !== "network",
  );

  const normalizeEntries = (raw: unknown, maxEntries: number) => {
    if (raw === undefined) return [] as ReportRecord[];
    if (!Array.isArray(raw)) {
      truncated = true;
      return [] as ReportRecord[];
    }

    const entries = raw.flatMap((entry) => {
      const normalized = normalizeDiagnosticEntry(entry);
      if (!normalized) truncated = true;
      return normalized ? [normalized] : [];
    });
    if (entries.length > maxEntries) truncated = true;
    return entries.slice(-maxEntries);
  };

  let consoleEntries = normalizeEntries(source.console, MAX_CONSOLE_ENTRIES);
  let networkEntries = normalizeEntries(source.network, MAX_NETWORK_ENTRIES);
  const diagnostics: ReportRecord = {
    console: consoleEntries,
    network: networkEntries,
  };

  while (
    jsonByteLength(diagnostics) > MAX_DIAGNOSTICS_BYTES &&
    (consoleEntries.length > 0 || networkEntries.length > 0)
  ) {
    if (
      networkEntries.length > 0 &&
      (consoleEntries.length === 0 || networkEntries.length >= consoleEntries.length)
    ) {
      networkEntries = networkEntries.slice(1);
      diagnostics.network = networkEntries;
    } else {
      consoleEntries = consoleEntries.slice(1);
      diagnostics.console = consoleEntries;
    }
    truncated = true;
  }

  if (truncated) {
    diagnostics.diagnostics_truncated = true;
  }

  if (jsonByteLength(diagnostics) > MAX_DIAGNOSTICS_BYTES) {
    return {
      console: [],
      network: [],
      diagnostics_truncated: true,
    };
  }

  return diagnostics;
};

const getSafePageUrl = () => {
  if (typeof window === "undefined") return "";
  try {
    return `${window.location.origin}${window.location.pathname}`;
  } catch {
    return window.location.pathname || "";
  }
};

export const sendClientErrorReport = async (draft: FatalErrorReportDraft) => {
  const auth = getAuthState();
  const workspace = getWorkspaceState();
  const diagnostics = normalizeDiagnostics(getClientDiagnosticsSnapshot());

  const result = await invokeEdgeFunction<{ accepted: boolean }>("client-error-report", {
    method: "POST",
    body: {
      title: normalizeReportText(draft.title, 160),
      message: normalizeReportText(draft.message, 1200, { allowLineBreaks: true }),
      reason: normalizeReportText(draft.reason, 400),
      error_name: normalizeReportText(draft.error_name, 120),
      stack: normalizeReportText(draft.stack, 5000, { allowLineBreaks: true }),
      context: normalizeReportText(draft.context, 300),
      page: {
        url: normalizeReportText(getSafePageUrl(), 255),
        user_agent: normalizeReportText(
          typeof navigator !== "undefined" ? navigator.userAgent : "",
          255,
        ),
        environment: normalizeReportText(import.meta.env.MODE, 40),
        release: normalizeReportText(import.meta.env.VITE_GIT_COMMIT || "n/a", 80),
      },
      auth: {
        is_authenticated: auth.isAuthenticated,
        role: normalizeReportText(auth.role, 40) || null,
        workspace_id: normalizeReportText(auth.workspaceContextId, 80) || null,
      },
      workspace: {
        is_workspace_host: workspace.isWorkspaceHost,
        workspace_id: normalizeReportText(workspace.workspaceId, 80) || null,
      },
      diagnostics,
    },
  });

  if (!result.ok) {
    throw new Error(result.error || "Unable to send error report. Please contact support directly via email: support@itemtraxx.com");
  }
};
