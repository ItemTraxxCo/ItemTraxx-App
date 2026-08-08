import { logError, logInfo } from "./observability.ts";

const assert = (condition: boolean, message: string) => {
  if (!condition) throw new Error(message);
};

const capture = (
  level: "info" | "error",
  run: () => void,
) => {
  const original = console[level];
  const calls: unknown[][] = [];
  console[level] = (...args: unknown[]) => {
    calls.push(args);
  };
  try {
    run();
  } finally {
    console[level] = original;
  }
  return calls;
};

Deno.test("observability logs control characters as one JSON line", () => {
  const infoCalls = capture("info", () => {
    logInfo("event\nforged", "request\r\nforged", {
      detail: "value\nforged",
    });
  });
  assert(infoCalls.length === 1, "expected one info log call");
  assert(infoCalls[0].length === 1, "expected one serialized info argument");
  const infoLine = infoCalls[0][0];
  if (typeof infoLine !== "string") {
    throw new Error("expected serialized info output");
  }
  assert(
    !infoLine.includes("\n") && !infoLine.includes("\r"),
    "info output must stay on one line",
  );
  const parsedInfo = JSON.parse(infoLine);
  assert(
    parsedInfo.event === "event\nforged",
    "event should round-trip through JSON",
  );
  assert(
    parsedInfo.request_id === "request\r\nforged",
    "request ID should round-trip through JSON",
  );
  assert(
    parsedInfo.detail === "value\nforged",
    "extra data should round-trip through JSON",
  );

  const errorCalls = capture("error", () => {
    logError(
      "error\nforged",
      "request\r\nforged",
      new Error("failure\nforged"),
    );
  });
  assert(errorCalls.length === 1, "expected one error log call");
  assert(errorCalls[0].length === 1, "expected one serialized error argument");
  const errorLine = errorCalls[0][0];
  if (typeof errorLine !== "string") {
    throw new Error("expected serialized error output");
  }
  assert(
    !errorLine.includes("\n") && !errorLine.includes("\r"),
    "error output must stay on one line",
  );
  const parsedError = JSON.parse(errorLine);
  assert(
    parsedError.event === "error\nforged",
    "error event should round-trip through JSON",
  );
  assert(
    parsedError.request_id === "request\r\nforged",
    "error request ID should round-trip through JSON",
  );
  assert(
    parsedError.message === "failure\nforged",
    "error message should round-trip through JSON",
  );
});
