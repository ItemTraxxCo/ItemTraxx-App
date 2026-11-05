import { describe, expect, it } from "vitest";
import { LEGAL_DOCUMENTS } from "./documents";
import { LEGAL_ROUTE_TITLES } from "./routeTitles";

describe("legal route titles", () => {
  it("cover exactly the documents in the registry", () => {
    expect(Object.keys(LEGAL_ROUTE_TITLES).sort()).toEqual(LEGAL_DOCUMENTS.map((doc) => doc.slug).sort());
    for (const doc of LEGAL_DOCUMENTS) expect(doc.path).toBe(`/legal/${doc.slug}`);
  });
});
