import {
  hasTrustedEdgeIngress,
  requireTrustedEdgeIngress,
} from "./trustedIngress.ts";

const SECRET = "trusted-ingress-test-secret";

const assert = (condition: boolean, message: string) => {
  if (!condition) throw new Error(message);
};

const toHex = (bytes: Uint8Array) =>
  Array.from(bytes)
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");

const sign = async (message: string) => {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(SECRET),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const signature = await crypto.subtle.sign(
    "HMAC",
    key,
    new TextEncoder().encode(message),
  );
  return toHex(new Uint8Array(signature));
};

const bodyHash = async (value: string) => {
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(value),
  );
  return toHex(new Uint8Array(digest));
};

const withSecret = async (run: () => Promise<void>) => {
  const previous = Deno.env.get("ITX_EDGE_PROXY_SHARED_SECRET");
  Deno.env.set("ITX_EDGE_PROXY_SHARED_SECRET", SECRET);
  try {
    await run();
  } finally {
    if (previous === undefined) {
      Deno.env.delete("ITX_EDGE_PROXY_SHARED_SECRET");
    } else {
      Deno.env.set("ITX_EDGE_PROXY_SHARED_SECRET", previous);
    }
  }
};

Deno.test("trusted ingress rejects direct requests", async () => {
  await withSecret(async () => {
    const response = await requireTrustedEdgeIngress(
      new Request("https://example.test/functions/tenant-login"),
      "tenant-login",
      (status, body) => Response.json(body, { status }),
    );

    assert(response?.status === 403, "expected direct request rejection");
  });
});

Deno.test("trusted ingress accepts a fresh matching proxy signature", async () => {
  await withSecret(async () => {
    const timestamp = Date.now().toString();
    const requestId = "request-123";
    const target = "tenant-login";
    const payload = JSON.stringify({
      access_code: "tenant-1",
      password: "secret",
    });
    const signature = await sign(
      `${timestamp}.${requestId}.POST.${target}.${await bodyHash(payload)}`,
    );
    const request = new Request("https://example.test/functions/tenant-login", {
      method: "POST",
      headers: {
        "x-itx-edge-proxy": "1",
        "x-itx-edge-proxy-ts": timestamp,
        "x-itx-edge-proxy-signature": signature,
        "x-request-id": requestId,
        "content-type": "application/json",
      },
      body: payload,
    });

    assert(
      await hasTrustedEdgeIngress(request, target),
      "expected signed request acceptance",
    );
    assert(
      !(await hasTrustedEdgeIngress(request, "different-target")),
      "expected target-bound signature rejection",
    );
  });
});

Deno.test("trusted ingress rejects body replay with modified payload", async () => {
  await withSecret(async () => {
    const timestamp = Date.now().toString();
    const requestId = "request-123";
    const target = "tenant-login";
    const originalPayload = JSON.stringify({
      access_code: "tenant-1",
      password: "secret",
    });
    const tamperedPayload = JSON.stringify({
      access_code: "tenant-1",
      password: "changed",
    });
    const signature = await sign(
      `${timestamp}.${requestId}.POST.${target}.${await bodyHash(
        originalPayload,
      )}`,
    );
    const request = new Request("https://example.test/functions/tenant-login", {
      method: "POST",
      headers: {
        "x-itx-edge-proxy": "1",
        "x-itx-edge-proxy-ts": timestamp,
        "x-itx-edge-proxy-signature": signature,
        "x-request-id": requestId,
        "content-type": "application/json",
      },
      body: tamperedPayload,
    });

    assert(
      !(await hasTrustedEdgeIngress(request, target)),
      "expected modified body rejection",
    );
  });
});
