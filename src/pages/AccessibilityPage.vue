<template>
  <div class="accessibility-page">
    <div class="accessibility-orb accessibility-orb-one" aria-hidden="true"></div>
    <div class="accessibility-orb accessibility-orb-two" aria-hidden="true"></div>
    <div class="grid-noise" aria-hidden="true"></div>

    <main class="accessibility-container">
      <div class="page-nav-left accessibility-top-nav">
        <RouterLink class="accessibility-back-link" to="/" aria-label="Return to home">
          <svg viewBox="0 0 24 24" aria-hidden="true">
            <path d="M15 5 8 12l7 7" />
          </svg>
        </RouterLink>
        <span class="accessibility-breadcrumb">Accessibility</span>
      </div>

      <section class="accessibility-hero">
        <p class="accessibility-eyebrow">ItemTraxx accessibility</p>
        <h1>Accessibility practices and current product expectations.</h1>
        <p class="accessibility-lead">
          ItemTraxx is intended to be usable across modern desktop and mobile environments, and we
          treat accessibility as part of product quality. This page describes the current approach,
          the areas we pay attention to, and how to report accessibility issues.
        </p>
      </section>

      <section class="accessibility-grid">
        <article class="accessibility-card accessibility-card-emphasis">
          <p class="accessibility-section-label">Current Focus</p>
          <h2>What we actively try to keep accessible.</h2>
          <ul class="accessibility-list">
            <li v-for="item in currentFocus" :key="item.title">
              <strong>{{ item.title }}</strong>
              <span>{{ item.description }}</span>
            </li>
          </ul>
        </article>

        <article class="accessibility-card">
          <p class="accessibility-section-label">Scope</p>
          <h2>Where this applies.</h2>
          <ul class="accessibility-list">
            <li v-for="item in scopeAreas" :key="item.title">
              <strong>{{ item.title }}</strong>
              <span>{{ item.description }}</span>
            </li>
          </ul>
        </article>
      </section>

      <section class="accessibility-grid accessibility-grid-compact accessibility-grid-footer-gap">
        <article class="accessibility-card accessibility-card-emphasis">
          <p class="accessibility-section-label">Known Reality</p>
          <h2>What this page does and does not claim.</h2>
          <ul class="accessibility-list">
            <li v-for="item in limitations" :key="item.title">
              <strong>{{ item.title }}</strong>
              <span>{{ item.description }}</span>
            </li>
          </ul>
        </article>

        <article class="accessibility-card">
          <p class="accessibility-section-label">Contact</p>
          <h2>How to report an accessibility issue.</h2>
          <p>
            If you run into an accessibility issue in ItemTraxx, report it through
            <RouterLink to="/contact-support">Contact Support</RouterLink>
            or email
            <a href="mailto:support@itemtraxx.com">support@itemtraxx.com</a>.
          </p>
          <p>
            Include the page, device, browser, and what you were trying to do. That makes the issue
            easier for us to reproduce and fix.
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

const currentFocus = [
  {
    title: "Readable contrast and layout",
    description:
      "We try to keep public and operational pages readable across light and dark themes, desktop, and mobile layouts.",
  },
  {
    title: "Keyboard-usable controls",
    description:
      "Navigation, menus, dialogs, and primary actions are intended to remain usable through standard keyboard interaction where applicable.",
  },
  {
    title: "Semantic structure",
    description:
      "Pages are built with headings, links, buttons, and related structure intended to make the interface more understandable to assistive technologies.",
  },
  {
    title: "Responsive behavior",
    description:
      "We pay attention to layout overflow, viewport behavior, and mobile-safe interactions so the product remains usable on smaller screens.",
  },
];

const scopeAreas = [
  {
    title: "Public pages",
    description:
      "Landing, pricing, support, trust, legal, privacy, security, changelog, FAQ, and related public routes.",
  },
  {
    title: "Authenticated workflows",
    description:
      "Login, checkout, borrower management, inventory management, and related admin flows.",
  },
  {
    title: "Core interactions",
    description:
      "Forms, dialogs, tables, menus, and route transitions that affect day-to-day use of the product.",
  },
];

const limitations = [
  {
    title: "Not a certification page",
    description:
      "This page describes current accessibility practices and intent. It is not a statement of formal certification or an exhaustive conformance claim.",
  },
  {
    title: "Ongoing work",
    description:
      "Accessibility quality depends on continued review as the product evolves. Some issues may still exist and should be reported when found.",
  },
  {
    title: "Operational priority",
    description:
      "When an accessibility issue blocks real product use, we treat it as a product-quality issue, not just a cosmetic bug.",
  },
];
</script>

<style scoped>
.accessibility-page {
  position: relative;
  min-height: 100vh;
  min-height: 100dvh;
  width: 100%;
  max-width: 100%;
  margin-left: 0;
  padding:
    calc(2rem + env(safe-area-inset-top, 0px))
    0
    calc(3.5rem + env(safe-area-inset-bottom, 0px));
  background-color: #0a1120;
  color: #f5f7fb;
  overflow-x: hidden;
}

.accessibility-page::before {
  content: "";
  position: fixed;
  inset: 0;
  z-index: 0;
  background:
    radial-gradient(circle at 14% 18%, rgba(25, 194, 168, 0.16), transparent 34%),
    radial-gradient(circle at 83% 10%, rgba(25, 67, 155, 0.18), transparent 31%),
    linear-gradient(180deg, #09111f 0%, #0d1524 48%, #0a1120 100%);
  pointer-events: none;
}

.accessibility-orb {
  position: absolute;
  border-radius: 999px;
  filter: blur(40px);
  opacity: 0.38;
  pointer-events: none;
}

.accessibility-orb-one {
  width: 20rem;
  height: 20rem;
  top: 5rem;
  left: -6rem;
  background: rgba(30, 202, 183, 0.24);
}

.accessibility-orb-two {
  width: 24rem;
  height: 24rem;
  top: 9rem;
  right: -8rem;
  background: rgba(38, 104, 226, 0.2);
}

.accessibility-container {
  position: relative;
  z-index: 1;
  width: min(1120px, calc(100% - 2rem));
  margin: 0 auto;
}

.accessibility-top-nav {
  display: flex;
  align-items: center;
  gap: 0.9rem;
  margin-bottom: 1.25rem;
}

.accessibility-back-link {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 2.6rem;
  height: 2.6rem;
  border-radius: 999px;
  border: 1px solid rgba(140, 157, 189, 0.24);
  background: rgba(9, 17, 31, 0.58);
  color: #f5f7fb;
  text-decoration: none;
  backdrop-filter: blur(18px);
}

.accessibility-back-link svg {
  width: 1rem;
  height: 1rem;
  fill: none;
  stroke: currentColor;
  stroke-linecap: round;
  stroke-linejoin: round;
  stroke-width: 2;
}

.accessibility-breadcrumb,
.accessibility-section-label,
.accessibility-eyebrow {
  text-transform: uppercase;
  letter-spacing: 0.22em;
  font-size: 0.74rem;
  font-weight: 700;
  color: rgba(155, 231, 220, 0.78);
}

.accessibility-hero,
.accessibility-card {
  border-radius: 1.5rem;
  border: 1px solid rgba(120, 136, 169, 0.18);
  background: rgba(13, 21, 36, 0.72);
  box-shadow:
    inset 0 1px 0 rgba(255, 255, 255, 0.03),
    0 8px 18px rgba(3, 8, 18, 0.16);
  backdrop-filter: blur(18px);
}

.accessibility-hero {
  margin-bottom: 1.5rem;
  padding: 1.7rem 1.6rem;
}

.accessibility-hero h1 {
  margin: 0.55rem 0 0.85rem;
  font-size: clamp(2.2rem, 4vw, 3.6rem);
  line-height: 0.96;
  letter-spacing: -0.05em;
}

.accessibility-lead,
.accessibility-card p,
.accessibility-list span {
  color: rgba(230, 236, 247, 0.82);
  line-height: 1.72;
}

.accessibility-grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 1rem;
  align-items: stretch;
}

.accessibility-grid-compact {
  margin-top: 3.5rem;
}

.accessibility-grid-footer-gap {
  margin-bottom: 5rem;
}

.accessibility-grid-compact .accessibility-card,
.accessibility-grid:not(.accessibility-grid-compact) .accessibility-card {
  min-height: 100%;
}

.accessibility-card {
  display: flex;
  flex-direction: column;
  height: 100%;
  padding: 1.35rem;
  overflow: hidden;
}

.accessibility-card-emphasis {
  min-height: 100%;
}

.accessibility-card h2 {
  margin: 0.55rem 0 0.8rem;
  font-size: clamp(1.2rem, 2vw, 1.7rem);
  letter-spacing: -0.03em;
}

.accessibility-list {
  margin: 0;
  padding-left: 1.2rem;
  display: grid;
  gap: 0.75rem;
}

.accessibility-list li {
  display: grid;
  gap: 0.18rem;
}

.accessibility-card :deep(a) {
  color: #7de7d6;
}

@media (max-width: 720px) {
  .accessibility-page {
    padding-top: calc(1.25rem + env(safe-area-inset-top, 0px));
  }

  .accessibility-container {
    width: min(100%, calc(100% - 1.25rem));
  }

  .accessibility-grid {
    grid-template-columns: 1fr;
  }

  .accessibility-hero,
  .accessibility-card {
    padding: 1.15rem 1rem;
    border-radius: 1.15rem;
  }
}
</style>
