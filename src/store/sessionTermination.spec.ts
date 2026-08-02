import { afterEach, describe, expect, it } from "vitest";
import { clearSessionTermination, getSessionTerminationState, showSessionTermination } from "./sessionTermination";

afterEach(() => {
  clearSessionTermination();
});

describe("showSessionTermination", () => {
  it("shows the modal with default title/message when none are given", () => {
    showSessionTermination({ name: "public-login" });
    const state = getSessionTerminationState();
    expect(state.visible).toBe(true);
    expect(state.title).toBe("This session has been terminated or expired.");
    expect(state.message).toBe("Please sign in again.");
    expect(state.recoveryRoute).toEqual({ name: "public-login" });
  });

  it("uses custom title/message when provided and non-blank", () => {
    showSessionTermination({ name: "super-auth" }, { title: "Custom title", message: "Custom message" });
    const state = getSessionTerminationState();
    expect(state.title).toBe("Custom title");
    expect(state.message).toBe("Custom message");
  });

  it("falls back to defaults when custom title/message are blank/whitespace", () => {
    showSessionTermination({ name: "public-login" }, { title: "   ", message: "" });
    const state = getSessionTerminationState();
    expect(state.title).toBe("This session has been terminated or expired.");
    expect(state.message).toBe("Please sign in again.");
  });
});

describe("clearSessionTermination", () => {
  it("resets visibility, title, message, and recovery route to defaults", () => {
    showSessionTermination({ name: "super-auth" }, { title: "X", message: "Y" });

    clearSessionTermination();

    const state = getSessionTerminationState();
    expect(state.visible).toBe(false);
    expect(state.title).toBe("This session has been terminated or expired.");
    expect(state.message).toBe("Please sign in again.");
    expect(state.recoveryRoute).toBeNull();
  });
});
