import { isItemTraxxHostname, trimTrailingSlash } from "./url.ts";

const assertEquals = (actual: string, expected: string, message: string) => {
  if (actual !== expected) {
    throw new Error(
      `${message}: expected ${JSON.stringify(expected)}, received ${
        JSON.stringify(actual)
      }`,
    );
  }
};

Deno.test("trimTrailingSlash removes only trailing slash characters", () => {
  for (
    const [input, expected] of [
      ["https://example.supabase.co", "https://example.supabase.co"],
      ["https://example.supabase.co/", "https://example.supabase.co"],
      ["https://example.supabase.co///", "https://example.supabase.co"],
      ["https://example.supabase.co/path/", "https://example.supabase.co/path"],
      ["///", ""],
      ["", ""],
    ] as const
  ) {
    assertEquals(trimTrailingSlash(input), expected, input);
  }
});

Deno.test("trimTrailingSlash handles large slash runs without regex backtracking", () => {
  const nonMatching = "/".repeat(200_000) + "x";
  assertEquals(
    trimTrailingSlash(nonMatching),
    nonMatching,
    "non-trailing slash run",
  );

  const trailing = "https://example.supabase.co" + "/".repeat(200_000);
  assertEquals(
    trimTrailingSlash(trailing),
    "https://example.supabase.co",
    "trailing slash run",
  );
});

Deno.test("isItemTraxxHostname enforces the domain label boundary", () => {
  const allowed = ["itemtraxx.com", "app.itemtraxx.com", "ORG.APP.ITEMTRAXX.COM"];
  const rejected = ["evilitemtraxx.com", "itemtraxx.com.attacker.example", ".itemtraxx.com", "itemtraxx.com."];
  for (const hostname of allowed) {
    if (!isItemTraxxHostname(hostname)) throw new Error(`expected ${hostname} to be allowed`);
  }
  for (const hostname of rejected) {
    if (isItemTraxxHostname(hostname)) throw new Error(`expected ${hostname} to be rejected`);
  }
});
