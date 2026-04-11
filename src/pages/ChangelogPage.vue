<template>
  <div class="changelog-page">
    <div class="changelog-orb changelog-orb-one" aria-hidden="true"></div>
    <div class="changelog-orb changelog-orb-two" aria-hidden="true"></div>
    <div class="grid-noise" aria-hidden="true"></div>

    <main class="changelog-container">
      <div class="page-nav-left changelog-top-nav">
        <RouterLink class="changelog-back-link" to="/" aria-label="Return to home" @click.prevent="$router.back()">
          <svg viewBox="0 0 24 24" aria-hidden="true">
            <path d="M15 5 8 12l7 7" />
          </svg>
        </RouterLink>
        <span class="changelog-breadcrumb">Changelog</span>
      </div>

      <section class="changelog-hero">
        <p class="changelog-eyebrow">ItemTraxx Product changelog</p>
        <h1>Recent ItemTraxx product and engineering changes.</h1>
        <p v-if="lastUpdated" class="changelog-lead">Last updated (year-month-day): {{ lastUpdated }}</p>
      </section>

      <section v-if="intro.length" class="changelog-card changelog-intro-card">
        <p v-for="paragraph in intro" :key="paragraph">{{ paragraph }}</p>
      </section>

      <section v-if="docLinks.length" class="changelog-card changelog-links-card">
        <p class="changelog-section-label">Documentation Links</p>
        <div class="changelog-links-grid">
          <article v-for="link in docLinks" :key="link.title" class="changelog-link-card">
            <h2>{{ link.title }}</h2>
            <p>{{ link.description }}</p>
            <a v-if="link.href" :href="link.href" target="_blank" rel="noreferrer">Open</a>
          </article>
        </div>
      </section>

      <section class="changelog-version-strip" aria-label="Latest build version">
        <p class="changelog-version-label">Latest version</p>
        <p class="changelog-version-lead">Please make sure your ItemTraxx is updated.</p>
        <p class="changelog-version-value">Current release version: {{ appVersion }}</p>
        <p class="changelog-version-meta">
          {{ releaseChannel }}
          <span v-if="showBranchName"> • {{ appBranch }}</span>
        </p>
      </section>

      <div class="changelog-version-divider" aria-hidden="true"></div>
      <p class="changelog-entries-kicker">Recent Changes</p>

      <section class="changelog-entries">
        <article v-for="entry in entries" :key="entry.title" class="changelog-card changelog-entry-card">
          <p class="changelog-section-label"></p>
          <h2>{{ entry.title }}</h2>
          <ul class="changelog-list">
            <li v-for="item in entry.items" :key="item.title + item.body">
              <strong>{{ item.title }}</strong>
              <span v-if="item.body">{{ item.body }}</span>
            </li>
          </ul>
        </article>
      </section>

      <PublicFooter />
    </main>
  </div>
</template>

<script setup lang="ts">
import { computed } from "vue";
import { RouterLink } from "vue-router";
import PublicFooter from "../components/PublicFooter.vue";
import changelogRaw from "../../CHANGELOG.md?raw";

type DocLink = {
  title: string;
  description: string;
  href: string | null;
};

type EntryItem = {
  title: string;
  body: string;
};

type ChangelogEntry = {
  title: string;
  items: EntryItem[];
};

const lines = changelogRaw.split(/\r?\n/);
const appVersion = import.meta.env.VITE_GIT_COMMIT || "n/a";
const appBranch = import.meta.env.VITE_GIT_BRANCH || "n/a";
const runtimeEnvironment = (
  import.meta.env.VITE_SENTRY_ENVIRONMENT ||
  import.meta.env.MODE ||
  ""
).trim().toLowerCase();
const runtimeHostname =
  typeof window !== "undefined" ? window.location.hostname.trim().toLowerCase() : "";
const isDevHost =
  runtimeHostname === "dev.itemtraxx.com" || runtimeHostname.endsWith(".dev.itemtraxx.com");

const releaseChannel =
  isDevHost
    ? "Development"
    : runtimeEnvironment === "production"
    ? "Production"
    : runtimeEnvironment === "preview"
      ? "Preview"
      : runtimeEnvironment === "beta"
        ? "Beta"
        : "Development";

const showBranchName = !!appBranch && appBranch !== "n/a" && appBranch !== "main";

const lastUpdated = computed(() => {
  const line = lines.find((entry) => entry.startsWith("Last updated (year-month-day):"));
  return line ? line.split(":").slice(1).join(":").trim() : "";
});

const intro = computed(() => {
  const start = lines.findIndex((line) => line.startsWith("All notable changes"));
  const end = lines.findIndex((line) => line.trim() === "## Documentation Links");
  if (start === -1 || end === -1 || end <= start) return [] as string[];
  return lines
    .slice(start, end)
    .map((line) => line.trim().replace(/\*\*/g, ""))
    .filter(Boolean)
    .filter((line) => line !== "---");
});

const DOC_LINK_ROUTE_MAP: Record<string, string> = {
  "README.md": "https://github.com/ItemTraxxCo/ItemTraxx-App/blob/main/README.md",
  "LICENSE.md": "https://github.com/ItemTraxxCo/ItemTraxx-App/blob/main/LICENSE.md",
  "LEGAL.md": "/legal",
  "TERMS.md": "/legal",
  "PRIVACY.md": "/privacy",
  "SECURITY.md": "/security",
};

const normalizeDocHref = (href: string) => {
  if (/^https?:\/\//.test(href)) return href;
  const mapped = DOC_LINK_ROUTE_MAP[href];
  if (mapped) return mapped;
  return `https://github.com/ItemTraxxCo/ItemTraxx-App/blob/main/${href}`;
};

const docLinks = computed<DocLink[]>(() => {
  const start = lines.findIndex((line) => line.trim() === "## Documentation Links");
  if (start === -1) return [];
  const result: DocLink[] = [];
  for (let i = start + 1; i < lines.length; i += 1) {
    const line = lines[i].trim();
    if (!line) continue;
    if (line === "---") continue;
    if (line.startsWith("### ")) break;
    if (!line.startsWith("- [")) continue;
    const match = line.match(/^- \[(.+?)\]\((.+?)\)\s+[–-]\s+(.+)$/);
    if (!match) continue;
    const [, title, href, description] = match;
    result.push({ title, href: normalizeDocHref(href), description });
  }
  return result;
});

const normalizeBullet = (text: string) => {
  const trimmed = text.trim();
  const parts = trimmed.split(":");
  if (parts.length > 1) {
    return {
      title: `${parts.shift()?.trim()}:`,
      body: parts.join(":").trim(),
    };
  }
  return { title: trimmed, body: "" };
};

const entries = computed<ChangelogEntry[]>(() => {
  const result: ChangelogEntry[] = [];
  let current: ChangelogEntry | null = null;

  for (const rawLine of lines) {
    const line = rawLine.trimEnd();
    if (line.startsWith("### ")) {
      if (current) result.push(current);
      current = { title: line.replace(/^###\s+/, "").trim(), items: [] };
      continue;
    }
    if (!current) continue;
    const trimmed = line.trim();
    if (!trimmed || trimmed === "---") continue;
    if (trimmed.startsWith("- ")) {
      current.items.push(normalizeBullet(trimmed.replace(/^-\s+/, "")));
      continue;
    }
    if (trimmed.startsWith("  - ")) {
      current.items.push(normalizeBullet(trimmed.replace(/^\-\s+/, "")));
      continue;
    }
  }

  if (current) result.push(current);
  return result;
});
</script>

<style scoped>
.changelog-page {
  position: relative;
  min-height: 100vh;
  min-height: 100dvh;
  width: 100%;
  max-width: 100%;
  margin-left: 0;
  padding: calc(2rem + env(safe-area-inset-top, 0px)) 0 3.5rem;
  background-color: #0a1120;
  color: #f5f7fb;
  overflow-x: hidden;
}

.changelog-page::before {
  content: "";
  position: fixed;
  inset: 0;
  z-index: 0;
  background:
    radial-gradient(circle at 14% 18%, rgba(25, 194, 168, 0.16), transparent 34%),
    radial-gradient(circle at 83% 10%, rgba(25, 67, 155, 0.18), transparent 31%),
    linear-gradient(180deg, #09111f 0%, #0d1524 48%, #0a1120 100%);
  pointer-events: none;
}

.changelog-orb {
  position: absolute;
  border-radius: 999px;
  filter: blur(40px);
  opacity: 0.38;
  pointer-events: none;
}

.changelog-orb-one {
  width: 20rem;
  height: 20rem;
  top: 5rem;
  left: -6rem;
  background: rgba(30, 202, 183, 0.24);
}

.changelog-orb-two {
  width: 24rem;
  height: 24rem;
  top: 9rem;
  right: -8rem;
  background: rgba(38, 104, 226, 0.2);
}

.changelog-container {
  position: relative;
  z-index: 1;
  width: min(1120px, calc(100% - 2rem));
  margin: 0 auto;
}

.changelog-top-nav {
  display: flex;
  align-items: center;
  gap: 0.9rem;
  margin-bottom: 1.25rem;
}

.changelog-back-link {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 2.75rem;
  height: 2.75rem;
  border-radius: 999px;
  border: 1px solid rgba(136, 154, 184, 0.28);
  background: rgba(10, 17, 31, 0.72);
  color: #f5f7fb;
  transition: border-color 160ms ease, transform 160ms ease;
}

.changelog-back-link:hover {
  border-color: rgba(56, 208, 177, 0.55);
  transform: translateX(-1px);
}

.changelog-back-link svg {
  width: 1.1rem;
  height: 1.1rem;
  stroke: currentColor;
  stroke-width: 2;
  fill: none;
  stroke-linecap: round;
  stroke-linejoin: round;
}

.changelog-breadcrumb,
.changelog-section-label {
  font-size: 0.8rem;
  letter-spacing: 0.11em;
  text-transform: uppercase;
  color: #8be6d6;
}

.changelog-hero,
.changelog-card,
.changelog-link-card {
  position: relative;
  overflow: hidden;
  border: 1px solid rgba(112, 138, 180, 0.16);
  background: linear-gradient(180deg, rgba(18, 26, 41, 0.95), rgba(11, 18, 31, 0.92));
  box-shadow: 0 28px 64px rgba(5, 10, 18, 0.34);
}

.changelog-hero::after,
.changelog-card::after,
.changelog-link-card::after {
  content: "";
  position: absolute;
  inset: 0;
  background: linear-gradient(120deg, rgba(255, 255, 255, 0.04), transparent 46%);
  pointer-events: none;
}

.changelog-hero {
  padding: clamp(2rem, 4vw, 3.2rem);
  border-radius: 2rem;
  margin-bottom: 1.25rem;
}

.changelog-hero h1 {
  margin: 0;
  max-width: 100%;
  line-height: 1.05;
  font-size: clamp(1.4rem, 3vw, 2.4rem);
  padding-right: 1.1rem;
}

.changelog-eyebrow {
  margin: 0 0 0.9rem;
  font-size: 0.76rem;
  letter-spacing: 0.12em;
  text-transform: uppercase;
  color: #8be6d6;
}

.changelog-lead,
.changelog-card p,
.changelog-link-card p,
.changelog-list span,
.changelog-link-card a {
  color: rgba(231, 236, 245, 0.82);
}

.changelog-lead {
  margin: 1.25rem 0 0;
  font-size: 1.02rem;
  line-height: 1.75;
}

.changelog-card {
  border-radius: 1.6rem;
  padding: 1.5rem;
}

.changelog-intro-card {
  margin-bottom: 1rem;
}

.changelog-links-grid,
.changelog-entries {
  display: grid;
  gap: 1rem;
}

.changelog-links-grid {
  grid-template-columns: repeat(3, minmax(0, 1fr));
  margin-top: 1rem;
}

.changelog-link-card {
  border-radius: 1.25rem;
  padding: 1.2rem;
}

.changelog-link-card h2,
.changelog-entry-card h2 {
  margin: 0;
}

.changelog-link-card a {
  display: inline-flex;
  margin-top: 0.85rem;
  text-decoration: none;
  font-weight: 600;
}

.changelog-link-card a:hover {
  color: #eafffb;
}

.changelog-entries {
  margin-top: 1rem;
}

.changelog-version-strip {
  margin-top: 1rem;
  margin-bottom: 1rem;
  padding: 0.85rem 1rem;
  border-radius: 1rem;
  border: 1px solid rgba(112, 138, 180, 0.16);
  background: linear-gradient(180deg, rgba(18, 26, 41, 0.9), rgba(11, 18, 31, 0.86));
}

.changelog-version-label {
  margin: 0;
  font-size: 0.72rem;
  letter-spacing: 0.11em;
  text-transform: uppercase;
  color: #8be6d6;
}

.changelog-version-lead {
  margin: 0.16rem 0 0.08rem;
  font-size: 0.78rem;
  line-height: 1.35;
  color: rgba(231, 236, 245, 0.74);
}

.changelog-version-value {
  margin: 0.12rem 0 0;
  font-size: 0.96rem;
  font-weight: 700;
  color: #f5f7fb;
}

.changelog-version-meta {
  margin: 0.2rem 0 0;
  font-size: 0.82rem;
  color: rgba(231, 236, 245, 0.78);
}

.changelog-version-divider {
  height: 3px;
  margin: 1.75rem 0 1.95rem;
  border-radius: 999px;
  background: color-mix(in srgb, #ffffff 48%, rgba(255, 255, 255, 0.8));
}

.changelog-entries-kicker {
  margin: 0 0 0.65rem;
  font-size: 0.78rem;
  letter-spacing: 0.12em;
  text-transform: uppercase;
  color: #8be6d6;
}

.changelog-list {
  list-style: none;
  margin: 1rem 0 0;
  padding: 0;
  display: grid;
  gap: 0.85rem;
}

.changelog-list li {
  display: grid;
  gap: 0.25rem;
}

.changelog-list strong {
  color: #f5f7fb;
}

@media (max-width: 980px) {
  .changelog-links-grid {
    grid-template-columns: 1fr;
  }
}

@media (max-width: 640px) {
  .changelog-page {
    padding-top: calc(1.25rem + env(safe-area-inset-top, 0px));
  }

  .changelog-container {
    width: min(1120px, calc(100% - 1rem));
  }

  .changelog-card,
  .changelog-link-card,
  .changelog-hero {
    border-radius: 1.4rem;
  }
}
</style>
