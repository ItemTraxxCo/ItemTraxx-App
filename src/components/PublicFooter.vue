<template>
  <footer class="public-footer">
    <div class="footer-brand-block">
      <p class="footer-brand">©2026 ItemTraxx Co</p>
      <span class="footer-env footer-version">{{ releaseChannel }}</span>
      <span class="footer-version">v-{{ appVersion }}</span>

    </div>
    <div class="footer-grid">
      <div class="footer-column">
        <p class="footer-heading">Product</p>
        <RouterLink to="/login">Login</RouterLink>
        <RouterLink to="/tenant/admin-login">Admin Login</RouterLink>
        <RouterLink to="/pricing">Pricing</RouterLink>
        <RouterLink to="/contact-sales">Contact Sales</RouterLink>
        <RouterLink to="/forgot-password">Forgot Password</RouterLink>
      </div>
      <div class="footer-column">
        <p class="footer-heading">Support</p>
        <RouterLink to="/contact-support">Support</RouterLink>
        <RouterLink to="/security">Security</RouterLink>
        <RouterLink to="/report-security-issue">Report Security Issue</RouterLink>
        <RouterLink to="/trust">Trust</RouterLink>
        <RouterLink to="/changelog">Changelog</RouterLink>
        <RouterLink to="/faq">FAQ</RouterLink>
        <a href="https://status.itemtraxx.com/" target="_blank" rel="noreferrer">Status</a>
      </div>
      <div class="footer-column">
        <p class="footer-heading">Company</p>
        <RouterLink to="/legal">Legal</RouterLink>
        <RouterLink to="/privacy">Privacy</RouterLink>
        <RouterLink to="/cookies">Cookies</RouterLink>
        <RouterLink to="/accessibility">Accessibility</RouterLink>
        <RouterLink to="/about">About</RouterLink>
        <a href="https://github.com/ItemTraxxCo" target="_blank" rel="noreferrer">GitHub</a>
      </div>
    </div>
  </footer>
</template>

<script setup lang="ts">
import { RouterLink } from "vue-router";

const appVersion = import.meta.env.VITE_GIT_COMMIT || "n/a";
const runtimeEnvironment = (
  import.meta.env.VITE_SENTRY_ENVIRONMENT ||
  import.meta.env.MODE ||
  ""
).trim().toLowerCase();

const releaseChannel =
  runtimeEnvironment === "production"
    ? "Production"
    : runtimeEnvironment === "preview"
      ? "Preview"
      : runtimeEnvironment === "beta"
        ? "Beta"
        : "Development";
</script>

<style scoped>
.public-footer {
  margin-top: 3.6rem;
  padding: 1rem 0 0;
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 2rem;
  color: inherit;
}

.footer-brand-block {
  display: flex;
  flex-direction: column;
  gap: 0.35rem;
  min-width: 12rem;
}

.footer-brand {
  margin: 0;
  font-weight: 700;
  letter-spacing: -0.03em;
}

.footer-grid {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 1.5rem 2.5rem;
  flex: 1;
}

.footer-column {
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  gap: 0.45rem;
}

.footer-heading {
  margin: 0 0 0.2rem;
  font-size: 0.72rem;
  font-weight: 700;
  letter-spacing: 0.12em;
  text-transform: uppercase;
  opacity: 0.58;
}

.footer-version,
.footer-column a {
  color: inherit;
  opacity: 0.78;
  text-decoration: none;
}

.footer-brand {
  opacity: 0.88;
}

.footer-column a:hover {
  color: var(--link-color);
  opacity: 1;
}

@media (max-width: 900px) {
  .public-footer {
    flex-direction: column;
    gap: 1rem;
  }

  .footer-grid {
    width: 100%;
    grid-template-columns: repeat(2, minmax(0, 1fr));
    gap: 1.2rem 1.8rem;
  }
}

@media (max-width: 640px) {
  .footer-grid {
    grid-template-columns: 1fr;
    gap: 1rem;
  }
}
</style>
