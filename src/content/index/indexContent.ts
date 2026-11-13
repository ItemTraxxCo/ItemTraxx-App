import DOMPurify from "dompurify";
import { marked } from "marked";

export const INDEX_CATEGORIES = [
  "Company",
  "Product",
  "Guides",
  "Security",
  "Updates",
] as const;

export type IndexCategory = (typeof INDEX_CATEGORIES)[number];
export type IndexFormat = "Article" | "Guide" | "Disclosure" | "Update";
export const INDEX_COVER_COLORS = [
  "stone",
  "sage",
  "clay",
  "sand",
  "slate",
  "mauve",
] as const;
export type IndexCoverColor = (typeof INDEX_COVER_COLORS)[number];

const defaultCoverColors: Record<IndexCategory, IndexCoverColor> = {
  Company: "clay",
  Product: "slate",
  Guides: "sand",
  Security: "sage",
  Updates: "mauve",
};

export type IndexEntry = {
  title: string;
  slug: string;
  category: IndexCategory;
  format: IndexFormat;
  coverColor: IndexCoverColor;
  date: string;
  summary: string;
  markdown: string;
  draft: boolean;
  image?: string;
};

const rawFiles = import.meta.glob<string>(["./*.md", "!./README.md"], {
  eager: true,
  query: "?raw",
  import: "default",
});

const formats: readonly IndexFormat[] = ["Article", "Guide", "Disclosure", "Update"];

const slugify = (value: string) =>
  value
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");

const cleanValue = (value: string) => {
  const trimmed = value.trim();
  if (
    (trimmed.startsWith("\"") && trimmed.endsWith("\"")) ||
    (trimmed.startsWith("'") && trimmed.endsWith("'"))
  ) {
    return trimmed.slice(1, -1).trim();
  }
  return trimmed;
};

const parseFrontmatter = (source: string) => {
  const match = source.match(/^---\s*\r?\n([\s\S]*?)\r?\n---\s*(?:\r?\n|$)/);
  if (!match) return { metadata: {} as Record<string, string>, markdown: source.trim() };

  const metadata: Record<string, string> = {};
  for (const line of match[1].split(/\r?\n/)) {
    const separator = line.indexOf(":");
    if (separator < 1) continue;
    metadata[line.slice(0, separator).trim().toLowerCase()] = cleanValue(line.slice(separator + 1));
  }

  return { metadata, markdown: source.slice(match[0].length).trim() };
};

const parseFile = ([path, source]: [string, string]): IndexEntry | null => {
  const fileName = path.split("/").at(-1)?.replace(/\.md$/i, "") ?? "";
  const title = decodeURIComponent(fileName).replace(/\s+/g, " ").trim();
  const slug = slugify(title);
  if (!title || !slug || slug === "about") return null;

  const { metadata, markdown } = parseFrontmatter(source);
  const category = INDEX_CATEGORIES.find(
    (candidate) => candidate.toLowerCase() === metadata.category?.toLowerCase(),
  ) ?? "Company";
  const format = formats.find(
    (candidate) => candidate.toLowerCase() === metadata.format?.toLowerCase(),
  ) ?? "Article";
  const coverColor = INDEX_COVER_COLORS.find(
    (candidate) => candidate === metadata.cover?.toLowerCase(),
  ) ?? defaultCoverColors[category];
  const date = /^\d{4}-\d{2}-\d{2}$/.test(metadata.date ?? "") ? metadata.date : "";
  const summary = metadata.summary ?? "";

  return {
    title,
    slug,
    category,
    format,
    coverColor,
    date,
    summary,
    markdown,
    draft: metadata.draft?.toLowerCase() !== "false",
    image: metadata.image || undefined,
  };
};

const entries = Object.entries(rawFiles)
  .map(parseFile)
  .filter((entry): entry is IndexEntry => entry !== null);

if (import.meta.env.DEV) {
  const seen = new Set<string>();
  for (const entry of entries) {
    if (seen.has(entry.slug)) {
      console.warn(`[Index] Duplicate article slug: /index/${entry.slug}`);
    }
    seen.add(entry.slug);
  }
}

const isPublished = (entry: IndexEntry) => !entry.draft;

export const getIndexEntries = () =>
  entries
    .filter(isPublished)
    .sort((a, b) => b.date.localeCompare(a.date) || a.title.localeCompare(b.title));

export const getIndexEntry = (slug: string) =>
  entries.find((entry) => entry.slug === slug && isPublished(entry)) ?? null;

export const renderIndexMarkdown = (markdown: string) =>
  DOMPurify.sanitize(marked.parse(markdown, { async: false }));

export const formatIndexDate = (date: string) => {
  if (!date) return "Date to be added";
  const parsed = new Date(`${date}T12:00:00`);
  if (Number.isNaN(parsed.getTime())) return date;
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  }).format(parsed);
};

