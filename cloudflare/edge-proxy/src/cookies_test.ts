import {
  appendSetCookies,
  clearSessionCookies,
  parseCookies,
  setSessionCookies,
} from "./cookies.ts";

const assertEquals = (actual: unknown, expected: unknown, message: string) => {
  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    throw new Error(
      `${message}: expected ${JSON.stringify(expected)}, received ${
        JSON.stringify(actual)
      }`,
    );
  }
};

const values = (headers: Headers) =>
  (headers as Headers & { getSetCookie?: () => string[] }).getSetCookie?.() ??
    [];

Deno.test("cookie parsing preserves encoded values and ignores malformed pairs", () => {
  const request = new Request("https://edge.itemtraxx.com", {
    headers: {
      cookie:
        "other=ignored; itx_session=access%20token; malformed; itx_refresh=refresh%2Ftoken",
    },
  });
  assertEquals(parseCookies(request), {
    accessToken: "access token",
    refreshToken: "refresh/token",
  }, "parsed session cookies");
});

Deno.test("session cookie writers preserve exact set and clear attributes", () => {
  const env = {
    SESSION_COOKIE_DOMAIN: ".itemtraxx.com",
    SESSION_COOKIE_SAMESITE: "none",
    SESSION_REFRESH_COOKIE_MAX_AGE_SECONDS: "7200",
  } as Env;
  const setHeaders = new Headers();
  setSessionCookies(setHeaders, env, {
    accessToken: "access",
    refreshToken: "refresh",
  });
  assertEquals(values(setHeaders), [
    "itx_session=access; Path=/; Max-Age=3600; HttpOnly; Secure; SameSite=None; Domain=.itemtraxx.com",
    "itx_refresh=refresh; Path=/; Max-Age=7200; HttpOnly; Secure; SameSite=None; Domain=.itemtraxx.com",
  ], "set cookie values");

  const clearHeaders = new Headers();
  clearSessionCookies(clearHeaders, env);
  assertEquals(values(clearHeaders), [
    "itx_session=; Path=/; Max-Age=0; HttpOnly; Secure; SameSite=None; Domain=.itemtraxx.com",
    "itx_refresh=; Path=/; Max-Age=0; HttpOnly; Secure; SameSite=None; Domain=.itemtraxx.com",
  ], "clear cookie values");
});

Deno.test("Set-Cookie forwarding preserves each independent cookie", () => {
  const source = new Headers();
  source.append("Set-Cookie", "first=1; Path=/");
  source.append("Set-Cookie", "second=2; Path=/");
  const target = new Headers({ existing: "kept" });
  appendSetCookies(target, source);
  assertEquals(
    values(target),
    ["first=1; Path=/", "second=2; Path=/"],
    "forwarded cookies",
  );
  assertEquals(target.get("existing"), "kept", "existing header");
});
