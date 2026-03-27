<template>
  <footer class="public-footer">
    <p class="footer-brand">©2026 ItemTraxx Co</p>
    <div class="footer-links">
      <span class="footer-version">v{{ appVersion }}</span>
      <RouterLink to="/pricing">Pricing</RouterLink>
      <RouterLink to="/contact-support">Support</RouterLink>
      <RouterLink to="/security">Security</RouterLink>
      <RouterLink to="/changelog">Changelog</RouterLink>
      <a href="https://status.itemtraxx.com/" target="_blank" rel="noreferrer">Status</a>
      <RouterLink to="/legal">Legal</RouterLink>
      <RouterLink to="/about">About</RouterLink>
      <a href="https://github.com/ItemTraxxCo" target="_blank" rel="noreferrer">GitHub</a>
    </div>
  </footer>
</template>

<script setup lang="ts">
import { RouterLink } from "vue-router";

const appVersion = import.meta.env.VITE_GIT_COMMIT || "n/a";
</script>

<style scoped>
.public-footer {
  margin-top: 3.6rem;
  padding: 0.8rem 0 0;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 1rem;
  color: rgba(216, 224, 235, 0.76);
}

.footer-brand {
  margin: 0;
  font-weight: 700;
  letter-spacing: -0.03em;
}

.footer-links {
  display: flex;
  align-items: center;
  gap: 1rem;
  flex-wrap: wrap;
}

.footer-version,
.footer-links a {
  color: rgba(216, 224, 235, 0.76);
  text-decoration: none;
}

.footer-links a:hover {
  color: #eafffb;
}

@media (max-width: 720px) {
  .public-footer {
    align-items: flex-start;
    flex-direction: column;
    gap: 0.8rem;
  }

  .footer-links {
    align-items: flex-start;
    flex-direction: column;
    gap: 0.55rem;
  }
}
</style>
