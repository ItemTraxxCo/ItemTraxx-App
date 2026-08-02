import { afterEach, describe, expect, it, vi } from "vitest";
import {
  dismissFatalErrorToast,
  getFatalErrorToastState,
  sendFatalErrorToastReport,
  showFatalErrorToast,
} from "./fatalErrorToast";
import { AppError } from "../services/appErrors";

vi.mock("../services/clientErrorReportService", () => ({
  sendClientErrorReport: vi.fn(),
}));

import { sendClientErrorReport } from "../services/clientErrorReportService";
const mockedSend = vi.mocked(sendClientErrorReport);

afterEach(() => {
  dismissFatalErrorToast();
  mockedSend.mockReset();
});

describe("showFatalErrorToast", () => {
  it("derives a friendly reason per AppError code", () => {
    showFatalErrorToast(new AppError("NETWORK", "offline"));
    expect(getFatalErrorToastState().reason).toMatch(/could not reach the network/i);

    showFatalErrorToast(new AppError("TIMEOUT", "slow"), "ctx-2");
    expect(getFatalErrorToastState().reason).toMatch(/timed out/i);
  });

  it("never surfaces the raw error message to the user-facing text", () => {
    showFatalErrorToast(new Error("raw internal db failure: users.email column missing"));
    expect(getFatalErrorToastState().message).toBe("Oh no! Something went wrong. Please try again.");
  });

  it("redacts JWTs, bearer tokens, emails, and token query params from the report message/stack", () => {
    const token = "eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.dozjgNryP4J3jVmNHl0w5N_XgL0n3I9PlFUP0THsR8U";
    const error = new Error(
      `Authorization: Bearer ${token} failed for user test@example.com?access_token=abc123secret`
    );
    showFatalErrorToast(error);
    const state = getFatalErrorToastState();
    expect(state.reportMessage).not.toContain("test@example.com");
    expect(state.reportMessage).not.toContain(token);
    expect(state.reportMessage).toContain("[redacted_email]");
    expect(state.reportMessage).toContain("[redacted]");
  });

  it("dedupes an identical error+context fingerprint while already visible", () => {
    showFatalErrorToast(new Error("boom"), "ctx");
    const firstTitle = getFatalErrorToastState().title;
    showFatalErrorToast(new Error("boom"), "ctx");
    expect(getFatalErrorToastState().title).toBe(firstTitle);
  });

  it("uses a fallback reason and name for non-Error values", () => {
    showFatalErrorToast("just a string");
    const state = getFatalErrorToastState();
    expect(state.errorName).toBe("UnknownError");
    expect(state.reportMessage).toBe("Unknown error.");
  });
});

describe("dismissFatalErrorToast", () => {
  it("hides the toast without clearing other fields", () => {
    showFatalErrorToast(new Error("boom"));
    dismissFatalErrorToast();
    expect(getFatalErrorToastState().visible).toBe(false);
  });
});

describe("sendFatalErrorToastReport", () => {
  it("does nothing when the toast is not visible", async () => {
    await sendFatalErrorToastReport();
    expect(mockedSend).not.toHaveBeenCalled();
  });

  it("sends the report and marks sent on success", async () => {
    mockedSend.mockResolvedValue(undefined);
    showFatalErrorToast(new Error("boom"), "ctx");

    await sendFatalErrorToastReport();

    expect(mockedSend).toHaveBeenCalledOnce();
    expect(getFatalErrorToastState().sent).toBe(true);
    expect(getFatalErrorToastState().isSending).toBe(false);
  });

  it("records the error message and leaves sent false when reporting fails", async () => {
    mockedSend.mockRejectedValue(new Error("network down"));
    showFatalErrorToast(new Error("boom"), "ctx");

    await sendFatalErrorToastReport();

    expect(getFatalErrorToastState().sent).toBe(false);
    expect(getFatalErrorToastState().sendError).toBe("network down");
  });

  it("is a no-op re-entry guard while a send is already in flight", async () => {
    let resolveSend: () => void = () => {};
    mockedSend.mockReturnValue(new Promise((resolve) => { resolveSend = () => resolve(undefined); }));
    showFatalErrorToast(new Error("boom"), "ctx");

    const first = sendFatalErrorToastReport();
    const second = sendFatalErrorToastReport();
    resolveSend();
    await Promise.all([first, second]);

    expect(mockedSend).toHaveBeenCalledTimes(1);
  });
});
