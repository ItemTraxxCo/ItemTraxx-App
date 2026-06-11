import { assertEquals } from "https://deno.land/std@0.177.0/testing/asserts.ts";
import {
  CURRENT_TERMS_VERSION,
  isCurrentStudentPrivacyAcceptance,
  STUDENT_PRIVACY_AGREEMENT_CONTEXT,
} from "./studentPrivacy.ts";

Deno.test("accepts the current school authorization attestation", () => {
  assertEquals(
    isCurrentStudentPrivacyAcceptance({
      terms_version: CURRENT_TERMS_VERSION,
      agreement_context: STUDENT_PRIVACY_AGREEMENT_CONTEXT,
    }),
    true,
  );
});

Deno.test("rejects generic or stale legal acceptance records", () => {
  assertEquals(
    isCurrentStudentPrivacyAcceptance({
      terms_version: CURRENT_TERMS_VERSION,
      agreement_context: "authorized_adult_administrator",
    }),
    false,
  );
  assertEquals(
    isCurrentStudentPrivacyAcceptance({
      terms_version: "2026-01-01",
      agreement_context: STUDENT_PRIVACY_AGREEMENT_CONTEXT,
    }),
    false,
  );
});
