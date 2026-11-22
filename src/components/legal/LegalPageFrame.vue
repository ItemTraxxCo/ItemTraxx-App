<template>
  <div class="legal-page">
    <main class="legal-column">
      <RouterLink class="legal-back" to="/legal">&larr; Legal</RouterLink>
      <slot />
    </main>
    <div class="legal-footer-wrap"><PublicFooter /></div>
  </div>
</template>

<script setup lang="ts">
import { RouterLink } from "vue-router";
import PublicFooter from "../PublicFooter.vue";
</script>

<style scoped>
.legal-page { min-height: 100vh; padding: 2rem 1rem 3rem; }
.legal-column { width: min(760px, 100%); margin: 0 auto; }
.legal-back { display: inline-block; margin-bottom: 1.5rem; color: var(--muted); font-size: 0.9rem; text-decoration: none; }
.legal-back:hover { color: var(--text); }
.legal-footer-wrap { min-height: 32rem; contain: layout style; width: min(1280px, 92%); margin: 3rem auto 0; padding-top: 0.85rem; border-top: 3px solid color-mix(in srgb, var(--border) 72%, transparent); }
@media (min-width: 901px) and (max-width: 914px) { .legal-footer-wrap { min-height: 36rem; } }
@media (min-width: 915px) and (max-width: 919px) { .legal-footer-wrap { min-height: 34.5rem; } }
@media (min-width: 920px) and (max-width: 939px) { .legal-footer-wrap { min-height: 33rem; } }
@media (max-width: 900px) { .legal-footer-wrap { min-height: 55rem; } }
@media (max-width: 640px) { .legal-footer-wrap { min-height: 80rem; } }
</style>
