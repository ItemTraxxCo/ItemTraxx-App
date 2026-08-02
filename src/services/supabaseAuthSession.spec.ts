import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("./supabaseClient", () => ({
  supabase: {
    auth: {
      signOut: vi.fn(),
    },
  },
}));

import { signOutLocalSupabaseSession } from "./supabaseAuthSession";
import { supabase } from "./supabaseClient";

describe("signOutLocalSupabaseSession", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("resolves cleanly when Supabase reports no error", async () => {
    vi.mocked(supabase.auth.signOut).mockResolvedValueOnce({ error: null } as never);

    await expect(signOutLocalSupabaseSession()).resolves.toBeUndefined();
    expect(supabase.auth.signOut).toHaveBeenCalledWith({ scope: "local" });
  });

  it("swallows a session_not_found error code returned (not thrown) by signOut", async () => {
    vi.mocked(supabase.auth.signOut).mockResolvedValueOnce({
      error: { code: "session_not_found", message: "Session not found" },
    } as never);

    await expect(signOutLocalSupabaseSession()).resolves.toBeUndefined();
  });

  it("swallows a 403 error whose message mentions session", async () => {
    vi.mocked(supabase.auth.signOut).mockResolvedValueOnce({
      error: { status: 403, message: "Auth session missing" },
    } as never);

    await expect(signOutLocalSupabaseSession()).resolves.toBeUndefined();
  });

  it("does not swallow a 403 error unrelated to a missing session", async () => {
    const error = { status: 403, message: "Forbidden action" };
    vi.mocked(supabase.auth.signOut).mockResolvedValueOnce({ error } as never);

    await expect(signOutLocalSupabaseSession()).rejects.toEqual(error);
  });

  it("rethrows an error object that doesn't match the missing-session heuristic", async () => {
    const error = { code: "network_error", message: "boom" };
    vi.mocked(supabase.auth.signOut).mockResolvedValueOnce({ error } as never);

    await expect(signOutLocalSupabaseSession()).rejects.toEqual(error);
  });

  it("swallows a thrown (rejected) session_not_found error", async () => {
    vi.mocked(supabase.auth.signOut).mockRejectedValueOnce({
      error_code: "session_not_found",
    });

    await expect(signOutLocalSupabaseSession()).resolves.toBeUndefined();
  });

  it("rethrows a thrown error unrelated to a missing session", async () => {
    const error = new Error("network down");
    vi.mocked(supabase.auth.signOut).mockRejectedValueOnce(error);

    await expect(signOutLocalSupabaseSession()).rejects.toBe(error);
  });

  it("treats a non-object thrown value as non-matching and rethrows it", async () => {
    vi.mocked(supabase.auth.signOut).mockRejectedValueOnce("plain string error");

    await expect(signOutLocalSupabaseSession()).rejects.toBe("plain string error");
  });
});
