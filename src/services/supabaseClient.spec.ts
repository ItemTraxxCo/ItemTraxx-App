import { describe, expect, it } from "vitest";
import { supabase } from "./supabaseClient";

describe("supabase client", () => {
  it("exports a database client without relying on Supabase Auth", () => {
    expect(supabase).toBeDefined();
    expect(typeof supabase.from).toBe("function");
  });
});
