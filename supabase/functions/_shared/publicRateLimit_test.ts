import { buildPublicRateLimitHeaders } from "./publicRateLimit.ts";

const assert = (condition: boolean, message: string) => {
  if (!condition) throw new Error(message);
};

Deno.test("public rate-limit headers describe the configured window", () => {
  const headers = buildPublicRateLimitHeaders({ limit: 60, windowSeconds: 60 });
  assert(headers["RateLimit-Limit"] === "60", "expected the limit header");
  assert(
    headers["RateLimit-Reset"] === "60",
    "expected the default reset window",
  );
  assert(
    headers["RateLimit-Policy"] === "60;w=60",
    "expected the policy header",
  );
  assert(!("RateLimit-Remaining" in headers), "remaining must not be guessed");
  assert(
    !("Retry-After" in headers),
    "retry-after belongs on a limited response",
  );
});

Deno.test("public rate-limit headers expose a real rejection delay", () => {
  const headers = buildPublicRateLimitHeaders({
    limit: 5,
    windowSeconds: 3600,
    retryAfterSeconds: 123,
    remaining: 0,
  });
  assert(headers["RateLimit-Limit"] === "5", "expected the configured limit");
  assert(
    headers["RateLimit-Reset"] === "123",
    "expected the retry delay as reset",
  );
  assert(
    headers["RateLimit-Remaining"] === "0",
    "expected zero remaining capacity",
  );
  assert(headers["Retry-After"] === "123", "expected retry-after on 429");
});
