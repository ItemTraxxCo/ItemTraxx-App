<template>
  <div class="page trust-page">
    <RouterLink class="brand-mark" to="/" aria-label="ItemTraxx home">
      <img v-if="brandLogoUrl" class="brand-mark-full" :src="brandLogoUrl" alt="ItemTraxx Co" />
    </RouterLink>

    <main class="trust-container">
      <div class="page-nav-left trust-top-nav">
        <RouterLink class="trust-back-link" to="/" aria-label="Return to home" @click.prevent="$router.back()">
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

const trustLinks = [
  {
    category: "Security",
    title: "Security",
    description: "Current public security practices, request controls, and reporting guidance.",
    to: "/security",
  },
  {
    category: "Compliance",
    title: "Compliance",
    description: "Public compliance mappings and remediation status supported by current security monitoring.",
    to: "/compliance",
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
    description: "Start with Security and Compliance, then use Contact Support if you need follow-up or additional clarification.",
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
.trust-page {
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

.trust-container {
  width: 100%;
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

.trust-back-link:hover {
  transform: translateY(-1px);
  border-color: rgba(39, 196, 172, 0.58);
  background: linear-gradient(180deg, rgba(29, 66, 75, 0.62) 0%, rgba(16, 37, 48, 0.54) 100%);
  box-shadow: 0 16px 32px rgba(25, 194, 168, 0.14);
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
  color: color-mix(in srgb, var(--text) 64%, var(--accent) 36%);
}

.trust-hero,
.trust-card {
  border-radius: 1rem;
  border: 1px solid color-mix(in srgb, var(--border) 58%, transparent);
  background: transparent;
  box-shadow: none;
}

.trust-hero {
  margin-bottom: 1.5rem;
  padding: 1.7rem 1.6rem;
}

.trust-hero h1 {
  margin: 0.55rem 0 0.85rem;
  font-size: clamp(1.4rem, 3vw, 2.4rem);
  line-height: 0.96;
  letter-spacing: -0.05em;
}

.trust-lead,
.trust-card p,
.trust-list span {
  color: color-mix(in srgb, var(--text) 84%, transparent);
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
  align-items: center;
  justify-content: center;
  min-height: 2.3rem;
  padding: 0.45rem 0.9rem;
  margin-top: 0.7rem;
  border-radius: 999px;
  border: 1px solid color-mix(in srgb, var(--border) 72%, transparent);
  background: color-mix(in srgb, var(--surface-2) 68%, transparent);
  color: color-mix(in srgb, var(--text) 62%, var(--accent) 38%);
  text-decoration: none;
  font-weight: 600;
  transition: transform 0.16s ease, border-color 0.16s ease, background 0.16s ease;
}

.trust-link:hover {
  text-decoration: none;
  transform: translateY(-1px);
  border-color: color-mix(in srgb, var(--accent) 48%, var(--border) 52%);
  background: color-mix(in srgb, var(--surface-2) 52%, var(--accent) 8%);
}

.trust-link:focus-visible {
  outline: 2px solid color-mix(in srgb, var(--accent) 62%, transparent);
  outline-offset: 2px;
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

  .brand-mark {
    margin-bottom: 0.25rem;
  }

  .brand-mark-full {
    height: 3.9rem;
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
