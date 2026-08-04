const MTA_STS_HOST = "mta-sts.itemtraxx.com";
const MTA_STS_PATH = "/.well-known/mta-sts.txt";

// The MX set is the live Zoho configuration for itemtraxx.com. Keep this
// policy explicit so an unexpected MX is never silently trusted by senders.
const MTA_STS_POLICY = [
  "version: STSv1",
  "mode: enforce",
  "mx: mx.zoho.com",
  "mx: mx2.zoho.com",
  "mx: mx3.zoho.com",
  "max_age: 86400",
].join("\n") + "\n";

const policyHeaders = () => {
  const headers = new Headers({
    "Cache-Control": "public, max-age=300, must-revalidate",
    "Content-Type": "text/plain; charset=utf-8",
    "Strict-Transport-Security": "max-age=31536000",
    "X-Content-Type-Options": "nosniff",
  });
  return headers;
};

export const isMtaStsRequest = (url: URL) =>
  url.hostname.toLowerCase() === MTA_STS_HOST;

export const handleMtaStsRequest = (
  request: Request,
  url: URL,
): Response => {
  const headers = policyHeaders();

  if (url.pathname !== MTA_STS_PATH) {
    return new Response("Not found\n", { status: 404, headers });
  }

  if (request.method === "GET") {
    return new Response(MTA_STS_POLICY, { status: 200, headers });
  }

  if (request.method === "HEAD") {
    return new Response(null, { status: 200, headers });
  }

  headers.set("Allow", "GET, HEAD");
  return new Response("Method not allowed\n", { status: 405, headers });
};
