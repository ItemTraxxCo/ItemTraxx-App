import {
  normalizeClientIp,
  normalizeUserAgent,
  parseAcceptLegalDocumentRequest,
} from "./legalAcceptance.ts";

const assert = (condition: boolean, message: string) => {
  if (!condition) throw new Error(message);
};

const HASH = "a".repeat(64);

Deno.test("parseAcceptLegalDocumentRequest accepts a valid request and lowercases the hash", () => {
  const parsed = parseAcceptLegalDocumentRequest({
    document_type: "dpa",
    document_version: "2026-11-01",
    document_hash: "A".repeat(64),
  });
  assert(parsed?.documentType === "dpa", "document type");
  assert(parsed?.documentVersion === "2026-11-01", "document version");
  assert(parsed?.documentHash === HASH, "hash must be lowercased");
});

Deno.test("parseAcceptLegalDocumentRequest rejects malformed input", () => {
  const bad: unknown[] = [
    null,
    [],
    "dpa",
    { document_type: "nope", document_version: "1", document_hash: HASH },
    { document_type: "dpa", document_version: "", document_hash: HASH },
    { document_type: "dpa", document_version: "../etc", document_hash: HASH },
    { document_type: "dpa", document_version: "1", document_hash: "abc" },
    { document_type: "dpa", document_version: "1" },
  ];
  for (const body of bad) {
    assert(parseAcceptLegalDocumentRequest(body) === null, `should reject ${JSON.stringify(body)}`);
  }
});

Deno.test("normalizeClientIp keeps valid IPv4/IPv6 and drops everything else", () => {
  assert(normalizeClientIp("203.0.113.7") === "203.0.113.7", "ipv4");
  assert(normalizeClientIp(" 2001:DB8::1 ") === "2001:db8::1", "ipv6");
  assert(normalizeClientIp("999.1.1.1") === null, "octet range");
  assert(normalizeClientIp("1.2.3.4, 5.6.7.8") === null, "list");
  assert(normalizeClientIp("not-an-ip") === null, "garbage");
  assert(normalizeClientIp("") === null, "empty");
  assert(normalizeClientIp(null) === null, "null");
});

Deno.test("normalizeUserAgent strips control characters and truncates", () => {
  assert(normalizeUserAgent("Mozilla\n/5.0") === "Mozilla /5.0", "control chars");
  assert(normalizeUserAgent("x".repeat(900))?.length === 500, "truncate");
  assert(normalizeUserAgent("  ") === null, "blank");
});
