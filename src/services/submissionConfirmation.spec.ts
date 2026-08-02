import { afterEach, describe, expect, it } from "vitest";
import {
  clearSubmissionConfirmation,
  saveSubmissionConfirmation,
  type SubmissionConfirmationPayload,
} from "./submissionConfirmation";

const STORAGE_KEY = "itemtraxx.submit-confirmation";

afterEach(() => {
  window.sessionStorage.clear();
});

describe("saveSubmissionConfirmation", () => {
  it("persists the payload as JSON under the confirmation storage key", () => {
    const payload: SubmissionConfirmationPayload = {
      kind: "contact_sales",
      submissionRef: "ref-123",
      submittedAt: "2026-08-01T00:00:00.000Z",
    };

    saveSubmissionConfirmation(payload);

    expect(JSON.parse(window.sessionStorage.getItem(STORAGE_KEY)!)).toEqual(payload);
  });

  it("overwrites a previously saved confirmation", () => {
    saveSubmissionConfirmation({ kind: "support", submissionRef: "a", submittedAt: "t1" });
    saveSubmissionConfirmation({ kind: "demo", submissionRef: "b", submittedAt: "t2" });

    expect(JSON.parse(window.sessionStorage.getItem(STORAGE_KEY)!)).toEqual({
      kind: "demo",
      submissionRef: "b",
      submittedAt: "t2",
    });
  });
});

describe("clearSubmissionConfirmation", () => {
  it("removes any saved confirmation", () => {
    saveSubmissionConfirmation({ kind: "security_report", submissionRef: "x", submittedAt: "t" });
    clearSubmissionConfirmation();
    expect(window.sessionStorage.getItem(STORAGE_KEY)).toBeNull();
  });

  it("is a no-op when nothing was saved", () => {
    expect(() => clearSubmissionConfirmation()).not.toThrow();
    expect(window.sessionStorage.getItem(STORAGE_KEY)).toBeNull();
  });
});
