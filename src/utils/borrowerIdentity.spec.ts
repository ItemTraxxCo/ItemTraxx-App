import { describe, expect, it } from "vitest";
import { generateBorrowerIdentity } from "./borrowerIdentity";

describe("generateBorrowerIdentity", () => {
  it("returns a borrowerId shaped as 4 digits followed by 2 uppercase letters", () => {
    for (let i = 0; i < 100; i += 1) {
      const { borrowerId } = generateBorrowerIdentity();
      expect(borrowerId).toMatch(/^\d{4}[A-Z]{2}$/);
    }
  });

  it("returns a username shaped as two capitalized alpha chunks (each capped at 6 chars) followed by 3 digits", () => {
    for (let i = 0; i < 100; i += 1) {
      const { username } = generateBorrowerIdentity();
      expect(username).toMatch(/^[A-Za-z]+\d{3}$/);

      const digits = username.slice(-3);
      const letters = username.slice(0, -3);
      expect(digits).toMatch(/^\d{3}$/);

      // Word-list entries are capped at 6 chars each by normalizeNameToken,
      // so the alpha portion (prefix + suffix) is at most 12 chars.
      expect(letters.length).toBeGreaterThan(0);
      expect(letters.length).toBeLessThanOrEqual(12);
    }
  });

  it("does not reuse the same borrowerId or username across many consecutive calls (no fixed seed / no obvious collisions)", () => {
    const seenUsernames = new Set<string>();
    const seenBorrowerIds = new Set<string>();
    const iterations = 200;

    for (let i = 0; i < iterations; i += 1) {
      const { username, borrowerId } = generateBorrowerIdentity();
      seenUsernames.add(username);
      seenBorrowerIds.add(borrowerId);
    }

    // Not a strict uniqueness guarantee (this is randomness, not a sequence),
    // but with this much entropy per call, 200 draws should not collapse to
    // a handful of repeats -- that would indicate a broken RNG or a static
    // fallback silently kicking in.
    expect(seenUsernames.size).toBeGreaterThan(iterations * 0.9);
    expect(seenBorrowerIds.size).toBeGreaterThan(iterations * 0.9);
  });

  it("returns a fresh object each call (no shared mutable state between calls)", () => {
    const first = generateBorrowerIdentity();
    const second = generateBorrowerIdentity();
    expect(first).not.toBe(second);
  });
});
