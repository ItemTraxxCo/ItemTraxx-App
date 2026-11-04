// Registry for the public legal pages. The markdown files in docs/legal/
// (plus the legacy DPA.md) are the source of truth for wording.

export type LegalDocMeta = {
  slug: string;
  title: string;
  path: string;
  /** Source file, relative to the repository root. */
  sourceFile: string;
};

export const LEGAL_DOCUMENTS: readonly LegalDocMeta[] = [
  { slug: "terms", title: "Terms of Service", path: "/legal/terms", sourceFile: "docs/legal/terms-of-service.md" },
  { slug: "privacy", title: "Privacy Policy", path: "/legal/privacy", sourceFile: "docs/legal/privacy-policy.md" },
  { slug: "student-privacy", title: "Student Privacy Notice and FERPA / SOPIPA Addendum", path: "/legal/student-privacy", sourceFile: "docs/legal/student-privacy-notice.md" },
  { slug: "subprocessors", title: "Subprocessor Directory", path: "/legal/subprocessors", sourceFile: "docs/legal/subprocessor-directory.md" },
  { slug: "cookies", title: "Cookie Notice", path: "/legal/cookies", sourceFile: "docs/legal/cookie-notice.md" },
  { slug: "vdp", title: "Vulnerability Disclosure Policy", path: "/legal/vdp", sourceFile: "docs/legal/vulnerability-disclosure-policy.md" },
  { slug: "dpa", title: "Data Processing Addendum", path: "/legal/dpa", sourceFile: "DPA.md" },
];

export const getLegalDocument = (slug: string): LegalDocMeta | undefined =>
  LEGAL_DOCUMENTS.find((doc) => doc.slug === slug);

/** Maps markdown file names used in cross-document links to site paths. */
export const LEGAL_FILE_TO_PATH: Readonly<Record<string, string>> = Object.freeze({
  "terms-of-service.md": "/legal/terms",
  "privacy-policy.md": "/legal/privacy",
  "student-privacy-notice.md": "/legal/student-privacy",
  "subprocessor-directory.md": "/legal/subprocessors",
  "cookie-notice.md": "/legal/cookies",
  "vulnerability-disclosure-policy.md": "/legal/vdp",
  "DPA.md": "/legal/dpa",
  "dpa.md": "/legal/dpa",
});
