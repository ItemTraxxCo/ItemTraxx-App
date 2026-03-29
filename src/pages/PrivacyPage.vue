<template>
  <div class="privacy-page">
    <div class="privacy-orb privacy-orb-one" aria-hidden="true"></div>
    <div class="privacy-orb privacy-orb-two" aria-hidden="true"></div>
    <div class="grid-noise" aria-hidden="true"></div>

    <main class="privacy-container">
      <div class="page-nav-left privacy-top-nav">
        <RouterLink class="privacy-back-link" to="/" aria-label="Return to home">
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

      <PublicFooter />
    </main>
  </div>
</template>

<script setup lang="ts">
import { computed } from "vue";
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
</script>

<style scoped>
.privacy-page {
  position: relative;
  min-height: 100vh;
  min-height: 100dvh;
  width: 100%;
  max-width: 100%;
  margin-left: 0;
  padding:
    calc(2rem + env(safe-area-inset-top, 0px))
    0
    calc(3.5rem + env(safe-area-inset-bottom, 0px));
  background-color: #0a1120;
  color: #f5f7fb;
  overflow-x: hidden;
}

.privacy-page::before {
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

.privacy-orb {
  position: absolute;
  border-radius: 999px;
  filter: blur(40px);
  opacity: 0.38;
  pointer-events: none;
}

.privacy-orb-one {
  width: 20rem;
  height: 20rem;
  top: 5rem;
  left: -6rem;
  background: rgba(30, 202, 183, 0.24);
}

.privacy-orb-two {
  width: 24rem;
  height: 24rem;
  top: 9rem;
  right: -8rem;
  background: rgba(38, 104, 226, 0.2);
}

.privacy-container {
  position: relative;
  z-index: 1;
  width: min(1120px, calc(100% - 2rem));
  margin: 0 auto;
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
  width: 2.6rem;
  height: 2.6rem;
  border-radius: 999px;
  border: 1px solid rgba(140, 157, 189, 0.24);
  background: rgba(9, 17, 31, 0.58);
  color: #f5f7fb;
  text-decoration: none;
  backdrop-filter: blur(18px);
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
  color: rgba(155, 231, 220, 0.78);
}

.privacy-hero {
  margin-bottom: 1.75rem;
  padding: 1.7rem 1.6rem;
  border-radius: 1.6rem;
  border: 1px solid rgba(120, 136, 169, 0.18);
  background: rgba(13, 21, 36, 0.72);
  box-shadow: 0 28px 80px rgba(3, 8, 18, 0.38);
  backdrop-filter: blur(18px);
}

.privacy-hero h1 {
  margin: 0.55rem 0 0.85rem;
  font-size: clamp(2.2rem, 4vw, 3.6rem);
  line-height: 0.96;
  letter-spacing: -0.05em;
}

.privacy-lead,
.privacy-intro p,
.privacy-content p,
.privacy-list li {
  color: rgba(230, 236, 247, 0.82);
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
  border-radius: 1.35rem;
  border: 1px solid rgba(120, 136, 169, 0.18);
  background: rgba(13, 21, 36, 0.72);
  box-shadow: 0 28px 80px rgba(3, 8, 18, 0.28);
  backdrop-filter: blur(18px);
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
  color: #7de7d6;
}

.privacy-content :deep(code),
.privacy-intro :deep(code) {
  padding: 0.12rem 0.34rem;
  border-radius: 0.38rem;
  background: rgba(255, 255, 255, 0.08);
  color: #f5f7fb;
  font-size: 0.92em;
}

@media (max-width: 720px) {
  .privacy-page {
    padding-top: calc(1.25rem + env(safe-area-inset-top, 0px));
  }

  .privacy-container {
    width: min(100%, calc(100% - 1.25rem));
  }

  .privacy-hero,
  .privacy-card {
    padding: 1.15rem 1rem;
    border-radius: 1.15rem;
  }
}
</style>
