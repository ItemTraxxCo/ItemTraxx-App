import { readJsonBody } from "./requestBody.ts";
import { ValidationError } from "./validation.ts";

const assert = (condition: boolean, message: string) => {
  if (!condition) throw new Error(message);
};

Deno.test("bounded JSON reader accepts requests within the limit", async () => {
  const request = new Request("https://example.test", {
    method: "POST",
    body: JSON.stringify({ ok: true }),
  });
  const body = await readJsonBody<{ ok: boolean }>(request, 64);
  assert(body.ok, "expected parsed body");
});

Deno.test("bounded JSON reader rejects oversized requests", async () => {
  const request = new Request("https://example.test", {
    method: "POST",
    body: JSON.stringify({ value: "x".repeat(100) }),
  });
  try {
    await readJsonBody(request, 32);
  } catch (error) {
    if (!(error instanceof ValidationError)) {
      throw new Error("expected ValidationError");
    }
    assert(error.status === 413, "expected 413 status");
    return;
  }
  throw new Error("expected oversized request rejection");
});

Deno.test("bounded JSON reader rejects an understated streaming body", async () => {
  const request = new Request("https://example.test", {
    method: "POST",
    headers: { "content-length": "1" },
    body: new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new TextEncoder().encode('{"value":"too large"}'));
        controller.close();
      },
    }),
  });
  try {
    await readJsonBody(request, 8);
  } catch (error) {
    if (!(error instanceof ValidationError)) {
      throw new Error("expected ValidationError");
    }
    assert(error.status === 413, "expected 413 status");
    return;
  }
  throw new Error("expected understated body rejection");
});

Deno.test("bounded JSON reader rejects malformed Content-Length before reading", async () => {
  const request = new Request("https://example.test", {
    method: "POST",
    headers: { "content-length": "not-a-number" },
    body: "{}",
  });
  try {
    await readJsonBody(request, 64);
  } catch (error) {
    if (!(error instanceof ValidationError)) {
      throw new Error("expected ValidationError");
    }
    assert(error.status === 400, "expected 400 status");
    return;
  }
  throw new Error("expected malformed Content-Length rejection");
});
