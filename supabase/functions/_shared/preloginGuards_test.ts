import { resolveClientFingerprint } from "./preloginGuards.ts";

const assert = (condition: boolean, message: string) => {
  if (!condition) throw new Error(message);
};

Deno.test("resolveClientFingerprint prefers trusted Cloudflare IP", () => {
  const request = new Request("https://example.com", {
    headers: {
      "cf-connecting-ip": "203.0.113.42",
      "user-agent": "AttackerBot/1.0",
    },
  });

  const fingerprint = resolveClientFingerprint(request, null);
  assert(
    fingerprint === "ip-203-0-113-42",
    "expected trusted Cloudflare IP fingerprint",
  );
});

Deno.test("resolveClientFingerprint does not fall back to user-agent", () => {
  const request = new Request("https://example.com", {
    headers: {
      "user-agent": "AttackerBot/1.0",
    },
  });

  const fingerprint = resolveClientFingerprint(request, null);
  assert(
    fingerprint === "unknown-client",
    "expected non-IP clients to share the unknown-client bucket",
  );
});
