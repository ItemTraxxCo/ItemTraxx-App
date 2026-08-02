import {
  getTrustedIngressBodyLimit,
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
      new Request("https://example.test/functions/workspace-login"),
      "workspace-login",
      (status, body) => Response.json(body, { status }),
    );

    assert(response?.status === 403, "expected direct request rejection");
  });
});

Deno.test("trusted ingress accepts a fresh matching proxy signature", async () => {
  await withSecret(async () => {
    const timestamp = Date.now().toString();
    const requestId = "request-123";
    const target = "workspace-login";
    const payload = JSON.stringify({
      access_code: "tenant-1",
      password: "secret",
    });
    const signature = await sign(
      `${timestamp}.${requestId}.POST.${target}.${await bodyHash(payload)}`,
    );
    const request = new Request("https://example.test/functions/workspace-login", {
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

Deno.test("trusted ingress preserves the support attachment payload limit", async () => {
  await withSecret(async () => {
    const payload = "x".repeat(1024 * 1024 + 1);
    const timestamp = Date.now().toString();
    const requestId = "request-support-large";
    const target = "contact-support-submit";
    const signature = await sign(
      `${timestamp}.${requestId}.POST.${target}.${await bodyHash(payload)}`,
    );
    const request = new Request("https://example.test/functions/contact-support-submit", {
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
      getTrustedIngressBodyLimit(target) > 1024 * 1024,
      "expected support ingress limit to exceed the default cap",
    );
    assert(
      await hasTrustedEdgeIngress(request, target),
      "expected large support request to retain a valid ingress signature",
    );
  });
});

Deno.test("trusted ingress rejects body replay with modified payload", async () => {
  await withSecret(async () => {
    const timestamp = Date.now().toString();
    const requestId = "request-123";
    const target = "workspace-login";
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
    const request = new Request("https://example.test/functions/workspace-login", {
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

Deno.test("hasTrustedEdgeIngress throws when the shared secret is not configured", async () => {
  const previous = Deno.env.get("ITX_EDGE_PROXY_SHARED_SECRET");
  Deno.env.delete("ITX_EDGE_PROXY_SHARED_SECRET");
  try {
    const request = new Request("https://example.test/functions/workspace-login", {
      headers: { "x-itx-edge-proxy": "1" },
    });
    try {
      await hasTrustedEdgeIngress(request, "workspace-login");
    } catch (error) {
      assert(
        error instanceof Error &&
          error.message === "Missing ITX_EDGE_PROXY_SHARED_SECRET",
        "expected the missing-secret error message",
      );
      return;
    }
    throw new Error("expected missing secret to throw");
  } finally {
    if (previous !== undefined) {
      Deno.env.set("ITX_EDGE_PROXY_SHARED_SECRET", previous);
    }
  }
});

Deno.test("requireTrustedEdgeIngress reports server misconfiguration when the secret is missing", async () => {
  const previous = Deno.env.get("ITX_EDGE_PROXY_SHARED_SECRET");
  Deno.env.delete("ITX_EDGE_PROXY_SHARED_SECRET");
  try {
    const response = await requireTrustedEdgeIngress(
      new Request("https://example.test/functions/workspace-login"),
      "workspace-login",
      (status, body) => Response.json(body, { status }),
    );
    assert(response?.status === 500, "expected a 500 misconfiguration response");
    const body = await response?.json();
    assert(
      body?.error === "Server misconfiguration.",
      "expected the misconfiguration error message",
    );
  } finally {
    if (previous !== undefined) {
      Deno.env.set("ITX_EDGE_PROXY_SHARED_SECRET", previous);
    }
  }
});

Deno.test("trusted ingress rejects requests missing the timestamp or signature headers", async () => {
  await withSecret(async () => {
    const target = "workspace-login";
    const requestId = "request-missing-headers";

    const missingTimestamp = new Request(
      "https://example.test/functions/workspace-login",
      {
        method: "POST",
        headers: {
          "x-itx-edge-proxy": "1",
          "x-itx-edge-proxy-signature": "deadbeef",
          "x-request-id": requestId,
        },
        body: "{}",
      },
    );
    assert(
      !(await hasTrustedEdgeIngress(missingTimestamp, target)),
      "expected missing timestamp header rejection",
    );

    const missingSignature = new Request(
      "https://example.test/functions/workspace-login",
      {
        method: "POST",
        headers: {
          "x-itx-edge-proxy": "1",
          "x-itx-edge-proxy-ts": Date.now().toString(),
          "x-request-id": requestId,
        },
        body: "{}",
      },
    );
    assert(
      !(await hasTrustedEdgeIngress(missingSignature, target)),
      "expected missing signature header rejection",
    );
  });
});

Deno.test("trusted ingress rejects a non-numeric timestamp header", async () => {
  await withSecret(async () => {
    const request = new Request(
      "https://example.test/functions/workspace-login",
      {
        method: "POST",
        headers: {
          "x-itx-edge-proxy": "1",
          "x-itx-edge-proxy-ts": "not-a-number",
          "x-itx-edge-proxy-signature": "deadbeef",
          "x-request-id": "request-1",
        },
        body: "{}",
      },
    );
    assert(
      !(await hasTrustedEdgeIngress(request, "workspace-login")),
      "expected non-numeric timestamp rejection",
    );
  });
});

Deno.test("trusted ingress rejects a timestamp outside the allowed clock skew", async () => {
  await withSecret(async () => {
    const target = "workspace-login";
    const requestId = "request-skew";
    const staleTimestamp = (Date.now() - 5 * 60 * 1000).toString();
    const signature = await sign(
      `${staleTimestamp}.${requestId}.POST.${target}.${await bodyHash("{}")}`,
    );
    const request = new Request(
      "https://example.test/functions/workspace-login",
      {
        method: "POST",
        headers: {
          "x-itx-edge-proxy": "1",
          "x-itx-edge-proxy-ts": staleTimestamp,
          "x-itx-edge-proxy-signature": signature,
          "x-request-id": requestId,
        },
        body: "{}",
      },
    );
    assert(
      !(await hasTrustedEdgeIngress(request, target)),
      "expected stale timestamp rejection",
    );
  });
});

Deno.test("trusted ingress rejects requests missing an x-request-id header", async () => {
  await withSecret(async () => {
    const target = "workspace-login";
    const timestamp = Date.now().toString();
    const signature = await sign(
      `${timestamp}..POST.${target}.${await bodyHash("{}")}`,
    );
    const request = new Request(
      "https://example.test/functions/workspace-login",
      {
        method: "POST",
        headers: {
          "x-itx-edge-proxy": "1",
          "x-itx-edge-proxy-ts": timestamp,
          "x-itx-edge-proxy-signature": signature,
        },
        body: "{}",
      },
    );
    assert(
      !(await hasTrustedEdgeIngress(request, target)),
      "expected missing request-id rejection",
    );
  });
});

Deno.test("trusted ingress accepts GET requests using the no-body hash", async () => {
  await withSecret(async () => {
    const target = "system-status";
    const timestamp = Date.now().toString();
    const requestId = "request-get";
    const signature = await sign(
      `${timestamp}.${requestId}.GET.${target}.no-body`,
    );
    const request = new Request(
      "https://example.test/functions/system-status",
      {
        method: "GET",
        headers: {
          "x-itx-edge-proxy": "1",
          "x-itx-edge-proxy-ts": timestamp,
          "x-itx-edge-proxy-signature": signature,
          "x-request-id": requestId,
        },
      },
    );
    assert(
      await hasTrustedEdgeIngress(request, target),
      "expected GET requests to be signed using the no-body sentinel",
    );
  });
});

Deno.test("requireTrustedEdgeIngress surfaces oversized-body validation errors with their status", async () => {
  await withSecret(async () => {
    const target = "generic-target";
    const timestamp = Date.now().toString();
    const requestId = "request-oversized";
    const oversizedPayload = "x".repeat(1024 * 1024 + 100);
    const request = new Request(
      "https://example.test/functions/generic-target",
      {
        method: "POST",
        headers: {
          "x-itx-edge-proxy": "1",
          "x-itx-edge-proxy-ts": timestamp,
          "x-itx-edge-proxy-signature": "irrelevant-because-body-check-runs-first",
          "x-request-id": requestId,
        },
        body: oversizedPayload,
      },
    );

    const response = await requireTrustedEdgeIngress(
      request,
      target,
      (status, body) => Response.json(body, { status }),
    );

    assert(response?.status === 413, "expected the oversized-body status to propagate");
    const body = await response?.json();
    assert(
      body?.error === "Request body is too large.",
      "expected the oversized-body validation message to propagate",
    );
  });
});
