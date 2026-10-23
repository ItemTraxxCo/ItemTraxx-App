import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("./edgeFunctionClient", () => ({ invokeEdgeFunction: vi.fn() }));

import { invokeEdgeFunction } from "./edgeFunctionClient";
import { acceptWorkspaceInvitation } from "./workspaceInvitationService";

const mockedInvoke = vi.mocked(invokeEdgeFunction);

beforeEach(() => mockedInvoke.mockReset());

describe("workspace invitation service", () => {
  it("posts the invitation token and password without signing in", async () => {
    mockedInvoke.mockResolvedValueOnce({
      ok: true,
      status: 200,
      error: "",
      data: { success: true },
    });

    await acceptWorkspaceInvitation("a".repeat(64), "StrongPassword7!");

    expect(invokeEdgeFunction).toHaveBeenCalledWith("workspace-invitation", {
      method: "POST",
      body: { token: "a".repeat(64), password: "StrongPassword7!" },
    });
  });
});
