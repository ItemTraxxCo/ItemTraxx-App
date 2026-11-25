import { beforeEach, describe, expect, it, vi } from "vitest";
import { clearAuthState, setAuthStateFromBackend, setWorkspaceContext } from "../store/authState";
vi.mock("./edgeFunctionClient", () => ({ invokeEdgeFunction: vi.fn() }));
vi.mock("../utils/deviceSession", () => ({ getOrCreateDeviceSession: () => ({ deviceId: "device" }) }));
import { invokeEdgeFunction } from "./edgeFunctionClient";
import { isEncryptedBorrowerDirectoryEnabled } from "./borrowerEncryptionMode";

describe("workspace encryption mode", () => {
  beforeEach(() => { clearAuthState(); setAuthStateFromBackend({ isAuthenticated: true, userId: 'user-1' }); setWorkspaceContext("workspace-1"); vi.mocked(invokeEdgeFunction).mockReset(); vi.stubEnv("VITE_ENCRYPTED_BORROWERS_LOCAL", "false"); });
  it("uses the authenticated broker response", async () => {
    vi.mocked(invokeEdgeFunction).mockResolvedValue({ ok: true, status: 200, error: "", data: { data: { encrypted: true } } });
    await expect(isEncryptedBorrowerDirectoryEnabled()).resolves.toBe(true);
    expect(invokeEdgeFunction).toHaveBeenCalledWith("crypto-broker", { method: "POST", body: { action: "mode", device_id: "device" } });
  });
  it("fails closed if the mode is unavailable", async () => {
    vi.mocked(invokeEdgeFunction).mockResolvedValue({ ok: false, status: 503, error: "", data: null });
    await expect(isEncryptedBorrowerDirectoryEnabled()).rejects.toThrow();
  });
  it("rejects a response after a workspace switch", async () => {
    let resolve!: (value: never) => void;
    vi.mocked(invokeEdgeFunction).mockReturnValue(new Promise(done => { resolve = done; }));
    const pending = isEncryptedBorrowerDirectoryEnabled();
    setWorkspaceContext("workspace-2");
    resolve({ ok: true, status: 200, error: "", data: { data: { encrypted: false } } } as never);
    await expect(pending).rejects.toThrow();
  });
});
