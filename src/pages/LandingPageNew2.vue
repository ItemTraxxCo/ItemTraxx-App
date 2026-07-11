<template>
  <div class="landing-new2">
    <a class="skip-link" href="#landing-new2-main">Skip to main content</a>

    <header class="lp-header">
      <div class="lp-shell lp-header__inner">
        <RouterLink class="lp-logo" to="/" aria-label="ItemTraxx home">
          <img v-if="brandLogoUrl" :src="brandLogoUrl" alt="ItemTraxx Co" />
          <span v-else>ItemTraxx</span>
        </RouterLink>

        <nav class="lp-nav" aria-label="Primary">
          <RouterLink class="lp-nav__link is-hideable" to="/pricing">Pricing</RouterLink>
          <RouterLink class="lp-nav__link is-hideable" to="/contact-support">Support</RouterLink>
          <a
            class="lp-status"
            href="https://status.itemtraxx.com/"
            target="_blank"
            rel="noreferrer"
            aria-label="Open ItemTraxx system status"
          >
            <span class="lp-status__dot" :class="statusClass" aria-hidden="true"></span>
            {{ statusLabel }}
          </a>
          <RouterLink class="lp-btn lp-btn--primary" to="/login" @click="trackCta('login', 'header')">
            Login
          </RouterLink>
        </nav>
      </div>
    </header>

    <main id="landing-new2-main" class="lp-main">
      <section id="top" class="lp-section lp-hero">
        <div class="lp-shell lp-hero__grid">
          <div class="lp-reveal">
            <p class="lp-eyebrow">Inventory tracking made simple</p>
            <h1>Master your inventory, without the spreadsheet headaches.</h1>
            <p class="lp-hero__lead">
              Losing track of where stuff goes? ItemTraxx is the right service for you.
            </p>
            <p class="lp-hero__support">
              Start mastering your inventory with ItemTraxx's streamlined checkout, returns, and admin
              management.
            </p>
            <div class="lp-hero__actions">
              <RouterLink class="lp-btn lp-btn--primary lp-btn--lg" to="/pricing" @click="trackCta('pricing', 'hero')">
                Pricing
              </RouterLink>
              <RouterLink class="lp-btn lp-btn--lg" to="/request-demo" @click="trackCta('demo', 'hero')">
                Request Demo
              </RouterLink>
            </div>
            <ul class="lp-points" aria-label="Key product benefits">
              <li v-for="point in heroPoints" :key="point">
                <span class="lp-check" aria-hidden="true"></span>
                {{ point }}
              </li>
            </ul>
          </div>

          <div class="lp-hero__aside lp-reveal lp-reveal-delay">
            <article class="lp-card lp-valuecard">
              <div class="lp-valuecard__head">
                <p class="lp-eyebrow">Why teams use it</p>
                <span class="lp-status lp-status-static">Core value</span>
              </div>
              <h2>Simple inventory tracking without spreadsheet headaches.</h2>
              <p>
                ItemTraxx keeps checkout, returns, and management work in one place so teams can move
                fast without losing accountability.
              </p>
              <ul class="lp-valuecard__list">
                <li v-for="point in valuePoints" :key="point">
                  <span class="lp-check" aria-hidden="true"></span>
                  {{ point }}
                </li>
              </ul>
            </article>

            <article class="lp-card lp-shot">
              <div class="lp-shot__bar">
                <span class="lp-shot__dot"></span>
                <span class="lp-shot__dot"></span>
                <span class="lp-shot__dot"></span>
                <span class="lp-shot__label">checkout / return</span>
              </div>
              <picture>
                <source
                  type="image/webp"
                  :srcset="`${checkoutReturnUiImage800} 800w, ${checkoutReturnUiImage1200} 1200w, ${checkoutReturnUiImage1600} 1600w`"
                  sizes="(max-width: 900px) 92vw, 640px"
                />
                <img
                  :src="checkoutReturnUiImage"
                  alt="ItemTraxx checkout and return interface"
                  loading="lazy"
                  decoding="async"
                  width="1600"
                  height="810"
                />
              </picture>
            </article>
          </div>
        </div>
      </section>

      <section class="lp-section lp-feature">
        <div class="lp-shell lp-feature__grid">
          <div class="lp-reveal">
            <p class="lp-eyebrow">Simple usage</p>
            <h2>Simple UI keeps everything minimal, sleek, and easy to navigate.</h2>
            <p>A clean interface keeps daily work confusion-free, for operators and admins alike.</p>
            <ul class="lp-checks">
              <li v-for="point in featurePoints" :key="point">
                <span class="lp-check" aria-hidden="true"></span>
                {{ point }}
              </li>
            </ul>
          </div>

          <article class="lp-card lp-shot lp-reveal lp-reveal-delay">
            <div class="lp-shot__bar">
              <span class="lp-shot__dot"></span>
              <span class="lp-shot__dot"></span>
              <span class="lp-shot__dot"></span>
              <span class="lp-shot__label">admin panel</span>
            </div>
            <picture>
              <source
                type="image/webp"
                :srcset="`${adminUiImage800} 800w, ${adminUiImage1200} 1200w, ${adminUiImage1600} 1600w`"
                sizes="(max-width: 900px) 92vw, 700px"
              />
              <img
                :src="adminUiImage"
                alt="ItemTraxx admin panel interface"
                loading="lazy"
                decoding="async"
                width="1600"
                height="934"
              />
            </picture>
          </article>
        </div>
      </section>

      <section class="lp-section">
        <div class="lp-shell lp-ops__grid">
          <article v-for="item in opsItems" :key="item.title" class="lp-card lp-ops__panel lp-reveal">
            <p class="lp-eyebrow">{{ item.eyebrow }}</p>
            <h3>{{ item.title }}</h3>
            <p>{{ item.body }}</p>
          </article>
        </div>
      </section>

      <section id="support" class="lp-section">
        <div class="lp-shell">
          <div class="lp-faq__head lp-reveal">
            <p class="lp-eyebrow">Frequently asked questions</p>
            <h2>Answers to the common stuff.</h2>
          </div>

          <div class="lp-faq__list lp-reveal lp-reveal-delay">
            <article
              v-for="(item, index) in faqItems"
              :key="item.q"
              class="lp-faq"
              :data-open="openFaqIndex === index ? 'true' : 'false'"
            >
              <button
                type="button"
                class="lp-faq__toggle"
                :id="`landing-new2-faq-toggle-${index}`"
                :aria-expanded="openFaqIndex === index"
                :aria-controls="`landing-new2-faq-answer-${index}`"
                @click="toggleFaq(index)"
              >
                <span>{{ item.q }}</span>
                <span class="lp-faq__symbol" aria-hidden="true">+</span>
              </button>
              <div
                :id="`landing-new2-faq-answer-${index}`"
                class="lp-faq__answer"
                role="region"
                :aria-labelledby="`landing-new2-faq-toggle-${index}`"
              >
                <div>
                  <p>{{ item.a }}</p>
                </div>
              </div>
            </article>
          </div>
        </div>
      </section>

      <section id="pricing" class="lp-section">
        <div class="lp-shell">
          <article class="lp-card lp-final lp-reveal">
            <div>
              <p class="lp-eyebrow">Ready to simplify inventory tracking?</p>
              <h2>Get started with ItemTraxx and streamline your inventory management.</h2>
              <p>Simplify your inventory management with ItemTraxx today.</p>
            </div>
            <div class="lp-final__actions">
              <RouterLink class="lp-btn lp-btn--primary lp-btn--lg" to="/login" @click="trackCta('login', 'final')">
                Go to Login
              </RouterLink>
              <RouterLink class="lp-btn lp-btn--lg" to="/pricing" @click="trackCta('pricing', 'final')">
                Pricing
              </RouterLink>
            </div>
          </article>
        </div>
      </section>
    </main>

    <PublicFooter />
  </div>
</template>

<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, onUnmounted, ref } from "vue";
import { RouterLink } from "vue-router";
import adminUiImage from "../assets/landing/admin_ui.png";
import adminUiImage800 from "../assets/landing/admin_ui-800.webp";
import adminUiImage1200 from "../assets/landing/admin_ui-1200.webp";
import adminUiImage1600 from "../assets/landing/admin_ui-1600.webp";
import checkoutReturnUiImage from "../assets/landing/checkout_return_ui.png";
import checkoutReturnUiImage800 from "../assets/landing/checkout_return_ui-800.webp";
import checkoutReturnUiImage1200 from "../assets/landing/checkout_return_ui-1200.webp";
import checkoutReturnUiImage1600 from "../assets/landing/checkout_return_ui-1600.webp";
import PublicFooter from "../components/PublicFooter.vue";
import { trackProductEvent } from "../services/productEvents";
import { useSystemStatus } from "../composables/useSystemStatus";

const lightBrandLogoUrl = import.meta.env.VITE_BRAND_LOGO_LIGHT_URL as string | undefined;
const darkBrandLogoUrl = import.meta.env.VITE_BRAND_LOGO_DARK_URL as string | undefined;
const themeMode = ref<"light" | "dark">("dark");
const brandLogoUrl = computed(() =>
  themeMode.value === "light"
    ? lightBrandLogoUrl || darkBrandLogoUrl || ""
    : darkBrandLogoUrl || lightBrandLogoUrl || "",
);

const heroPoints = [
  "Secure sign-ins and protected admin access",
  "Clear transaction history and audit visibility",
  "Easy item and user management features",
  "Designed for teams, organizations, and individual users",
  "Built to scale with your inventory and operations",
  "Avoid common inventory management fails",
];

const valuePoints = [
  "Know who has what item",
  "See what is out and what came back",
  "Keep admin control clean and auditable",
];

const featurePoints = [
  "Fast sign in and transaction flow",
  "Clean operator-facing workflow design",
  "Light and dark appearance modes available",
];

const opsItems = [
  {
    eyebrow: "Easy management",
    title: "Management workflows without the spreadsheet sprawl.",
    body:
      "With useful features such as item management, user management, transaction logs, and more, keeping track of inventory has never been easier.",
  },
  {
    eyebrow: "Why it matters",
    title: "Master your inventory.",
    body:
      "ItemTraxx solves issues with keeping track of inventory: who has what item, when it was taken, when it was returned, and what items are currently out.",
  },
  {
    eyebrow: "Fit",
    title: "Built for teams, organizations, and individual users.",
    body:
      "ItemTraxx is flexible and scalable — a fit for schools, smaller and larger teams, and organizations of any size. We also offer individual plans for single-user use.",
  },
];

const faqItems = [
  {
    q: "How quickly can I get started?",
    a:
      "You can get started with ItemTraxx fast. Simply contact support at support@itemtraxx.com to set up your account and user. Once you have your credentials, you can log in and start managing your inventory right away.",
  },
  {
    q: "Does ItemTraxx keep a transaction history?",
    a:
      "Yes, ItemTraxx keeps a detailed transaction history that logs every checkout, return, and inventory change. This lets you track who has what items, when they were taken, and when they were returned.",
  },
  {
    q: "Is ItemTraxx suitable for my school/team/organization?",
    a:
      "Yes, ItemTraxx is designed to be flexible and scalable, making it a great fit for schools, small teams, larger organizations, and individual users.",
  },
  {
    q: "How do I request a demo?",
    a: "You can request a demo by clicking the Request Demo button at the top of this page and submitting the demo request form.",
  },
  {
    q: "I found a bug, how do I report it?",
    a: "Please report it by contacting support to report any bugs or issues you encounter.",
  },
  {
    q: "I want to suggest a feature, how can I do that?",
    a: "Please use the contact support links to suggest any features you would like to see.",
  },
  {
    q: "Is this the same as ItemTrax or Item Traxx?",
    a: "Yes. If you searched for ItemTrax or Item Traxx, this is the official ItemTraxx website.",
  },
  {
    q: "Is there a limit to how many items, transactions, and members I can have?",
    a: "No, there are no limits to the number of items, transactions, or members you can have in ItemTraxx. The system is designed to scale with your needs.",
  },
];

const openFaqIndex = ref<number | null>(null);
const {
  state: systemStatus,
  statusLabel: sharedStatusLabel,
  statusClass,
} = useSystemStatus();
const statusLabel = computed(() =>
  systemStatus.refreshedAt === 0 ? "Checking" : sharedStatusLabel.value,
);

let observer: IntersectionObserver | null = null;
let themeObserver: MutationObserver | null = null;

const toggleFaq = (index: number) => {
  openFaqIndex.value = openFaqIndex.value === index ? null : index;
};

const trackCta = (cta: "pricing" | "demo" | "login", location: "header" | "hero" | "final") => {
  trackProductEvent({
    analytics: {
      name: "landing_new2_cta_click",
      properties: { cta, location },
    },
    posthog: {
      name: "landing_cta_clicked",
      properties: { cta, location, page: "landing-new2" },
    },
  });
};

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

  const prefersReducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  const revealElements = document.querySelectorAll<HTMLElement>(".lp-reveal");

  if (prefersReducedMotion) {
    revealElements.forEach((el) => el.classList.add("is-visible"));
    return;
  }

  observer = new IntersectionObserver(
    (entries) => {
      entries.forEach((entry) => {
        if (entry.isIntersecting) {
          entry.target.classList.add("is-visible");
          observer?.unobserve(entry.target);
        }
      });
    },
    { threshold: 0.14, rootMargin: "0px 0px -40px 0px" },
  );

  revealElements.forEach((el) => observer?.observe(el));
});

onBeforeUnmount(() => {
  observer?.disconnect();
  observer = null;
});

onUnmounted(() => {
  themeObserver?.disconnect();
  themeObserver = null;
});
</script>

<style scoped>
.landing-new2 {
  min-height: 100vh;
  background: var(--page-bg);
  color: var(--text);
}

.skip-link {
  position: absolute;
  left: 1rem;
  top: 0.75rem;
  z-index: 80;
  transform: translateY(-180%);
  border: 1px solid var(--border);
  border-radius: 999px;
  background: var(--surface);
  color: var(--text);
  padding: 0.55rem 0.85rem;
  font-weight: 700;
  transition: transform 0.18s ease;
}

.skip-link:focus-visible {
  transform: translateY(0);
}

.lp-shell {
  width: min(1180px, 92vw);
  margin: 0 auto;
}

.lp-header {
  position: sticky;
  top: 0;
  z-index: 50;
  border-bottom: 1px solid var(--border);
  background: color-mix(in srgb, var(--page-bg) 92%, transparent);
  backdrop-filter: saturate(140%) blur(8px);
}

.lp-header__inner {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 1rem;
  padding: 0.85rem 0;
}

.lp-logo {
  display: inline-flex;
  align-items: center;
  min-width: 0;
  color: var(--text);
  font-size: 1.1rem;
  font-weight: 800;
}

.lp-logo img {
  display: block;
  width: auto;
  height: 2.15rem;
  object-fit: contain;
}

.lp-nav {
  display: flex;
  align-items: center;
  gap: 0.55rem;
  flex-wrap: wrap;
  justify-content: flex-end;
}

.lp-nav__link {
  border-radius: 999px;
  color: var(--muted);
  font-size: 0.9rem;
  font-weight: 650;
  padding: 0.55rem 0.8rem;
  transition: background-color 0.16s ease, color 0.16s ease;
}

.lp-nav__link:hover {
  background: var(--surface-2);
  color: var(--text);
  text-decoration: none;
}

.lp-btn,
.lp-status {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  min-height: 2.15rem;
  border-radius: 999px;
  border: 1px solid var(--button-border);
  background: var(--button-bg);
  color: var(--text);
  font-size: 0.92rem;
  font-weight: 750;
  line-height: 1;
  text-decoration: none;
  white-space: nowrap;
}

.lp-btn {
  padding: 0.5rem 0.94rem;
  transition: transform 0.16s ease, background-color 0.16s ease, border-color 0.16s ease;
}

.lp-btn:hover,
.lp-status:hover {
  border-color: color-mix(in srgb, var(--text) 25%, var(--button-border) 75%);
  background: var(--surface-2);
  text-decoration: none;
}

.lp-btn:hover {
  transform: translateY(-1px);
}

.lp-btn--primary {
  border-color: var(--button-primary-border);
  background: var(--button-primary-bg);
  color: var(--button-primary-text);
}

.lp-btn--primary:hover {
  border-color: var(--button-primary-border);
  background: var(--button-primary-bg);
  color: var(--button-primary-text);
}

.lp-btn--lg {
  min-height: 2.58rem;
  padding: 0.62rem 1.2rem;
  font-size: 1rem;
}

.lp-status {
  gap: 0.5rem;
  padding: 0.4rem 0.68rem;
}

.lp-status-static {
  pointer-events: none;
  color: var(--muted);
}

.lp-status__dot {
  width: 0.55rem;
  height: 0.55rem;
  flex: none;
  border-radius: 999px;
}

.status-ok {
  background: var(--success);
}

.status-warn {
  background: var(--warning);
}

.status-down {
  background: var(--danger);
}

.status-unknown {
  background: var(--muted);
}

.lp-main {
  display: block;
}

.lp-section {
  padding-block: clamp(3.4rem, 8vw, 6.2rem);
}

.lp-section + .lp-section {
  padding-top: 0;
}

.lp-eyebrow {
  margin: 0 0 0.85rem;
  color: var(--muted);
  font-size: 0.76rem;
  font-weight: 800;
  letter-spacing: 0.15em;
  text-transform: uppercase;
}

.lp-hero {
  padding-top: clamp(3rem, 7vw, 5.2rem);
}

.lp-hero__grid,
.lp-feature__grid {
  display: grid;
  grid-template-columns: minmax(0, 1.04fr) minmax(0, 0.96fr);
  align-items: center;
  gap: clamp(1.5rem, 4vw, 3.5rem);
}

.lp-hero h1 {
  max-width: 12ch;
  margin: 0;
  font-size: clamp(2.6rem, 5.6vw, 4.55rem);
  font-weight: 850;
  letter-spacing: -0.065em;
  line-height: 1.02;
}

.lp-hero__lead,
.lp-hero__support,
.lp-feature p,
.lp-final p,
.lp-ops__panel p,
.lp-faq__answer p,
.lp-valuecard p {
  color: var(--muted);
}

.lp-hero__lead {
  max-width: 35rem;
  margin: 1.45rem 0 0;
  color: var(--text);
  font-size: clamp(1.18rem, 2vw, 1.45rem);
  line-height: 1.45;
}

.lp-hero__support {
  max-width: 35rem;
  margin: 0.8rem 0 0;
  font-size: 1rem;
  line-height: 1.75;
}

.lp-hero__actions,
.lp-final__actions {
  display: flex;
  flex-wrap: wrap;
  gap: 0.9rem;
  margin-top: 1.8rem;
}

.lp-points,
.lp-valuecard__list,
.lp-checks {
  display: grid;
  list-style: none;
  padding: 0;
}

.lp-points {
  grid-template-columns: 1fr 1fr;
  gap: 0.85rem 1.35rem;
  margin: 1.8rem 0 0;
}

.lp-points li,
.lp-valuecard__list li,
.lp-checks li {
  display: flex;
  align-items: flex-start;
  gap: 0.55rem;
  color: var(--muted);
  line-height: 1.45;
}

.lp-check {
  width: 0.48rem;
  height: 0.48rem;
  flex: none;
  margin-top: 0.42rem;
  border-radius: 999px;
  background: var(--success);
  color: var(--success);
}

.lp-hero__aside {
  display: grid;
  gap: 1rem;
}

.lp-card {
  border: 1px solid var(--border);
  border-radius: 1.4rem;
  background: var(--surface);
  color: var(--text);
}

.lp-valuecard {
  padding: clamp(1.25rem, 3vw, 1.8rem);
}

.lp-valuecard__head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 0.8rem;
  margin-bottom: 0.95rem;
}

.lp-valuecard__head .lp-eyebrow {
  margin: 0;
}

.lp-valuecard h2,
.lp-feature h2,
.lp-final h2,
.lp-faq__head h2,
.lp-ops__panel h3 {
  margin: 0;
  letter-spacing: -0.05em;
  line-height: 1.1;
}

.lp-valuecard h2 {
  font-size: clamp(1.45rem, 2.8vw, 2rem);
}

.lp-valuecard p,
.lp-ops__panel p,
.lp-feature p {
  margin: 1rem 0 0;
  line-height: 1.65;
}

.lp-valuecard__list {
  gap: 0.65rem;
  margin: 1.25rem 0 0;
}

.lp-valuecard__list li {
  color: var(--text);
}

.lp-shot {
  overflow: hidden;
}

.lp-shot__bar {
  display: flex;
  align-items: center;
  gap: 0.45rem;
  border-bottom: 1px solid var(--border);
  padding: 0.85rem 1rem;
}

.lp-shot__dot {
  width: 0.56rem;
  height: 0.56rem;
  border-radius: 999px;
  background: var(--surface-3);
}

.lp-shot__label {
  margin-left: auto;
  color: var(--muted);
  font-family: ui-monospace, "SFMono-Regular", "SF Mono", Consolas, monospace;
  font-size: 0.75rem;
  white-space: nowrap;
}

.lp-shot img {
  display: block;
  width: 100%;
  height: auto;
}

.lp-feature__grid {
  grid-template-columns: minmax(0, 0.9fr) minmax(0, 1.1fr);
}

.lp-feature h2,
.lp-faq__head h2 {
  font-size: clamp(1.95rem, 3.5vw, 2.75rem);
}

.lp-checks {
  gap: 0.75rem;
  margin: 1.45rem 0 0;
}

.lp-checks li {
  color: var(--text);
}

.lp-ops__grid {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 1rem;
}

.lp-ops__panel {
  padding: clamp(1.25rem, 3vw, 1.7rem);
}

.lp-ops__panel h3 {
  font-size: clamp(1.25rem, 2.2vw, 1.55rem);
}

.lp-faq__head {
  max-width: 38rem;
  margin-bottom: 1.7rem;
}

.lp-faq__list {
  display: grid;
  gap: 0.8rem;
}

.lp-faq {
  overflow: hidden;
  border: 1px solid var(--border);
  border-radius: 1.1rem;
  background: var(--surface);
}

.lp-faq__toggle {
  display: flex;
  width: 100%;
  align-items: center;
  justify-content: space-between;
  gap: 1rem;
  border: 0;
  background: transparent;
  color: var(--text);
  cursor: pointer;
  font: inherit;
  font-size: 1rem;
  font-weight: 750;
  line-height: 1.4;
  padding: 1.05rem 1.25rem;
  text-align: left;
}

.lp-faq__toggle:hover {
  background: var(--surface-2);
}

.lp-faq__toggle:focus,
.lp-faq__toggle:focus-visible {
  outline: none;
  box-shadow: none;
}

.lp-faq__symbol {
  flex: none;
  color: var(--muted);
  font-size: 1.35rem;
  line-height: 1;
  transition: transform 0.18s ease;
}

.lp-faq[data-open="true"] .lp-faq__symbol {
  transform: rotate(45deg);
}

.lp-faq__answer {
  display: grid;
  grid-template-rows: 0fr;
  transition: grid-template-rows 0.2s ease;
}

.lp-faq[data-open="true"] .lp-faq__answer {
  grid-template-rows: 1fr;
}

.lp-faq__answer > div {
  overflow: hidden;
}

.lp-faq__answer p {
  margin: 0;
  padding: 0 1.25rem 1.1rem;
  line-height: 1.7;
}

.lp-final {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 1.5rem;
  padding: clamp(1.5rem, 4vw, 2.6rem);
}

.lp-final h2 {
  max-width: 32rem;
  font-size: clamp(1.75rem, 3vw, 2.5rem);
}

.lp-final p {
  margin: 0.85rem 0 0;
}

.lp-final__actions {
  flex: none;
  margin-top: 0;
}

.lp-reveal {
  opacity: 0;
  transform: translateY(24px);
  transition: opacity 0.55s cubic-bezier(0.22, 1, 0.36, 1), transform 0.55s cubic-bezier(0.22, 1, 0.36, 1);
}

.lp-reveal-delay {
  transition-delay: 0.1s;
}

.lp-reveal.is-visible {
  opacity: 1;
  transform: translateY(0);
}

@media (prefers-reduced-motion: reduce) {
  .lp-btn,
  .lp-reveal,
  .lp-faq__answer,
  .lp-faq__symbol {
    transition: none;
  }
}

@media (max-width: 900px) {
  .lp-hero__grid,
  .lp-feature__grid,
  .lp-ops__grid {
    grid-template-columns: 1fr;
  }

  .lp-final {
    align-items: flex-start;
    flex-direction: column;
  }

  .lp-final__actions {
    margin-top: 0.35rem;
  }
}

@media (max-width: 680px) {
  .lp-header__inner {
    align-items: flex-start;
    flex-direction: column;
  }

  .lp-nav {
    width: 100%;
    justify-content: flex-start;
  }

  .lp-nav__link.is-hideable {
    display: none;
  }

  .lp-logo img {
    height: 1.95rem;
  }

  .lp-points {
    grid-template-columns: 1fr;
  }

  .lp-btn,
  .lp-status {
    min-height: 2rem;
    font-size: 0.84rem;
    padding: 0.44rem 0.72rem;
  }
}
</style>
