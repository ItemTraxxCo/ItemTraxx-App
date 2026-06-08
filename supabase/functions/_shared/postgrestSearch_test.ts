import { optionalPostgrestSearchText } from "./postgrestSearch.ts";
import { ValidationError } from "./validation.ts";

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

Deno.test("postgrest search accepts normal names organizations and emails", () => {
  assert(
    optionalPostgrestSearchText("Dennis Frenkel") === "Dennis Frenkel",
    "expected name",
  );
  assert(
    optionalPostgrestSearchText("ops-team+admin@itemtraxx.com") ===
      "ops-team+admin@itemtraxx.com",
    "expected email",
  );
  assert(
    optionalPostgrestSearchText("O'Brien & Sons/West") ===
      "O'Brien & Sons/West",
    "expected org",
  );
});

Deno.test("postgrest search rejects filter grammar metacharacters", () => {
  assertValidationError(() => optionalPostgrestSearchText("x),id.not.is.null"));
  assertValidationError(() => optionalPostgrestSearchText("name,email"));
  assertValidationError(() => optionalPostgrestSearchText("%"));
});
