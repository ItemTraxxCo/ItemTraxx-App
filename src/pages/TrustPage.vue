<template>
  <div class="trust-page">
    <div class="trust-orb trust-orb-one" aria-hidden="true"></div>
    <div class="trust-orb trust-orb-two" aria-hidden="true"></div>
    <div class="grid-noise" aria-hidden="true"></div>

    <main class="trust-container">
      <div class="page-nav-left trust-top-nav">
        <RouterLink class="trust-back-link" to="/" aria-label="Return to home">
          <svg viewBox="0 0 24 24" aria-hidden="true">
            <path d="M15 5 8 12l7 7" />
          </svg>
        </RouterLink>
        <span class="trust-breadcrumb">Trust</span>
      </div>

      <section class="trust-hero">
        <p class="trust-eyebrow">ItemTraxx trust center</p>
        <h1>Trust, policy, status, and operational visibility in one place.</h1>
        <p class="trust-lead">
          This page collects the public pages that explain how ItemTraxx is operated, secured,
          documented, and supported. If you are reviewing ItemTraxx for procurement, IT,
          administrative use, or just curious, you are in the right place.
        </p>
      </section>

      <section class="trust-grid">
        <article v-for="item in trustLinks" :key="item.title" class="trust-card">
          <p class="trust-section-label">{{ item.category }}</p>
          <h2>{{ item.title }}</h2>
          <p>{{ item.description }}</p>
          <RouterLink v-if="item.to" class="trust-link" :to="item.to">Open page</RouterLink>
          <a v-else class="trust-link" :href="item.href" target="_blank" rel="noreferrer">Open page</a>
        </article>
      </section>

      <section class="trust-notes">
        <article class="trust-card trust-card-wide">
          <p class="trust-section-label">Reviewing ItemTraxx</p>
          <h2>Where to go for common review questions.</h2>
          <ul class="trust-list">
            <li v-for="item in reviewNotes" :key="item.title">
              <strong>{{ item.title }}</strong>
              <span>{{ item.description }}</span>
            </li>
          </ul>
        </article>
      </section>

      <PublicFooter />
    </main>
  </div>
</template>

<script setup lang="ts">
import { RouterLink } from "vue-router";
import PublicFooter from "../components/PublicFooter.vue";

const trustLinks = [
  {
    category: "Security",
    title: "Security",
    description: "Current public security practices, request controls, and reporting guidance.",
    to: "/security",
  },
  {
    category: "Privacy",
    title: "Privacy",
    description: "How ItemTraxx handles data, retention, support workflows, and privacy requests.",
    to: "/privacy",
  },
  {
    category: "Legal",
    title: "Legal",
    description: "The combined legal agreement, service terms, policy language, and licensing reference.",
    to: "/legal",
  },
  {
    category: "Transparency",
    title: "Changelog",
    description: "Recent product, engineering, security, and operational changes documented publicly.",
    to: "/changelog",
  },
  {
    category: "Operations",
    title: "System Status",
    description: "Live status and incident visibility for the public-facing ItemTraxx system experience.",
    href: "https://status.itemtraxx.com/",
  },
  {
    category: "Support",
    title: "Contact Support",
    description: "Direct contact path for support, operational questions, and trust-related follow-up.",
    to: "/contact-support",
  },
];

const reviewNotes = [
  {
    title: "Security review",
    description: "Start with Security, then use Contact Support if you need follow-up or additional clarification.",
  },
  {
    title: "Privacy review",
    description: "Use the Privacy page for handling, retention, and request information, and Legal for the governing terms.",
  },
  {
    title: "Operational confidence",
    description: "Use Changelog and System Status together to see how ItemTraxx communicates change and service health.",
  },
  {
    title: "Procurement or IT questions",
    description: "If the public pages do not answer the question, Contact Support is the right escalation path.",
  },
];
</script>

<style scoped>
.trust-page {
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

.trust-page::before {
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

.trust-orb {
  position: absolute;
  border-radius: 999px;
  filter: blur(40px);
  opacity: 0.38;
  pointer-events: none;
}

.trust-orb-one {
  width: 20rem;
  height: 20rem;
  top: 5rem;
  left: -6rem;
  background: rgba(30, 202, 183, 0.24);
}

.trust-orb-two {
  width: 24rem;
  height: 24rem;
  top: 9rem;
  right: -8rem;
  background: rgba(38, 104, 226, 0.2);
}

.trust-container {
  position: relative;
  z-index: 1;
  width: min(1120px, calc(100% - 2rem));
  margin: 0 auto;
}

.trust-top-nav {
  display: flex;
  align-items: center;
  gap: 0.9rem;
  margin-bottom: 1.25rem;
}

.trust-back-link {
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

.trust-back-link svg {
  width: 1rem;
  height: 1rem;
  fill: none;
  stroke: currentColor;
  stroke-linecap: round;
  stroke-linejoin: round;
  stroke-width: 2;
}

.trust-breadcrumb,
.trust-section-label,
.trust-eyebrow {
  text-transform: uppercase;
  letter-spacing: 0.22em;
  font-size: 0.74rem;
  font-weight: 700;
  color: rgba(155, 231, 220, 0.78);
}

.trust-hero,
.trust-card {
  border-radius: 1.5rem;
  border: 1px solid rgba(120, 136, 169, 0.18);
  background: rgba(13, 21, 36, 0.72);
  box-shadow: 0 28px 80px rgba(3, 8, 18, 0.28);
  backdrop-filter: blur(18px);
}

.trust-hero {
  margin-bottom: 1.5rem;
  padding: 1.7rem 1.6rem;
}

.trust-hero h1 {
  margin: 0.55rem 0 0.85rem;
  font-size: clamp(2.2rem, 4vw, 3.6rem);
  line-height: 0.96;
  letter-spacing: -0.05em;
}

.trust-lead,
.trust-card p,
.trust-list span {
  color: rgba(230, 236, 247, 0.82);
  line-height: 1.72;
}

.trust-grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 1rem;
}

.trust-card {
  padding: 1.35rem;
}

.trust-card h2 {
  margin: 0.55rem 0 0.8rem;
  font-size: clamp(1.2rem, 2vw, 1.7rem);
  letter-spacing: -0.03em;
}

.trust-link {
  display: inline-flex;
  margin-top: 0.7rem;
  color: #7de7d6;
  text-decoration: none;
}

.trust-notes {
  margin-top: 1rem;
}

.trust-card-wide {
  grid-column: 1 / -1;
}

.trust-list {
  margin: 0;
  padding-left: 1.2rem;
  display: grid;
  gap: 0.75rem;
}

.trust-list li {
  display: grid;
  gap: 0.18rem;
}

@media (max-width: 720px) {
  .trust-page {
    padding-top: calc(1.25rem + env(safe-area-inset-top, 0px));
  }

  .trust-container {
    width: min(100%, calc(100% - 1.25rem));
  }

  .trust-grid {
    grid-template-columns: 1fr;
  }

  .trust-hero,
  .trust-card {
    padding: 1.15rem 1rem;
    border-radius: 1.15rem;
  }
}
</style>
