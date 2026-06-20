<template>
  <div class="legal-document-page">
    <main class="legal-document-shell">
      <RouterLink class="legal-document-back" to="/legal">Back to Legal Hub</RouterLink>
      <header>
        <h1>{{ title }}</h1>
        <p v-if="lastUpdated">Last updated: {{ lastUpdated }}</p>
      </header>

      <section v-for="section in sections" :key="section.title">
        <h2>{{ section.title }}</h2>
        <template v-for="(block, index) in section.blocks" :key="index">
          <p v-if="block.type === 'paragraph'">{{ block.text }}</p>
          <ul v-else>
            <li v-for="item in block.items" :key="item">{{ item }}</li>
          </ul>
        </template>
      </section>

      <PublicFooter />
    </main>
  </div>
</template>

<script setup lang="ts">
import { computed } from "vue";
import { RouterLink, useRoute } from "vue-router";
import PublicFooter from "../components/PublicFooter.vue";
import dpaRaw from "../../DPA.md?raw";
import studentPrivacyRaw from "../../STUDENT_PRIVACY.md?raw";

type Block = { type: "paragraph"; text: string } | { type: "list"; items: string[] };
type Section = { title: string; blocks: Block[] };

const route = useRoute();
const source = computed(() => route.name === "public-dpa" ? dpaRaw : studentPrivacyRaw);
const lines = computed(() => source.value.split(/\r?\n/));
const title = computed(() => lines.value.find((line) => line.startsWith("# "))?.slice(2).trim() ?? "Legal Document");
const lastUpdated = computed(() => lines.value.find((line) => line.startsWith("Last updated:"))?.replace("Last updated:", "").trim() ?? "");

const sections = computed<Section[]>(() => {
  const result: Section[] = [];
  let current: Section | null = null;
  let pendingList: string[] = [];
  let pendingParagraph: string[] = [];

  const flushParagraph = () => {
    if (!current || !pendingParagraph.length) return;
    current.blocks.push({
      type: "paragraph",
      text: pendingParagraph.join(" ").replace(/\*\*/g, ""),
    });
    pendingParagraph = [];
  };

  const flushList = () => {
    if (current && pendingList.length) current.blocks.push({ type: "list", items: [...pendingList] });
    pendingList = [];
  };

  for (const raw of lines.value) {
    const line = raw.trim();
    if (!line || line === "---") {
      flushParagraph();
      flushList();
      continue;
    }
    if (line.startsWith("# ") || line.startsWith("Last updated:")) continue;
    if (line.startsWith("## ")) {
      flushParagraph();
      flushList();
      if (current) result.push(current);
      current = { title: line.slice(3).trim(), blocks: [] };
      continue;
    }
    if (!current) current = { title: "Overview", blocks: [] };
    if (line.startsWith("- ")) {
      flushParagraph();
      pendingList.push(line.slice(2).trim());
    }
    else {
      flushList();
      pendingParagraph.push(line);
    }
  }
  flushParagraph();
  flushList();
  if (current) result.push(current);
  return result;
});
</script>

<style scoped>
.legal-document-page { min-height: 100vh; padding: 2rem 1rem 4rem; }
.legal-document-shell { width: min(880px, 100%); margin: 0 auto; }
.legal-document-back { display: inline-block; margin-bottom: 2rem; color: var(--accent); }
header, section { padding: 1.4rem; border: 1px solid var(--border); border-radius: 16px; }
section { margin-top: 1rem; }
h1, h2 { margin-top: 0; }
p, li { line-height: 1.65; }
header p { color: var(--muted); }
</style>
