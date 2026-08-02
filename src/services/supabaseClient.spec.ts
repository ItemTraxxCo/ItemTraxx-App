import { describe, expect, it } from "vitest";
import { supabase } from "./supabaseClient";

// supabaseClient.ts is a thin config file: it just calls createClient() with
// env-derived URL/key and a fixed auth config. There's no branching logic to
// exercise, so a smoke test confirming the export has the expected shape is
// enough — forcing scenario-style tests onto it would be meaningless.
describe("supabase client", () => {
  it("exports a configured Supabase client with the expected surface", () => {
    expect(supabase).toBeDefined();
    expect(supabase.auth).toBeDefined();
    expect(typeof supabase.auth.signOut).toBe("function");
    expect(typeof supabase.auth.signInWithPasskey).toBe("function");
    expect(typeof supabase.auth.refreshSession).toBe("function");
    expect(typeof supabase.from).toBe("function");
  });
});
