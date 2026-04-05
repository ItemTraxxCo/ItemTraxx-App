<template>
  <div class="getting-started-page">
    <div class="getting-started-orb getting-started-orb-one" aria-hidden="true"></div>
    <div class="getting-started-orb getting-started-orb-two" aria-hidden="true"></div>
    <div class="grid-noise" aria-hidden="true"></div>

    <main class="getting-started-container">
      <div class="page-nav-left getting-started-top-nav">
        <RouterLink class="getting-started-back-link" to="/" aria-label="Return to home">
          <svg viewBox="0 0 24 24" aria-hidden="true">
            <path d="M15 5 8 12l7 7" />
          </svg>
        </RouterLink>
        <span class="getting-started-breadcrumb">Getting Started</span>
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
import { RouterLink } from "vue-router";
import PublicFooter from "../components/PublicFooter.vue";
</script>

<style scoped>
.getting-started-page {
  position: relative;
  min-height: 100vh;
  min-height: 100dvh;
  overflow: clip;
  background:
    radial-gradient(circle at top left, rgba(25, 194, 168, 0.18), transparent 30%),
    radial-gradient(circle at bottom right, rgba(25, 67, 155, 0.22), transparent 38%),
    linear-gradient(180deg, #0e1420 0%, #0a0f18 100%);
  color: #f3f6fb;
}

.getting-started-orb {
  position: absolute;
  border-radius: 999px;
  filter: blur(70px);
  opacity: 0.22;
  pointer-events: none;
}

.getting-started-orb-one {
  top: 5rem;
  left: -3rem;
  width: 16rem;
  height: 16rem;
  background: rgba(25, 194, 168, 0.36);
}

.getting-started-orb-two {
  right: -4rem;
  top: 18rem;
  width: 20rem;
  height: 20rem;
  background: rgba(25, 67, 155, 0.34);
}

.getting-started-container {
  position: relative;
  z-index: 1;
  width: min(1120px, calc(100vw - 2rem));
  margin: 0 auto;
  padding: calc(1.4rem + env(safe-area-inset-top, 0px)) 0 3.5rem;
}

.getting-started-top-nav {
  margin-bottom: 1.5rem;
}

.getting-started-back-link {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 2.75rem;
  height: 2.75rem;
  border-radius: 999px;
  border: 1px solid rgba(142, 163, 193, 0.18);
  background: rgba(10, 15, 24, 0.68);
  color: inherit;
}

.getting-started-back-link svg {
  width: 1.25rem;
  height: 1.25rem;
  fill: none;
  stroke: currentColor;
  stroke-width: 1.8;
  stroke-linecap: round;
  stroke-linejoin: round;
}

.getting-started-breadcrumb {
  margin-left: 0.8rem;
  font-size: 0.9rem;
  color: rgba(230, 238, 248, 0.72);
}

.getting-started-hero,
.getting-started-card {
  border-radius: 28px;
  border: 1px solid rgba(118, 143, 181, 0.16);
  background: linear-gradient(180deg, rgba(15, 22, 34, 0.94) 0%, rgba(10, 15, 24, 0.98) 100%);
  box-shadow: 0 28px 80px rgba(3, 8, 18, 0.28);
}

.getting-started-hero {
  padding: 2rem;
  margin-bottom: 1.4rem;
}

.getting-started-eyebrow,
.getting-started-section-label {
  margin: 0 0 0.75rem;
  font-size: 0.78rem;
  font-weight: 700;
  letter-spacing: 0.16em;
  text-transform: uppercase;
  color: rgba(194, 206, 223, 0.7);
}

.getting-started-hero h1,
.getting-started-card h2 {
  margin: 0;
  letter-spacing: -0.04em;
}

.getting-started-hero h1 {
  max-width: 14ch;
  font-size: clamp(2.3rem, 5vw, 4.4rem);
  line-height: 0.98;
}

.getting-started-lead {
  max-width: 64ch;
  margin: 1rem 0 0;
  color: rgba(226, 233, 242, 0.78);
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
  min-height: 2.45rem;
  padding: 0.62rem 1rem;
  border-radius: 999px;
  font-weight: 700;
  text-decoration: none;
}

.getting-started-primary-link {
  background: linear-gradient(135deg, #18c3a6 0%, #2367f2 100%);
  color: #041019;
}

.getting-started-secondary-link {
  border: 1px solid rgba(123, 143, 176, 0.22);
  background: rgba(17, 24, 36, 0.64);
  color: #eef4fc;
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
  padding: 1.6rem;
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
  color: rgba(224, 232, 242, 0.76);
  line-height: 1.68;
}

.getting-started-help {
  margin-top: 1.25rem;
}

@media (max-width: 900px) {
  .getting-started-grid,
  .getting-started-grid-lower {
    grid-template-columns: 1fr;
  }

  .getting-started-container {
    width: min(100vw - 1.2rem, 1120px);
  }
}

@media (max-width: 640px) {
  .getting-started-container {
    padding-top: calc(1.2rem + env(safe-area-inset-top, 0px));
    padding-bottom: 3rem;
  }

  .getting-started-hero,
  .getting-started-card {
    padding: 1.2rem;
    border-radius: 22px;
  }

  .getting-started-hero h1 {
    max-width: none;
  }
}
</style>
