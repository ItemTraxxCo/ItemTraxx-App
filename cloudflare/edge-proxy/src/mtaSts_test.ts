import {
  handleMtaStsRequest,
  isMtaStsRequest,
} from "./mtaSts.ts";

Deno.test("serves the Cloudflare MTA-STS policy on the exact policy host", async () => {
  const url = new URL(
    "https://mta-sts.itemtraxx.com/.well-known/mta-sts.txt",
  );
  const response = handleMtaStsRequest(new Request(url), url);
  const body = await response.text();

  if (response.status !== 200) {
    throw new Error(`Expected 200, received ${response.status}`);
  }
  if (response.headers.get("Content-Type") !== "text/plain; charset=utf-8") {
    throw new Error("Expected a text/plain policy response");
  }
  for (const line of [
    "version: STSv1",
    "mode: enforce",
    "mx: *.mx.cloudflare.net",
    "max_age: 86400",
  ]) {
    if (!body.includes(line)) {
      throw new Error(`Missing MTA-STS policy line: ${line}`);
    }
  }
});

Deno.test("supports policy HEAD requests without returning the policy body", async () => {
  const url = new URL(
    "https://mta-sts.itemtraxx.com/.well-known/mta-sts.txt",
  );
  const response = handleMtaStsRequest(
    new Request(url, { method: "HEAD" }),
    url,
  );

  if (response.status !== 200 || (await response.text()) !== "") {
    throw new Error("Expected a bodyless successful HEAD response");
  }
});

Deno.test("rejects unexpected hosts, paths, and methods", async () => {
  const wrongHost = new URL(
    "https://edge.itemtraxx.com/.well-known/mta-sts.txt",
  );
  if (isMtaStsRequest(wrongHost)) {
    throw new Error("Unexpected host was treated as the MTA-STS host");
  }

  const wrongPath = new URL("https://mta-sts.itemtraxx.com/health");
  if (handleMtaStsRequest(new Request(wrongPath), wrongPath).status !== 404) {
    throw new Error("Unexpected path was served");
  }

  const policyUrl = new URL(
    "https://mta-sts.itemtraxx.com/.well-known/mta-sts.txt",
  );
  const response = handleMtaStsRequest(
    new Request(policyUrl, { method: "POST" }),
    policyUrl,
  );
  if (
    response.status !== 405 || response.headers.get("Allow") !== "GET, HEAD"
  ) {
    throw new Error("Unexpected method was accepted");
  }
});
