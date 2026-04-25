<template>
  <div class="page getting-started-page">
    <main class="getting-started-container">
      <RouterLink class="brand-mark" to="/" aria-label="ItemTraxx home">
        <img v-if="brandLogoUrl" class="brand-mark-full" :src="brandLogoUrl" alt="ItemTraxx Co" />
      </RouterLink>

      <div class="page-nav-left getting-started-top-nav">
        <RouterLink class="getting-started-back-link" to="/" aria-label="Return to home" @click.prevent="$router.back()">
          <svg viewBox="0 0 24 24" aria-hidden="true">
            <path d="M15 5 8 12l7 7" />
          </svg>
        </RouterLink>
        <span class="getting-started-breadcrumb"> </span>
      </div>

      <section class="getting-started-hero">
        <p class="getting-started-eyebrow">Start using ItemTraxx</p>
        <h1>Get up and running without guessing your way through setup.</h1>
        <p class="getting-started-lead">
          This page walks through the normal first steps for new ItemTraxx users and admins,
          from account access to the first checkout. It is meant to get someone moving quickly,
          not replace full documentation.
        </p>
        <div class="getting-started-actions">
          <RouterLink class="getting-started-primary-link" to="/login">Go to login</RouterLink>
          <RouterLink class="getting-started-secondary-link" to="/contact-support">Contact support</RouterLink>
        </div>
      </section>

      <section class="getting-started-grid">
        <article class="getting-started-card getting-started-card-wide">
          <p class="getting-started-section-label">Step 1</p>
          <h2>Sign in with the right page for your role.</h2>
          <ul class="getting-started-list">
            <li>
              <strong>Borrowers and regular tenant access</strong>
              <span>Use the main <RouterLink to="/login">sign in page</RouterLink> with your access code and password.</span>
            </li>
            <li>
              <strong>Tenant and district admins</strong>
              <span>Use the dedicated <RouterLink to="/tenant/admin-login">admin sign in</RouterLink> page with email and password.</span>
            </li>
            <li>
              <strong>Forgot your password?</strong>
              <span>Use <RouterLink to="/forgot-password">forgot password</RouterLink> to request a reset link.</span>
            </li>
          </ul>
        </article>

        <article class="getting-started-card">
          <p class="getting-started-section-label">Step 2</p>
          <h2>Confirm your account is ready.</h2>
          <ul class="getting-started-list compact-list">
            <li>
              <strong>Credentials</strong>
              <span>Make sure you are using the correct access code, email, and password for your role.</span>
            </li>
            <li>
              <strong>Tenant access</strong>
              <span>If your account is disabled or not assigned yet, contact your admin or support.</span>
            </li>
            <li>
              <strong>Browser/device issues</strong>
              <span>If sign in loops or expires unexpectedly, refresh once and try again before contacting support.</span>
            </li>
          </ul>
        </article>
      </section>

      <section class="getting-started-grid getting-started-grid-lower">
        <article class="getting-started-card">
          <p class="getting-started-section-label">Step 3</p>
          <h2>Run your first checkout or return.</h2>
          <ul class="getting-started-list compact-list">
            <li>
              <strong>Load the borrower</strong>
              <span>Enter or scan the borrower ID to load the borrower.</span>
            </li>
            <li>
              <strong>Scan the item</strong>
              <span>Scan the item barcode or enter it manually if needed.</span>
            </li>
            <li>
              <strong>Review result</strong>
              <span>ItemTraxx confirms whether the transaction succeeded or whether the item is already checked out.</span>
            </li>
          </ul>
        </article>

        <article class="getting-started-card">
          <p class="getting-started-section-label">Step 4</p>
          <h2>Use admin tools if you manage inventory.</h2>
          <ul class="getting-started-list compact-list">
            <li>
              <strong>Borrowers</strong>
              <span>Create, import, archive, and restore borrower records from admin tools.</span>
            </li>
            <li>
              <strong>Inventory</strong>
              <span>Add, update, archive, and restore items as inventory changes over time.</span>
            </li>
            <li>
              <strong>Logs and stats</strong>
              <span>Use logs, usage stats, and audit visibility to review activity and troubleshoot issues.</span>
            </li>
          </ul>
        </article>
      </section>

      <section class="getting-started-help">
        <article class="getting-started-card getting-started-card-wide">
          <p class="getting-started-section-label">Need help?</p>
          <h2>When to use support instead of guessing.</h2>
          <p>
            If you cannot sign in, your account is not assigned correctly, a reset email never arrives,
            or checkout behavior does not match what you expect, use
            <RouterLink to="/contact-support">Contact Support</RouterLink>.
            For account setup, pricing, or demos, use <RouterLink to="/contact-sales">Contact Sales</RouterLink>. If you have any
            other questions or issues, please reach out to our support team.
          </p>
        </article>
      </section>

      <PublicFooter />
    </main>
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref } from "vue";
import { RouterLink } from "vue-router";
import PublicFooter from "../components/PublicFooter.vue";

const lightBrandLogoUrl = import.meta.env.VITE_BRAND_LOGO_LIGHT_URL as string | undefined;
const darkBrandLogoUrl = import.meta.env.VITE_BRAND_LOGO_DARK_URL as string | undefined;
const themeMode = ref<"light" | "dark">("dark");
const brandLogoUrl = computed(() =>
  themeMode.value === "light"
    ? lightBrandLogoUrl || darkBrandLogoUrl || ""
    : darkBrandLogoUrl || lightBrandLogoUrl || ""
);
let themeObserver: MutationObserver | null = null;

onMounted(() => {
  const syncTheme = () => {
    themeMode.value = document.documentElement.getAttribute("data-theme") === "light" ? "light" : "dark";
  };
  syncTheme();
  themeObserver = new MutationObserver(syncTheme);
  themeObserver.observe(document.documentElement, {
    attributes: true,
    attributeFilter: ["data-theme"],
  });
});

onUnmounted(() => {
  if (themeObserver) {
    themeObserver.disconnect();
    themeObserver = null;
  }
});
</script>

<style scoped>
.getting-started-page {
  max-width: 1080px;
  padding-top: calc(2rem + env(safe-area-inset-top, 0px));
}

.getting-started-container {
  width: 100%;
}

.brand-mark {
  display: inline-flex;
  align-items: center;
  text-decoration: none;
  margin-bottom: 0.45rem;
}

.brand-mark-full {
  height: 5.8rem;
  width: auto;
  object-fit: contain;
  display: block;
}

.getting-started-top-nav {
  margin-bottom: 1rem;
}

.getting-started-back-link {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 2.4rem;
  height: 2.4rem;
  border-radius: 999px;
  border: 1px solid var(--border);
  background: var(--surface);
  color: var(--text);
  text-decoration: none;
  transition: transform 0.16s ease, border-color 0.16s ease, background 0.16s ease;
}

.getting-started-back-link:hover {
  text-decoration: none;
  transform: translateY(-1px);
  border-color: var(--text);
  background: var(--surface-2);
}

.getting-started-back-link svg {
  width: 1.2rem;
  height: 1.2rem;
  fill: none;
  stroke: currentColor;
  stroke-width: 2.2;
  stroke-linecap: round;
  stroke-linejoin: round;
}

.getting-started-breadcrumb {
  color: var(--muted);
  font-size: 0.95rem;
}

.getting-started-hero {
  display: grid;
  gap: 0.65rem;
  margin-bottom: 1.4rem;
}

.getting-started-eyebrow,
.getting-started-section-label {
  margin: 0 0 0.75rem;
  font-size: 0.78rem;
  font-weight: 700;
  letter-spacing: 0.16em;
  text-transform: uppercase;
  color: inherit;
  opacity: 0.72;
}

.getting-started-hero h1,
.getting-started-card h2 {
  margin: 0;
  letter-spacing: -0.04em;
}

.getting-started-hero h1 {
  max-width: 14ch;
  font-size: clamp(1.4rem, 3vw, 2.4rem);
  line-height: 0.98;
}

.getting-started-lead {
  max-width: 64ch;
  margin: 1rem 0 0;
  color: inherit;
  opacity: 0.82;
  line-height: 1.72;
}

.getting-started-actions {
  display: flex;
  flex-wrap: wrap;
  gap: 0.85rem;
  margin-top: 1.4rem;
}

.getting-started-primary-link,
.getting-started-secondary-link {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  min-height: 2.15rem;
  padding: 0.46rem 0.82rem;
  border-radius: 999px;
  font-size: 0.9rem;
  font-weight: 700;
  text-decoration: none;
}

.getting-started-primary-link {
  background: var(--text);
  color: var(--page-bg);
  border: 1px solid var(--text);
}

.getting-started-secondary-link {
  border: 1px solid var(--border);
  background: var(--surface);
  color: var(--text);
}

.getting-started-primary-link:hover,
.getting-started-secondary-link:hover {
  text-decoration: none;
  transform: translateY(-1px);
}

.getting-started-primary-link:hover {
  background: color-mix(in srgb, var(--text) 92%, var(--surface) 8%);
}

.getting-started-secondary-link:hover {
  border-color: var(--text);
  background: var(--surface-2);
}

.getting-started-grid {
  display: grid;
  grid-template-columns: 1.2fr 0.8fr;
  gap: 1.25rem;
  margin-top: 1.25rem;
}

.getting-started-grid-lower {
  grid-template-columns: repeat(2, minmax(0, 1fr));
}

.getting-started-card {
  padding: 0;
}

.getting-started-grid .getting-started-card {
  border: 1.2px solid color-mix(in srgb, var(--border) 78%, transparent);
  border-radius: 14px;
  padding: 1rem;
}

.getting-started-list {
  display: grid;
  gap: 1rem;
  margin: 1.1rem 0 0;
  padding: 0;
  list-style: none;
}

.getting-started-list li {
  display: grid;
  gap: 0.24rem;
}

.getting-started-list strong {
  font-size: 1rem;
}

.getting-started-list span,
.getting-started-help p {
  color: inherit;
  opacity: 0.82;
  line-height: 1.68;
}

.getting-started-help {
  margin-top: 1.25rem;
  padding-top: 1rem;
  border-top: 1px solid color-mix(in srgb, var(--border) 78%, transparent);
}

.getting-started-page :deep(.public-footer) {
  margin-top: 5rem;
}

@media (max-width: 900px) {
  .getting-started-grid,
  .getting-started-grid-lower {
    grid-template-columns: 1fr;
  }
}

@media (max-width: 640px) {
  .getting-started-page {
    padding-top: calc(1.25rem + env(safe-area-inset-top, 0px));
  }

  .brand-mark {
    margin-bottom: 0.25rem;
  }

  .brand-mark-full {
    height: 3.9rem;
  }

  .getting-started-hero h1 {
    max-width: none;
  }
}
</style>
