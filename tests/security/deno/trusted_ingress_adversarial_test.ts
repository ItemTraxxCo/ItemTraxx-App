// Adversarial trusted-ingress tests. Deliberately outside the CI test globs
// (`*_test.ts` under supabase/functions and cloudflare/edge-proxy/src); run via
// `npm run test:security:adversarial`.
import { requireTrustedEdgeIngress } from "../../../supabase/functions/_shared/trustedIngress.ts";

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

Deno.test("trusted ingress rejects signed-envelope field tampering without poisoning the original request ID", async () => {
  await withSecret(async () => {
    const body = '{"action":"read_workspace_items"}';
    const cases: Array<{
      name: string;
      mutate: (request: Request) => Promise<Request>;
      target?: string;
    }> = [
      {
        name: "proxy marker substitution",
        mutate: async (request) => {
          const tampered = request.clone();
          tampered.headers.set("x-itx-edge-proxy", "0");
          return tampered;
        },
      },
      {
        name: "request ID substitution",
        mutate: async (request) => {
          const tampered = request.clone();
          tampered.headers.set("x-request-id", "attacker-selected-request-id");
          return tampered;
        },
      },
      {
        name: "timestamp substitution",
        mutate: async (request) => {
          const tampered = request.clone();
          const timestamp = Number(
            tampered.headers.get("x-itx-edge-proxy-ts"),
          );
          tampered.headers.set("x-itx-edge-proxy-ts", String(timestamp + 1));
          return tampered;
        },
      },
      {
        name: "signature corruption",
        mutate: async (request) => {
          const tampered = request.clone();
          const signature = tampered.headers.get(
            "x-itx-edge-proxy-signature",
          ) ?? "";
          const replacement = signature.endsWith("0") ? "1" : "0";
          tampered.headers.set(
            "x-itx-edge-proxy-signature",
            `${signature.slice(0, -1)}${replacement}`,
          );
          return tampered;
        },
      },
      {
        name: "method substitution",
        mutate: async (request) =>
          new Request(request.url, {
            method: "PUT",
            headers: request.headers,
            body: await request.clone().text(),
          }),
      },
      {
        name: "body substitution",
        mutate: async (request) =>
          new Request(request.url, {
            method: request.method,
            headers: request.headers,
            body: '{"action":"delete_workspace_items"}',
          }),
      },
      {
        name: "target substitution",
        mutate: async (request) => request.clone(),
        target: "workspace-billing-export",
      },
    ];

    for (const [index, testCase] of cases.entries()) {
      const requestId = `request-binding-tamper-${index}`;
      const signedRequest = await makeSignedIngressRequest({
        requestId,
        body,
      });
      const tamperedRequest = await testCase.mutate(signedRequest);
      const response = await requireTrustedEdgeIngress(
        tamperedRequest,
        testCase.target ?? "workspace-admin-mutate",
        (status, payload) => Response.json(payload, { status }),
      );

      assert(
        response?.status === 403,
        `${testCase.name}: expected HTTP 403 for a tampered signed envelope`,
      );
      if (response === null) {
        throw new Error(
          `${testCase.name}: expected a rejection response, request was accepted`,
        );
      }
      assert(
        JSON.stringify(await response.json()) ===
          JSON.stringify({ error: "Trusted edge ingress required." }),
        `${testCase.name}: expected the stable fail-closed error payload`,
      );

      // Invalid traffic must not reserve a request ID or block its authentic
      // envelope. This also detects replay-cache claims made before HMAC checks.
      await assertIngressAccepted(
        signedRequest.clone(),
        `${testCase.name}: original signed request after tampering`,
      );
    }
  });
});

Deno.test("trusted ingress does not let forged signatures poison a valid request ID", async () => {
  await withSecret(async () => {
    const signedRequest = await makeSignedIngressRequest({
      requestId: "request-forgery-flood-fixture",
      body: '{"action":"read_workspace_items"}',
    });
    const authenticSignature = signedRequest.headers.get(
      "x-itx-edge-proxy-signature",
    ) ?? "";

    // Probe a range of attacker-controlled, correctly shaped HMAC values under
    // the same request ID. None may claim the replay slot before verification.
    for (let index = 0; index < 64; index += 1) {
      const digit = (index % 16).toString(16);
      const forged = digit.repeat(64) === authenticSignature
        ? `${digit.repeat(63)}${digit === "f" ? "e" : "f"}`
        : digit.repeat(64);
      const request = signedRequest.clone();
      request.headers.set("x-itx-edge-proxy-signature", forged);
      await assertIngressDenied(request, `forged signature ${index}`);
    }

    await assertIngressAccepted(
      signedRequest.clone(),
      "authentic request after forged-signature flood",
    );
  });
});

// Scope notes for the replay test below:
// - The HMAC binds `${timestamp}.${requestId}.${METHOD}.${target}.${bodyHash}`
//   only; the query string and unrelated headers are deliberately unsigned.
//   That is safe only while no ingress-protected function reads query
//   parameters, which the static guard test after this one enforces.
// - This proves same-isolate replay rejection via the in-memory cache.
//   Cross-isolate replays are rejected only when
//   ITX_TRUSTED_INGRESS_REPLAY_STORE=database (shared claim RPC; covered by
//   supabase/functions/_shared/trustedIngress_test.ts and
//   tests/security/postgres/trusted_ingress_replay_store.sql).
Deno.test("trusted ingress rejects an exact replay despite unrelated transport changes", async () => {
  await withSecret(async () => {
    const signedRequest = await makeSignedIngressRequest({
      requestId: "request-transport-variation-replay-fixture",
      body: '{"action":"read_workspace_items"}',
    });
    await assertIngressAccepted(signedRequest.clone(), "original envelope");

    const replay = new Request(`${signedRequest.url}?trace=attacker-value`, {
      method: signedRequest.method,
      headers: signedRequest.headers,
      body: await signedRequest.clone().text(),
    });
    replay.headers.set("x-attacker-added-header", "ignored-by-signature");

    const originalConsoleError = console.error;
    let replayLog = "";
    console.error = (...values: unknown[]) => {
      replayLog = values.map(String).join(" ");
    };
    try {
      await assertIngressDenied(
        replay,
        "replay with changed query and unrelated header",
        409,
        "Trusted edge request replay detected.",
      );
    } finally {
      console.error = originalConsoleError;
    }
    assert(
      replayLog.includes("trusted_ingress.replay_detected"),
      "expected transport-variant replay detection to be logged explicitly",
    );
  });
});

Deno.test("trusted-ingress functions never read the unsigned query string", async () => {
  // Query parameters are outside the signed envelope (see the scope notes
  // above). Any ingress-protected function that starts reading them would let
  // an attacker alter a signed request's meaning without breaking the HMAC.
  const functionsRoot = new URL(
    "../../../supabase/functions/",
    import.meta.url,
  );
  const usesIngress = /\b(?:requireTrustedEdgeIngress|hasTrustedEdgeIngress)\(/;
  // Flags `searchParams` and URL `.search` reads. Assignments such as
  // `url.search = ""` and signed JSON body fields such as `payload.search`
  // are not query-string reads.
  const readsQuery =
    /\bsearchParams\b|\b\w*(?:[uU]rl|URL)\.search\b(?!\s*=[^=])|new URL\([^)]*\)\.search\b/;

  const sourceFiles = async (dir: URL): Promise<URL[]> => {
    const files: URL[] = [];
    for await (const entry of Deno.readDir(dir)) {
      const child = new URL(
        `${entry.name}${entry.isDirectory ? "/" : ""}`,
        dir,
      );
      if (entry.isDirectory) files.push(...await sourceFiles(child));
      else if (entry.name.endsWith(".ts") && !entry.name.endsWith("_test.ts")) {
        files.push(child);
      }
    }
    return files;
  };

  let protectedFunctions = 0;
  const offenders: string[] = [];
  for await (const entry of Deno.readDir(functionsRoot)) {
    if (!entry.isDirectory || entry.name.startsWith("_")) continue;
    const files = await sourceFiles(new URL(`${entry.name}/`, functionsRoot));
    const sources = await Promise.all(
      files.map(async (file) => ({
        file,
        text: await Deno.readTextFile(file),
      })),
    );
    if (!sources.some(({ text }) => usesIngress.test(text))) continue;
    protectedFunctions += 1;
    for (const { file, text } of sources) {
      text.split("\n").forEach((line, index) => {
        if (readsQuery.test(line)) {
          offenders.push(
            `${file.pathname.split("/functions/")[1]}:${
              index + 1
            }: ${line.trim()}`,
          );
        }
      });
    }
  }

  assert(
    protectedFunctions > 0,
    "expected to find at least one trusted-ingress-protected function",
  );
  assert(
    offenders.length === 0,
    `ingress-protected functions read the unsigned query string; sign it or move the value into the body:\n${
      offenders.join("\n")
    }`,
  );
});
