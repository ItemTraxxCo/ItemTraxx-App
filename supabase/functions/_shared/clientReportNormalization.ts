const INVALID_REPORT_CONTROL_CHARS =
  /[\u0000-\u0008\u000B-\u000C\u000E-\u001F\u007F\u200B-\u200F\u202A-\u202E\u2060-\u206F\uFEFF]/g;

export const CLIENT_REPORT_DIAGNOSTICS_MAX_BYTES = 20_000;

const MAX_CONSOLE_ENTRIES = 80;
const MAX_NETWORK_ENTRIES = 40;
const MAX_DIAGNOSTIC_STRING_LENGTH = 600;

type RecordValue = Record<string, unknown>;

const asRecord = (value: unknown): RecordValue | null =>
  value && typeof value === "object" && !Array.isArray(value)
    ? value as RecordValue
    : null;

const jsonByteLength = (value: unknown) =>
  new TextEncoder().encode(JSON.stringify(value) ?? "").byteLength;

export const normalizeClientReportText = (
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

const normalizeDiagnosticEntry = (value: unknown): RecordValue | null => {
  const record = asRecord(value);
  if (!record) return null;

  const normalized: RecordValue = {};
  for (const [key, entry] of Object.entries(record)) {
    if (typeof entry === "string") {
      normalized[key] = normalizeClientReportText(
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

export const normalizeClientReportDiagnostics = (
  value: unknown,
): RecordValue => {
  if (value === undefined || value === null) return {};

  const source = asRecord(value);
  if (!source) return { diagnostics_truncated: true };

  let truncated = Object.keys(source).some(
    (key) => key !== "console" && key !== "network",
  );

  const normalizeEntries = (raw: unknown, maxEntries: number) => {
    if (raw === undefined) return [] as RecordValue[];
    if (!Array.isArray(raw)) {
      truncated = true;
      return [] as RecordValue[];
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
  const diagnostics: RecordValue = {
    console: consoleEntries,
    network: networkEntries,
  };

  while (
    jsonByteLength(diagnostics) > CLIENT_REPORT_DIAGNOSTICS_MAX_BYTES &&
    (consoleEntries.length > 0 || networkEntries.length > 0)
  ) {
    if (
      networkEntries.length > 0 &&
      (consoleEntries.length === 0 ||
        networkEntries.length >= consoleEntries.length)
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

  if (jsonByteLength(diagnostics) > CLIENT_REPORT_DIAGNOSTICS_MAX_BYTES) {
    return {
      console: [],
      network: [],
      diagnostics_truncated: true,
    };
  }

  return diagnostics;
};
