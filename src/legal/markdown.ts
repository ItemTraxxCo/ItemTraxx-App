import DOMPurify from "dompurify";
import { Marked } from "marked";
import { LEGAL_FILE_TO_PATH } from "./documents";
import { LEGAL_TOKEN_VALUES } from "./legalTokens";

export type RenderedLegalDocument = {
  body: DocumentFragment;
  /** Placeholder tokens that had no configured value. */
  unresolvedTokens: string[];
};

const SITE_HOSTS = new Set(["itemtraxx.com", "www.itemtraxx.com"]);
const TOKEN_RE = /\[\[([A-Z][A-Z0-9_]*)\]\]/g;

const marked = new Marked({ gfm: true, breaks: false });

const SANITIZE_CONFIG = {
  USE_PROFILES: { html: true },
  FORBID_TAGS: ["style", "script", "iframe", "form", "input", "button", "svg", "math"],
  FORBID_ATTR: ["style", "srcset"],
  ADD_ATTR: ["data-token"],
  RETURN_DOM_FRAGMENT: true,
};

export const slugifyHeading = (text: string): string =>
  text
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "") || "section";

const substituteTokens = (source: string, unresolved: Set<string>): string =>
  source.replace(TOKEN_RE, (_match, name: string) => {
    const value = LEGAL_TOKEN_VALUES[name];
    if (value && value.trim()) return value.trim();
    unresolved.add(name);
    return `<mark class="legal-pending" data-token="${name}">${name.replace(/_/g, " ").toLowerCase()} (pending)</mark>`;
  });

const resolveInternalHref = (href: string): string | null => {
  const hashIndex = href.indexOf("#");
  const pathPart = hashIndex === -1 ? href : href.slice(0, hashIndex);
  const hash = hashIndex === -1 ? "" : href.slice(hashIndex);
  if (!pathPart) return hash || null;

  const fileName = pathPart.split("/").pop() ?? "";
  const mapped = LEGAL_FILE_TO_PATH[fileName];
  if (mapped && !/^[a-z][a-z0-9+.-]*:/i.test(pathPart)) return `${mapped}${hash}`;

  if (/^https?:\/\//i.test(pathPart)) {
    try {
      const url = new URL(pathPart);
      if (SITE_HOSTS.has(url.hostname)) return `${url.pathname}${url.search}${hash}`;
    } catch {
      return null;
    }
    return null;
  }
  if (pathPart.startsWith("/") && !pathPart.startsWith("//")) return `${pathPart}${hash}`;
  return null;
};

const decorateLinks = (root: ParentNode) => {
  for (const anchor of Array.from(root.querySelectorAll("a[href]"))) {
    const href = anchor.getAttribute("href") ?? "";
    if (/^mailto:/i.test(href)) continue;

    const internal = resolveInternalHref(href);
    if (internal) {
      anchor.setAttribute("href", internal);
      anchor.setAttribute("data-legal-link", internal.startsWith("#") ? "anchor" : "route");
      continue;
    }
    if (/^https?:\/\//i.test(href)) {
      anchor.setAttribute("target", "_blank");
      anchor.setAttribute("rel", "noopener noreferrer");
      anchor.setAttribute("data-legal-link", "external");
      continue;
    }
    // Unknown relative link (for example a repository file): keep the text, drop the link.
    anchor.replaceWith(...Array.from(anchor.childNodes));
  }
};

const wrapTables = (root: ParentNode) => {
  for (const table of Array.from(root.querySelectorAll("table"))) {
    const wrapper = document.createElement("div");
    wrapper.className = "legal-table-wrap";
    wrapper.setAttribute("role", "region");
    wrapper.setAttribute("tabindex", "0");
    const caption = table.querySelector("th")?.textContent?.trim();
    wrapper.setAttribute("aria-label", caption ? `Table: ${caption}` : "Table");
    table.replaceWith(wrapper);
    wrapper.appendChild(table);
  }
};

/** One H1 per page: any further H1 (for example "# Part A") becomes an H2. */
const keepSingleH1 = (root: ParentNode) => {
  for (const heading of Array.from(root.querySelectorAll("h1")).slice(1)) {
    const next = document.createElement("h2");
    for (const attr of Array.from(heading.attributes)) next.setAttribute(attr.name, attr.value);
    next.append(...Array.from(heading.childNodes));
    heading.replaceWith(next);
  }
};

/** Gives headings stable ids so links like privacy-policy.md#section work. */
const assignHeadingIds = (root: ParentNode) => {
  const used = new Map<string, number>();
  for (const heading of Array.from(root.querySelectorAll("h1, h2, h3, h4"))) {
    const base = slugifyHeading(heading.textContent ?? "");
    const count = used.get(base) ?? 0;
    used.set(base, count + 1);
    heading.setAttribute("id", count === 0 ? base : `${base}-${count + 1}`);
  }
};

const sanitize = (html: string): DocumentFragment =>
  DOMPurify.sanitize(html, SANITIZE_CONFIG) as unknown as DocumentFragment;

/**
 * Renders a legal markdown document into a sanitized DOM fragment.
 * Must run in a browser-like environment (DOMPurify needs a window).
 */
export const renderLegalMarkdown = (markdown: string): RenderedLegalDocument => {
  const unresolved = new Set<string>();
  const body = sanitize(marked.parse(substituteTokens(markdown, unresolved), { async: false }));
  decorateLinks(body);
  wrapTables(body);
  keepSingleH1(body);
  assignHeadingIds(body);
  return { body, unresolvedTokens: Array.from(unresolved).sort() };
};
