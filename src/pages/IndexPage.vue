<template>
  <div class="index-page">
    <main class="index-container">
      <div class="index-heading-row">
        <h1>{{ selectedCategory }}</h1>
        <RouterLink class="index-about-link" to="/index/about">
          About the Index
          <svg viewBox="0 0 20 20" aria-hidden="true"><path d="M4 10h11M10 5l5 5-5 5" /></svg>
        </RouterLink>
      </div>

      <div class="index-toolbar">
        <nav class="index-categories" aria-label="Index categories">
          <button
            v-for="category in categories"
            :key="category"
            type="button"
            class="index-category-button"
            :class="{ 'is-active': selectedCategory === category }"
            :aria-current="selectedCategory === category ? 'page' : undefined"
            @click="selectedCategory = category"
          >
            {{ category }}
          </button>
        </nav>

        <div class="index-tools">
          <label class="index-search">
            <svg viewBox="0 0 20 20" aria-hidden="true"><circle cx="8.7" cy="8.7" r="5.7" /><path d="m13 13 4 4" /></svg>
            <span class="visually-hidden">Search the Index</span>
            <input v-model="searchText" type="search" placeholder="Search" autocomplete="off" />
            <button
              v-if="searchText"
              class="index-clear-search"
              type="button"
              aria-label="Clear search"
              @click="searchText = ''"
            >
              <svg viewBox="0 0 20 20" aria-hidden="true"><path d="m5 5 10 10M15 5 5 15" /></svg>
            </button>
          </label>

          <div class="index-filter-wrap">
            <button
              class="index-tool-button"
              type="button"
              aria-haspopup="true"
              :aria-expanded="filterOpen"
              @click="filterOpen = !filterOpen"
              @keydown.esc="filterOpen = false"
            >
              <span>Filter</span>
              <svg viewBox="0 0 20 20" aria-hidden="true"><path d="M3 5h14M6 10h8m-5 5h2" /></svg>
            </button>
            <div v-if="filterOpen" class="index-filter-menu" role="group" aria-label="Filter by format">
              <p>Format</p>
              <button
                v-for="format in formats"
                :key="format.value"
                type="button"
                :aria-pressed="selectedFormat === format.value"
                @click="selectedFormat = format.value"
              >
                <span>{{ format.label }}</span>
                <svg v-if="selectedFormat === format.value" viewBox="0 0 20 20" aria-hidden="true"><path d="m4 10 4 4 8-8" /></svg>
              </button>
            </div>
          </div>

          <label class="index-sort-control">
            <span>Sort</span>
            <select v-model="sortOrder" aria-label="Sort Index entries">
              <option value="newest">Newest</option>
              <option value="oldest">Oldest</option>
              <option value="title">A–Z</option>
            </select>
            <svg viewBox="0 0 20 20" aria-hidden="true"><path d="m5 7 5 5 5-5" /></svg>
          </label>

          <div class="index-view-toggle" role="group" aria-label="View layout">
            <button
              type="button"
              :class="{ 'is-active': layout === 'grid' }"
              :aria-pressed="layout === 'grid'"
              aria-label="Grid view"
              @click="layout = 'grid'"
            >
              <svg viewBox="0 0 20 20" aria-hidden="true"><rect x="2.5" y="2.5" width="6" height="6" rx="1" /><rect x="11.5" y="2.5" width="6" height="6" rx="1" /><rect x="2.5" y="11.5" width="6" height="6" rx="1" /><rect x="11.5" y="11.5" width="6" height="6" rx="1" /></svg>
            </button>
            <button
              type="button"
              :class="{ 'is-active': layout === 'list' }"
              :aria-pressed="layout === 'list'"
              aria-label="List view"
              @click="layout = 'list'"
            >
              <svg viewBox="0 0 20 20" aria-hidden="true"><path d="M7 4h10M7 10h10M7 16h10" /><circle cx="3.5" cy="4" r=".8" /><circle cx="3.5" cy="10" r=".8" /><circle cx="3.5" cy="16" r=".8" /></svg>
            </button>
          </div>
        </div>
      </div>

      <section
        v-if="visibleEntries.length"
        class="index-entry-grid"
        :class="{ 'is-list': layout === 'list' }"
        :aria-label="`${selectedCategory} Index entries`"
      >
        <article v-for="entry in visibleEntries" :key="entry.slug" class="index-entry">
          <RouterLink
            class="index-entry-link"
            :to="{ name: 'public-index-article', params: { articleSlug: entry.slug } }"
          >
            <div
              v-if="entry.image"
              class="index-cover index-cover-image"
              :data-category="entry.category"
            >
              <img :src="entry.image" :alt="`Cover for ${entry.title}`" loading="lazy" />
            </div>
            <div
              v-else
              class="index-cover"
              :data-category="entry.category"
              :data-cover-color="entry.coverColor"
              aria-hidden="true"
            >
            </div>

            <div class="index-entry-copy">
              <div v-if="layout === 'list'" class="index-list-kicker">{{ entry.format }}</div>
              <h2>{{ entry.title }}</h2>
              <p v-if="layout === 'list' && entry.summary" class="index-entry-summary">{{ entry.summary }}</p>
              <div class="index-entry-meta">
                <span>{{ entry.category }}</span>
                <span class="index-meta-divider" aria-hidden="true"></span>
                <time :datetime="entry.date || undefined">{{ formatIndexDate(entry.date) }}</time>
              </div>
            </div>
          </RouterLink>
        </article>
      </section>

      <section v-else class="index-empty-state" aria-live="polite">
        <div class="index-empty-mark" aria-hidden="true">
          <svg viewBox="0 0 40 40"><circle cx="17" cy="17" r="10" /><path d="m24.5 24.5 8 8" /></svg>
        </div>
        <h2>{{ searchText || selectedFormat !== 'all' ? 'No matches found' : 'More to come' }}</h2>
        <p>
          {{ searchText || selectedFormat !== 'all'
            ? 'Try another search or adjust the category and format filters.'
            : 'New writing, guides, and updates will appear here.' }}
        </p>
        <button v-if="searchText || selectedFormat !== 'all' || selectedCategory !== 'All'" type="button" @click="resetFilters">
          Clear filters
        </button>
      </section>

      <PublicFooter />
    </main>
  </div>
</template>

<script setup lang="ts">
import { computed, ref } from "vue";
import { RouterLink } from "vue-router";
import PublicFooter from "../components/PublicFooter.vue";
import {
  INDEX_CATEGORIES,
  formatIndexDate,
  getIndexEntries,
  type IndexFormat,
} from "../content/index/indexContent";
import "./index/index.css";

const categories = ["All", ...INDEX_CATEGORIES] as const;
const entries = getIndexEntries();
const selectedCategory = ref<(typeof categories)[number]>("All");
const selectedFormat = ref<"all" | IndexFormat>("all");
const searchText = ref("");
const sortOrder = ref<"newest" | "oldest" | "title">("newest");
const layout = ref<"grid" | "list">("grid");
const filterOpen = ref(false);

const formats: { value: "all" | IndexFormat; label: string }[] = [
  { value: "all", label: "All formats" },
  { value: "Article", label: "Articles" },
  { value: "Guide", label: "Guides" },
  { value: "Disclosure", label: "Disclosures" },
  { value: "Update", label: "Updates" },
];

const visibleEntries = computed(() => {
  const query = searchText.value.trim().toLowerCase();
  const filtered = entries.filter((entry) => {
    const matchesCategory = selectedCategory.value === "All" || entry.category === selectedCategory.value;
    const matchesFormat = selectedFormat.value === "all" || entry.format === selectedFormat.value;
    const searchableText = `${entry.title} ${entry.category} ${entry.format} ${entry.summary} ${entry.markdown}`.toLowerCase();
    return matchesCategory && matchesFormat && (!query || searchableText.includes(query));
  });

  return filtered.sort((a, b) => {
    if (sortOrder.value === "title") return a.title.localeCompare(b.title);
    const dateOrder = a.date.localeCompare(b.date);
    return sortOrder.value === "oldest" ? dateOrder : -dateOrder;
  });
});

const resetFilters = () => {
  selectedCategory.value = "All";
  selectedFormat.value = "all";
  searchText.value = "";
  sortOrder.value = "newest";
};
</script>
