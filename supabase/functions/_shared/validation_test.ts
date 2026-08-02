import {
  asRecord,
  BARCODE_PATTERN,
  BORROWER_ID_PATTERN,
  optionalEmail,
  optionalEnum,
  optionalInteger,
  optionalIsoDate,
  optionalJsonObject,
  optionalPositiveInteger,
  optionalText,
  optionalUuid,
  rejectUnexpectedKeys,
  requireEmail,
  requireEnum,
  requireText,
  requireTextArray,
  requireUuid,
  SLUG_PATTERN,
  ValidationError,
} from "./validation.ts";

const assert = (condition: boolean, message: string) => {
  if (!condition) throw new Error(message);
};

const assertValidationError = (operation: () => unknown) => {
  try {
    operation();
  } catch (error) {
    assert(error instanceof ValidationError, "expected ValidationError");
    return;
  }
  throw new Error("expected operation to throw");
};

Deno.test("validation rejects malformed emails and IDs", () => {
  assertValidationError(() => requireEmail("not-an-email"));
  assertValidationError(() => requireUuid("not-a-uuid"));
  assertValidationError(() =>
    requireText("1234567", { maxLen: 6, pattern: BORROWER_ID_PATTERN })
  );
});

Deno.test("validation rejects oversized text and control characters", () => {
  assertValidationError(() => requireText("a".repeat(121), { maxLen: 120 }));
  assertValidationError(() => requireText("bad\u0000value", { maxLen: 120 }));
  assertValidationError(() =>
    requireText("hidden\u200Bvalue", { maxLen: 120 })
  );
  assertValidationError(() => requireText("spoof\u202Evalue", { maxLen: 120 }));
});

Deno.test("validation rejects invalid enums", () => {
  const allowed = new Set(["healthy", "degraded", "down"] as const);
  assert(
    requireEnum("healthy", allowed) === "healthy",
    "expected allowed enum",
  );
  assertValidationError(() => requireEnum("unknown", allowed));
});

Deno.test("validation enforces slug pattern", () => {
  assert(
    requireText("district-1", { maxLen: 63, pattern: SLUG_PATTERN }) ===
      "district-1",
    "expected valid slug",
  );
  assertValidationError(() =>
    requireText("../admin", { maxLen: 63, pattern: SLUG_PATTERN })
  );
});

Deno.test("validation rejects too many items and malformed barcodes", () => {
  assertValidationError(() =>
    requireTextArray(
      Array.from({ length: 101 }, (_, index) => `ITX-${index}`),
      {
        minItems: 1,
        maxItems: 100,
        maxLen: 64,
        pattern: BARCODE_PATTERN,
      },
    )
  );
  assertValidationError(() =>
    requireTextArray(["valid-1", "<script>"], {
      minItems: 1,
      maxItems: 100,
      maxLen: 64,
      pattern: BARCODE_PATTERN,
    })
  );
});

Deno.test("asRecord accepts plain objects and rejects everything else", () => {
  const record = asRecord({ a: 1 });
  assert(record.a === 1, "expected the object to pass through unchanged");
  assertValidationError(() => asRecord(null));
  assertValidationError(() => asRecord(undefined));
  assertValidationError(() => asRecord([1, 2, 3]));
  assertValidationError(() => asRecord("not an object"));
});

Deno.test("requireText rejects non-string values and enforces minLen", () => {
  assertValidationError(() => requireText(123, { maxLen: 10 }));
  assertValidationError(() => requireText(null, { maxLen: 10 }));
  assertValidationError(() =>
    requireText("ab", { maxLen: 10, minLen: 3 })
  );
  assert(
    requireText("abc", { maxLen: 10, minLen: 3 }) === "abc",
    "expected minLen-satisfying text to pass",
  );
});

Deno.test("requireText applies uppercase and lowercase transforms", () => {
  assert(
    requireText("MixedCase", { maxLen: 20, transform: "lowercase" }) ===
      "mixedcase",
    "expected lowercase transform",
  );
  assert(
    requireText("MixedCase", { maxLen: 20, transform: "uppercase" }) ===
      "MIXEDCASE",
    "expected uppercase transform",
  );
});

Deno.test("requireText allows blank values only when allowEmpty is set", () => {
  assertValidationError(() => requireText("   ", { maxLen: 20 }));
  assert(
    requireText("   ", { maxLen: 20, allowEmpty: true }) === "",
    "expected allowEmpty to permit blank text",
  );
});

Deno.test("optionalText passes through null/undefined as empty and validates strings", () => {
  assert(optionalText(undefined, { maxLen: 20 }) === "", "expected undefined to yield empty string");
  assert(optionalText(null, { maxLen: 20 }) === "", "expected null to yield empty string");
  assert(optionalText("  ", { maxLen: 20 }) === "", "expected blank text to yield empty string");
  assert(
    optionalText("  value  ", { maxLen: 20 }) === "value",
    "expected optionalText to trim provided values",
  );
  assertValidationError(() => optionalText(42, { maxLen: 20 }));
  assertValidationError(() =>
    optionalText("too-long-value", { maxLen: 5 })
  );
});

Deno.test("optionalUuid accepts empty input and validates provided values", () => {
  assert(optionalUuid(undefined) === "", "expected undefined to yield empty string");
  assert(optionalUuid("") === "", "expected empty string to yield empty string");
  assertValidationError(() => optionalUuid("not-a-uuid"));
  const validUuid = "123e4567-e89b-12d3-a456-426614174000";
  assert(
    optionalUuid(validUuid) === validUuid,
    "expected a valid uuid to pass through",
  );
});

Deno.test("requireEnum rejects non-string values", () => {
  const allowed = new Set(["a", "b"] as const);
  assertValidationError(() => requireEnum(42, allowed));
  assertValidationError(() => requireEnum(null, allowed));
});

Deno.test("optionalEnum falls back for empty input and validates provided values", () => {
  const allowed = new Set(["healthy", "degraded"] as const);
  assert(
    optionalEnum(undefined, allowed, "healthy") === "healthy",
    "expected undefined to use the fallback",
  );
  assert(
    optionalEnum(null, allowed, "healthy") === "healthy",
    "expected null to use the fallback",
  );
  assert(
    optionalEnum("", allowed, "healthy") === "healthy",
    "expected empty string to use the fallback",
  );
  assert(
    optionalEnum("degraded", allowed, "healthy") === "degraded",
    "expected a valid value to override the fallback",
  );
  assertValidationError(() => optionalEnum("unknown", allowed, "healthy"));
});

Deno.test("requireEmail normalizes case", () => {
  assert(
    requireEmail("User@Example.COM") === "user@example.com",
    "expected email to be lowercased",
  );
});

Deno.test("optionalEmail accepts empty input and validates provided values", () => {
  assert(optionalEmail(undefined) === "", "expected undefined to yield empty string");
  assert(optionalEmail("") === "", "expected empty string to yield empty string");
  assert(
    optionalEmail("User@Example.com") === "user@example.com",
    "expected optional email to normalize case",
  );
  assertValidationError(() => optionalEmail("not-an-email"));
});

Deno.test("optionalPositiveInteger enforces positivity and max bounds", () => {
  assert(optionalPositiveInteger(undefined, 100) === null, "expected undefined to yield null");
  assert(optionalPositiveInteger(null, 100) === null, "expected null to yield null");
  assert(optionalPositiveInteger("", 100) === null, "expected empty string to yield null");
  assert(
    optionalPositiveInteger("5.4", 100) === 5,
    "expected numeric strings to be parsed and rounded",
  );
  assertValidationError(() => optionalPositiveInteger(0, 100));
  assertValidationError(() => optionalPositiveInteger(-5, 100));
  assertValidationError(() => optionalPositiveInteger("not-a-number", 100));
  assertValidationError(() => optionalPositiveInteger(101, 100));
});

Deno.test("optionalInteger applies a fallback and enforces range", () => {
  assert(
    optionalInteger(undefined, 0, 10, 3) === 3,
    "expected undefined to use the fallback",
  );
  assert(
    optionalInteger("", 0, 10, 3) === 3,
    "expected empty string to use the fallback",
  );
  assert(optionalInteger("7.6", 0, 10, 3) === 8, "expected rounding");
  assertValidationError(() => optionalInteger("not-a-number", 0, 10, 3));
  assertValidationError(() => optionalInteger(-1, 0, 10, 3));
  assertValidationError(() => optionalInteger(11, 0, 10, 3));
});

Deno.test("optionalIsoDate accepts empty input and validates parseable dates", () => {
  assert(optionalIsoDate(undefined) === "", "expected undefined to yield empty string");
  assert(optionalIsoDate("") === "", "expected empty string to yield empty string");
  assert(
    optionalIsoDate("2026-01-01T00:00:00Z") === "2026-01-01T00:00:00Z",
    "expected a valid ISO date to pass through",
  );
  assertValidationError(() => optionalIsoDate("not-a-date"));
});

Deno.test("optionalJsonObject accepts empty input and enforces a byte budget", () => {
  const empty = optionalJsonObject(undefined, 100);
  assert(Object.keys(empty).length === 0, "expected undefined to yield an empty object");
  assert(
    Object.keys(optionalJsonObject(null, 100)).length === 0,
    "expected null to yield an empty object",
  );
  const record = optionalJsonObject({ a: 1, b: "two" }, 100);
  assert(record.a === 1, "expected valid json object to pass through");
  assertValidationError(() =>
    optionalJsonObject({ big: "x".repeat(200) }, 50)
  );
  assertValidationError(() => optionalJsonObject([1, 2, 3], 100));
});

Deno.test("requireTextArray enforces minItems and rejects non-arrays", () => {
  assertValidationError(() =>
    requireTextArray("not-an-array", { minItems: 1, maxItems: 5, maxLen: 10 })
  );
  assertValidationError(() =>
    requireTextArray([], { minItems: 1, maxItems: 5, maxLen: 10 })
  );
  const result = requireTextArray(["one", "two"], {
    minItems: 1,
    maxItems: 5,
    maxLen: 10,
  });
  assert(
    result.length === 2 && result[0] === "one",
    "expected a valid array to pass through normalized",
  );
});

Deno.test("rejectUnexpectedKeys allows known keys and rejects unknown keys", () => {
  const allowed = new Set(["a", "b"]);
  rejectUnexpectedKeys({ a: 1, b: 2 }, allowed);
  assertValidationError(() =>
    rejectUnexpectedKeys({ a: 1, c: 3 }, allowed)
  );
});
