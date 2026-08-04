import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  invokeEdgeFunction: vi.fn(),
  initializeSdk: vi.fn(),
  shutdownSdk: vi.fn(),
}));

vi.mock("./edgeFunctionClient", () => ({
  invokeEdgeFunction: mocks.invokeEdgeFunction,
}));

vi.mock("@intercom/messenger-js-sdk", () => ({
  default: mocks.initializeSdk,
  shutdown: mocks.shutdownSdk,
}));

const loadService = async () => {
  vi.resetModules();
  vi.stubEnv("VITE_INTERCOM_APP_ID", "p7kap9jy");
  vi.stubEnv("VITE_E2E_TEST_UTILS", "false");
  return import("./intercomService");
};

describe("intercomService", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.invokeEdgeFunction.mockResolvedValue({
      ok: true,
      status: 200,
      data: { data: { token: "signed-jwt" } },
      error: "",
    });
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("keeps anonymous settings app-id-only", async () => {
    const service = await loadService();
    expect(service.buildIntercomSettings()).toEqual({ app_id: "p7kap9jy" });
  });

  it("boots authenticated users with a signed JWT and no unsigned identity fields", async () => {
    const service = await loadService();

    await service.initializeIntercom({
      userId: "user-123",
      email: "person@example.com",
    });

    expect(mocks.invokeEdgeFunction).toHaveBeenCalledWith("intercom-jwt", {
      method: "POST",
    });
    expect(mocks.initializeSdk).toHaveBeenCalledWith({
      app_id: "p7kap9jy",
      intercom_user_jwt: "signed-jwt",
    });
  });

  it("does not boot an authenticated Messenger when token minting fails", async () => {
    mocks.invokeEdgeFunction.mockResolvedValueOnce({
      ok: false,
      status: 500,
      data: null,
      error: "Server misconfiguration.",
    });
    const service = await loadService();

    await service.initializeIntercom({ userId: "user-123", email: null });

    expect(mocks.initializeSdk).not.toHaveBeenCalled();
  });
});
