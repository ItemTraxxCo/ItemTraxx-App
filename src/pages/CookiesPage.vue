<template>
  <div class="cookies-page">
    <div class="cookies-orb cookies-orb-one" aria-hidden="true"></div>
    <div class="cookies-orb cookies-orb-two" aria-hidden="true"></div>
    <div class="grid-noise" aria-hidden="true"></div>

    <main class="cookies-container">
      <div class="page-nav-left cookies-top-nav">
        <RouterLink class="cookies-back-link" to="/" aria-label="Return to home">
          <svg viewBox="0 0 24 24" aria-hidden="true">
            <path d="M15 5 8 12l7 7" />
          </svg>
        </RouterLink>
        <span class="cookies-breadcrumb">Cookies</span>
      </div>

      <section class="cookies-hero">
        <p class="cookies-eyebrow">ItemTraxx cookies notice</p>
        <h1>How ItemTraxx uses cookies and similar browser storage.</h1>
        <p class="cookies-lead">
          ItemTraxx uses cookies and similar browser storage for secure sign-in, anti-abuse controls,
          product telemetry, and diagnostics. Essential cookies stay on because the app cannot work
          securely without them; analytics and diagnostics are only enabled after consent.
        </p>
      </section>

      <section class="cookies-grid">
        <article class="cookies-card">
          <p class="cookies-section-label">Essential</p>
          <h2>Required for sign-in and secure app use.</h2>
          <ul class="cookies-list">
            <li v-for="item in essentialCookies" :key="item.title">
              <strong>{{ item.title }}</strong>
              <span>{{ item.description }}</span>
            </li>
          </ul>
        </article>

        <article class="cookies-card">
          <p class="cookies-section-label">Analytics</p>
          <h2>Used to understand product usage and performance.</h2>
          <ul class="cookies-list">
            <li v-for="item in analyticsCookies" :key="item.title">
              <strong>{{ item.title }}</strong>
              <span>{{ item.description }}</span>
            </li>
          </ul>
        </article>
      </section>

      <section class="cookies-grid cookies-grid-compact">
        <article class="cookies-card">
          <p class="cookies-section-label">Diagnostics</p>
          <h2>Used to detect errors and investigate reliability issues.</h2>
          <ul class="cookies-list">
            <li v-for="item in diagnosticsCookies" :key="item.title">
              <strong>{{ item.title }}</strong>
              <span>{{ item.description }}</span>
            </li>
          </ul>
        </article>

        <article class="cookies-card">
          <p class="cookies-section-label">Operational</p>
          <h2>Used to keep the product stable and usable.</h2>
          <ul class="cookies-list">
            <li v-for="item in operationalCookies" :key="item.title">
              <strong>{{ item.title }}</strong>
              <span>{{ item.description }}</span>
            </li>
          </ul>
        </article>
      </section>

      <section class="cookies-grid cookies-grid-compact cookies-grid-footer-gap">
        <article class="cookies-card">
          <p class="cookies-section-label">What We Do Not Use</p>
          <h2>Limited scope by design.</h2>
          <ul class="cookies-list">
            <li v-for="item in limitations" :key="item.title">
              <strong>{{ item.title }}</strong>
              <span>{{ item.description }}</span>
            </li>
          </ul>
        </article>

        <article class="cookies-card">
          <p class="cookies-section-label">Questions</p>
          <h2>How to ask about cookies or data handling.</h2>
          <p>
            If you need clarification about ItemTraxx cookie usage, privacy handling, or session
            behavior, use <RouterLink to="/contact-support">Contact Support</RouterLink>.
          </p>
          <p>
            For the broader privacy policy, see <RouterLink to="/privacy">Privacy</RouterLink>.
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

const essentialCookies = [
  {
    title: "Session cookies",
    description:
      "Used to keep authenticated users signed in, validate secure sessions, and support protected route access.",
  },
  {
    title: "Security controls",
    description:
      "Used for request protection, step-up verification flows, and related account or session hardening behavior.",
  },
  {
    title: "Tenant routing context",
    description:
      "Used where needed to maintain the correct tenant or district sign-in and handoff experience.",
  },
];

const analyticsCookies = [
  {
    title: "Vercel Analytics",
    description:
      "Used on public and app pages to measure navigation, page usage, and selected product interaction events after consent.",
  },
  {
    title: "Speed Insights",
    description:
      "Used to understand frontend performance and page responsiveness across real user sessions after consent.",
  },
];

const diagnosticsCookies = [
  {
    title: "Sentry error monitoring",
    description:
      "Used to capture application errors, failed requests, and runtime diagnostics after consent so reliability issues can be investigated.",
  },
  {
    title: "Sentry Replay when enabled",
    description:
      "If replay sampling is enabled in the active environment, browser session replay data may be collected after consent for debugging and incident investigation.",
  },
];

const operationalCookies = [
  {
    title: "Theme and interface state",
    description:
      "Used to remember interface preferences such as light or dark mode and a small amount of non-sensitive UI state.",
  },
  {
    title: "Device and workflow state",
    description:
      "Used for onboarding completion, device labeling, dismissed notices, offline checkout buffering, and similar product state that improves usability.",
  },
  {
    title: "Reliability and abuse protection",
    description:
      "Some browser storage and request-layer controls are used to support rate limiting, anti-abuse, platform stability, and platform security.",
  },
];

const limitations = [
  {
    title: "No advertising trackers",
    description:
      "ItemTraxx is not built around ad networks, remarketing pixels, or advertising profile building.",
  },
  {
    title: "Limited by product need",
    description:
      "The goal is to use only the browser storage needed for secure authentication, product function, telemetry, and operational quality.",
  },
  {
    title: "May change as the product evolves",
    description:
      "If cookie or storage usage changes materially, the related public pages are updated to reflect that change.",
  },
];
</script>

<style scoped>
.cookies-page {
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

.cookies-page::before {
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

.cookies-orb {
  position: absolute;
  border-radius: 999px;
  filter: blur(40px);
  opacity: 0.38;
  pointer-events: none;
}

.cookies-orb-one {
  width: 20rem;
  height: 20rem;
  top: 5rem;
  left: -6rem;
  background: rgba(30, 202, 183, 0.24);
}

.cookies-orb-two {
  width: 24rem;
  height: 24rem;
  top: 9rem;
  right: -8rem;
  background: rgba(38, 104, 226, 0.2);
}

.cookies-container {
  position: relative;
  z-index: 1;
  width: min(1120px, calc(100% - 2rem));
  margin: 0 auto;
}

.cookies-top-nav {
  display: flex;
  align-items: center;
  gap: 0.9rem;
  margin-bottom: 1.25rem;
}

.cookies-back-link {
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

.cookies-back-link svg {
  width: 1rem;
  height: 1rem;
  fill: none;
  stroke: currentColor;
  stroke-linecap: round;
  stroke-linejoin: round;
  stroke-width: 2;
}

.cookies-breadcrumb,
.cookies-section-label,
.cookies-eyebrow {
  text-transform: uppercase;
  letter-spacing: 0.22em;
  font-size: 0.74rem;
  font-weight: 700;
  color: rgba(155, 231, 220, 0.78);
}

.cookies-hero,
.cookies-card {
  border-radius: 1.5rem;
  border: 1px solid rgba(120, 136, 169, 0.18);
  background: rgba(13, 21, 36, 0.72);
  box-shadow:
    inset 0 1px 0 rgba(255, 255, 255, 0.03),
    0 8px 18px rgba(3, 8, 18, 0.16);
  backdrop-filter: blur(18px);
}

.cookies-hero {
  margin-bottom: 1.5rem;
  padding: 1.7rem 1.6rem;
}

.cookies-hero h1 {
  margin: 0.55rem 0 0.85rem;
  font-size: clamp(2.2rem, 4vw, 3.6rem);
  line-height: 0.96;
  letter-spacing: -0.05em;
}

.cookies-lead,
.cookies-card p,
.cookies-list span {
  color: rgba(230, 236, 247, 0.82);
  line-height: 1.72;
}

.cookies-grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 1rem;
  align-items: stretch;
}

.cookies-grid-compact {
  margin-top: 3.5rem;
}

.cookies-grid-footer-gap {
  margin-bottom: 5rem;
}

.cookies-card {
  display: flex;
  flex-direction: column;
  height: 100%;
  padding: 1.35rem;
  overflow: hidden;
}

.cookies-card h2 {
  margin: 0.55rem 0 0.8rem;
  font-size: clamp(1.2rem, 2vw, 1.7rem);
  letter-spacing: -0.03em;
}

.cookies-list {
  margin: 0;
  padding-left: 1.2rem;
  display: grid;
  gap: 0.75rem;
}

.cookies-list li {
  display: grid;
  gap: 0.18rem;
}

.cookies-card :deep(a) {
  color: #7de7d6;
}

@media (max-width: 720px) {
  .cookies-page {
    padding-top: calc(1.25rem + env(safe-area-inset-top, 0px));
  }

  .cookies-container {
    width: min(100%, calc(100% - 1.25rem));
  }

  .cookies-grid {
    grid-template-columns: 1fr;
  }

  .cookies-grid-compact {
    margin-top: 2rem;
  }

  .cookies-grid-footer-gap {
    margin-bottom: 3rem;
  }

  .cookies-hero,
  .cookies-card {
    padding: 1.15rem 1rem;
    border-radius: 1.15rem;
  }
}
</style>
