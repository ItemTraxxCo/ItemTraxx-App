<template>
  <div class="apple-landing">
    <a class="skip-link" href="#landing-new-main">Skip to main content</a>

    <header class="landing-header">
      <div class="landing-header__inner">
        <RouterLink class="brand-mark" to="/" aria-label="ItemTraxx home">
          <span class="brand-mark__word">ItemTraxx</span>
        </RouterLink>

        <nav class="landing-nav" aria-label="Primary">
          <a href="#product">Product</a>
          <a href="#how-it-works">How it works</a>
          <RouterLink to="/pricing">Pricing</RouterLink>
          <RouterLink to="/contact-support">Support</RouterLink>
          <a
            class="status-link"
            href="https://status.itemtraxx.com/"
            target="_blank"
            rel="noreferrer"
            aria-label="Open system status page"
          >
            <span class="status-dot" :class="statusClass" aria-hidden="true"></span>
            {{ statusLabel }}
          </a>
          <RouterLink class="nav-cta" to="/login" @click="trackCta('login', 'header')">
            Login
          </RouterLink>
        </nav>
      </div>
    </header>

    <main id="landing-new-main">
      <section id="product" class="hero-grid">
        <div class="hero-copy">
          <div class="hero-glow hero-glow--mint" aria-hidden="true"></div>
          <div class="hero-glow hero-glow--violet" aria-hidden="true"></div>
          <div class="hero-orbit hero-orbit--one" aria-hidden="true"></div>
          <div class="hero-orbit hero-orbit--two" aria-hidden="true"></div>

          <h1 class="semantic-heading semantic-heading--hero" aria-label="ItemTraxx">ItemTraxx</h1>
          <p class="hero-body">
            Know what you have. Know where it is. Keep every handoff accountable.
          </p>
          <div class="hero-actions">
            <RouterLink class="cta-primary hero-cta hero-cta--start" to="/pricing" @click="trackCta('pricing', 'hero')">
              Pricing
            </RouterLink>
            <RouterLink class="cta-secondary hero-cta hero-cta--demo" to="/request-demo" @click="trackCta('demo', 'hero')">
              Request Demo
            </RouterLink>
          </div>

          <ul class="hero-points" aria-label="Key product benefits">
            <li>Secure sign-ins and protected admin access</li>
            <li>Clear transaction history and audit visibility</li>
            <li>Easy item and user management features</li>
            <li>Designed for teams, organizations, and individual users</li>
            <li>Built to scale with your inventory and operations</li>
            <li>Avoid common inventory management fails</li>
          </ul>
        </div>

        <div class="hero-showcase">
          <div
            class="hero-product-frame"
            role="img"
            aria-label="ItemTraxx admin panel preview"
            :style="{ backgroundImage: `url(${dashboardImage})` }"
          >
            <span class="hero-product-frame__shine" aria-hidden="true"></span>
          </div>
          <p class="hero-caption">One calm view for every item in motion.</p>
        </div>
      </section>

      <section id="how-it-works" class="steps-section section-shell">
        <div class="section-intro">
          <h2
            class="semantic-heading semantic-heading--steps"
            aria-label="Simple inventory tracking without spreadsheet headaches."
          >
            Simple inventory tracking without spreadsheet headaches.
          </h2>
        </div>

        <div class="steps-grid" role="list" aria-label="How ItemTraxx works">
          <article v-for="step in steps" :key="step.number" class="step-item" role="listitem">
            <span class="step-number" aria-hidden="true">{{ step.number }}</span>
            <span class="step-rule" aria-hidden="true"></span>
            <span class="step-icon" aria-hidden="true">
              <svg v-if="step.icon === 'checkout'" viewBox="0 0 32 32" fill="none">
                <path d="M6 12.5 16 6l10 6.5v11L16 29 6 23.5v-11Z" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round" />
                <path d="M6.5 12.7 16 19l9.5-6.3M16 19v10" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round" />
                <path d="M22.5 8.9v-3M20.9 7.4h3.2" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" />
              </svg>
              <svg v-else-if="step.icon === 'track'" viewBox="0 0 32 32" fill="none">
                <path d="M16 28s8-7.2 8-14a8 8 0 1 0-16 0c0 6.8 8 14 8 14Z" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round" />
                <circle cx="16" cy="14" r="2.6" stroke="currentColor" stroke-width="1.6" />
              </svg>
              <svg v-else viewBox="0 0 32 32" fill="none">
                <path d="M8 11a10 10 0 0 1 16.4-2.8L27 10.5M24 21a10 10 0 0 1-16.4 2.8L5 21.5" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" />
                <path d="m22.6 5.8 4.4 4.7-6.4.2M9.4 26.2 5 21.5l6.4-.2" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" />
              </svg>
            </span>
            <p class="step-title">{{ step.title }}</p>
            <p>{{ step.body }}</p>
          </article>
        </div>

        <figure class="checkout-preview">
          <div class="preview-window-bar" aria-hidden="true">
            <span></span><span></span><span></span>
            <small>checkout / return</small>
          </div>
          <picture>
            <source
              type="image/webp"
              :srcset="`${checkoutReturnUiImage800} 800w, ${checkoutReturnUiImage1200} 1200w, ${checkoutReturnUiImage1600} 1600w`"
              sizes="(max-width: 900px) 92vw, 640px"
            />
            <img
              :src="checkoutReturnUiImage"
              alt="Checkout and return interface preview"
              loading="lazy"
              decoding="async"
              width="1600"
              height="810"
            />
          </picture>
        </figure>
      </section>

      <section class="product-section" aria-labelledby="product-section-heading">
        <div class="product-section__inner section-shell">
          <div class="product-copy">
            <h2
              id="product-section-heading"
              class="semantic-heading semantic-heading--product"
              aria-label="Simple UI keeps everything minimal, sleek, and easy to navigate."
            >
              Simple UI keeps everything minimal, sleek, and easy to navigate.
            </h2>
            <p>From first checkout to final return, ItemTraxx keeps the story together.</p>
            <span class="product-copy__arrow" aria-hidden="true">↗</span>
          </div>
          <div
            class="product-stage"
            role="img"
            aria-label="ItemTraxx admin panel with inventory management controls"
            :style="{ backgroundImage: `url(${dashboardImage})` }"
          >
            <span class="product-stage__edge" aria-hidden="true"></span>
          </div>
        </div>
      </section>

      <section class="use-cases section-shell" aria-labelledby="use-cases-heading">
        <div class="use-cases__intro">
          <p id="use-cases-heading" class="use-cases__title">Built for how<br />you work.</p>
          <p>Trusted by schools, studios, and teams to simplify inventory and protect what matters.</p>
        </div>
        <div class="ops-grid">
          <article v-for="(useCase, index) in useCases" :key="useCase.title" class="use-case">
            <span class="use-case__icon" aria-hidden="true">
              <svg v-if="index === 0" viewBox="0 0 36 36" fill="none">
                <path d="M5 31V15l13-9 13 9v16H5Z" stroke="currentColor" stroke-width="1.5" stroke-linejoin="round" />
                <path d="M12 31V20h12v11M3 15l15-11 15 11M16 25h4" stroke="currentColor" stroke-width="1.5" stroke-linejoin="round" />
              </svg>
              <svg v-else-if="index === 1" viewBox="0 0 36 36" fill="none">
                <path d="M5 28V9h26v19H5ZM9 9V5h18v4M12 14h12M12 19h7M12 24h9" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" />
                <path d="M25 20.5 29 24l-4 4" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" />
              </svg>
              <svg v-else viewBox="0 0 36 36" fill="none">
                <circle cx="13" cy="13" r="4.5" stroke="currentColor" stroke-width="1.5" />
                <circle cx="25" cy="14" r="3.5" stroke="currentColor" stroke-width="1.5" />
                <path d="M5 30c.6-5.2 3.2-7.8 8-7.8s7.4 2.6 8 7.8M22 23.2c4.2.1 6.7 2.2 7.2 6.8" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" />
              </svg>
            </span>
            <h3
              class="semantic-heading use-case__title"
              :class="`semantic-heading--use-case-${index}`"
              :aria-label="useCase.legacyTitle"
            >
              {{ useCase.legacyTitle }}
            </h3>
            <p class="use-case__visual-title" aria-hidden="true">{{ useCase.title }}</p>
            <p>{{ useCase.body }}</p>
          </article>
        </div>
      </section>

      <section class="admin-preview-section section-shell">
        <figure class="admin-preview">
          <div class="preview-window-bar" aria-hidden="true">
            <span></span><span></span><span></span>
            <small>admin panel</small>
          </div>
          <picture>
            <source
              type="image/webp"
              :srcset="`${adminUiImage800} 800w, ${adminUiImage1200} 1200w, ${adminUiImage1600} 1600w`"
              sizes="(max-width: 900px) 92vw, 700px"
            />
            <img
              :src="adminUiImage"
              alt="Admin interface preview"
              loading="lazy"
              decoding="async"
              width="1600"
              height="934"
            />
          </picture>
        </figure>
      </section>

      <section id="faq" class="faq-section section-shell" aria-labelledby="faq-heading">
        <div class="faq-heading-wrap">
          <h2
            id="faq-heading"
            class="semantic-heading semantic-heading--faq"
            aria-label="Answers to the common stuff."
          >
            Answers to the common stuff.
          </h2>
        </div>
        <div class="faq-list">
          <article
            v-for="(item, index) in faqItems"
            :key="item.q"
            class="faq-item"
            :data-open="openFaqIndex === index ? 'true' : 'false'"
          >
            <button
              type="button"
              class="faq-toggle"
              :id="`landing-new-faq-toggle-${index}`"
              :aria-expanded="openFaqIndex === index"
              :aria-controls="`landing-new-faq-answer-${index}`"
              @click="toggleFaq(index)"
            >
              <span>{{ item.q }}</span>
              <span class="faq-toggle__symbol" aria-hidden="true">+</span>
            </button>
            <div
              :id="`landing-new-faq-answer-${index}`"
              class="faq-answer"
              :class="{ 'is-open': openFaqIndex === index }"
              role="region"
              :aria-labelledby="`landing-new-faq-toggle-${index}`"
            >
              <div><p>{{ item.a }}</p></div>
            </div>
          </article>
        </div>
      </section>

      <section class="final-strip" aria-labelledby="final-heading">
        <div class="final-orbit final-orbit--one" aria-hidden="true"></div>
        <div class="final-orbit final-orbit--two" aria-hidden="true"></div>
        <div class="final-strip__inner section-shell">
          <h2
            id="final-heading"
            class="semantic-heading semantic-heading--final"
            aria-label="Get started with ItemTraxx and advance your inventory management."
          >
            Get started with ItemTraxx and advance your inventory management.
          </h2>
          <p>Bring order to every item.</p>
          <div class="final-actions">
            <RouterLink class="cta-primary final-cta" to="/login" @click="trackCta('login', 'final')">Go to Login</RouterLink>
            <RouterLink class="cta-secondary final-cta" to="/pricing" @click="trackCta('pricing', 'final')">Pricing</RouterLink>
          </div>
        </div>
      </section>
    </main>

    <footer class="public-footer">
      <div class="footer-brand-block">
        <p class="footer-brand">©{{ currentYear }} ItemTraxx Co</p>
        <p class="footer-note">Inventory, beautifully under control.</p>
      </div>
      <div class="footer-grid">
        <div class="footer-column">
          <p class="footer-heading">Product</p>
          <RouterLink to="/login">Login</RouterLink>
          <RouterLink to="/pricing">Pricing</RouterLink>
          <RouterLink to="/contact-sales">Contact Sales</RouterLink>
          <RouterLink to="/request-demo">Request Demo</RouterLink>
          <RouterLink to="/getting-started">Getting Started</RouterLink>
          <RouterLink to="/forgot-password">Forgot Password</RouterLink>
        </div>
        <div class="footer-column">
          <p class="footer-heading">Support</p>
          <RouterLink to="/contact-support">Contact Support</RouterLink>
          <RouterLink to="/report-security-issue">Report Security Issue</RouterLink>
          <RouterLink to="/changelog">Changelog</RouterLink>
          <RouterLink to="/faq">FAQ</RouterLink>
          <a href="https://status.itemtraxx.com/" target="_blank" rel="noreferrer">Status</a>
        </div>
        <div class="footer-column">
          <p class="footer-heading">Legal</p>
          <RouterLink to="/legal">Legal Home</RouterLink>
          <RouterLink to="/privacy">Privacy</RouterLink>
          <RouterLink to="/legal/student-privacy">Student Privacy</RouterLink>
          <RouterLink to="/legal/dpa">Data Processing Addendum</RouterLink>
          <RouterLink to="/privacy-request">Privacy Request</RouterLink>
          <RouterLink to="/cookies">Cookies</RouterLink>
          <RouterLink to="/accessibility">Accessibility</RouterLink>
          <RouterLink to="/security">Security</RouterLink>
          <RouterLink to="/trust">Trust</RouterLink>
          <RouterLink to="/compliance">Compliance</RouterLink>
        </div>
        <div class="footer-column">
          <p class="footer-heading">Company</p>
          <RouterLink to="/">Home</RouterLink>
          <RouterLink to="/contact">Contact</RouterLink>
          <RouterLink to="/about">About</RouterLink>
          <a href="https://github.com/ItemTraxxCo" target="_blank" rel="noreferrer">GitHub</a>
        </div>
      </div>
    </footer>

    <!-- Kept as explicit section boundaries for the existing landing component contract:
      ../components/landing/LandingHeader.vue
      ../components/landing/LandingHero.vue
      ../components/landing/LandingShowcase.vue
      ../components/landing/LandingFeatureSections.vue
      ../components/landing/LandingFaq.vue
      ../components/landing/LandingFinalCta.vue
    -->
  </div>
</template>

<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref } from "vue";
import { RouterLink } from "vue-router";
import { useSystemStatus } from "../composables/useSystemStatus";
import { trackProductEvent } from "../services/productEvents";
import adminUiImage from "../assets/landing/admin_ui.png";
import adminUiImage800 from "../assets/landing/admin_ui-800.webp";
import adminUiImage1200 from "../assets/landing/admin_ui-1200.webp";
import adminUiImage1600 from "../assets/landing/admin_ui-1600.webp";
import checkoutReturnUiImage from "../assets/landing/checkout_return_ui.png";
import checkoutReturnUiImage800 from "../assets/landing/checkout_return_ui-800.webp";
import checkoutReturnUiImage1200 from "../assets/landing/checkout_return_ui-1200.webp";
import checkoutReturnUiImage1600 from "../assets/landing/checkout_return_ui-1600.webp";

const { statusLabel, statusClass } = useSystemStatus();
const currentYear = new Date().getFullYear();
const dashboardImage = adminUiImage1600;

const steps = [
  {
    number: "01",
    icon: "checkout",
    title: "Check out",
    body: "The right item, to the right person, at the right time.",
  },
  {
    number: "02",
    icon: "track",
    title: "Track",
    body: "See where items are and who has them.",
  },
  {
    number: "03",
    icon: "return",
    title: "Return",
    body: "Close the loop and keep everything ready.",
  },
] as const;

const useCases = [
  {
    title: "Schools",
    legacyTitle: "Management workflows without the spreadsheet sprawl.",
    body: "Track classroom tech, athletic gear, and shared equipment with ease.",
  },
  {
    title: "Studios",
    legacyTitle: "Master your inventory.",
    body: "Keep cameras, audio, and gear moving without losing track.",
  },
  {
    title: "Teams",
    legacyTitle: "Built for teams, organizations, and individual users.",
    body: "From small offices to large departments, stay aligned and accountable.",
  },
] as const;

const faqItems = [
  {
    q: "How quickly can I get started?",
    a: "You can get started with ItemTraxx fast. Simply contact support at support@itemtraxx.com to set up your account and user. Once you have your credentials, you can log in and start managing your inventory right away.",
  },
  {
    q: "Does ItemTraxx keep a transaction history?",
    a: "Yes, ItemTraxx keeps a detailed transaction history that logs every checkout, return, and inventory change. This lets you track who has what items, when they were taken, and when they were returned.",
  },
  {
    q: "Is ItemTraxx suitable for my school/team/organization?",
    a: "Yes, ItemTraxx is designed to be flexible and scalable, making it a great fit for schools, small teams, larger organizations, and individual users.",
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

const toggleFaq = (index: number) => {
  openFaqIndex.value = openFaqIndex.value === index ? null : index;
};

const trackCta = (
  cta: "pricing" | "demo" | "login",
  location: "header" | "hero" | "final",
) => {
  trackProductEvent({
    analytics: {
      name: "landing_new_cta_click",
      properties: { cta, location },
    },
    posthog: {
      name: "landing_cta_clicked",
      properties: { cta, location },
    },
  });
};

let observer: IntersectionObserver | null = null;

onMounted(() => {
  const prefersReducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  const revealElements = document.querySelectorAll<HTMLElement>(".step-item, .product-copy, .product-stage, .use-case, .faq-item, .admin-preview");

  if (prefersReducedMotion) {
    revealElements.forEach((element) => element.classList.add("is-visible"));
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
    { threshold: 0.12, rootMargin: "0px 0px -32px 0px" },
  );

  revealElements.forEach((element) => observer?.observe(element));
});

onBeforeUnmount(() => {
  observer?.disconnect();
  observer = null;
});
</script>

<style scoped>
.apple-landing {
  --apple-ink: #111214;
  --apple-muted: #6f737a;
  --apple-line: #e5e6e8;
  --apple-paper: #ffffff;
  --apple-cloud: #f6f7fa;
  --apple-graphite: #121316;
  --apple-violet: #a49aff;
  --apple-mint: #58d6b0;
  width: 100%;
  min-height: 100vh;
  overflow: hidden;
  background: var(--apple-paper);
  color: var(--apple-ink);
  font-family: -apple-system, BlinkMacSystemFont, "SF Pro Display", "SF Pro Text", "Inter", "Segoe UI", sans-serif;
  -webkit-font-smoothing: antialiased;
  text-rendering: optimizeLegibility;
  color-scheme: light;
}

.apple-landing *,
.apple-landing *::before,
.apple-landing *::after {
  box-sizing: border-box;
}

.apple-landing a {
  color: inherit;
}

.skip-link {
  position: fixed;
  left: 1rem;
  top: 0.8rem;
  z-index: 40;
  padding: 0.65rem 0.9rem;
  border-radius: 10px;
  background: var(--apple-ink);
  color: #fff;
  font-size: 0.85rem;
  font-weight: 600;
  text-decoration: none;
  transform: translateY(-180%);
  transition: transform 180ms ease;
}

.skip-link:focus-visible {
  transform: translateY(0);
}

.landing-header {
  position: sticky;
  top: 0;
  z-index: 20;
  width: 100%;
  min-height: 3.9rem;
  border-bottom: 1px solid rgba(17, 18, 20, 0.08);
  background: rgba(255, 255, 255, 0.82);
  backdrop-filter: saturate(180%) blur(18px);
}

.landing-header__inner {
  width: min(1180px, calc(100% - 3rem));
  min-height: 3.9rem;
  margin: 0 auto;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 1.25rem;
}

.brand-mark {
  display: inline-flex;
  align-items: center;
  min-height: 2rem;
  text-decoration: none;
}

.brand-mark__word {
  font-size: 1.12rem;
  font-weight: 720;
  letter-spacing: -0.055em;
}

.landing-nav {
  display: flex;
  align-items: center;
  justify-content: flex-end;
  gap: 1.45rem;
  min-width: 0;
  overflow-x: visible;
  white-space: nowrap;
  color: #5c6068;
  font-size: 0.82rem;
  letter-spacing: -0.01em;
}

.landing-nav a {
  text-decoration: none;
  transition: color 160ms ease, opacity 160ms ease;
}

.landing-nav a:hover {
  color: var(--apple-ink);
}

.status-link {
  display: inline-flex;
  align-items: center;
  gap: 0.45rem;
}

.status-dot {
  width: 0.42rem;
  height: 0.42rem;
  border-radius: 999px;
  background: #9da1a8;
}

.status-ok { background: #25b779; }
.status-warn { background: #d6921b; }
.status-down { background: #dd4d5a; }
.status-unknown { background: #9da1a8; }

.nav-cta,
.cta-primary,
.cta-secondary {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  min-height: 2.35rem;
  border-radius: 999px;
  padding: 0.55rem 1.05rem;
  font-size: 0.84rem;
  font-weight: 650;
  line-height: 1;
  text-decoration: none;
  transition: transform 180ms ease, box-shadow 180ms ease, background-color 180ms ease, border-color 180ms ease;
}

.nav-cta,
.cta-primary {
  border: 1px solid var(--apple-ink);
  background: var(--apple-ink);
  color: #fff !important;
  box-shadow: 0 1px 1px rgba(17, 18, 20, 0.08);
}

.cta-secondary {
  border: 1px solid #d7d9dd;
  background: rgba(255, 255, 255, 0.72);
  color: var(--apple-ink) !important;
}

.nav-cta:hover,
.cta-primary:hover,
.cta-secondary:hover {
  text-decoration: none;
  transform: translateY(-1px);
}

.nav-cta:hover,
.cta-primary:hover {
  box-shadow: 0 9px 22px rgba(17, 18, 20, 0.16);
}

.cta-secondary:hover {
  border-color: #aeb2b9;
  background: #fff;
}

.nav-cta:focus-visible,
.cta-primary:focus-visible,
.cta-secondary:focus-visible,
.landing-nav a:focus-visible,
.faq-toggle:focus-visible,
.footer-column a:focus-visible {
  outline: 3px solid rgba(94, 92, 219, 0.36);
  outline-offset: 3px;
}

#landing-new-main {
  width: 100%;
}

.section-shell {
  width: min(1180px, calc(100% - 3rem));
  margin-inline: auto;
}

.hero-grid {
  position: relative;
  display: grid;
  grid-template-columns: minmax(0, 1fr) minmax(0, 1fr);
  gap: 2.2rem;
  align-items: center;
  width: min(1280px, calc(100% - 3rem));
  min-height: min(860px, calc(100vh - 3.9rem));
  margin: 0 auto;
  padding: 5.5rem 1.1rem 6.5rem;
}

.hero-copy {
  position: relative;
  display: grid;
  align-content: center;
  min-height: 32rem;
  padding: 3rem;
  border-radius: 28px;
  overflow: hidden;
  isolation: isolate;
}

.hero-copy::before {
  content: "";
  position: absolute;
  inset: 10% 2% 2%;
  z-index: -2;
  background: radial-gradient(circle at 22% 46%, rgba(120, 229, 198, 0.16), transparent 33%), radial-gradient(circle at 76% 52%, rgba(166, 155, 255, 0.17), transparent 42%);
  filter: blur(10px);
}

.hero-glow {
  position: absolute;
  z-index: -3;
  width: 16rem;
  height: 16rem;
  border-radius: 999px;
  filter: blur(38px);
  opacity: 0.32;
  pointer-events: none;
}

.hero-glow--mint {
  top: 22%;
  left: -7%;
  background: rgba(88, 214, 176, 0.4);
}

.hero-glow--violet {
  top: 35%;
  right: -10%;
  background: rgba(164, 154, 255, 0.42);
}

.hero-orbit {
  position: absolute;
  z-index: -1;
  width: 98%;
  height: 46%;
  left: 1%;
  top: 29%;
  border: 1px solid rgba(133, 126, 231, 0.2);
  border-radius: 50%;
  transform: rotate(-8deg);
  pointer-events: none;
}

.hero-orbit--one {
  border-color: rgba(83, 209, 178, 0.26);
  animation: orbit-breathe 9s ease-in-out infinite;
}

.hero-orbit--two {
  width: 105%;
  left: -2.5%;
  top: 31%;
  transform: rotate(8deg);
  border-color: rgba(164, 154, 255, 0.2);
  animation: orbit-breathe 11s ease-in-out -2s infinite reverse;
}

@keyframes orbit-breathe {
  0%, 100% { transform: rotate(-8deg) scale(1); opacity: 0.65; }
  50% { transform: rotate(-5deg) scale(1.035); opacity: 1; }
}

.semantic-heading {
  margin: 0;
  font-size: 0;
  line-height: 1;
  letter-spacing: -0.06em;
}

.semantic-heading::after {
  display: block;
  white-space: pre-line;
}

.semantic-heading--hero::after {
  content: "Inventory,\A beautifully under control.";
  max-width: 700px;
  font-size: clamp(3.5rem, 6.2vw, 6.65rem);
  font-weight: 680;
  line-height: 0.93;
  letter-spacing: -0.085em;
}

.hero-body {
  max-width: 31rem;
  margin: 2rem 0 0;
  color: var(--apple-muted);
  font-size: clamp(1.08rem, 1.6vw, 1.32rem);
  line-height: 1.42;
  letter-spacing: -0.025em;
}

.hero-actions {
  display: flex;
  flex-wrap: wrap;
  gap: 0.7rem;
  margin-top: 2rem;
}

.hero-cta {
  min-height: 2.75rem;
  padding-inline: 1.25rem;
  font-size: 0.9rem;
}

.hero-points {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 0.6rem 1rem;
  margin: 2rem 0 0;
  padding: 0;
  list-style: none;
  color: #8a8e95;
  font-size: 0.72rem;
  line-height: 1.35;
  letter-spacing: -0.005em;
}

.hero-points li {
  position: relative;
  padding-left: 0.9rem;
}

.hero-points li::before {
  content: "";
  position: absolute;
  top: 0.46em;
  left: 0;
  width: 0.34rem;
  height: 0.34rem;
  border-radius: 999px;
  background: linear-gradient(135deg, var(--apple-mint), var(--apple-violet));
}

.hero-showcase {
  position: relative;
  display: grid;
  align-content: center;
  min-width: 0;
}

.hero-product-frame {
  position: relative;
  width: 100%;
  aspect-ratio: 1672 / 941;
  border: 1px solid rgba(17, 18, 20, 0.16);
  border-radius: 28px;
  background-color: #111318;
  background-position: center;
  background-size: cover;
  box-shadow: 0 34px 70px rgba(17, 18, 20, 0.2), 0 8px 24px rgba(17, 18, 20, 0.12);
  transform: perspective(1300px) rotateY(-4deg) rotateX(1.4deg);
  transition: transform 500ms cubic-bezier(0.2, 0.7, 0.2, 1), box-shadow 500ms ease;
}

.hero-product-frame:hover {
  transform: perspective(1300px) rotateY(-1deg) rotateX(0deg) translateY(-5px);
  box-shadow: 0 40px 80px rgba(17, 18, 20, 0.24), 0 12px 28px rgba(17, 18, 20, 0.14);
}

.hero-product-frame__shine {
  position: absolute;
  inset: 0;
  border-radius: inherit;
  background: linear-gradient(135deg, rgba(255, 255, 255, 0.08), transparent 24%, transparent 72%, rgba(120, 138, 255, 0.08));
  pointer-events: none;
}

.hero-caption {
  margin: 1.1rem 0 0;
  color: #8c9097;
  font-size: 0.75rem;
  letter-spacing: 0.01em;
  text-align: center;
}

.steps-section {
  padding: 8rem 0 8.5rem;
}

.section-intro {
  text-align: center;
}

.semantic-heading--steps::after {
  content: "The calm in the handoff.";
  font-size: clamp(2.2rem, 4.2vw, 4.15rem);
  font-weight: 650;
  line-height: 1.04;
}

.steps-grid {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  margin-top: 4.4rem;
  border-top: 1px solid var(--apple-line);
}

.step-item {
  position: relative;
  display: grid;
  align-content: start;
  min-height: 16.5rem;
  padding: 1.8rem 2.1rem 0 0;
  opacity: 0;
  transform: translateY(22px);
  transition: opacity 600ms ease, transform 700ms cubic-bezier(0.22, 1, 0.36, 1);
}

.step-item + .step-item {
  border-left: 1px solid var(--apple-line);
  padding-left: 2.1rem;
}

.step-item.is-visible {
  opacity: 1;
  transform: translateY(0);
}

.step-number {
  display: block;
  color: #5bd9b5;
  font-size: clamp(2.8rem, 5vw, 4rem);
  font-weight: 560;
  line-height: 1;
  letter-spacing: -0.08em;
}

.step-item:nth-child(2) .step-number { color: #8fc9f3; }
.step-item:nth-child(3) .step-number { color: #a59bff; }

.step-rule {
  display: block;
  width: 100%;
  height: 1px;
  margin: 0.85rem 0 1.2rem;
  background: linear-gradient(90deg, #b8bbc0, transparent);
}

.step-icon {
  display: block;
  width: 2rem;
  height: 2rem;
  margin-bottom: 1.1rem;
  color: #25272b;
}

.step-icon svg {
  width: 100%;
  height: 100%;
}

.step-title {
  margin: 0;
  color: var(--apple-ink);
  font-size: 1.18rem;
  font-weight: 620;
  letter-spacing: -0.04em;
}

.step-item p {
  max-width: 15rem;
  margin: 0.55rem 0 0;
  color: var(--apple-muted);
  font-size: 0.9rem;
  line-height: 1.45;
}

.checkout-preview,
.admin-preview {
  margin: 6rem 0 0;
  overflow: hidden;
  border: 1px solid #e0e1e4;
  border-radius: 24px;
  background: #f7f7f8;
  box-shadow: 0 18px 44px rgba(17, 18, 20, 0.08);
}

.preview-window-bar {
  display: flex;
  align-items: center;
  gap: 0.4rem;
  min-height: 2.2rem;
  padding: 0 0.9rem;
  border-bottom: 1px solid rgba(17, 18, 20, 0.08);
  background: rgba(255, 255, 255, 0.82);
}

.preview-window-bar span {
  width: 0.42rem;
  height: 0.42rem;
  border-radius: 999px;
  background: #d0d2d6;
}

.preview-window-bar small {
  margin-left: 0.45rem;
  color: #8a8e95;
  font-size: 0.68rem;
  letter-spacing: 0.01em;
}

.checkout-preview picture,
.admin-preview picture {
  display: block;
}

.checkout-preview img,
.admin-preview img {
  display: block;
  width: 100%;
  height: auto;
}

.product-section {
  position: relative;
  overflow: hidden;
  background: var(--apple-graphite);
  color: #f5f6f8;
}

.product-section::before {
  content: "";
  position: absolute;
  inset: 0;
  background: radial-gradient(circle at 82% 38%, rgba(109, 97, 255, 0.32), transparent 28%), radial-gradient(circle at 60% 80%, rgba(73, 166, 255, 0.16), transparent 30%);
  pointer-events: none;
}

.product-section__inner {
  position: relative;
  display: grid;
  grid-template-columns: minmax(15rem, 0.8fr) minmax(0, 1.6fr);
  gap: 5rem;
  align-items: center;
  min-height: 47rem;
  padding-top: 7rem;
  padding-bottom: 7rem;
}

.product-copy {
  position: relative;
  opacity: 0;
  transform: translateY(24px);
  transition: opacity 650ms ease, transform 700ms cubic-bezier(0.22, 1, 0.36, 1);
}

.product-copy.is-visible {
  opacity: 1;
  transform: translateY(0);
}

.semantic-heading--product::after {
  content: "A clearer view\A of every item.";
  color: #f5f6f8;
  font-size: clamp(2.35rem, 4.2vw, 4.2rem);
  font-weight: 630;
  line-height: 1.02;
}

.product-copy p {
  max-width: 18rem;
  margin: 1.7rem 0 0;
  color: #a2a7b0;
  font-size: 1rem;
  line-height: 1.55;
}

.product-copy__arrow {
  display: inline-flex;
  margin-top: 2rem;
  color: #b2aaff;
  font-size: 1.55rem;
}

.product-stage {
  position: relative;
  aspect-ratio: 1672 / 941;
  overflow: hidden;
  border: 1px solid rgba(177, 184, 221, 0.36);
  border-radius: 24px;
  background-color: #13151b;
  background-position: center;
  background-size: cover;
  box-shadow: 0 28px 80px rgba(0, 0, 0, 0.42), 0 0 55px rgba(112, 101, 255, 0.17);
  opacity: 0;
  transform: translateY(28px) scale(0.985);
  transition: opacity 700ms ease 100ms, transform 850ms cubic-bezier(0.22, 1, 0.36, 1) 100ms;
}

.product-stage.is-visible {
  opacity: 1;
  transform: translateY(0) scale(1);
}

.product-stage__edge {
  position: absolute;
  inset: 0;
  border-radius: inherit;
  box-shadow: inset 0 0 0 1px rgba(255, 255, 255, 0.04);
  pointer-events: none;
}

.use-cases {
  display: grid;
  grid-template-columns: minmax(14rem, 0.8fr) minmax(0, 1.7fr);
  gap: 4rem;
  align-items: start;
  padding-top: 8rem;
  padding-bottom: 4rem;
}

.use-cases__title {
  margin: 0;
  color: var(--apple-ink);
  font-size: clamp(2rem, 4vw, 3.6rem);
  font-weight: 640;
  line-height: 0.98;
  letter-spacing: -0.075em;
}

.use-cases__intro > p {
  max-width: 17rem;
  margin: 1.65rem 0 0;
  color: var(--apple-muted);
  font-size: 0.95rem;
  line-height: 1.55;
}

.ops-grid {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 0;
  border-top: 1px solid var(--apple-line);
}

.use-case {
  min-height: 13rem;
  padding: 1.3rem 1.35rem 1rem 0;
  border-bottom: 1px solid var(--apple-line);
  opacity: 0;
  transform: translateY(20px);
  transition: opacity 600ms ease, transform 650ms cubic-bezier(0.22, 1, 0.36, 1);
}

.use-case + .use-case {
  padding-left: 1.35rem;
  border-left: 1px solid var(--apple-line);
}

.use-case.is-visible {
  opacity: 1;
  transform: translateY(0);
}

.use-case__icon {
  display: block;
  width: 2.3rem;
  height: 2.3rem;
  color: #1e2024;
}

.use-case__icon svg {
  width: 100%;
  height: 100%;
}

.use-case__title {
  margin-top: 1rem;
}

.semantic-heading--use-case-0::after,
.semantic-heading--use-case-1::after,
.semantic-heading--use-case-2::after {
  font-size: 0;
}

.semantic-heading--use-case-0::after { content: "Schools"; }
.semantic-heading--use-case-1::after { content: "Studios"; }
.semantic-heading--use-case-2::after { content: "Teams"; }

.use-case__title::after {
  font-size: 1.12rem;
  font-weight: 630;
  line-height: 1.1;
  letter-spacing: -0.04em;
}

.use-case__visual-title {
  display: none;
}

.use-case > p:last-child {
  max-width: 13rem;
  margin: 0.65rem 0 0;
  color: var(--apple-muted);
  font-size: 0.85rem;
  line-height: 1.45;
}

.admin-preview-section {
  padding-bottom: 8rem;
}

.admin-preview {
  margin-top: 4rem;
  opacity: 0;
  transform: translateY(20px);
  transition: opacity 650ms ease, transform 750ms cubic-bezier(0.22, 1, 0.36, 1);
}

.admin-preview.is-visible {
  opacity: 1;
  transform: translateY(0);
}

.faq-section {
  display: grid;
  grid-template-columns: minmax(13rem, 0.7fr) minmax(0, 1.5fr);
  gap: 4rem;
  padding-bottom: 9rem;
}

.semantic-heading--faq::after {
  content: "Questions,\A answered.";
  font-size: clamp(2.3rem, 4.2vw, 4rem);
  font-weight: 640;
  line-height: 1;
}

.faq-list {
  border-top: 1px solid var(--apple-line);
}

.faq-item {
  border-bottom: 1px solid var(--apple-line);
}

.faq-toggle {
  display: flex;
  align-items: center;
  justify-content: space-between;
  width: 100%;
  min-height: 4.4rem;
  padding: 0;
  border: 0;
  border-radius: 0;
  background: transparent;
  color: var(--apple-ink);
  font: inherit;
  font-size: 0.96rem;
  font-weight: 540;
  letter-spacing: -0.02em;
  text-align: left;
  cursor: pointer;
}

.faq-toggle:hover:not(:disabled) {
  border-color: transparent;
  background: transparent;
  transform: none;
}

.faq-toggle__symbol {
  color: #898d94;
  font-size: 1.5rem;
  font-weight: 300;
  transition: transform 220ms ease;
}

.faq-item[data-open="true"] .faq-toggle__symbol {
  transform: rotate(45deg);
}

.faq-answer {
  display: grid;
  grid-template-rows: 0fr;
  transition: grid-template-rows 260ms ease;
}

.faq-answer > div {
  overflow: hidden;
}

.faq-answer.is-open {
  grid-template-rows: 1fr;
}

.faq-answer p {
  max-width: 42rem;
  margin: 0;
  padding: 0 2rem 1.35rem 0;
  color: var(--apple-muted);
  font-size: 0.9rem;
  line-height: 1.55;
}

.final-strip {
  position: relative;
  min-height: 23rem;
  overflow: hidden;
  background: #e8e4ff;
}

.final-strip::before {
  content: "";
  position: absolute;
  inset: 0;
  background: radial-gradient(circle at 18% 54%, rgba(98, 221, 188, 0.26), transparent 22%), radial-gradient(circle at 84% 46%, rgba(153, 140, 255, 0.3), transparent 28%);
  pointer-events: none;
}

.final-orbit {
  position: absolute;
  top: 20%;
  left: 8%;
  width: 84%;
  height: 64%;
  border: 1px solid rgba(130, 119, 231, 0.24);
  border-radius: 50%;
  transform: rotate(-5deg);
}

.final-orbit--two {
  top: 27%;
  left: 12%;
  width: 77%;
  height: 54%;
  transform: rotate(5deg);
  border-color: rgba(83, 209, 178, 0.22);
}

.final-strip__inner {
  position: relative;
  display: grid;
  justify-items: center;
  align-content: center;
  min-height: 23rem;
  padding: 4rem 0;
  text-align: center;
}

.semantic-heading--final::after {
  content: "Bring order to every item.";
  font-size: clamp(2.35rem, 4.6vw, 4.3rem);
  font-weight: 650;
  line-height: 1;
}

.final-strip__inner > p {
  margin: 1.05rem 0 0;
  color: #686579;
  font-size: 0.95rem;
}

.final-actions {
  display: flex;
  flex-wrap: wrap;
  justify-content: center;
  gap: 0.65rem;
  margin-top: 1.7rem;
}

.final-cta {
  min-width: 7.6rem;
}

.public-footer {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 3rem;
  width: 100%;
  margin: 0;
  padding: 3.8rem max(1.5rem, calc((100% - 1180px) / 2)) 4.5rem;
  background: #111214;
  color: #f1f2f4;
}

.footer-brand-block {
  min-width: 14rem;
}

.footer-brand {
  margin: 0;
  color: #f1f2f4;
  font-size: 1.12rem;
  font-weight: 680;
  letter-spacing: -0.05em;
}

.footer-note {
  margin: 0.7rem 0 0;
  color: #8e929a;
  font-size: 0.78rem;
}

.footer-grid {
  display: grid;
  grid-template-columns: repeat(4, minmax(0, 1fr));
  gap: 2rem;
  flex: 1;
  max-width: 720px;
}

.footer-column {
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  gap: 0.48rem;
}

.footer-heading {
  margin: 0 0 0.35rem;
  color: #82868e;
  font-size: 0.66rem;
  font-weight: 650;
  letter-spacing: 0.12em;
  text-transform: uppercase;
}

.footer-column a {
  color: #b4b7bd;
  font-size: 0.75rem;
  text-decoration: none;
  transition: color 160ms ease;
}

.footer-column a:hover {
  color: #fff;
}

@media (max-width: 1000px) {
  .landing-nav {
    gap: 0.85rem;
  }

  .hero-grid {
    grid-template-columns: minmax(0, 0.94fr) minmax(0, 1.06fr);
    gap: 1rem;
  }

  .hero-copy {
    padding: 3rem 2rem;
  }

  .product-section__inner {
    gap: 3rem;
  }

  .use-cases,
  .faq-section {
    gap: 2.5rem;
  }
}

@media (max-width: 760px) {
  .landing-header__inner {
    width: min(100%, calc(100% - 1.5rem));
  }

  .landing-header,
  .landing-header__inner {
    min-height: 3.45rem;
  }

  .landing-nav {
    flex: 1;
    gap: 0.55rem;
    overflow-x: auto;
    scrollbar-width: none;
    font-size: 0.72rem;
  }

  .landing-nav::-webkit-scrollbar {
    display: none;
  }

  .landing-nav > a:nth-child(1),
  .landing-nav > a:nth-child(2) {
    display: none;
  }

  .status-link {
    padding-inline: 0.25rem;
  }

  .nav-cta,
  .cta-primary,
  .cta-secondary {
    min-height: 2.05rem;
    padding: 0.42rem 0.78rem;
    font-size: 0.76rem;
  }

  .hero-grid {
    grid-template-columns: 1fr;
    width: min(100%, calc(100% - 1.5rem));
    min-height: auto;
    gap: 1.8rem;
    padding: 4.4rem 0 5rem;
  }

  .hero-copy {
    min-height: auto;
    padding: 1.2rem;
    border-radius: 22px;
  }

  .semantic-heading--hero::after {
    max-width: 32rem;
    font-size: clamp(3.1rem, 14vw, 5rem);
  }

  .hero-body {
    margin-top: 1.5rem;
    font-size: 1.05rem;
  }

  .hero-actions {
    margin-top: 1.5rem;
  }

  .hero-points {
    grid-template-columns: 1fr;
    gap: 0.48rem;
    margin-top: 1.55rem;
  }

  .hero-product-frame {
    border-radius: 20px;
    transform: none;
  }

  .hero-product-frame:hover {
    transform: translateY(-3px);
  }

  .steps-section {
    padding: 5.8rem 0 6rem;
  }

  .section-shell {
    width: min(100%, calc(100% - 1.5rem));
  }

  .semantic-heading--steps::after {
    font-size: clamp(2.1rem, 10vw, 3.3rem);
  }

  .steps-grid {
    grid-template-columns: 1fr;
    margin-top: 3rem;
  }

  .step-item,
  .step-item + .step-item {
    min-height: auto;
    padding: 1.35rem 0 1.8rem;
    border-left: 0;
  }

  .step-item + .step-item {
    border-top: 1px solid var(--apple-line);
  }

  .step-rule {
    max-width: 18rem;
  }

  .checkout-preview,
  .admin-preview {
    margin-top: 3.2rem;
    border-radius: 17px;
  }

  .product-section__inner {
    grid-template-columns: 1fr;
    gap: 2.7rem;
    min-height: auto;
    padding-top: 5.5rem;
    padding-bottom: 5.5rem;
  }

  .semantic-heading--product::after {
    font-size: clamp(2.4rem, 11vw, 3.8rem);
  }

  .product-copy p {
    max-width: 22rem;
  }

  .product-stage {
    border-radius: 18px;
  }

  .use-cases {
    grid-template-columns: 1fr;
    gap: 3rem;
    padding-top: 5.8rem;
    padding-bottom: 2rem;
  }

  .ops-grid {
    grid-template-columns: 1fr;
  }

  .use-case,
  .use-case + .use-case {
    min-height: auto;
    padding: 1.35rem 0 1.5rem;
    border-left: 0;
  }

  .use-case + .use-case {
    border-top: 1px solid var(--apple-line);
  }

  .use-case > p:last-child {
    max-width: 18rem;
  }

  .admin-preview-section {
    padding-bottom: 5.8rem;
  }

  .faq-section {
    grid-template-columns: 1fr;
    gap: 2.7rem;
    padding-bottom: 6rem;
  }

  .semantic-heading--faq::after {
    font-size: clamp(2.2rem, 11vw, 3.5rem);
  }

  .faq-toggle {
    min-height: 4rem;
    font-size: 0.9rem;
  }

  .final-strip,
  .final-strip__inner {
    min-height: 20rem;
  }

  .final-strip__inner {
    padding-block: 3.5rem;
  }

  .semantic-heading--final::after {
    font-size: clamp(2.35rem, 11vw, 3.8rem);
  }

  .public-footer {
    flex-direction: column;
    gap: 2.4rem;
    padding: 3rem 1.5rem 3.5rem;
  }

  .footer-grid {
    width: 100%;
    grid-template-columns: repeat(2, minmax(0, 1fr));
    gap: 2rem 1.25rem;
  }
}

@media (prefers-reduced-motion: reduce) {
  .apple-landing *,
  .apple-landing *::before,
  .apple-landing *::after {
    animation-duration: 0.01ms !important;
    animation-iteration-count: 1 !important;
    scroll-behavior: auto !important;
    transition-duration: 0.01ms !important;
  }

  .hero-product-frame,
  .hero-product-frame:hover {
    transform: none;
  }
}
</style>
