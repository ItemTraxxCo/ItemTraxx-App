import { checkSessionRateLimit } from "./session.ts";

Deno.test("session limiter uses only the trusted Cloudflare client IP and fails closed", async () => {
  let observed = "";
  const request = new Request("https://edge.itemtraxx.com/auth/session/refresh", {
    headers: { "cf-connecting-ip": "203.0.113.42", "x-forwarded-for": "198.51.100.10" },
  });
  const allowed = await checkSessionRateLimit({
    limit: ({ key }) => {
      observed = key;
      return Promise.resolve({ success: true });
    },
  }, request);
  if (allowed !== "allowed" || observed !== "203.0.113.42") {
    throw new Error("Expected the Cloudflare connecting IP to be the limiter key");
  }
  if (await checkSessionRateLimit(undefined, request) !== "unavailable") {
    throw new Error("Expected a missing limiter binding to fail closed");
  }
});
