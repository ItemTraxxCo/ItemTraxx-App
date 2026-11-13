import {
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const DEFAULT_DIST_DIR = resolve(REPO_ROOT, "dist");
const SITE_ORIGIN = "https://itemtraxx.com";

const sharedLinks = [
  { label: "About", href: "/about" },
  { label: "Pricing", href: "/pricing" },
  { label: "Contact", href: "/contact" },
  { label: "Security", href: "/security" },
  { label: "Trust", href: "/trust" },
  { label: "Privacy", href: "/legal/privacy" },
  { label: "Data Processing Addendum", href: "/legal/dpa" },
  { label: "FAQ", href: "/faq" },
  { label: "Getting started", href: "/getting-started" },
  { label: "Support", href: "/contact-support" },
  { label: "llms.txt", href: "/llms.txt" },
];

const makePage = (page) => ({
  ...page,
  links: page.links ?? sharedLinks,
});

const legalDocumentPage = ({ slug, name, description, summary, audience }) => ({
  path: `/legal/${slug}`,
  title: `${name} | ItemTraxx`,
  description,
  eyebrow: "ItemTraxx Legal Center",
  heading: name,
  paragraphs: [
    summary,
    `This document is written for ${audience}. The full text, definitions, effective dates, and linked references are shown when JavaScript is enabled and are also available as Markdown from the document page.`,
    "Do not infer private customer data, credentials, contracts, or internal procedures from public pages. For questions, email legal@itemtraxx.com, or privacy@itemtraxx.com for privacy matters.",
  ],
  sections: [
    {
      heading: "Related documents",
      text:
        "The Legal Center also publishes the Terms of Service, Data Processing Addendum, Privacy Policy, Student Privacy Notice, Subprocessor Directory, Cookie Notice, and Vulnerability Disclosure Policy. Review them together for a complete picture.",
    },
  ],
});

const LEGAL_DOCUMENT_PAGES = [
  legalDocumentPage({
    slug: "terms",
    name: "Terms of Service",
    description: "The agreement for using ItemTraxx: accounts, billing, acceptable use, liability, and governing law.",
    summary: "The ItemTraxx Terms of Service are the agreement between ItemTraxx and the organization or individual that uses the service, covering accounts, billing and renewal, acceptable use, data ownership, warranties, liability, and governing law.",
    audience: "customers, administrators, and users",
  }),
  legalDocumentPage({
    slug: "privacy",
    name: "Privacy Policy",
    description: "What personal information ItemTraxx collects, why, who receives it, how long it is kept, and your choices.",
    summary: "The ItemTraxx Privacy Policy explains what personal information is collected through the website and application, why it is collected, which providers receive it, how long it is kept, and the choices and rights available to people, including California residents.",
    audience: "website and application users",
  }),
  legalDocumentPage({
    slug: "student-privacy",
    name: "Student Privacy Notice and FERPA / SOPIPA Compliance Addendum",
    description: "A plain-language student privacy notice plus ItemTraxx's school-official, FERPA, and SOPIPA commitments.",
    summary: "The Student Privacy Notice explains in plain language what ItemTraxx records about borrowers, and the compliance addendum sets out the school-official, FERPA, COPPA, and SOPIPA commitments that apply when a school uses the service.",
    audience: "schools, districts, parents, and students",
  }),
  legalDocumentPage({
    slug: "subprocessors",
    name: "Subprocessor Directory",
    description: "Every provider that may process ItemTraxx customer personal information, what it does, and where it operates.",
    summary: "The Subprocessor Directory lists each provider that may process personal information for ItemTraxx and its customers, what each one does, what information it can receive, and how customers are notified of changes.",
    audience: "schools, districts, and security reviewers",
  }),
  legalDocumentPage({
    slug: "dpa",
    name: "Data Processing Addendum",
    description: "How ItemTraxx processes customer data, protects it, uses subprocessors, and handles incidents, requests, and deletion.",
    summary: "The ItemTraxx Data Processing Addendum describes processing roles and instructions, security safeguards, subprocessors, customer requests, security-incident notices, retention and deletion, international processing, and service-provider terms.",
    audience: "customers, schools, districts, and organizations",
  }),
  legalDocumentPage({
    slug: "cookies",
    name: "Cookie Notice",
    description: "The cookies and browser storage ItemTraxx uses, how long they last, and how cookie choices work.",
    summary: "The Cookie Notice lists the essential and optional cookies and browser storage used by ItemTraxx, how long each lasts, how the cookie banner choices are recorded, and how to change them.",
    audience: "website and application users",
  }),
  legalDocumentPage({
    slug: "vdp",
    name: "Vulnerability Disclosure Policy",
    description: "How to report a security vulnerability to ItemTraxx, with safe-harbor protection for good-faith research.",
    summary: "The Vulnerability Disclosure Policy tells security researchers what they may test, how to report a finding, and what to expect from ItemTraxx, including written authorization and safe-harbor protection for good-faith research.",
    audience: "security researchers",
  }),
];

export const PUBLIC_PRERENDER_PAGES = [
  makePage({
    path: "/",
    title: "ItemTraxx Inventory Tracking",
    description:
      "ItemTraxx helps schools, districts, organizations, and individual operators manage inventory with clear checkout, return, and audit workflows.",
    eyebrow: "Inventory tracking made simple",
    heading: "ItemTraxx",
    paragraphs: [
      "ItemTraxx is a cloud-based inventory, checkout, and administrative control platform for schools, districts, organizations, teams, and individual operators.",
      "Teams can record who has each item, when it moved, and when it was returned. Barcode-friendly checkout and return flows, inventory status, borrower management, reporting, and audit history keep day-to-day operations easier to follow.",
      "ItemTraxx is designed for real equipment rooms, classrooms, shared assets, and other workflows where accountability matters. Public information about the product, pricing, support, security, privacy, and trust review is available through the links below.",
    ],
    sections: [
      {
        heading: "Core workflows",
        text:
          "Use ItemTraxx to manage items and borrowers, run checkout and return workflows, review transaction history, and keep administrative actions organized. The application supports role-based access and workspace-aware operations for the teams that use it.",
      },
      {
        heading: "Getting started",
        text:
          "ItemTraxx is currently support-led. Contact the team for account setup, a demonstration, pricing questions, or help with an existing workspace. Public legal, privacy, security, and support information is linked below.",
      },
    ],
  }),
  makePage({
    path: "/about",
    title: "About | ItemTraxx",
    description:
      "Learn who ItemTraxx is built for, the inventory problem it addresses, and how the product is operated.",
    eyebrow: "About ItemTraxx",
    heading: "The people and thinking behind ItemTraxx.",
    paragraphs: [
      "ItemTraxx is built to make inventory tracking simpler, more accountable, and easier to run day to day for schools, districts, organizations, teams, and individual operators.",
      "The product grew from a practical inventory problem: shared equipment moves constantly, but forms, spreadsheets, and memory leave too many loose ends. ItemTraxx brings checkout, returns, borrower records, item status, and administrative history into one focused workflow.",
      "The product is designed around the people who use inventory systems in real settings. Operators need fast, understandable actions. Administrators need clear visibility and dependable records. Organizations need a service that can grow without turning ordinary work into a complicated reporting exercise.",
    ],
    sections: [
      {
        heading: "Who ItemTraxx is for",
        text:
          "Schools and classrooms, districts, media rooms, small teams, larger organizations, and individual operators can use ItemTraxx for shared assets and equipment that move between people, rooms, or teams.",
      },
      {
        heading: "How we operate",
        text:
          "ItemTraxx follows a support-first operating model with clear public product and policy information. Security, privacy, operational status, and support paths are documented on the public site so a team can review the service before asking for access.",
      },
    ],
  }),
  makePage({
    path: "/contact",
    title: "Contact | ItemTraxx",
    description:
      "Choose the ItemTraxx contact path for demos, sales, support, privacy questions, or security reports.",
    eyebrow: "Get in touch",
    heading: "Use the right contact path the first time.",
    paragraphs: [
      "ItemTraxx has separate paths for demos, sales, support, privacy requests, and security reports. Choosing the right path helps a request reach the right workflow without unnecessary handoffs.",
      "For product demonstrations, account setup, workspace planning, or pricing questions, use Contact Sales or Request Demo. For an existing account, checkout issue, login problem, or operational question, use Contact Support.",
      "Security concerns should use the security issue reporting path so the report can include the affected page, impact, and reproduction details. Privacy questions should identify the request clearly and avoid sending credentials or sensitive information in an ordinary message.",
    ],
    sections: [
      {
        heading: "What helps us respond",
        text:
          "Include the team, district, school, or organization name when it applies. Describe what you were trying to do, what happened, and any relevant page or error. For demo requests, include your role and the inventory workflow you want to see.",
      },
      {
        heading: "Response expectations",
        text:
          "The public contact page lists a default response target within active hours. The support team may ask for additional context before discussing account-specific details, and public security and privacy pages explain the appropriate escalation paths.",
      },
    ],
  }),
  makePage({
    path: "/contact-sales",
    title: "Contact Sales | ItemTraxx",
    description:
      "Talk with ItemTraxx about inventory tracking plans for schools, districts, organizations, and individual operators.",
    eyebrow: "ItemTraxx plans and pricing",
    heading: "Find the right ItemTraxx plan for your team.",
    paragraphs: [
      "Contact ItemTraxx Sales to discuss inventory tracking for a school, district, organization, team, or individual operation. The sales request form helps us understand your needs and the plan you want to explore.",
      "ItemTraxx offers Workspace Core, Workspace Growth, Workspace Enterprise, Education, Custom, and Individual plans. Share the size of your organization and the inventory workflow you want to manage so the team can prepare a useful response.",
      "The sales team aims to respond within 72 hours during active hours. Use the form to ask about plans, account setup, pricing, or a tailored inventory workflow.",
    ],
    sections: [
      {
        heading: "What to include",
        text:
          "Provide your name, reply email, the plan you are considering, and your school, district, or organization name when applicable. Include the number of schools or units for plans that need that context.",
      },
      {
        heading: "Inventory workflows",
        text:
          "ItemTraxx supports item and borrower records, checkout and return workflows, inventory status, reporting, and administrative history for shared equipment and assets.",
      },
    ],
  }),
  makePage({
    path: "/request-demo",
    title: "Request Demo | ItemTraxx",
    description:
      "Request a guided ItemTraxx demo of inventory tracking, checkout, return, and administrative workflows.",
    eyebrow: "See ItemTraxx in a live walkthrough",
    heading: "Request an ItemTraxx demo.",
    paragraphs: [
      "Request a guided walkthrough of ItemTraxx for your school, district, organization, team, or individual operation. See how teams track shared items and record who has each item, when it moved, and when it was returned.",
      "A demo can cover item and borrower records, barcode-friendly checkout and returns, inventory status, reporting, transaction history, and administrative controls.",
      "Tell us about your inventory workflow and what you want to see. The ItemTraxx team aims to respond within 72 hours during active hours to schedule next steps.",
    ],
    sections: [
      {
        heading: "Who the demo is for",
        text:
          "ItemTraxx is built for schools, districts, organizations, teams, and individual operators that manage shared equipment, classroom materials, and other assets that move between people or locations.",
      },
      {
        heading: "Plan a useful walkthrough",
        text:
          "Share the items you track, who checks them out, and the records or reports your team needs. This helps focus the demonstration on your day-to-day process.",
      },
    ],
  }),
  makePage({
    path: "/contact-support",
    title: "Contact Support | ItemTraxx",
    description:
      "Contact ItemTraxx Support for account access, inventory workflow, technical, billing, or feature questions.",
    eyebrow: "ItemTraxx customer support",
    heading: "Get help with ItemTraxx.",
    paragraphs: [
      "Use the ItemTraxx support form for help with an existing account, inventory workflow, technical issue, billing question, access problem, or feature request.",
      "Include a clear subject and describe what you were trying to do, what happened, and the relevant workspace or page. You can attach up to two images to help explain the issue.",
      "The support team aims to respond within 72 hours during active hours. For security concerns, use the dedicated security reporting page so the report reaches the right review process.",
    ],
    sections: [
      {
        heading: "Support topics",
        text:
          "The support form accepts general questions, bug reports, billing questions, account access requests, feature requests, and privacy or data-rights requests.",
      },
      {
        heading: "Help us respond",
        text:
          "Provide a reply email, a concise subject, and enough detail to reproduce or understand the question. Do not include passwords, access codes, or other credentials in a support request.",
      },
    ],
  }),
  makePage({
    path: "/login",
    title: "Login | ItemTraxx",
    description:
      "Sign in to ItemTraxx with email and password, your workspace single sign-on provider, or a passkey.",
    eyebrow: "ItemTraxx account access",
    heading: "Sign in to your ItemTraxx workspace.",
    paragraphs: [
      "Use ItemTraxx sign-in to access the inventory workspace for your school, district, organization, or team.",
      "Sign in with your email and password, continue through your workspace single sign-on provider, or use a passkey when available.",
      "If you need an account or help with access, contact your workspace administrator or the ItemTraxx Support team. Password recovery is available from the sign-in page.",
    ],
    sections: [
      {
        heading: "Manage inventory",
        text:
          "ItemTraxx helps teams manage item records, borrowers, checkout and return activity, inventory status, reporting, and administrative history.",
      },
      {
        heading: "Workspace sign-in",
        text:
          "Workspace access is organized around the account and role assigned by your organization. Choose the sign-in method configured for your workspace.",
      },
    ],
  }),
  makePage({
    path: "/privacy",
    title: "Privacy | ItemTraxx",
    description:
      "Read how ItemTraxx describes data handling, retention, support workflows, cookies, and privacy requests.",
    eyebrow: "ItemTraxx privacy policy",
    heading: "How ItemTraxx handles information.",
    paragraphs: [
      "ItemTraxx publishes a privacy policy describing the information used to provide inventory, account, support, and administrative workflows. The policy is the authoritative source for current handling, retention, sharing, and request details.",
      "Information can include account and profile details, workspace and inventory records, checkout and return history, support conversations, security events, and technical information needed to operate and protect the service. Access is organized around the account and workspace context involved in a request.",
      "ItemTraxx also describes cookies, analytics and diagnostics choices, support tooling, subprocessors, and the ways a person can ask a privacy question or submit a request. Do not infer private customer data, credentials, contracts, or internal procedures from public pages.",
    ],
    sections: [
      {
        heading: "Use the full policy",
        text:
          "The rendered Privacy Policy in the ItemTraxx Legal Center contains the complete policy language, definitions, purposes, retention explanations, and request guidance. Use that source for legal or procurement review instead of relying on this no-JavaScript summary.",
      },
      {
        heading: "Privacy questions",
        text:
          "For a privacy request or question, use the published contact path and provide only the information needed to identify the request. Never include passwords, access codes, API secrets, or other credentials in a support or privacy message.",
      },
    ],
  }),
  makePage({
    path: "/security",
    title: "Security | ItemTraxx",
    description:
      "Review ItemTraxx public security practices, access controls, traffic controls, auditability, and reporting guidance.",
    eyebrow: "Security here at ItemTraxx Co",
    heading: "Current security practices and operational controls.",
    paragraphs: [
      "ItemTraxx documents the security practices and operational controls that are in place today. The public security page is factual guidance for customers, administrators, procurement reviewers, and researchers; it is not a statement about private controls that are deliberately not published.",
      "The application uses protected sign-in flows, role- and workspace-aware authorization, server-side validation, request controls at the edge, trusted service boundaries, audit history, and monitoring around important operational paths. These layers work together; a page description is not a substitute for authorization or tenant isolation.",
      "Security issues should be reported through the published security issue page or security contact. A useful report identifies the affected page or endpoint, expected and observed behavior, impact, and safe reproduction steps. Do not access another customer, attempt destructive actions, or include real secrets in a report.",
    ],
    sections: [
      {
        heading: "Operational visibility",
        text:
          "The public Trust page links security, compliance, privacy, legal, changelog, status, and support resources together. Reviewing those pages as a set gives a clearer picture of how ItemTraxx communicates service health and operational change.",
      },
      {
        heading: "Current claims",
        text:
          "ItemTraxx does not use this summary to claim a certification that is not explicitly documented. For current details, use the security and compliance pages and contact support when a review requires additional authorized information.",
      },
    ],
  }),
  makePage({
    path: "/trust",
    title: "Trust | ItemTraxx",
    description:
      "Use the ItemTraxx trust center to review security, compliance, privacy, legal, status, and support information.",
    eyebrow: "ItemTraxx trust center",
    heading: "Trust, policy, status, and operational visibility in one place.",
    paragraphs: [
      "The ItemTraxx Trust page collects the public pages used to review how the service is operated, secured, documented, and supported. It is intended for procurement, IT, administrative, and customer review as well as anyone learning how the product works.",
      "Start with Security and Compliance for current control and monitoring information. Use Privacy and Legal for data handling and governing terms. Use Changelog and System Status together to understand operational communication and current service health.",
      "If the public pages do not answer a question, Contact Support is the right escalation path. Support can explain the appropriate next step without exposing private implementation details, customer information, credentials, or internal operating procedures.",
    ],
    sections: [
      {
        heading: "Reviewing ItemTraxx",
        text:
          "A useful trust review asks who can access a workspace, how requests are protected, what records are retained, how incidents are communicated, and where privacy or security questions go. The linked pages answer those questions at the level intended for public review.",
      },
      {
        heading: "Public scope",
        text:
          "This center intentionally links public product and policy material. It does not publish customer records, secrets, private runbooks, privileged API contracts, or undocumented internal controls. Request authorized additional information through support when necessary.",
      },
    ],
  }),
  makePage({
    path: "/faq",
    title: "FAQ | ItemTraxx",
    description:
      "Common ItemTraxx questions about setup, inventory workflows, support, plans, and operational use.",
    eyebrow: "ItemTraxx FAQ",
    heading: "Common questions about ItemTraxx, setup, support, and operations.",
    paragraphs: [
      "ItemTraxx is built for schools, districts, organizations, teams, and individual operators that need cleaner checkout, return, inventory, and oversight workflows. This summary covers the common questions a new reviewer or user may have.",
      "Core setup is currently support-led. After an account is provisioned, users sign in through the appropriate page, load a borrower, scan or enter an item, and review the result. Administrators can manage borrowers, inventory, logs, and workspace settings according to their role.",
      "ItemTraxx is designed for shared assets such as equipment, tools, and other items that move between people, rooms, or teams. Transaction history and status visibility help teams understand what is out, what came back, and where follow-up is needed.",
    ],
    sections: [
      {
        heading: "Plans and access",
        text:
          "Pricing is organized around the published plan categories and the needs of the organization. Contact Sales or Request Demo for fit, onboarding, and quote questions. Access and administrative capabilities depend on the provisioned account role and workspace.",
      },
      {
        heading: "When something goes wrong",
        text:
          "Use Contact Support for sign-in issues, account assignment, reset problems, unexpected checkout behavior, or operational questions. Include the page, steps, and useful context, but never send passwords or access codes.",
      },
    ],
  }),
  makePage({
    path: "/getting-started",
    title: "Getting Started | ItemTraxx",
    description:
      "Follow the normal ItemTraxx setup path from account access to a first checkout or return.",
    eyebrow: "Start using ItemTraxx",
    heading: "Get up and running without guessing your way through setup.",
    paragraphs: [
      "ItemTraxx setup is support-led so the account, workspace, and expected workflow can be confirmed before day-to-day use. Start by using the sign-in page intended for your role, then confirm that your account is assigned to the right workspace.",
      "For a first checkout, load the borrower, scan or enter the item identifier, review the result, and confirm the transaction state. For a return, load the existing checkout and follow the return flow so the transaction history stays understandable.",
      "Administrators can use the dedicated tools for borrowers, inventory, logs, reports, and workspace settings. If a record is missing, a login loops, an email does not arrive, or a transaction does not match expectations, Contact Support is safer than repeatedly retrying.",
    ],
    sections: [
      {
        heading: "A simple first run",
        text:
          "Confirm credentials, verify the right workspace, load one borrower, scan one item, and review the success or conflict message. Small controlled checks make it easier to identify an assignment or setup problem before a larger batch of inventory moves.",
      },
      {
        heading: "Need help?",
        text:
          "Use Contact Support for operational help and Contact Sales for account setup, pricing, or a demonstration. Include the role, page, action, and observed result without including a password, access code, or secret.",
      },
    ],
  }),
  makePage({
    path: "/pricing",
    title: "Pricing | ItemTraxx",
    description:
      "Review ItemTraxx plan categories and contact sales for organization, school, district, or individual fit.",
    eyebrow: "Pricing",
    heading: "Simple pricing for teams of any size.",
    paragraphs: [
      "ItemTraxx publishes plan categories for workspaces, education, organizations, teams, and individual use. The right option depends on the number of accounts, the operating model, the inventory workflow, and the amount of onboarding or support needed.",
      "Workspace plans are intended for organizations that manage shared inventory and borrowers across one or more operational contexts. Education and organization plans support environments where staff need clear checkout, return, history, and administrative visibility.",
      "Contact Sales for current pricing questions, school or district structure, multi-organization planning, onboarding, or a quote. Request Demo is available when a team wants to see the workflow before deciding how ItemTraxx fits its operations.",
    ],
    sections: [
      {
        heading: "What to include in a pricing question",
        text:
          "Share the type of organization, approximate workspace or account structure, number of people or items involved, and the workflow you want to improve. Avoid sending credentials or private customer data in a sales request.",
      },
      {
        heading: "Access and onboarding",
        text:
          "ItemTraxx is currently support-led rather than a self-serve API marketplace. Account provisioning, onboarding expectations, and access details are confirmed through the published sales and support paths.",
      },
    ],
  }),
  makePage({
    path: "/legal",
    title: "Legal Center | ItemTraxx",
    description:
      "Read the public ItemTraxx Terms of Service, Data Processing Addendum, Privacy Policy, Student Privacy Notice, Subprocessor Directory, Cookie Notice, and Vulnerability Disclosure Policy.",
    eyebrow: "ItemTraxx legal center",
    heading: "Public terms and policy references.",
    paragraphs: [
      "The ItemTraxx Legal page organizes the public agreements, terms, privacy references, and policy documents that govern use of the service. These documents explain the responsibilities of ItemTraxx and its customers and should be reviewed for the context that applies to an account.",
      "The legal hub may link to the Privacy Policy, student privacy language, data processing material, licensing terms, and other policy-facing documents. The document itself is the authoritative source for current wording, effective dates, and defined terms.",
      "Questions about a contract, school or district review, data processing, or an account-specific obligation should use the published contact path. Do not infer contract terms, private pricing, customer data, or internal procedures from a generic page summary.",
    ],
    sections: [
      {
        heading: "Policy review",
        text:
          "Use Legal together with Privacy, Security, Compliance, and Trust when reviewing ItemTraxx. The Terms of Service and Data Processing Addendum set out customer terms and processing roles; the other pages explain data handling, operational controls, public mappings, and review navigation.",
      },
      {
        heading: "Questions",
        text:
          "For a legal or procurement question, contact ItemTraxx through the public sales or support path and identify the document or topic that needs clarification. Formal advice should come from the appropriate legal or compliance reviewer.",
      },
    ],
    links: [
      { label: "Terms of Service", href: "/legal/terms" },
      { label: "Data Processing Addendum", href: "/legal/dpa" },
      { label: "Privacy Policy", href: "/legal/privacy" },
      { label: "Student Privacy Notice", href: "/legal/student-privacy" },
      { label: "Subprocessor Directory", href: "/legal/subprocessors" },
      { label: "Cookie Notice", href: "/legal/cookies" },
      { label: "Vulnerability Disclosure Policy", href: "/legal/vdp" },
    ],
  }),
  ...LEGAL_DOCUMENT_PAGES.map((page) => makePage(page)),
  makePage({
    path: "/cookies",
    title: "Cookies | ItemTraxx",
    description:
      "Learn how ItemTraxx describes essential cookies, analytics choices, diagnostics, and browser preferences.",
    eyebrow: "ItemTraxx cookie information",
    heading: "Cookies, preferences, and optional telemetry.",
    paragraphs: [
      "ItemTraxx uses browser storage and cookies where needed for sign-in, security, application preferences, and the operation of the service. The public Cookies page explains the categories that may be used and the choices available through the consent experience.",
      "Essential behavior supports account and application functions. Optional analytics or diagnostics can be controlled through the consent settings shown by the application. A refusal of optional telemetry should not be treated as permission to infer a person’s identity or activity beyond what is needed to provide the requested service.",
      "Cookie and privacy behavior can change as providers or product capabilities change. Use the current public Cookies and Privacy pages for the full explanation, and contact support when a school, district, or organization review needs additional authorized information.",
    ],
    sections: [
      {
        heading: "Browser choices",
        text:
          "Browser settings can clear or restrict storage, but doing so may affect sign-in or preference behavior. The in-app consent controls are the clearest way to express optional analytics and diagnostics choices for the current browser.",
      },
      {
        heading: "Related policy",
        text:
          "Review Privacy for the broader information-handling explanation and Legal for governing terms. Do not submit passwords, access codes, or secrets through a cookie or support question.",
      },
    ],
  }),
  makePage({
    path: "/compliance",
    title: "Compliance | ItemTraxx",
    description:
      "Review public ItemTraxx compliance mappings and security-monitoring context without inferring undocumented certifications.",
    eyebrow: "ItemTraxx compliance",
    heading: "Public compliance context and current mappings.",
    paragraphs: [
      "The ItemTraxx Compliance page provides public context for security monitoring, control mappings, and remediation information that is documented for review. It is intended to help teams understand the available evidence without overstating what has not been independently documented.",
      "Compliance review should consider the customer’s environment, account configuration, contractual requirements, and the specific control or framework being evaluated. A public mapping is not automatically a certification, an audit opinion, or a guarantee that every customer configuration has the same outcome.",
      "Use Compliance together with Security, Privacy, Legal, and Trust. If a procurement or school review requires evidence that is not public, contact support with the framework, control, or document request and wait for authorized guidance.",
    ],
    sections: [
      {
        heading: "Evidence boundaries",
        text:
          "Public pages describe the controls and mappings that ItemTraxx chooses to publish. They do not expose private runbooks, credentials, customer data, privileged API contracts, or undocumented internal procedures.",
      },
      {
        heading: "Current information",
        text:
          "Use the live Compliance and Security pages for current wording and status. Avoid copying a historical description into a contract or questionnaire without confirming that it still applies.",
      },
    ],
  }),
  makePage({
    path: "/accessibility",
    title: "Accessibility | ItemTraxx",
    description:
      "Read the public ItemTraxx accessibility guidance and how to report an accessibility barrier.",
    eyebrow: "ItemTraxx accessibility",
    heading: "Accessibility information and feedback paths.",
    paragraphs: [
      "ItemTraxx aims to keep the public and application experience understandable and usable across modern desktop and mobile browsers. The public Accessibility page describes the current guidance and the path for reporting a barrier or requesting help.",
      "Accessibility work includes semantic structure, readable labels, keyboard-aware interactions, responsive layouts, understandable error states, and care around motion or focus behavior. The exact experience can depend on the browser, device, account role, and workflow being used.",
      "If a page or flow creates an accessibility barrier, report the URL or workflow, the device and browser when relevant, and the observed behavior. Do not include passwords, access codes, or private customer records in a public or ordinary support report.",
    ],
    sections: [
      {
        heading: "Feedback is useful",
        text:
          "Specific reproduction steps help the team understand whether the issue affects navigation, labels, contrast, focus, screen-reader output, touch interaction, or another part of the experience. Include the expected outcome and what happened instead.",
      },
      {
        heading: "Related support",
        text:
          "Contact Support for help using an existing account and use the public security reporting path for security concerns. Accessibility feedback should remain focused on the barrier and the affected experience.",
      },
    ],
  }),
  makePage({
    path: "/changelog",
    title: "Changelog | ItemTraxx",
    description:
      "Review public ItemTraxx product, engineering, security, and operational changes in the changelog.",
    eyebrow: "ItemTraxx changelog",
    heading: "Product and operational changes, documented publicly.",
    paragraphs: [
      "The ItemTraxx Changelog records public product, engineering, security, and operational changes that are useful to customers and reviewers. It helps explain how the service evolves without exposing customer data, secrets, or private implementation details.",
      "Changelog entries should be read with the current product, security, privacy, legal, and status pages. A historical entry describes a change at a point in time; it does not replace the current behavior or current policy published elsewhere on the site.",
      "When a change affects account access, inventory workflows, support, or operational expectations, use the linked public guidance and contact support if a team needs help understanding the impact on its workspace.",
    ],
    sections: [
      {
        heading: "What the changelog is for",
        text:
          "Use it to follow meaningful changes, understand when a behavior was introduced, and find the public page that explains the current workflow. It is not an API contract, a security disclosure, or a substitute for a customer-specific release communication.",
      },
      {
        heading: "Stay current",
        text:
          "For service health, use the public status page. For security and privacy review, use the corresponding policy pages. For account or workflow questions, use Contact Support rather than relying on an old changelog entry.",
      },
    ],
  }),
];

const INDEX_CONTENT_DIR = join(REPO_ROOT, "src", "content", "index");
const INDEX_CATEGORIES = ["Company", "Product", "Guides", "Security", "Updates"];
const slugifyIndexTitle = (title) => title
  .normalize("NFKD")
  .replace(/[\u0300-\u036f]/g, "")
  .toLowerCase()
  .trim()
  .replace(/[^a-z0-9]+/g, "-")
  .replace(/^-+|-+$/g, "");

const parseIndexMarkdown = (source) => {
  const match = source.match(/^---\s*\r?\n([\s\S]*?)\r?\n---\s*(?:\r?\n|$)/);
  if (!match) return { metadata: {}, markdown: source.trim() };

  const metadata = {};
  for (const line of match[1].split(/\r?\n/)) {
    const separator = line.indexOf(":");
    if (separator < 1) continue;
    const key = line.slice(0, separator).trim().toLowerCase();
    let value = line.slice(separator + 1).trim();
    if (
      (value.startsWith("\"") && value.endsWith("\"")) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1).trim();
    }
    metadata[key] = value;
  }
  return { metadata, markdown: source.slice(match[0].length).trim() };
};

const readableIndexParagraphs = (markdown) => markdown
  .split(/\r?\n\s*\r?\n/)
  .map((block) => block
    .replace(/^\s{0,3}#{1,6}\s+/gm, "")
    .replace(/!?\[([^\]]*)\]\([^)]+\)/g, "$1")
    .replace(/^\s*(?:[-*+]\s+|\d+\.\s+)/gm, "")
    .replace(/[>*_~`]/g, "")
    .replace(/\s+/g, " ")
    .trim())
  .filter(Boolean);

const loadPublishedIndexPages = () => {
  if (!existsSync(INDEX_CONTENT_DIR)) return [];
  const pages = [];
  const slugs = new Set();

  for (const fileName of readdirSync(INDEX_CONTENT_DIR).filter((name) => name.toLowerCase().endsWith(".md") && name.toLowerCase() !== "readme.md")) {
    const title = fileName.replace(/\.md$/i, "").replace(/\s+/g, " ").trim();
    const slug = slugifyIndexTitle(title);
    if (!title || !slug || slug === "about") continue;

    const { metadata, markdown } = parseIndexMarkdown(readFileSync(join(INDEX_CONTENT_DIR, fileName), "utf8"));
    if (metadata.draft?.toLowerCase() !== "false") continue;
    if (slugs.has(slug)) throw new Error(`Duplicate ItemTraxx Index slug: /index/${slug}`);
    slugs.add(slug);

    const category = INDEX_CATEGORIES.find((item) => item.toLowerCase() === metadata.category?.toLowerCase()) ?? "Company";
    const summary = metadata.summary?.trim() || `Read ${title} from the ItemTraxx Index.`;
    const articleParagraphs = readableIndexParagraphs(markdown);
    pages.push(makePage({
      path: `/index/${slug}`,
      title: `${title} | ItemTraxx Index`,
      description: summary,
      eyebrow: `ItemTraxx Index · ${category}`,
      heading: title,
      paragraphs: articleParagraphs.length ? articleParagraphs : [summary],
      sections: [],
      lastmod: /^\d{4}-\d{2}-\d{2}$/.test(metadata.date ?? "") ? metadata.date : undefined,
    }));
  }

  return pages;
};

PUBLIC_PRERENDER_PAGES.push(
  makePage({
    path: "/index",
    title: "Index | ItemTraxx",
    description: "Browse articles, guides, security writing, and product updates from ItemTraxx.",
    eyebrow: "ItemTraxx Index",
    heading: "All",
    paragraphs: [
      "The ItemTraxx Index is a public collection of writing, guides, product updates, and information about how we work.",
      "Use the categories to browse, or search the Index for a topic.",
    ],
    sections: [],
  }),
  makePage({
    path: "/index/about",
    title: "About the Index | ItemTraxx",
    description: "Why we created the ItemTraxx Index and what we plan to share here.",
    eyebrow: "About the ItemTraxx Index",
    heading: "We believe transparency helps build trust.",
    paragraphs: [
      "We want people to understand how we approach our work at ItemTraxx, what practices guide us, and how our company and product evolve.",
      "The Index gives us a place to share more of that openly through articles, practical guides, product updates, and information about our company practices.",
      "Our goal is to make it easier for customers, partners, and anyone interested in ItemTraxx to see how we think, what we’re learning, and how our work changes over time.",
    ],
    sections: [],
  }),
  ...loadPublishedIndexPages(),
);

const escapeHtml = (value) => String(value)
  .replaceAll("&", "&amp;")
  .replaceAll("<", "&lt;")
  .replaceAll(">", "&gt;")
  .replaceAll('"', "&quot;")
  .replaceAll("'", "&#39;");

const escapeAttribute = escapeHtml;

const pageUrl = (path) => `${SITE_ORIGIN}${path === "/" ? "/" : path}`;

const writeIndexSitemapEntries = (distDir) => {
  const sitemapPath = join(distDir, "sitemap.xml");
  if (!existsSync(sitemapPath)) return;
  let sitemap = readFileSync(sitemapPath, "utf8");
  const buildDate = new Date().toISOString().slice(0, 10);

  for (const page of PUBLIC_PRERENDER_PAGES.filter((candidate) => candidate.path === "/index" || candidate.path.startsWith("/index/"))) {
    const location = pageUrl(page.path);
    if (sitemap.includes(`<loc>${location}</loc>`)) continue;
    const lastmod = page.lastmod ?? buildDate;
    const entry = `  <url>\n    <loc>${escapeHtml(location)}</loc>\n    <lastmod>${escapeHtml(lastmod)}</lastmod>\n  </url>`;
    sitemap = sitemap.replace("</urlset>", `${entry}\n</urlset>`);
  }

  writeFileSync(sitemapPath, sitemap, "utf8");
};

export const renderPublicFallback = (page) => {
  const sections = page.sections.map((section) => `
      <section>
        <h2>${escapeHtml(section.heading)}</h2>
        <p>${escapeHtml(section.text)}</p>
      </section>`).join("");
  const links = page.links.map((link) =>
    `<a href="${escapeAttribute(link.href)}">${escapeHtml(link.label)}</a>`
  ).join(" · ");

  return `<main class="agent-readable-fallback" data-agent-prerendered="true" data-agent-path="${escapeAttribute(page.path)}">
    <p class="agent-readable-eyebrow">${escapeHtml(page.eyebrow)}</p>
    <h1>${escapeHtml(page.heading)}</h1>
    ${page.paragraphs.map((paragraph) => `<p>${escapeHtml(paragraph)}</p>`).join("")}
    ${sections}
    <nav aria-label="Public ItemTraxx pages">
      <h2>Public ItemTraxx pages</h2>
      <p>${links}</p>
    </nav>
  </main>`;
};

const replaceTagAttribute = (html, tagPattern, attribute, value) =>
  html.replace(tagPattern, (tag) =>
    tag.replace(
      new RegExp(`${attribute}="[^"]*"`),
      `${attribute}="${escapeAttribute(value)}"`,
    )
  );

export const applyPublicMetadata = (html, page) => {
  let result = html.replace(
    /<title>[\s\S]*?<\/title>/,
    `<title>${escapeHtml(page.title)}</title>`,
  );
  result = replaceTagAttribute(
    result,
    /<meta\s+name="description"[\s\S]*?\/>/,
    "content",
    page.description,
  );
  result = replaceTagAttribute(
    result,
    /<link\s+rel="canonical"[\s\S]*?\/>/,
    "href",
    pageUrl(page.path),
  );
  result = replaceTagAttribute(
    result,
    /<meta\s+property="og:title"[\s\S]*?\/>/,
    "content",
    page.title,
  );
  result = replaceTagAttribute(
    result,
    /<meta\s+property="og:description"[\s\S]*?\/>/,
    "content",
    page.description,
  );
  result = replaceTagAttribute(
    result,
    /<meta\s+property="og:url"[\s\S]*?\/>/,
    "content",
    pageUrl(page.path),
  );
  result = replaceTagAttribute(
    result,
    /<meta\s+name="twitter:title"[\s\S]*?\/>/,
    "content",
    page.title,
  );
  result = replaceTagAttribute(
    result,
    /<meta\s+name="twitter:description"[\s\S]*?\/>/,
    "content",
    page.description,
  );
  return result;
};

export const injectPublicFallback = (html, page) => {
  const appMount = /<div id="app">[\s\S]*?<\/div>/;
  if (!appMount.test(html)) {
    throw new Error("Unable to find the #app mount in the built HTML.");
  }
  return applyPublicMetadata(
    html.replace(appMount, `<div id="app">${renderPublicFallback(page)}</div>`),
    page,
  );
};

export const writePublicPrerenderedPages = (distDir = DEFAULT_DIST_DIR) => {
  const indexPath = join(distDir, "index.html");
  if (!existsSync(indexPath)) {
    throw new Error(`Expected Vite output at ${indexPath}. Run vite build first.`);
  }
  const builtHtml = readFileSync(indexPath, "utf8");

  for (const page of PUBLIC_PRERENDER_PAGES) {
    const outputPath = page.path === "/"
      ? indexPath
      : join(distDir, page.path.slice(1), "index.html");
    mkdirSync(dirname(outputPath), { recursive: true });
    writeFileSync(outputPath, injectPublicFallback(builtHtml, page), "utf8");
  }
  writeIndexSitemapEntries(distDir);

  console.log(
    `[prerender] wrote ${PUBLIC_PRERENDER_PAGES.length} public route HTML files`,
  );
};

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  writePublicPrerenderedPages();
}
