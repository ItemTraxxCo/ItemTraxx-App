import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ invokeEdgeFunction: vi.fn() }));

vi.mock("./edgeFunctionClient", () => ({ invokeEdgeFunction: mocks.invokeEdgeFunction }));

import { acceptLegalDocument, fetchPendingLegalDocuments } from "./legalAcceptanceService";

const DOC = {
  document_type: "dpa" as const,
  document_version: "2026-11-01",
  document_hash: "a".repeat(64),
};

describe("legalAcceptanceService", () => {
  beforeEach(() => vi.clearAllMocks());

  it("lists pending documents from the status action", async () => {
    const pending = [{ ...DOC, url_path: "/legal/dpa", effective_at: "2026-11-01T00:00:00Z" }];
    mocks.invokeEdgeFunction.mockResolvedValue({ ok: true, status: 200, data: { data: { pending } }, error: "" });

    await expect(fetchPendingLegalDocuments()).resolves.toEqual(pending);
    expect(mocks.invokeEdgeFunction).toHaveBeenCalledWith("legal-acceptance", {
      method: "POST",
      body: { action: "status" },
    });
  });

  it("returns an empty list when nothing is pending", async () => {
    mocks.invokeEdgeFunction.mockResolvedValue({ ok: true, status: 200, data: { data: {} }, error: "" });
    await expect(fetchPendingLegalDocuments()).resolves.toEqual([]);
  });

  it("throws when the status lookup fails", async () => {
    mocks.invokeEdgeFunction.mockResolvedValue({ ok: false, status: 503, data: null, error: "down" });
    await expect(fetchPendingLegalDocuments()).rejects.toThrow("down");
  });

  it("sends only the document identity on accept (server derives user, IP, UA)", async () => {
    mocks.invokeEdgeFunction.mockResolvedValue({
      ok: true,
      status: 200,
      data: { data: { accepted_at: "2026-11-04T19:00:00Z", already_accepted: false } },
      error: "",
    });

    await expect(acceptLegalDocument(DOC)).resolves.toEqual({
      accepted_at: "2026-11-04T19:00:00Z",
      already_accepted: false,
    });
    expect(mocks.invokeEdgeFunction).toHaveBeenCalledWith("legal-acceptance", {
      method: "POST",
      body: { action: "accept", ...DOC },
    });
  });

  it("surfaces a failed acceptance instead of pretending it was recorded", async () => {
    mocks.invokeEdgeFunction.mockResolvedValue({ ok: false, status: 409, data: null, error: "Document version is not current." });
    await expect(acceptLegalDocument(DOC)).rejects.toThrow("Document version is not current.");
  });
});
