<template>
  <div class="page contact-page">
    <RouterLink class="brand-mark" to="/" aria-label="ItemTraxx home">
      <img v-if="brandLogoUrl" class="brand-mark-full" :src="brandLogoUrl" alt="ItemTraxx Co" />
    </RouterLink>

    <main class="contact-container">
      <div class="page-nav-left contact-top-nav">
        <RouterLink class="contact-back-link" to="/" aria-label="Return to home" @click.prevent="$router.back()">
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
    cta: "Open security reporting",
    to: "/report-security-issue",
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
.contact-page {
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

.contact-container {
  width: 100%;
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

.contact-back-link:hover {
  transform: translateY(-1px);
  border-color: rgba(39, 196, 172, 0.58);
  background: linear-gradient(180deg, rgba(29, 66, 75, 0.62) 0%, rgba(16, 37, 48, 0.54) 100%);
  box-shadow: 0 16px 32px rgba(25, 194, 168, 0.14);
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
  color: color-mix(in srgb, var(--text) 64%, var(--accent) 36%);
}

.contact-hero,
.contact-card {
  border-radius: 1rem;
  border: 2px solid color-mix(in srgb, var(--border) 58%, transparent);
  background: transparent;
  box-shadow: none;
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
  font-size: clamp(1.4rem, 3vw, 2.4rem);
  line-height: 0.98;
}

.contact-lead {
  max-width: 64ch;
  margin: 1rem 0 0;
  color: color-mix(in srgb, var(--text) 84%, transparent);
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
  color: color-mix(in srgb, var(--text) 84%, transparent);
  line-height: 1.68;
}

.contact-link {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  min-height: 2.3rem;
  padding: 0.45rem 0.9rem;
  margin-top: 1.2rem;
  border-radius: 999px;
  border: 2px solid color-mix(in srgb, var(--border) 72%, transparent);
  background: color-mix(in srgb, var(--surface-2) 68%, transparent);
  color: color-mix(in srgb, var(--text) 62%, var(--accent) 38%);
  text-decoration: none;
  font-weight: 600;
  transition: transform 0.16s ease, border-color 0.16s ease, background 0.16s ease;
}

.contact-link:hover {
  transform: translateY(-1px);
  border-color: color-mix(in srgb, var(--accent) 48%, var(--border) 52%);
  background: color-mix(in srgb, var(--surface-2) 52%, var(--accent) 8%);
}

.contact-link:focus-visible {
  outline: 2px solid color-mix(in srgb, var(--accent) 62%, transparent);
  outline-offset: 2px;
}

.contact-notes {
  margin-top: 1.25rem;
  margin-bottom: 1.25rem;
}

.contact-card-wide {
  width: 100%;
  box-sizing: border-box;
}

@media (max-width: 900px) {
  .contact-grid {
    grid-template-columns: 1fr;
  }
}

@media (max-width: 640px) {
  .contact-page {
    padding-top: calc(1.25rem + env(safe-area-inset-top, 0px));
  }

  .brand-mark {
    margin-bottom: 0.25rem;
  }

  .brand-mark-full {
    height: 3.9rem;
  }

  .contact-hero,
  .contact-card {
    padding: 1.2rem;
    border-radius: 1rem;
  }

  .contact-hero h1 {
    max-width: none;
  }
}
</style>
