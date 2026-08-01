import {
  getFunctionRequestBodyLimit,
  MAX_PROXY_REQUEST_BODY_BYTES,
  MAX_SUPPORT_REQUEST_BODY_BYTES,
  readBoundedRequestBody,
  RequestBodyLimitError,
} from "./requestBody.ts";

const assert = (condition: boolean, message: string) => {
  if (!condition) throw new Error(message);
};

Deno.test("function body limits preserve the support attachment payload contract", () => {
  assert(
    getFunctionRequestBodyLimit("contact-support-submit") ===
      MAX_SUPPORT_REQUEST_BODY_BYTES,
    "expected the support function to use the larger attachment limit",
  );
  assert(
    getFunctionRequestBodyLimit("admin-ops") === MAX_PROXY_REQUEST_BODY_BYTES,
    "expected other functions to retain the default proxy limit",
  );
});

Deno.test("Worker request body reader accepts a body within the cap", async () => {
  const body = await readBoundedRequestBody(
    new Request("https://edge.itemtraxx.com/functions/test", {
      method: "POST",
      body: "{\"ok\":true}",
    }),
    64,
  );
  assert(new TextDecoder().decode(body) === '{"ok":true}', "body bytes");
});

Deno.test("Worker request body reader rejects oversized declared lengths", async () => {
  try {
    await readBoundedRequestBody(
      new Request("https://edge.itemtraxx.com/functions/test", {
        method: "POST",
        headers: { "content-length": "65" },
        body: "{}",
      }),
      64,
    );
  } catch (error) {
    assert(error instanceof RequestBodyLimitError, "expected body limit error");
    assert((error as RequestBodyLimitError).status === 413, "expected 413 status");
    return;
  }
  throw new Error("expected declared-length rejection");
});

Deno.test("Worker request body reader rejects understated streaming bodies", async () => {
  const request = new Request("https://edge.itemtraxx.com/functions/test", {
    method: "POST",
    headers: { "content-length": "1" },
    body: new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new Uint8Array(32));
        controller.close();
      },
    }),
  });
  try {
    await readBoundedRequestBody(request, 8);
  } catch (error) {
    assert(error instanceof RequestBodyLimitError, "expected body limit error");
    assert((error as RequestBodyLimitError).status === 413, "expected 413 status");
    return;
  }
  throw new Error("expected streaming body rejection");
});
