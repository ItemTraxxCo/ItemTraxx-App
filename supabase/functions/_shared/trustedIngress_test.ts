import {
  getTrustedIngressBodyLimit,
  hasTrustedEdgeIngress,
  requireTrustedEdgeIngress,
} from "./trustedIngress.ts";
import { SECURITY_AUDIT_INGRESS_TARGET } from "./securityAuditIngress.ts";

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

const makeSignedIngressRequest = async (input: {
  timestamp?: string;
  requestId?: string;
  target?: string;
  method?: string;
  body?: string;
  signedBody?: string;
} = {}) => {
  const timestamp = input.timestamp ?? Date.now().toString();
  const requestId = input.requestId ?? "request-adversarial-1";
  const target = input.target ?? "workspace-admin-mutate";
  const method = input.method ?? "POST";
  const body = input.body ?? "{}";
  const signatureBody = input.signedBody ?? body;
  const signature = await sign(
    `${timestamp}.${requestId}.${method.toUpperCase()}.${target}.${await bodyHash(
      signatureBody,
    )}`,
  );

  return new Request(`https://example.test/functions/${target}`, {
    method,
    headers: {
      "x-itx-edge-proxy": "1",
      "x-itx-edge-proxy-ts": timestamp,
      "x-itx-edge-proxy-signature": signature,
      "x-request-id": requestId,
      "content-type": "application/json",
    },
    body: method === "GET" || method === "HEAD" ? undefined : body,
  });
};

const assertIngressDenied = async (
  request: Request,
  label: string,
  expectedStatus = 403,
  expectedError = "Trusted edge ingress required.",
) => {
  const response = await requireTrustedEdgeIngress(
    request,
    "workspace-admin-mutate",
    (status, body) => Response.json(body, { status }),
  );
  if (response === null) {
    throw new Error(
      `${label}: expected HTTP ${expectedStatus}, request was accepted`,
    );
  }
  assert(
    response.status === expectedStatus,
    `${label}: expected HTTP ${expectedStatus}`,
  );
  assert(
    JSON.stringify(await response.json()) ===
      JSON.stringify({ error: expectedError }),
    `${label}: expected the stable fail-closed error payload`,
  );
};

const assertIngressAccepted = async (request: Request, label: string) => {
  const response = await requireTrustedEdgeIngress(
    request,
    "workspace-admin-mutate",
    (status, body) => Response.json(body, { status }),
  );
  assert(
    response === null,
    `${label}: expected the signed request to be accepted`,
  );
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
    const request = new Request(
      "https://example.test/functions/workspace-login",
      {
        method: "POST",
        headers: {
          "x-itx-edge-proxy": "1",
          "x-itx-edge-proxy-ts": timestamp,
          "x-itx-edge-proxy-signature": signature,
          "x-request-id": requestId,
          "content-type": "application/json",
        },
        body: payload,
      },
    );

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

Deno.test("the audit writer rejects signatures the function proxy issues for browser requests", async () => {
  await withSecret(async () => {
    const timestamp = Date.now().toString();
    const requestId = "request-audit-forged";
    const payload = JSON.stringify({
      action: "read_item_target",
      item_ids: ["00000000-0000-4000-8000-000000000001"],
      returned_item_ids: ["00000000-0000-4000-8000-000000000001"],
    });
    const buildRequest = async (signedTarget: string) =>
      new Request("https://example.test/functions/v1/security-audit", {
        method: "POST",
        headers: {
          "x-itx-edge-proxy": "1",
          "x-itx-edge-proxy-ts": timestamp,
          "x-itx-edge-proxy-signature": await sign(
            `${timestamp}.${requestId}.POST.${signedTarget}.${await bodyHash(
              payload,
            )}`,
          ),
          "x-request-id": requestId,
          "content-type": "application/json",
        },
        body: payload,
      });

    // The generic proxy signs with the routed function name.
    assert(
      !(await hasTrustedEdgeIngress(
        await buildRequest("security-audit"),
        SECURITY_AUDIT_INGRESS_TARGET,
      )),
      "expected a proxy-relayed audit request to be rejected",
    );
    assert(
      await hasTrustedEdgeIngress(
        await buildRequest(SECURITY_AUDIT_INGRESS_TARGET),
        SECURITY_AUDIT_INGRESS_TARGET,
      ),
      "expected the Worker's internal audit signature to be accepted",
    );
    // Widen the literal type: the constant is compared as a runtime string so
    // this still guards against it being changed back to the routed name.
    const internalTarget: string = SECURITY_AUDIT_INGRESS_TARGET;
    assert(
      internalTarget !== "security-audit",
      "the internal target must differ from the routed function name",
    );
  });
});

Deno.test("trusted ingress rejects missing, stale, malformed, and body-tampered signatures with HTTP 403", async () => {
  await withSecret(async () => {
    await assertIngressDenied(
      new Request("https://example.test/functions/workspace-admin-mutate", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: "{}",
      }),
      "unsigned request",
    );

    const expiredTimestamp = String(Date.now() - 30_001);
    await assertIngressDenied(
      await makeSignedIngressRequest({ timestamp: expiredTimestamp }),
      "expired request signature",
    );

    const invalidTimestampRequest = await makeSignedIngressRequest();
    invalidTimestampRequest.headers.set(
      "x-itx-edge-proxy-ts",
      "not-a-timestamp",
    );
    await assertIngressDenied(invalidTimestampRequest, "malformed timestamp");

    const bodyTamperedRequest = await makeSignedIngressRequest({
      body: '{"action":"set_workspace_account_role","role":"super_admin"}',
      signedBody: '{"action":"get_workspace_settings"}',
    });
    await assertIngressDenied(bodyTamperedRequest, "tampered request body");
  });
});

Deno.test("trusted ingress rejects a replayed valid request ID within the timestamp window", async () => {
  await withSecret(async () => {
    const signedRequest = await makeSignedIngressRequest({
      requestId: "request-replay-fixture",
      body:
        '{"action":"set_workspace_account_role","payload":{"role":"workspace_admin"}}',
    });
    await assertIngressAccepted(signedRequest, "first fresh signed request");

    const replay = await makeSignedIngressRequest({
      timestamp: signedRequest.headers.get("x-itx-edge-proxy-ts") ?? "",
      requestId: "request-replay-fixture",
      body:
        '{"action":"set_workspace_account_role","payload":{"role":"workspace_admin"}}',
    });

    const originalConsoleError = console.error;
    let replayLog = "";
    console.error = (...values: unknown[]) => {
      replayLog = values.map(String).join(" ");
    };
    try {
      await assertIngressDenied(
        replay,
        "replayed signed request",
        409,
        "Trusted edge request replay detected.",
      );
    } finally {
      console.error = originalConsoleError;
    }
    assert(
      replayLog.includes("trusted_ingress.replay_detected"),
      "expected replay detection to be logged explicitly",
    );
  });
});

Deno.test("trusted ingress permits distinct signed batches that reuse a request ID", async () => {
  await withSecret(async () => {
    const firstBatch = await makeSignedIngressRequest({
      requestId: "request-shared-audit-batches",
      target: SECURITY_AUDIT_INGRESS_TARGET,
      body: '{"action":"read_items","item_ids":["item-1"]}',
    });
    const secondBatch = await makeSignedIngressRequest({
      requestId: "request-shared-audit-batches",
      target: SECURITY_AUDIT_INGRESS_TARGET,
      body: '{"action":"read_items","item_ids":["item-2"]}',
    });
    assert(
      firstBatch.headers.get("x-itx-edge-proxy-signature") !==
        secondBatch.headers.get("x-itx-edge-proxy-signature"),
      "each distinct batch must have a distinct signed envelope",
    );

    const acceptBatch = async (request: Request) =>
      await requireTrustedEdgeIngress(
        request,
        SECURITY_AUDIT_INGRESS_TARGET,
        (status, body) => Response.json(body, { status }),
      );
    assert(
      await acceptBatch(firstBatch) === null,
      "first audit batch should pass",
    );
    assert(
      await acceptBatch(secondBatch) === null,
      "a distinct payload signed under the same request ID must remain valid",
    );
  });
});

Deno.test("trusted ingress classifiers do not treat a replay as trusted", async () => {
  await withSecret(async () => {
    const request = await makeSignedIngressRequest({
      requestId: "request-replayed-classifier-fixture",
    });
    assert(
      await hasTrustedEdgeIngress(request, "workspace-admin-mutate"),
      "expected the first signed request to be trusted",
    );

    const originalConsoleError = console.error;
    let replayLog = "";
    console.error = (...values: unknown[]) => {
      replayLog = values.map(String).join(" ");
    };
    try {
      assert(
        !(await hasTrustedEdgeIngress(request, "workspace-admin-mutate")),
        "a repeated signed request must not be treated as trusted",
      );
    } finally {
      console.error = originalConsoleError;
    }
    assert(
      replayLog.includes("trusted_ingress.replay_detected"),
      "expected classifier replay detection to be logged explicitly",
    );
  });
});

Deno.test("trusted ingress atomically accepts only one concurrent exact envelope", async () => {
  await withSecret(async () => {
    const request = await makeSignedIngressRequest({
      requestId: "request-concurrent-replay-fixture",
    });
    const originalConsoleError = console.error;
    console.error = () => {};
    let responses: Array<Response | null>;
    try {
      responses = await Promise.all([
        requireTrustedEdgeIngress(
          request.clone(),
          "workspace-admin-mutate",
          (status, body) => Response.json(body, { status }),
        ),
        requireTrustedEdgeIngress(
          request.clone(),
          "workspace-admin-mutate",
          (status, body) => Response.json(body, { status }),
        ),
      ]);
    } finally {
      console.error = originalConsoleError;
    }
    assert(
      responses.filter((response) => response === null).length === 1,
      "exactly one concurrent request should claim the signed envelope",
    );
    assert(
      responses.filter((response) => response?.status === 409).length === 1,
      "the other concurrent request should receive HTTP 409",
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
    const request = new Request(
      "https://example.test/functions/contact-support-submit",
      {
        method: "POST",
        headers: {
          "x-itx-edge-proxy": "1",
          "x-itx-edge-proxy-ts": timestamp,
          "x-itx-edge-proxy-signature": signature,
          "x-request-id": requestId,
          "content-type": "application/json",
        },
        body: payload,
      },
    );

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
    const request = new Request(
      "https://example.test/functions/workspace-login",
      {
        method: "POST",
        headers: {
          "x-itx-edge-proxy": "1",
          "x-itx-edge-proxy-ts": timestamp,
          "x-itx-edge-proxy-signature": signature,
          "x-request-id": requestId,
          "content-type": "application/json",
        },
        body: tamperedPayload,
      },
    );

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
    const request = new Request(
      "https://example.test/functions/workspace-login",
      {
        headers: { "x-itx-edge-proxy": "1" },
      },
    );
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
    assert(
      response?.status === 500,
      "expected a 500 misconfiguration response",
    );
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
          "x-itx-edge-proxy-signature":
            "irrelevant-because-body-check-runs-first",
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

    assert(
      response?.status === 413,
      "expected the oversized-body status to propagate",
    );
    const body = await response?.json();
    assert(
      body?.error === "Request body is too large.",
      "expected the oversized-body validation message to propagate",
    );
  });
});

// Shared (cross-isolate) replay store, enabled by
// ITX_TRUSTED_INGRESS_REPLAY_STORE=database.
const withSharedReplayStore = async (
  respond: (request: Request) => Promise<Response> | Response,
  run: (calls: Request[]) => Promise<void>,
  enabled = true,
) => {
  const names = [
    "ITX_TRUSTED_INGRESS_REPLAY_STORE",
    "ITX_SUPABASE_URL",
    "ITX_SECRET_KEY",
  ];
  const previous = Object.fromEntries(names.map((name) => [name, Deno.env.get(name)]));
  const originalFetch = globalThis.fetch;
  const calls: Request[] = [];
  if (enabled) Deno.env.set("ITX_TRUSTED_INGRESS_REPLAY_STORE", "database");
  else Deno.env.delete("ITX_TRUSTED_INGRESS_REPLAY_STORE");
  Deno.env.set("ITX_SUPABASE_URL", "https://replay-store.supabase.test/");
  Deno.env.set("ITX_SECRET_KEY", "service-role-test-key");
  globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
    const request = input instanceof Request ? input : new Request(input, init);
    calls.push(request.clone());
    return await respond(request);
  }) as typeof fetch;
  try {
    await withSecret(() => run(calls));
  } finally {
    globalThis.fetch = originalFetch;
    for (const name of names) {
      if (previous[name] === undefined) Deno.env.delete(name);
      else Deno.env.set(name, previous[name]!);
    }
  }
};

Deno.test("shared replay store is not consulted unless enabled", async () => {
  await withSharedReplayStore(() => Response.json(true), async (calls) => {
    const request = await makeSignedIngressRequest({ requestId: "shared-store-disabled" });
    await assertIngressAccepted(request, "store disabled");
    assert(calls.length === 0, "expected no shared-store call while the flag is off");
  }, false);
});

Deno.test("shared replay store claim admits a first-seen envelope with a hashed key", async () => {
  await withSharedReplayStore(() => Response.json(true), async (calls) => {
    const request = await makeSignedIngressRequest({ requestId: "shared-store-first-seen" });
    await assertIngressAccepted(request, "first-seen envelope");
    assert(calls.length === 1, "expected exactly one shared-store claim");
    const [call] = calls;
    assert(
      call.url === "https://replay-store.supabase.test/rest/v1/rpc/claim_trusted_ingress_request",
      `unexpected claim URL ${call.url}`,
    );
    assert(
      call.headers.get("authorization") === "Bearer service-role-test-key" &&
        call.headers.get("apikey") === "service-role-test-key",
      "expected the claim to authenticate as service_role",
    );
    const body = await call.json() as { p_claim_key: string; p_ttl_seconds: number };
    assert(/^[0-9a-f]{64}$/.test(body.p_claim_key), "claim key must be a sha256 hex digest");
    assert(
      !body.p_claim_key.includes("shared-store-first-seen"),
      "claim key must not carry the raw request ID",
    );
    assert(body.p_ttl_seconds === 60, "claim TTL must match the replay window");
  });
});

Deno.test("shared replay store rejects an envelope another isolate already claimed", async () => {
  // A fresh isolate has never seen this envelope locally; the database claim
  // returning false is the cross-isolate replay signal.
  await withSharedReplayStore(() => Response.json(false), async () => {
    const request = await makeSignedIngressRequest({ requestId: "shared-store-cross-isolate" });
    await assertIngressDenied(
      request,
      "cross-isolate replay",
      409,
      "Trusted edge request replay detected.",
    );
  });
});

Deno.test("shared replay store fails closed when the claim cannot be confirmed", async () => {
  for (
    const [label, respond] of [
      ["HTTP error", () => new Response("upstream failure", { status: 500 })],
      ["network error", () => Promise.reject(new TypeError("connection reset"))],
      ["non-boolean body", () => Response.json({ claimed: true })],
    ] as const
  ) {
    await withSharedReplayStore(respond, async () => {
      const required = await makeSignedIngressRequest({ requestId: `shared-store-unavailable-${label}` });
      await assertIngressDenied(
        required,
        `${label} (requireTrustedEdgeIngress)`,
        503,
        "Trusted edge replay protection unavailable.",
      );
      const gated = await makeSignedIngressRequest({ requestId: `shared-store-gate-${label}` });
      assert(
        await hasTrustedEdgeIngress(gated, "workspace-admin-mutate") === false,
        `${label}: hasTrustedEdgeIngress must not trust an unconfirmed claim`,
      );
    });
  }
});

const makeSignedStatusRequest = async (requestId: string) => {
  const timestamp = Date.now().toString();
  const signature = await sign(
    `${timestamp}.${requestId}.GET.system-status.no-body`,
  );
  return new Request("https://example.test/functions/system-status", {
    method: "GET",
    headers: {
      "x-itx-edge-proxy": "1",
      "x-itx-edge-proxy-ts": timestamp,
      "x-itx-edge-proxy-signature": signature,
      "x-request-id": requestId,
    },
  });
};

Deno.test("status gate stays trusted when the shared replay store is down", async () => {
  // system-status must report a database outage, so its trusted path cannot
  // depend on the database-backed replay claim.
  await withSharedReplayStore(
    () => new Response("upstream failure", { status: 503 }),
    async (calls) => {
      const request = await makeSignedStatusRequest("status-store-outage");
      assert(
        await hasTrustedEdgeIngress(request, "system-status", {
          tolerateReplayStoreOutage: true,
        }),
        "expected the status gate to trust a verified envelope during a store outage",
      );
      assert(calls.length === 1, "expected the shared store to be consulted first");
    },
  );
});

Deno.test("status gate outage tolerance still rejects replays", async () => {
  await withSharedReplayStore(() => Response.json(false), async () => {
    const crossIsolate = await makeSignedStatusRequest("status-cross-isolate-replay");
    assert(
      await hasTrustedEdgeIngress(crossIsolate, "system-status", {
        tolerateReplayStoreOutage: true,
      }) === false,
      "a replay the shared store detected must not be trusted",
    );
  });

  await withSharedReplayStore(
    () => Promise.reject(new TypeError("connection reset")),
    async () => {
      const request = await makeSignedStatusRequest("status-local-replay");
      const options = { tolerateReplayStoreOutage: true };
      assert(
        await hasTrustedEdgeIngress(request.clone(), "system-status", options),
        "expected the first envelope to be trusted",
      );
      assert(
        await hasTrustedEdgeIngress(request, "system-status", options) === false,
        "an exact replay to the same isolate must not be trusted",
      );
    },
  );
});

Deno.test("replay store outage tolerance does not apply to requests with a body", async () => {
  await withSharedReplayStore(
    () => new Response("upstream failure", { status: 503 }),
    async () => {
      const request = await makeSignedIngressRequest({ requestId: "status-store-outage-post" });
      assert(
        await hasTrustedEdgeIngress(request, "workspace-admin-mutate", {
          tolerateReplayStoreOutage: true,
        }) === false,
        "a POST must stay fail-closed when the shared store is down",
      );
    },
  );
});
