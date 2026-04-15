<template>
  <footer class="public-footer">
    <div class="footer-brand-block">
      <p class="footer-brand">©2026 ItemTraxx Co</p>
      <span class="footer-env footer-version">{{ releaseChannel }}</span>
      <span class="footer-version">v-{{ appVersion }}</span>
      <span v-if="showBranchName" class="footer-version footer-branch">{{ appBranch }}</span>
      <button
        type="button"
        class="footer-theme-toggle"
        :aria-label="themeMode === 'dark' ? 'Switch to light mode' : 'Switch to dark mode'"
        @click="toggleTheme"
      >
        <span class="footer-theme-toggle-kicker">Theme</span>
        <span class="footer-theme-toggle-label">{{ themeMode === "dark" ? "Dark" : "Light" }}</span>
        <span class="footer-theme-toggle-track" :data-theme="themeMode">
          <span class="footer-theme-toggle-thumb"></span>
        </span>
      </button>
    </div>
    <div class="footer-grid">
      <div class="footer-column">
        <p class="footer-heading">Product</p>
        <RouterLink to="/login">Login</RouterLink>
        <RouterLink to="/tenant/admin-login">Admin Login</RouterLink>
        <RouterLink to="/pricing">Pricing</RouterLink>
        <RouterLink to="/contact-sales">Contact Sales</RouterLink>
        <RouterLink to="/request-demo">Request Demo</RouterLink>
        <RouterLink to="/getting-started">Getting Started</RouterLink>
        <RouterLink to="/forgot-password">Forgot Password</RouterLink>
      </div>
      <div class="footer-column">
        <p class="footer-heading">Support</p>
        <RouterLink to="/contact-support">Contact Support</RouterLink>
        <RouterLink to="/security">Security</RouterLink>
        <RouterLink to="/report-security-issue">Report Security Issue</RouterLink>
        <RouterLink to="/trust">Trust</RouterLink>
        <RouterLink to="/changelog">Changelog</RouterLink>
        <RouterLink to="/faq">FAQ</RouterLink>
        <a href="https://status.itemtraxx.com/" target="_blank" rel="noreferrer">Status</a>
      </div>
      <div class="footer-column">
        <p class="footer-heading">Company</p>
        <RouterLink to="/contact">Contact</RouterLink>
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
import { onMounted, onUnmounted, ref } from "vue";
import { RouterLink } from "vue-router";

const appVersion = import.meta.env.VITE_GIT_COMMIT || "n/a";
const appBranch = import.meta.env.VITE_GIT_BRANCH || "n/a";
const runtimeEnvironment = (
  import.meta.env.VITE_SENTRY_ENVIRONMENT ||
  import.meta.env.MODE ||
  ""
).trim().toLowerCase();
const runtimeHostname =
  typeof window !== "undefined" ? window.location.hostname.trim().toLowerCase() : "";
const isDevHost =
  runtimeHostname === "dev.itemtraxx.com" || runtimeHostname.endsWith(".dev.itemtraxx.com");

const releaseChannel =
  isDevHost
    ? "Development"
    : runtimeEnvironment === "production"
    ? "Production"
    : runtimeEnvironment === "preview"
      ? "Preview"
      : runtimeEnvironment === "beta"
        ? "Beta"
        : "Development";

const showBranchName = !!appBranch && appBranch !== "n/a" && appBranch !== "main";

const themeMode = ref<"light" | "dark">("light");
let themeObserver: MutationObserver | null = null;

const syncThemeMode = () => {
  themeMode.value = document.documentElement.getAttribute("data-theme") === "dark" ? "dark" : "light";
};

const toggleTheme = () => {
  const next = themeMode.value === "dark" ? "light" : "dark";
  document.documentElement.setAttribute("data-theme", next);
  localStorage.setItem("itemtraxx-theme", next);
  themeMode.value = next;
};

onMounted(() => {
  syncThemeMode();
  themeObserver = new MutationObserver(syncThemeMode);
  themeObserver.observe(document.documentElement, {
    attributes: true,
    attributeFilter: ["data-theme"],
  });
});

onUnmounted(() => {
  themeObserver?.disconnect();
  themeObserver = null;
});
</script>

<style scoped>
.public-footer {
  width: min(1280px, 92vw);
  margin-top: 3.6rem;
  margin-left: auto;
  margin-right: auto;
  padding: 1rem 0 0;
  position: relative;
  left: 50%;
  transform: translateX(-50%);
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

.footer-branch {
  font-size: 0.84rem;
}

.footer-theme-toggle {
  margin-top: 0.25rem;
  display: inline-flex;
  align-items: center;
  gap: 0.48rem;
  padding: 0;
  border-radius: 0;
  border: none;
  background: transparent;
  color: inherit;
  font: inherit;
  cursor: pointer;
  transition: transform 160ms ease;
}

.footer-theme-toggle:hover,
.footer-theme-toggle:focus-visible {
  transform: translateY(-1px);
}

button.footer-theme-toggle:hover:not(:disabled) {
  background-color: transparent;
  border-color: transparent;
  box-shadow: none;
}

.footer-theme-toggle:focus-visible {
  outline: 2px solid color-mix(in srgb, var(--accent) 62%, transparent);
  outline-offset: 3px;
}

.footer-theme-toggle-kicker {
  font-size: 0.68rem;
  letter-spacing: 0.1em;
  text-transform: uppercase;
  opacity: 0.62;
}

.footer-theme-toggle-label {
  font-size: 0.76rem;
  font-weight: 600;
  opacity: 0.9;
}

.footer-theme-toggle-track {
  display: inline-flex;
  align-items: center;
  width: 2.05rem;
  height: 1.18rem;
  padding: 0.12rem;
  border-radius: 999px;
  background: color-mix(in srgb, var(--muted) 42%, transparent);
  transition: background-color 160ms ease;
}

.footer-theme-toggle-track[data-theme="dark"] {
  background: color-mix(in srgb, var(--accent) 54%, transparent);
}

.footer-theme-toggle-thumb {
  width: 0.84rem;
  height: 0.84rem;
  border-radius: 999px;
  background: #ffffff;
  box-shadow: 0 4px 10px rgba(4, 10, 22, 0.2);
  transform: translateX(0);
  transition: transform 160ms ease;
}

.footer-theme-toggle-track[data-theme="dark"] .footer-theme-toggle-thumb {
  transform: translateX(0.84rem);
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
  .public-footer {
    width: min(1280px, calc(100vw - 1.5rem));
  }

  .footer-grid {
    grid-template-columns: 1fr;
    gap: 1rem;
  }
}
</style>
