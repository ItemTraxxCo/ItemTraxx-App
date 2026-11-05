<template>
  <LegalPageFrame>
    <h1>Legal</h1>
    <ul class="legal-list">
      <li v-for="doc in docs" :key="doc.slug"><RouterLink :to="doc.path">{{ doc.title }}</RouterLink></li>
    </ul>
    <p class="legal-contact">
      Questions: <a href="mailto:legal@itemtraxx.com">legal@itemtraxx.com</a>
    </p>
  </LegalPageFrame>
</template>

<script setup lang="ts">
import { RouterLink } from "vue-router";
import LegalPageFrame from "../components/legal/LegalPageFrame.vue";
import { LEGAL_DOCUMENTS } from "../legal/documents";

const docs = LEGAL_DOCUMENTS;
</script>

<style scoped>
h1 { margin: 0 0 1rem; font-size: 2rem; letter-spacing: -0.02em; }
.legal-list { margin: 0; padding-left: 1.25rem; line-height: 2; }
a { color: var(--accent); }
.legal-contact { margin-top: 1.5rem; color: var(--muted); }
</style>
