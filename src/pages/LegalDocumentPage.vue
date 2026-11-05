<template>
  <LegalPageFrame>
    <p v-if="loadState === 'error'" role="alert">
      We couldn't load this document. Refresh the page, or email
      <a href="mailto:legal@itemtraxx.com">legal@itemtraxx.com</a>.
    </p>
    <article v-else class="legal-prose" :aria-busy="loadState === 'loading'" @click="handleClick">
      <LegalHtml :fragment="fragment" />
    </article>
  </LegalPageFrame>
</template>

<script setup lang="ts">
import { nextTick, ref, watch } from "vue";
import { useRouter } from "vue-router";
import LegalHtml from "../components/legal/LegalHtml.vue";
import LegalPageFrame from "../components/legal/LegalPageFrame.vue";
import { getLegalDocument } from "../legal/documents";
import { loadLegalMarkdown } from "../legal/sources";

const props = defineProps<{ docSlug: string }>();
const router = useRouter();

const fragment = ref<DocumentFragment | null>(null);
const loadState = ref<"loading" | "ready" | "error">("loading");
let loadToken = 0;

const load = async () => {
  const token = ++loadToken;
  const doc = getLegalDocument(props.docSlug);
  fragment.value = null;
  if (!doc) {
    loadState.value = "error";
    return;
  }
  loadState.value = "loading";
  try {
    // marked and DOMPurify load only with this page, never with the app shell.
    const [markdown, { renderLegalMarkdown }] = await Promise.all([
      loadLegalMarkdown(doc),
      import("../legal/markdown"),
    ]);
    if (token !== loadToken) return;
    const result = renderLegalMarkdown(markdown);
    if (import.meta.env.DEV && result.unresolvedTokens.length) {
      console.warn(`[legal] ${doc.slug} has unresolved tokens:`, result.unresolvedTokens.join(", "));
    }
    fragment.value = result.body;
    loadState.value = "ready";
    await nextTick();
    const hash = router.currentRoute.value.hash;
    if (hash) document.getElementById(decodeURIComponent(hash.slice(1)))?.scrollIntoView();
  } catch {
    if (token === loadToken) loadState.value = "error";
  }
};

watch(() => props.docSlug, load, { immediate: true });

// Internal links go through the router instead of a full page load.
const handleClick = (event: MouseEvent) => {
  if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
  const anchor = (event.target as HTMLElement | null)?.closest<HTMLAnchorElement>("a[data-legal-link]");
  const kind = anchor?.getAttribute("data-legal-link");
  if (!anchor || (kind !== "route" && kind !== "anchor")) return;
  event.preventDefault();
  void router.push(anchor.getAttribute("href") ?? "/legal");
};
</script>

<style scoped>
.legal-prose { font-size: 0.97rem; line-height: 1.7; overflow-wrap: break-word; }
.legal-prose :deep(h1) { margin: 0 0 1rem; font-size: 2rem; line-height: 1.2; letter-spacing: -0.02em; }
.legal-prose :deep(h2) { margin: 2.25rem 0 0.5rem; font-size: 1.3rem; line-height: 1.3; scroll-margin-top: 1rem; }
.legal-prose :deep(h3) { margin: 1.6rem 0 0.4rem; font-size: 1.08rem; scroll-margin-top: 1rem; }
.legal-prose :deep(h4) { margin: 1.2rem 0 0.3rem; font-size: 1rem; scroll-margin-top: 1rem; }
.legal-prose :deep(p) { margin: 0.75rem 0; }
.legal-prose :deep(ul), .legal-prose :deep(ol) { margin: 0.75rem 0; padding-left: 1.4rem; }
.legal-prose :deep(li) { margin: 0.3rem 0; }
.legal-prose :deep(a) { color: var(--accent); text-decoration: underline; text-underline-offset: 0.18em; }
.legal-prose :deep(code) { padding: 0.1em 0.35em; border-radius: 4px; background: var(--surface-3); font-size: 0.88em; }
.legal-prose :deep(pre) { margin: 1rem 0; padding: 1rem; overflow-x: auto; border: 1px solid var(--border); border-radius: 6px; background: var(--surface-2); }
.legal-prose :deep(pre code) { padding: 0; background: none; }
.legal-prose :deep(blockquote) { margin: 1rem 0; padding: 0.1rem 1rem; border-left: 3px solid var(--border); color: var(--muted); }
.legal-prose :deep(hr) { margin: 2rem 0; border: 0; border-top: 1px solid var(--border); }
.legal-prose :deep(mark.legal-pending) { padding: 0 0.25em; border-radius: 3px; background: #f5d76e; color: #1a1a1a; }
.legal-prose :deep(.legal-table-wrap) { margin: 1rem 0; overflow-x: auto; }
.legal-prose :deep(table) { width: 100%; min-width: 520px; border-collapse: collapse; font-size: 0.88rem; line-height: 1.5; }
.legal-prose :deep(th), .legal-prose :deep(td) { padding: 0.5rem 0.75rem; text-align: left; vertical-align: top; border: 1px solid var(--border); }
.legal-prose :deep(th) { background: var(--surface-2); font-weight: 600; }
@media print {
  .legal-prose :deep(.legal-table-wrap) { overflow: visible; }
  .legal-prose :deep(table) { min-width: 0; }
}
</style>
