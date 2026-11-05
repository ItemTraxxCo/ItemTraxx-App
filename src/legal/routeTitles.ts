// Kept tiny on purpose: the router (main bundle) only needs slug -> page title.
// Everything else lives in documents.ts, which is only loaded with the legal pages.
// routeTitles.spec.ts keeps this in sync with the registry.
export const LEGAL_ROUTE_TITLES: Readonly<Record<string, string>> = {
  terms: "Terms of Service",
  dpa: "Data Processing Addendum",
  privacy: "Privacy Policy",
  "student-privacy": "Student Privacy Notice and FERPA / SOPIPA Compliance Addendum",
  subprocessors: "Subprocessors",
  cookies: "Cookie Notice",
  vdp: "Vulnerability Disclosure",
};
