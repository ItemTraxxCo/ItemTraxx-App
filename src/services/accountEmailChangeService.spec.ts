import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("./edgeFunctionClient", () => ({ invokeEdgeFunction: vi.fn() }));

import { invokeEdgeFunction } from "./edgeFunctionClient";
import {
  completeAccountEmailChangeStep,
  requestAccountEmailChange,
} from "./accountEmailChangeService";

const mockedInvoke = vi.mocked(invokeEdgeFunction);

beforeEach(() => mockedInvoke.mockReset());

describe("account email change service", () => {
  it("requests approval without changing the caller's session", async () => {
    mockedInvoke.mockResolvedValueOnce({
      ok: true,
      status: 200,
      error: "",
      data: { success: true, message: "Approval instructions sent." },
    });

    await expect(requestAccountEmailChange(" new@example.com ")).resolves.toBe(
      "Approval instructions sent.",
    );
    expect(invokeEdgeFunction).toHaveBeenCalledWith("account-email-change", {
      method: "POST",
      body: { action: "request", new_email: "new@example.com" },
    });
  });

  it("submits only a one-time token for each public verification step", async () => {
    mockedInvoke.mockResolvedValueOnce({
      ok: true,
      status: 200,
      error: "",
      data: { success: true },
    });
    await completeAccountEmailChangeStep("approve", "a".repeat(64));

    expect(invokeEdgeFunction).toHaveBeenCalledWith("account-email-change", {
      method: "POST",
      body: { action: "approve", token: "a".repeat(64) },
    });
  });
});
