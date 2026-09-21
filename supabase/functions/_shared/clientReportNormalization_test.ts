import {
  CLIENT_REPORT_DIAGNOSTICS_MAX_BYTES,
  normalizeClientReportDiagnostics,
  normalizeClientReportText,
} from "./clientReportNormalization.ts";

const assert = (condition: boolean, message: string) => {
  if (!condition) throw new Error(message);
};

Deno.test("normalizes report text without discarding multiline errors", () => {
  assert(
    normalizeClientReportText("  title\u0000\nvalue  ", 100) === "title value",
    "expected single-line text to replace controls and line breaks",
  );
  assert(
    normalizeClientReportText("line 1\r\nline 2\u0007", 100, {
      allowLineBreaks: true,
    }) ===
      "line 1\nline 2",
    "expected multiline text to preserve line breaks and replace other controls",
  );
  assert(
    normalizeClientReportText("x".repeat(20), 5) === "xxxxx",
    "expected text to be truncated to the configured limit",
  );
});

Deno.test("compacts oversized diagnostics while retaining the newest entries", () => {
  const diagnostics = normalizeClientReportDiagnostics({
    console: Array.from({ length: 80 }, (_, index) => ({
      level: "error",
      message: `console-${index} ${"x".repeat(600)}`,
      timestamp: "2026-09-21T15:13:24.000Z",
    })),
    network: Array.from({ length: 40 }, (_, index) => ({
      method: "POST",
      url: `https://example.test/network/${index}`,
      status: 500,
      ok: false,
      duration_ms: 20,
      request_id: null,
      timestamp: "2026-09-21T15:13:24.000Z",
      error: "x".repeat(600),
    })),
  });

  assert(
    new TextEncoder().encode(JSON.stringify(diagnostics)).byteLength <=
      CLIENT_REPORT_DIAGNOSTICS_MAX_BYTES,
    "expected diagnostics to stay within the byte budget",
  );
  assert(
    diagnostics.diagnostics_truncated === true,
    "expected oversized diagnostics to be marked as truncated",
  );
  assert(
    Array.isArray(diagnostics.console) &&
      (diagnostics.console.at(-1) as Record<string, unknown>).message
          ?.toString().startsWith("console-79") === true,
    "expected the newest console entry to be retained",
  );
});

Deno.test("replaces malformed diagnostics with a bounded marker", () => {
  const diagnostics = normalizeClientReportDiagnostics("not an object");
  assert(
    JSON.stringify(diagnostics) === '{"diagnostics_truncated":true}',
    "expected malformed diagnostics to be reduced to a marker",
  );
});
