const MTA_STS_HOST = "mta-sts.itemtraxx.com";
const MTA_STS_PATH = "/.well-known/mta-sts.txt";

// Cloudflare Email Service owns inbound delivery for itemtraxx.com. Keep this
// aligned with Cloudflare's supported MTA-STS policy so enforcing senders do
// not reject the live Cloudflare MX hosts before a message reaches routing.
const MTA_STS_POLICY = [
  "version: STSv1",
  "mode: enforce",
  "mx: *.mx.cloudflare.net",
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
