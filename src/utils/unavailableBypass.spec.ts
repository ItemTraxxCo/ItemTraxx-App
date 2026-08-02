import { describe, expect, it } from "vitest";
import { isUnavailableBypassHost } from "./unavailableBypass";

describe("isUnavailableBypassHost", () => {
  it.each([
    "dennis-dev.itemtraxx.com",
    "leo-dev.itemtraxx.com",
    "dev.itemtraxx.com",
    "preview.itemtraxx.com",
    "staging.itemtraxx.com",
  ])("allows the known non-production host %s", (host) => {
    expect(isUnavailableBypassHost(host)).toBe(true);
  });

  it("matches known hosts case-insensitively and trims whitespace", () => {
    expect(isUnavailableBypassHost("  STAGING.ITEMTRAXX.COM  ")).toBe(true);
  });

  it.each(["localhost", "127.0.0.1", "0.0.0.0"])("allows loopback host %s", (host) => {
    expect(isUnavailableBypassHost(host)).toBe(true);
  });

  it("allows any *.localhost subdomain", () => {
    expect(isUnavailableBypassHost("foo.localhost")).toBe(true);
    expect(isUnavailableBypassHost("bar.baz.localhost")).toBe(true);
  });

  it("allows 192.168.x.x private addresses", () => {
    expect(isUnavailableBypassHost("192.168.1.42")).toBe(true);
  });

  it("allows 10.x.x.x private addresses", () => {
    expect(isUnavailableBypassHost("10.0.0.5")).toBe(true);
  });

  it("allows the 172.16.0.0/12 private range (172.16 - 172.31)", () => {
    expect(isUnavailableBypassHost("172.16.0.1")).toBe(true);
    expect(isUnavailableBypassHost("172.31.255.255")).toBe(true);
    expect(isUnavailableBypassHost("172.20.5.5")).toBe(true);
  });

  it("rejects addresses just outside the 172.16.0.0/12 range", () => {
    expect(isUnavailableBypassHost("172.15.255.255")).toBe(false);
    expect(isUnavailableBypassHost("172.32.0.0")).toBe(false);
  });

  it("rejects a production or arbitrary public hostname", () => {
    expect(isUnavailableBypassHost("itemtraxx.com")).toBe(false);
    expect(isUnavailableBypassHost("www.itemtraxx.com")).toBe(false);
    expect(isUnavailableBypassHost("evil.example.com")).toBe(false);
  });

  it("rejects a hostname that merely contains 172 but doesn't match the octet shape", () => {
    expect(isUnavailableBypassHost("172.itemtraxx.com")).toBe(false);
    expect(isUnavailableBypassHost("not172.16.0.1")).toBe(false);
  });

  it("rejects empty input", () => {
    expect(isUnavailableBypassHost("")).toBe(false);
  });
});
