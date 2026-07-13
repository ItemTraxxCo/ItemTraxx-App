import { resolveTrustedGeneralLocation } from "./requestMetadata.ts";

const assertEquals = (actual: unknown, expected: unknown, message: string) => {
  if (actual !== expected) {
    throw new Error(
      `${message}: expected ${String(expected)}, got ${String(actual)}`,
    );
  }
};

const requestWithHeaders = (headers: HeadersInit) =>
  new Request("https://edge.itemtraxx.com/functions/v1/test", { headers });

Deno.test("trusted general location preserves the existing header and formatting contract", () => {
  assertEquals(
    resolveTrustedGeneralLocation(
      requestWithHeaders({
        "x-itx-geo-city": "  san francisco  ",
        "x-itx-geo-region": " california ",
        "x-itx-geo-country": "us",
      }),
    ),
    "SAN Francisco, California",
    "city and region must take precedence over country",
  );
  assertEquals(
    resolveTrustedGeneralLocation(
      requestWithHeaders({
        "x-itx-geo-city": "district of columbia",
        "x-itx-geo-country": "us",
      }),
    ),
    "District OF Columbia, US",
    "title casing and short-word capitalization must remain stable",
  );
  assertEquals(
    resolveTrustedGeneralLocation(
      requestWithHeaders({
        "x-itx-geo-region": "new south wales",
        "x-itx-geo-country": "au",
      }),
    ),
    "NEW South Wales, AU",
    "region and country must be used when city is absent",
  );
});

Deno.test("trusted general location preserves null, single-value, and length behavior", () => {
  assertEquals(
    resolveTrustedGeneralLocation(requestWithHeaders({})),
    null,
    "missing headers must resolve to null",
  );
  assertEquals(
    resolveTrustedGeneralLocation(
      requestWithHeaders({ "x-itx-geo-city": "   " }),
    ),
    null,
    "blank headers must resolve to null",
  );
  assertEquals(
    resolveTrustedGeneralLocation(
      requestWithHeaders({ "x-itx-geo-country": " united states " }),
    ),
    "United States",
    "a single header must remain supported",
  );

  const overlong = "a".repeat(81);
  assertEquals(
    resolveTrustedGeneralLocation(
      requestWithHeaders({ "x-itx-geo-city": overlong }),
    ),
    "A" + "a".repeat(79),
    "each forwarded geo header must remain capped at 80 characters",
  );
});

Deno.test("trusted general location does not read raw Cloudflare geo headers", () => {
  assertEquals(
    resolveTrustedGeneralLocation(
      requestWithHeaders({
        "cf-ipcity": "Los Angeles",
        "cf-region": "California",
        "cf-ipcountry": "US",
      }),
    ),
    null,
    "raw Cloudflare metadata belongs to a different trust contract",
  );
});
