import { describe, expect, it } from "vitest";
import { LEGAL_DOCUMENTS } from "./documents";
import { LEGAL_SOURCE_KEYS, loadLegalMarkdown } from "./sources";
import { LEGAL_PENDING_TOKENS } from "./legalTokens";
import { renderLegalMarkdown, slugifyHeading } from "./markdown";

const html = (fragment: DocumentFragment) => {
  const host = document.createElement("div");
  host.appendChild(fragment.cloneNode(true));
  return host;
};

describe("legal markdown pipeline", () => {
  it("renders tables, bold text, lists and headings with ids", () => {
    const out = renderLegalMarkdown(
      "# T\n\n## 1. Short version\n\n**bold** text\n\n- one\n- two\n\n| A | B |\n|---|---|\n| 1 | 2 |\n\n### Sub part\n\n## 1. Short version\n",
    );
    const dom = html(out.body);
    expect(dom.querySelector("strong")?.textContent).toBe("bold");
    expect(dom.querySelectorAll("li")).toHaveLength(2);
    expect(dom.querySelector(".legal-table-wrap table th")?.textContent).toBe("A");
    expect(Array.from(dom.querySelectorAll("h2, h3")).map((el) => el.id)).toEqual(["1-short-version", "sub-part", "1-short-version-2"]);
  });

  it("sanitizes scripts, event handlers and javascript: links", () => {
    const out = renderLegalMarkdown(
      '# T\n\n<script>alert(1)</script>\n\n<img src=x onerror="alert(1)">\n\n[x](javascript:alert(1))\n\n<iframe src="https://evil.test"></iframe>\n',
    );
    const dom = html(out.body);
    expect(dom.querySelector("script")).toBeNull();
    expect(dom.querySelector("iframe")).toBeNull();
    expect(dom.innerHTML).not.toContain("onerror");
    expect(dom.innerHTML).not.toContain("javascript:");
  });

  it("maps cross-document markdown links to legal routes and hardens external links", () => {
    const out = renderLegalMarkdown(
      "# T\n\n[p](privacy-policy.md#4-cookies) [s](student-privacy-notice.md) [site](https://itemtraxx.com/report-security-issue) [ext](https://example.com) [mail](mailto:a@b.co) [repo](../something.md)\n",
    );
    const links = Array.from(html(out.body).querySelectorAll("a"));
    expect(links.map((link) => link.getAttribute("href"))).toEqual([
      "/legal/privacy#4-cookies",
      "/legal/student-privacy",
      "/report-security-issue",
      "https://example.com",
      "mailto:a@b.co",
    ]);
    const external = links[3]!;
    expect(external.getAttribute("target")).toBe("_blank");
    expect(external.getAttribute("rel")).toBe("noopener noreferrer");
    expect(html(out.body).textContent).toContain("repo");
  });

  it("marks unresolved placeholder tokens and reports them", () => {
    const out = renderLegalMarkdown("# T\n\n**Effective date:** [[NOT_A_REAL_TOKEN]]\n\nAt [[ANOTHER_MISSING_ONE]].\n");
    expect(out.unresolvedTokens).toEqual(["ANOTHER_MISSING_ONE", "NOT_A_REAL_TOKEN"]);
    expect(html(out.body).querySelectorAll("mark.legal-pending")).toHaveLength(2);
  });

  it("keeps a single H1 when a document has parts", () => {
    const dom = html(renderLegalMarkdown("# Title\n\n# Part A\n\n## Sec\n\n# Part B\n").body);
    expect(dom.querySelectorAll("h1")).toHaveLength(1);
    expect(Array.from(dom.querySelectorAll("h2")).map((el) => el.textContent)).toEqual(["Part A", "Sec", "Part B"]);
  });

  it("does not bundle the internal docs/legal README", () => {
    expect(LEGAL_SOURCE_KEYS.some((key) => key.toLowerCase().endsWith("readme.md"))).toBe(false);
    expect(LEGAL_SOURCE_KEYS).toHaveLength(LEGAL_DOCUMENTS.length);
  });

  it("leaves only the declared pending tokens unresolved in published documents", async () => {
    for (const doc of LEGAL_DOCUMENTS) {
      const unresolved = renderLegalMarkdown(await loadLegalMarkdown(doc)).unresolvedTokens;
      expect(unresolved.filter((token) => !LEGAL_PENDING_TOKENS.includes(token)), doc.slug).toEqual([]);
    }
  });

  it("slugifies headings", () => {
    expect(slugifyHeading("9. Billing & Renewal!")).toBe("9-billing-and-renewal");
  });

  it("renders every registered document without leaving markdown syntax behind", async () => {
    for (const doc of LEGAL_DOCUMENTS) {
      const out = renderLegalMarkdown(await loadLegalMarkdown(doc));
      const dom = html(out.body);
      expect(dom.querySelectorAll("h1"), doc.slug).toHaveLength(1);
      expect(dom.querySelectorAll("h2").length, doc.slug).toBeGreaterThan(3);
      expect(dom.textContent, doc.slug).not.toMatch(/\*\*[^*\s]/);
      expect(dom.textContent, doc.slug).not.toMatch(/^\s*\|.*\|\s*$/m);
      expect(dom.querySelector("script"), doc.slug).toBeNull();
      for (const link of Array.from(dom.querySelectorAll("a[href]"))) {
        expect(link.getAttribute("href"), `${doc.slug} link`).not.toMatch(/\.md(#|$)/);
      }
    }
  });
});
