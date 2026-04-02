<template>
  <div class="contact-page">
    <div class="contact-orb contact-orb-one" aria-hidden="true"></div>
    <div class="contact-orb contact-orb-two" aria-hidden="true"></div>
    <div class="grid-noise" aria-hidden="true"></div>

    <main class="contact-container">
      <div class="page-nav-left contact-top-nav">
        <RouterLink class="contact-back-link" to="/" aria-label="Return to home">
          <svg viewBox="0 0 24 24" aria-hidden="true">
            <path d="M15 5 8 12l7 7" />
          </svg>
        </RouterLink>
        <span class="contact-breadcrumb">Contact</span>
      </div>

      <section class="contact-hero">
        <p class="contact-eyebrow">Get in touch</p>
        <h1>Use the right contact path the first time.</h1>
        <p class="contact-lead">
          ItemTraxx has separate paths for demos, sales, support, and security reports. This page
          points you to the right one so your request gets to the right workflow faster.
        </p>
      </section>

      <section class="contact-grid">
        <article v-for="item in contactOptions" :key="item.title" class="contact-card">
          <p class="contact-section-label">{{ item.category }}</p>
          <h2>{{ item.title }}</h2>
          <p>{{ item.description }}</p>
          <ul class="contact-list">
            <li v-for="detail in item.details" :key="detail">{{ detail }}</li>
          </ul>
          <RouterLink class="contact-link" :to="item.to">{{ item.cta }}</RouterLink>
        </article>
      </section>

      <section class="contact-notes">
        <article class="contact-card contact-card-wide">
          <p class="contact-section-label">Before you send</p>
          <h2>What helps us respond faster.</h2>
          <ul class="contact-list">
            <li>Include the team, district, school, or organization name when it applies.</li>
            <li>For support issues, describe what you were trying to do and what went wrong.</li>
            <li>For security issues, include impact, affected page, and reproduction steps.</li>
            <li>For demo requests, include your role and what inventory workflow you want to see.</li>
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

const contactOptions = [
  {
    category: "Demo",
    title: "Request a Demo",
    description: "Use this if you want a walkthrough, planning conversation, or a live product overview.",
    details: [
      "Best for prospective buyers and teams evaluating ItemTraxx.",
      "Use it when you want to see checkout, returns, admin tools, or district workflows.",
    ],
    cta: "Open demo request",
    to: "/request-demo",
  },
  {
    category: "Sales",
    title: "Contact Sales",
    description: "Use this for pricing, plans, procurement, billing questions, or account setup discussions.",
    details: [
      "Best for plan selection, invoice questions, and rollout planning.",
      "Use it when you know you need pricing or commercial follow-up.",
    ],
    cta: "Open sales form",
    to: "/contact-sales",
  },
  {
    category: "Support",
    title: "Contact Support",
    description: "Use this for operational issues, account problems, bugs, and product questions.",
    details: [
      "Best for sign-in issues, checkout problems, and day-to-day product support.",
      "Use it when something is broken or not behaving as expected.",
    ],
    cta: "Open support form",
    to: "/contact-support",
  },
  {
    category: "Security",
    title: "Report a Security Issue",
    description: "Use this for suspected vulnerabilities, abuse cases, or security-sensitive reports.",
    details: [
      "Best for responsible disclosure and security-related findings.",
      "Use it instead of the normal support form when the report is security-related.",
    ],
    cta: "Open security report",
    to: "/report-security-issue",
  },
];
</script>

<style scoped>
.contact-page {
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

.contact-page::before {
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

.contact-orb {
  position: absolute;
  border-radius: 999px;
  filter: blur(40px);
  opacity: 0.38;
  pointer-events: none;
}

.contact-orb-one {
  width: 20rem;
  height: 20rem;
  top: 5rem;
  left: -6rem;
  background: rgba(30, 202, 183, 0.24);
}

.contact-orb-two {
  width: 24rem;
  height: 24rem;
  top: 9rem;
  right: -8rem;
  background: rgba(38, 104, 226, 0.2);
}

.contact-container {
  position: relative;
  z-index: 1;
  width: min(1120px, calc(100% - 2rem));
  margin: 0 auto;
}

.contact-top-nav {
  display: flex;
  align-items: center;
  gap: 0.9rem;
  margin-bottom: 1.25rem;
}

.contact-back-link {
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

.contact-back-link svg {
  width: 1rem;
  height: 1rem;
  fill: none;
  stroke: currentColor;
  stroke-linecap: round;
  stroke-linejoin: round;
  stroke-width: 2;
}

.contact-breadcrumb,
.contact-section-label,
.contact-eyebrow {
  text-transform: uppercase;
  letter-spacing: 0.22em;
  font-size: 0.74rem;
  font-weight: 700;
  color: rgba(155, 231, 220, 0.78);
}

.contact-hero,
.contact-card {
  border-radius: 28px;
  border: 1px solid rgba(118, 143, 181, 0.16);
  background: linear-gradient(180deg, rgba(15, 22, 34, 0.94) 0%, rgba(10, 15, 24, 0.98) 100%);
  box-shadow: 0 28px 80px rgba(3, 8, 18, 0.28);
}

.contact-hero {
  padding: 2rem;
}

.contact-hero h1,
.contact-card h2 {
  margin: 0;
  letter-spacing: -0.04em;
}

.contact-hero h1 {
  max-width: 14ch;
  font-size: clamp(2.3rem, 5vw, 4.4rem);
  line-height: 0.98;
}

.contact-lead {
  max-width: 64ch;
  margin: 1rem 0 0;
  color: rgba(226, 233, 242, 0.78);
  line-height: 1.72;
}

.contact-grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 1.25rem;
  margin-top: 1.25rem;
}

.contact-card {
  padding: 1.6rem;
}

.contact-list {
  display: grid;
  gap: 0.7rem;
  margin: 1.1rem 0 0;
  padding-left: 1.1rem;
  color: rgba(224, 232, 242, 0.76);
  line-height: 1.68;
}

.contact-link {
  display: inline-flex;
  margin-top: 1.2rem;
  color: #8de9dc;
  text-decoration: none;
  font-weight: 700;
}

.contact-link:hover {
  color: #c6fbf4;
}

.contact-notes {
  margin-top: 1.25rem;
}

.contact-card-wide {
  width: 100%;
}

@media (max-width: 900px) {
  .contact-grid {
    grid-template-columns: 1fr;
  }
}

@media (max-width: 640px) {
  .contact-page {
    padding:
      calc(1.25rem + env(safe-area-inset-top, 0px))
      0
      calc(3rem + env(safe-area-inset-bottom, 0px));
  }

  .contact-container {
    width: min(100vw - 1.2rem, 1120px);
  }

  .contact-hero,
  .contact-card {
    padding: 1.2rem;
    border-radius: 22px;
  }

  .contact-hero h1 {
    max-width: none;
  }
}
</style>
