import type { LegalDocMeta } from "./documents";

// Kept out of documents.ts so the router (main bundle) does not pull in the loaders.
/** Raw markdown loaders; each document becomes its own lazy chunk. */
const rawSources = import.meta.glob(["../../docs/legal/*.md", "../../DPA.md"], {
  query: "?raw",
  import: "default",
}) as Record<string, () => Promise<string>>;

export const loadLegalMarkdown = async (doc: LegalDocMeta): Promise<string> => {
  const key = `../../${doc.sourceFile}`;
  const loader = rawSources[key];
  if (!loader) throw new Error(`Missing legal source: ${doc.sourceFile}`);
  return loader();
};
