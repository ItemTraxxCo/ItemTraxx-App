import worker from "./index.ts";

const executionContext = { waitUntil: (_promise: Promise<unknown>) => {} };

Deno.test("legacy Supabase Auth session endpoints are removed", async () => {
  for (const action of ["exchange", "refresh", "me", "logout"]) {
    const response = await worker.fetch(
      new Request(`https://edge.itemtraxx.com/auth/session/${action}`, {
        method: action === "me" ? "GET" : "POST",
        headers: { origin: "https://itemtraxx.com" },
      }),
      {
        SUPABASE_URL: "https://example.supabase.co",
        SUPABASE_ANON_KEY: "anon-key",
      },
      executionContext,
    );
    if (response.status !== 404) {
      throw new Error(`Expected removed ${action} endpoint to return 404`);
    }
  }
});
