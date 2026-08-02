import { describe, expect, it } from "vitest";
import { sanitizeInput } from "./inputSanitizer";

describe("sanitizeInput", () => {
  it("trims surrounding whitespace and returns no error for clean input", () => {
    const result = sanitizeInput("  hello world  ", { maxLen: 50 });
    expect(result).toEqual({ value: "hello world", error: "" });
  });

  it("truncates input longer than maxLen and reports a length error", () => {
    const result = sanitizeInput("abcdefghij", { maxLen: 5 });
    expect(result.value).toBe("abcde");
    expect(result.error).toBe("Input must be 5 characters or less.");
  });

  it("measures length after trimming, not before", () => {
    // Untrimmed length is 7 (over a maxLen of 5), but trimmed length is 5 (exactly at the limit).
    const result = sanitizeInput("  abcde  ", { maxLen: 5 });
    expect(result.value).toBe("abcde");
    expect(result.error).toBe("");
  });

  it.each([
    ["select", "select * from users"],
    ["insert", "insert into users values (1)"],
    ["update", "update users set x=1"],
    ["delete", "delete from users"],
    ["drop", "drop table users"],
    ["truncate", "truncate table users"],
    ["alter", "alter table users add column x"],
    ["create", "create table users (id int)"],
    ["double dash comment", "value -- comment"],
    ["semicolon", "value; drop table users"],
    ["block comment open", "value /* comment"],
    ["block comment close", "comment */ value"],
  ])("blocks input containing the %s keyword/character", (_label, value) => {
    const result = sanitizeInput(value, { maxLen: 200 });
    expect(result.error).toBe("Input contains blocked characters or keywords.");
    expect(result.value).toBe(value.trim());
  });

  it("is case-insensitive when matching blocked keywords", () => {
    const result = sanitizeInput("SELECT * FROM users", { maxLen: 200 });
    expect(result.error).toBe("Input contains blocked characters or keywords.");
  });

  it("only matches blocked keywords as whole words, not substrings", () => {
    // "selection" contains "select" as a substring but not as a whole word.
    const result = sanitizeInput("selection process", { maxLen: 200 });
    expect(result.error).toBe("");
    expect(result.value).toBe("selection process");
  });

  it("allows ordinary text with punctuation that isn't a blocked pattern", () => {
    const result = sanitizeInput("Room 204, bin #3 (top shelf)", { maxLen: 200 });
    expect(result).toEqual({ value: "Room 204, bin #3 (top shelf)", error: "" });
  });

  it("prioritizes the length check over the blocked-pattern check", () => {
    const overLong = `select ${"a".repeat(50)}`;
    const result = sanitizeInput(overLong, { maxLen: 5 });
    expect(result.error).toBe("Input must be 5 characters or less.");
  });

  it("handles empty input", () => {
    const result = sanitizeInput("", { maxLen: 10 });
    expect(result).toEqual({ value: "", error: "" });
  });
});
