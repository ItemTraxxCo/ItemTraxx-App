<template>
  <div class="page cookies-page">
    <RouterLink class="brand-mark" to="/" aria-label="ItemTraxx home">
      <img v-if="brandLogoUrl" class="brand-mark-full" :src="brandLogoUrl" alt="ItemTraxx Co" />
    </RouterLink>

    <main class="cookies-container">
      <div class="page-nav-left cookies-top-nav">
        <RouterLink class="cookies-back-link" to="/" aria-label="Return to home" @click.prevent="$router.back()">
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
          <p class="cookies-section-label">Analytics*</p>
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
          <p class="cookies-section-label">Diagnostics*</p>
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

      <section class="cookies-grid cookies-grid-compact">
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

      <section class="cookies-consent-standalone" aria-label="Consent note">
        <p class="cookies-consent-note">
          * Items marked with "*" are only enabled after user consent on first load through the consent banner.
        </p>
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
    title: "User routing context",
    description:
      "Used where needed to maintain the correct user or district/organization sign-in and handoff experience.",
  },
];

const analyticsCookies = [
  {
    title: "PostHog product analytics*",
    description:
      "Used to understand feature usage, key product flows, and aggregate engagement patterns for product improvement.",
  },
  {
    title: "Vercel Analytics*",
    description:
      "Used on public and app pages to measure navigation, page usage, and selected product interaction events after consent.",
  },
  {
    title: "Speed Insights*",
    description:
      "Used to understand frontend performance and page responsiveness across real user sessions after consent.",
  },
];

const diagnosticsCookies = [
  {
    title: "PostHog diagnostics and session insights*",
    description:
      "Used to investigate product issues with event-level diagnostics and troubleshooting context during incident/error analysis.",
  },
  {
    title: "Sentry error monitoring*",
    description:
      "Used to capture application errors, failed requests, and runtime diagnostics after consent so reliability issues can be investigated.",
  },
  {
    title: "Sentry Replay when enabled*",
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
      "Some browser storage and request-layer controls are used to support rate limiting, anti-abuse, platform stability, platform security, and approximate IP-based session location for device history.",
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
.cookies-page {
  max-width: 1120px;
  padding-top: calc(2rem + env(safe-area-inset-top, 0px));
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

.cookies-container {
  width: 100%;
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
  width: 2.4rem;
  height: 2.4rem;
  border-radius: 999px;
  border: 1px solid rgba(77, 97, 122, 0.4);
  background: linear-gradient(180deg, rgba(31, 40, 54, 0.46) 0%, rgba(17, 23, 32, 0.34) 100%);
  color: #ffffff;
  text-decoration: none;
  backdrop-filter: blur(2px);
  transition: transform 0.16s ease, border-color 0.16s ease, background 0.16s ease;
}

.cookies-back-link:hover {
  transform: translateY(-1px);
  border-color: rgba(39, 196, 172, 0.58);
  background: linear-gradient(180deg, rgba(29, 66, 75, 0.62) 0%, rgba(16, 37, 48, 0.54) 100%);
  box-shadow: 0 16px 32px rgba(25, 194, 168, 0.14);
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
  color: color-mix(in srgb, var(--text) 64%, var(--accent) 36%);
}

.cookies-hero,
.cookies-card {
  border-radius: 1rem;
  border: 2px solid color-mix(in srgb, var(--border) 58%, transparent);
  background: transparent;
  box-shadow: none;
}

.cookies-hero {
  margin-bottom: 1.5rem;
  padding: 1.7rem 1.6rem;
}

.cookies-hero h1 {
  margin: 0.55rem 0 0.85rem;
  font-size: clamp(1.4rem, 3vw, 2.4rem);
  line-height: 0.96;
  letter-spacing: -0.05em;
}

.cookies-lead,
.cookies-card p,
.cookies-list span {
  color: color-mix(in srgb, var(--text) 84%, transparent);
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
  margin-bottom: 6.5rem;
}

.cookies-consent-standalone {
  margin: calc(1.35rem + 4px) 0 6.5rem;
  padding: 0.75rem 0.9rem;
  border: 1px solid color-mix(in srgb, var(--border) 56%, transparent);
  border-radius: 0.8rem;
  background: color-mix(in srgb, var(--surface-2) 42%, transparent);
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
  color: color-mix(in srgb, var(--text) 62%, var(--accent) 38%);
}

.cookies-consent-note {
  margin: 0;
  color: color-mix(in srgb, var(--text) 76%, transparent);
  font-size: 0.92rem;
  line-height: 1.6;
}

@media (max-width: 720px) {
  .cookies-page {
    padding-top: calc(1.25rem + env(safe-area-inset-top, 0px));
  }

  .brand-mark {
    margin-bottom: 0.25rem;
  }

  .brand-mark-full {
    height: 3.9rem;
  }

  .cookies-grid {
    grid-template-columns: 1fr;
  }

  .cookies-grid-compact {
    margin-top: 2rem;
  }

  .cookies-grid-footer-gap {
    margin-bottom: 4rem;
  }

  .cookies-consent-standalone {
    margin-bottom: 4rem;
  }

  .cookies-hero,
  .cookies-card {
    padding: 1.15rem 1rem;
    border-radius: 1rem;
  }
}
</style>
