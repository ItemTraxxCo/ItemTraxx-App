<template>
  <div class="index-article-page">
    <main v-if="entry" class="index-article-container">
      <div class="index-article-topline">
        <RouterLink class="index-back-link" to="/index">
          <svg viewBox="0 0 20 20" aria-hidden="true"><path d="M15 10H5m5 5-5-5 5-5" /></svg>
          All
        </RouterLink>
        <RouterLink class="index-about-link" to="/index/about">About the Index</RouterLink>
      </div>

      <article class="index-article-content">
        <div class="index-article-meta">
          <span>{{ entry.category }}</span>
          <span class="index-meta-divider" aria-hidden="true"></span>
          <time :datetime="entry.date || undefined">{{ formatIndexDate(entry.date) }}</time>
        </div>
        <h1>{{ entry.title }}</h1>
        <p v-if="entry.summary" class="index-article-deck">{{ entry.summary }}</p>

        <div v-if="entry.markdown" class="index-markdown-body" v-html="renderedMarkdown"></div>
        <div v-if="entry.markdown" class="index-article-endmark" aria-hidden="true"><span></span><span></span><span></span></div>
        <RouterLink class="index-return-link" to="/index">
          <svg viewBox="0 0 20 20" aria-hidden="true"><path d="M15 10H5m5 5-5-5 5-5" /></svg>
          Back to all writing
        </RouterLink>
      </article>
      <PublicFooter />
    </main>

    <main v-else class="index-article-container index-not-found">
      <RouterLink class="index-back-link" to="/index">
        <svg viewBox="0 0 20 20" aria-hidden="true"><path d="M15 10H5m5 5-5-5 5-5" /></svg>
        Back to Index
      </RouterLink>
      <p class="index-not-found-kicker">404 / NOT FOUND</p>
      <h1>This page isn’t in the Index.</h1>
      <p>It may have moved, or the address may be incorrect.</p>
      <RouterLink class="index-return-link" to="/index">Browse all writing</RouterLink>
    </main>
  </div>
</template>

<script setup lang="ts">
import { computed, watchEffect } from "vue";
import { RouterLink, useRoute } from "vue-router";
import PublicFooter from "../components/PublicFooter.vue";
import { formatIndexDate, getIndexEntry, renderIndexMarkdown } from "../content/index/indexContent";
import "./index/index.css";

const route = useRoute();
const entry = computed(() => getIndexEntry(String(route.params.articleSlug ?? "")));
const renderedMarkdown = computed(() => entry.value ? renderIndexMarkdown(entry.value.markdown) : "");

watchEffect(() => {
  document.title = entry.value ? `${entry.value.title} | ItemTraxx Index` : "Not Found | ItemTraxx Index";
});
</script>
