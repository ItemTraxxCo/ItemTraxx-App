<template>
  <div class="page privacy-page">
    <RouterLink class="brand-mark" to="/" aria-label="ItemTraxx home">
      <img v-if="brandLogoUrl" class="brand-mark-full" :src="brandLogoUrl" alt="ItemTraxx Co" />
    </RouterLink>

    <main class="privacy-container">
      <div class="page-nav-left privacy-top-nav">
        <RouterLink class="privacy-back-link" to="/" aria-label="Return to home" @click.prevent="$router.back()">
          <svg viewBox="0 0 24 24" aria-hidden="true">
            <path d="M15 5 8 12l7 7" />
          </svg>
        </RouterLink>
        <span class="privacy-breadcrumb">Privacy</span>
      </div>

      <section class="privacy-hero">
        <p class="privacy-eyebrow">ItemTraxx privacy policy</p>
        <h1>{{ pageTitle }}</h1>
        <p v-if="lastUpdated" class="privacy-lead">Last updated: {{ lastUpdated }}</p>
        <div v-if="intro.length" class="privacy-intro">
          <p v-for="paragraph in intro" :key="paragraph">
            <template v-for="(token, tokenIndex) in tokenizeInline(paragraph)" :key="`${paragraph}-${tokenIndex}`">
              <code v-if="token.type === 'code'">{{ token.text }}</code>
              <strong v-else-if="token.type === 'strong'">{{ token.text }}</strong>
              <a
                v-else-if="token.type === 'link'"
                :href="token.href"
                target="_blank"
                rel="noreferrer"
              >
                {{ token.text }}
              </a>
              <template v-else>{{ token.text }}</template>
            </template>
          </p>
        </div>
      </section>

      <section class="privacy-sections">
        <article v-for="section in sections" :key="section.title" class="privacy-card">
          <h2>{{ section.title }}</h2>
          <div class="privacy-content">
            <template v-for="(block, index) in section.blocks" :key="`${section.title}-${index}`">
              <p v-if="block.type === 'paragraph'">
                <template v-for="(token, tokenIndex) in tokenizeInline(block.text)" :key="`${section.title}-${index}-${tokenIndex}`">
                  <code v-if="token.type === 'code'">{{ token.text }}</code>
                  <strong v-else-if="token.type === 'strong'">{{ token.text }}</strong>
                  <a
                    v-else-if="token.type === 'link'"
                    :href="token.href"
                    target="_blank"
                    rel="noreferrer"
                  >
                    {{ token.text }}
                  </a>
                  <template v-else>{{ token.text }}</template>
                </template>
              </p>
              <ul v-else class="privacy-list">
                <li v-for="item in block.items" :key="item">
                  <template v-for="(token, tokenIndex) in tokenizeInline(item)" :key="`${item}-${tokenIndex}`">
                    <code v-if="token.type === 'code'">{{ token.text }}</code>
                    <strong v-else-if="token.type === 'strong'">{{ token.text }}</strong>
                    <a
                      v-else-if="token.type === 'link'"
                      :href="token.href"
                      target="_blank"
                      rel="noreferrer"
                    >
                      {{ token.text }}
                    </a>
                    <template v-else>{{ token.text }}</template>
                  </template>
                </li>
              </ul>
            </template>
          </div>
        </article>
      </section>

    </main>

    <div class="privacy-footer-wrap">
      <PublicFooter />
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref } from "vue";
import { RouterLink } from "vue-router";
import PublicFooter from "../components/PublicFooter.vue";
import privacyRaw from "../../PRIVACY.md?raw";

type ContentBlock =
  | { type: "paragraph"; text: string }
  | { type: "list"; items: string[] };

type PrivacySection = {
  title: string;
  blocks: ContentBlock[];
};

type InlineToken =
  | { type: "text"; text: string }
  | { type: "code"; text: string }
  | { type: "strong"; text: string }
  | { type: "link"; text: string; href: string };

const lightBrandLogoUrl = import.meta.env.VITE_BRAND_LOGO_LIGHT_URL as string | undefined;
const darkBrandLogoUrl = import.meta.env.VITE_BRAND_LOGO_DARK_URL as string | undefined;
const themeMode = ref<"light" | "dark">("dark");
const brandLogoUrl = computed(() =>
  themeMode.value === "light"
    ? lightBrandLogoUrl || darkBrandLogoUrl || ""
    : darkBrandLogoUrl || lightBrandLogoUrl || ""
);
let themeObserver: MutationObserver | null = null;

const lines = privacyRaw.split(/\r?\n/);

const pageTitle = computed(() => {
  const line = lines.find((entry) => entry.startsWith("# "));
  return line ? line.replace(/^#\s+/, "").trim() : "Privacy Policy";
});

const lastUpdated = computed(() => {
  const line = lines.find((entry) => entry.startsWith("Last updated:"));
  return line ? line.replace(/^Last updated:\s*/, "").trim() : "";
});

const intro = computed(() => {
  const start = lines.findIndex((line) => line.startsWith('ItemTraxx Co'));
  const end = lines.findIndex((line) => line.trim() === '---');
  if (start === -1 || end === -1 || end <= start) return [] as string[];
  return lines
    .slice(start, end)
    .map((line) => line.trim())
    .filter(Boolean);
});

const sections = computed<PrivacySection[]>(() => {
  const result: PrivacySection[] = [];
  let current: PrivacySection | null = null;
  let pendingList: string[] = [];

  const flushList = () => {
    if (current && pendingList.length) {
      current.blocks.push({ type: 'list', items: [...pendingList] });
      pendingList = [];
    }
  };

  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (!line || line === '---') {
      flushList();
      continue;
    }
    if (line.startsWith('# ') || line.startsWith('Last updated:')) continue;
    if (line.startsWith('## ')) {
      flushList();
      if (current) result.push(current);
      current = { title: line.replace(/^##\s+/, '').trim(), blocks: [] };
      continue;
    }
    if (!current) continue;
    if (line.startsWith('- ')) {
      pendingList.push(line.replace(/^-\s+/, '').trim());
      continue;
    }
    flushList();
    current.blocks.push({ type: 'paragraph', text: line });
  }

  flushList();
  if (current) result.push(current);
  return result;
});

const tokenizeInline = (text: string): InlineToken[] => {
  const tokens: InlineToken[] = [];
  const pattern = /`([^`]+)`|\*\*([^*]+)\*\*|\[([^\]]+)\]\(([^)]+)\)/g;
  let lastIndex = 0;

  for (const match of text.matchAll(pattern)) {
    const matchIndex = match.index ?? 0;
    if (matchIndex > lastIndex) {
      tokens.push({ type: "text", text: text.slice(lastIndex, matchIndex) });
    }

    if (match[1]) {
      tokens.push({ type: "code", text: match[1] });
    } else if (match[2]) {
      tokens.push({ type: "strong", text: match[2] });
    } else if (match[3] && match[4]) {
      tokens.push({ type: "link", text: match[3], href: match[4] });
    }

    lastIndex = matchIndex + match[0].length;
  }

  if (lastIndex < text.length) {
    tokens.push({ type: "text", text: text.slice(lastIndex) });
  }

  return tokens.length ? tokens : [{ type: "text", text }];
};

onMounted(() => {
  const syncTheme = () => {
    themeMode.value = document.documentElement.getAttribute("data-theme") === "light" ? "light" : "dark";
  };

  syncTheme();
  themeObserver = new MutationObserver(syncTheme);
  themeObserver.observe(document.documentElement, {
    attributes: true,
    attributeFilter: ["data-theme"],
  });
});

onUnmounted(() => {
  if (themeObserver) {
    themeObserver.disconnect();
    themeObserver = null;
  }
});
</script>

<style scoped>
.privacy-page {
  max-width: 1120px;
  padding-top: calc(2rem + env(safe-area-inset-top, 0px));
}

.brand-mark {
  display: inline-flex;
  align-items: center;
  text-decoration: none;
  margin-bottom: 0.45rem;
}

.brand-mark-full {
  height: 5.8rem;
  width: auto;
  object-fit: contain;
  display: block;
}

.privacy-container {
  width: 100%;
}

.privacy-footer-wrap {
  width: min(1280px, 92%);
  margin-left: auto;
  margin-right: auto;
  position: relative;
  z-index: 2;
}

.privacy-top-nav {
  display: flex;
  align-items: center;
  gap: 0.9rem;
  margin-bottom: 1.25rem;
}

.privacy-back-link {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 2.4rem;
  height: 2.4rem;
  border-radius: 999px;
  border: 1px solid rgba(77, 97, 122, 0.4);
  background: linear-gradient(180deg, rgba(31, 40, 54, 0.46) 0%, rgba(17, 23, 32, 0.34) 100%);
  color: #ffffff;
  text-decoration: none;
  backdrop-filter: blur(2px);
  transition: transform 0.16s ease, border-color 0.16s ease, background 0.16s ease;
}

.privacy-back-link:hover {
  transform: translateY(-1px);
  border-color: rgba(39, 196, 172, 0.58);
  background: linear-gradient(180deg, rgba(29, 66, 75, 0.62) 0%, rgba(16, 37, 48, 0.54) 100%);
  box-shadow: 0 16px 32px rgba(25, 194, 168, 0.14);
}

.privacy-back-link svg {
  width: 1rem;
  height: 1rem;
  fill: none;
  stroke: currentColor;
  stroke-linecap: round;
  stroke-linejoin: round;
  stroke-width: 2;
}

.privacy-breadcrumb,
.privacy-section-label,
.privacy-eyebrow {
  text-transform: uppercase;
  letter-spacing: 0.22em;
  font-size: 0.74rem;
  font-weight: 700;
  color: color-mix(in srgb, var(--text) 64%, var(--accent) 36%);
}

.privacy-hero {
  margin-bottom: 1.75rem;
  padding: 1.7rem 1.6rem;
  border-radius: 1rem;
  border: 2px solid color-mix(in srgb, var(--border) 58%, transparent);
  background: transparent;
  box-shadow: none;
}

.privacy-hero h1 {
  margin: 0.55rem 0 0.85rem;
  font-size: clamp(1.4rem, 3vw, 2.4rem);
  line-height: 0.96;
  letter-spacing: -0.05em;
}

.privacy-lead,
.privacy-intro p,
.privacy-content p,
.privacy-list li {
  color: color-mix(in srgb, var(--text) 84%, transparent);
  line-height: 1.72;
}

.privacy-intro p:last-child,
.privacy-content p:last-child,
.privacy-list:last-child {
  margin-bottom: 0;
}

.privacy-sections {
  display: grid;
  gap: 1rem;
}

.privacy-card {
  padding: 1.4rem 1.35rem;
  border-radius: 1rem;
  border: 2px solid color-mix(in srgb, var(--border) 58%, transparent);
  background: transparent;
  box-shadow: none;
}

.privacy-card h2 {
  margin: 0.55rem 0 0.9rem;
  font-size: clamp(1.2rem, 2vw, 1.7rem);
  letter-spacing: -0.03em;
}

.privacy-list {
  margin: 0;
  padding-left: 1.2rem;
}

.privacy-content :deep(a) {
  color: color-mix(in srgb, var(--text) 62%, var(--accent) 38%);
}

.privacy-content :deep(code),
.privacy-intro :deep(code) {
  padding: 0.12rem 0.34rem;
  border-radius: 0.38rem;
  background: color-mix(in srgb, var(--surface-2) 72%, transparent);
  color: var(--text);
  font-size: 0.92em;
}

@media (max-width: 720px) {
  .privacy-page {
    padding-top: calc(1.25rem + env(safe-area-inset-top, 0px));
  }

  .brand-mark {
    margin-bottom: 0.25rem;
  }

  .brand-mark-full {
    height: 3.9rem;
  }

  .privacy-hero,
  .privacy-card {
    padding: 1.15rem 1rem;
    border-radius: 1.15rem;
  }
}
</style>
