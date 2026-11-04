import type { LegalDocMeta } from "./documents";

// Only published documents are bundled. README.md in docs/legal is an internal
// working note and is deliberately excluded from the glob.
const rawSources = import.meta.glob(["../../docs/legal/*.md", "!../../docs/legal/README.md"], {
  query: "?raw",
  import: "default",
}) as Record<string, () => Promise<string>>;

export const LEGAL_SOURCE_KEYS: readonly string[] = Object.keys(rawSources);

export const loadLegalMarkdown = async (doc: LegalDocMeta): Promise<string> => {
  const loader = rawSources[`../../${doc.sourceFile}`];
  if (!loader) throw new Error(`Missing legal source: ${doc.sourceFile}`);
  return loader();
};
