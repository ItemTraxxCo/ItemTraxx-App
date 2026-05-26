import {
  BARCODE_PATTERN,
  requireEmail,
  requireEnum,
  requireText,
  requireTextArray,
  requireUuid,
  SLUG_PATTERN,
  STUDENT_ID_PATTERN,
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
    requireText("1234567", { maxLen: 6, pattern: STUDENT_ID_PATTERN })
  );
});

Deno.test("validation rejects oversized text and control characters", () => {
  assertValidationError(() => requireText("a".repeat(121), { maxLen: 120 }));
  assertValidationError(() => requireText("bad\u0000value", { maxLen: 120 }));
});

Deno.test("validation rejects invalid enums", () => {
  const allowed = new Set(["healthy", "degraded", "down"] as const);
  assert(requireEnum("healthy", allowed) === "healthy", "expected allowed enum");
  assertValidationError(() => requireEnum("unknown", allowed));
});

Deno.test("validation enforces slug pattern", () => {
  assert(requireText("district-1", { maxLen: 63, pattern: SLUG_PATTERN }) === "district-1", "expected valid slug");
  assertValidationError(() => requireText("../admin", { maxLen: 63, pattern: SLUG_PATTERN }));
});

Deno.test("validation rejects too many items and malformed barcodes", () => {
  assertValidationError(() =>
    requireTextArray(Array.from({ length: 101 }, (_, index) => `ITX-${index}`), {
      minItems: 1,
      maxItems: 100,
      maxLen: 64,
      pattern: BARCODE_PATTERN,
    })
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
