<template>
  <div class="landing-new">
    <a class="skip-link" href="#landing-new-main">Skip to main content</a>

    <div class="ambient ambient-one" aria-hidden="true"></div>
    <div class="ambient ambient-two" aria-hidden="true"></div>
    <div class="grid-noise" aria-hidden="true"></div>

    <header class="landing-header shell">
      <RouterLink class="brand-mark" to="/">
        <img class="brand-mark-full" :src="brandLogoUrl" alt="ItemTraxx Co" />
      </RouterLink>
      <nav class="landing-nav" aria-label="Primary">
        <RouterLink to="/pricing">Pricing</RouterLink>
        <RouterLink to="/contact-support">Support</RouterLink>
        <a
          class="status-pill"
          href="https://status.itemtraxx.com/"
          target="_blank"
          rel="noreferrer"
          aria-label="Open system status page"
        >
          <span class="status-dot" :class="statusClass" aria-hidden="true"></span>
          {{ statusLabel }}
        </a>
        <RouterLink class="nav-cta" to="/login" @click="trackCta('login', 'header')">Login</RouterLink>
      </nav>
    </header>

    <main id="landing-new-main" class="shell landing-main">
      <section class="hero-grid reveal reveal-up">
        <div class="hero-copy reveal reveal-left">
          <p class="eyebrow">Inventory tracking made simple</p>
          <h1>ItemTraxx</h1>
          <p class="hero-body">
            Losing track of where stuff goes? ItemTraxx is the right service for you.
          </p>
          <p class="hero-support">
            Contact us to start mastering your inventory with ItemTraxx's
            streamlined checkout, returns, and admin management.
          </p>
          <div class="hero-actions">
            <RouterLink class="cta-primary" to="/pricing" @click="trackCta('pricing', 'hero')">Pricing</RouterLink>
            <RouterLink
              class="cta-secondary"
              to="/request-demo"
              @click="trackCta('demo', 'hero')"
            >
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
          <article class="showcase-card showcase-primary reveal reveal-right reveal-delay-1">
            <div class="showcase-header">
              <p class="showcase-label">{{ rotatingShowcase.label }}</p>
              <span class="showcase-pill">{{ rotatingShowcase.pill }}</span>
            </div>
            <h2>{{ rotatingShowcase.title }}</h2>
            <p>{{ rotatingShowcase.body }}</p>
            <ul class="showcase-points">
              <li v-for="point in rotatingShowcase.points" :key="point">{{ point }}</li>
            </ul>
          </article>

          <article class="showcase-card showcase-secondary reveal reveal-up reveal-delay-2">
            <p class="showcase-label">Checkout and return preview</p>
            <picture>
              <source
                type="image/webp"
                :srcset="`${checkoutReturnUiImage800} 800w, ${checkoutReturnUiImage1200} 1200w, ${checkoutReturnUiImage1600} 1600w`"
                sizes="(max-width: 900px) 92vw, 640px"
              />
              <img
                class="showcase-image"
                :src="checkoutReturnUiImage"
                alt="Checkout and return interface preview"
                loading="lazy"
                decoding="async"
                width="1600"
                height="810"
              />
            </picture>
          </article>
        </div>
      </section>

      <section class="feature-band reveal reveal-up">
        <div class="feature-band-copy reveal reveal-left">
          <p class="eyebrow">Simple usage</p>
          <h2>Simple UI keeps everything minimal, sleek, and easy to navigate.</h2>
          <p>
            Simple UI keeps everything minimal, sleek, and easy to navigate, confusion free.
          </p>
          <ul class="feature-checks">
            <li>Fast sign in and transaction flow</li>
            <li>Clean operator-facing workflow design</li>
            <li>Light and dark appearance modes available</li>
          </ul>
        </div>
        <div class="feature-band-visual reveal reveal-right reveal-delay-1">
          <picture>
            <source
              type="image/webp"
              :srcset="`${adminUiImage800} 800w, ${adminUiImage1200} 1200w, ${adminUiImage1600} 1600w`"
              sizes="(max-width: 900px) 92vw, 700px"
            />
            <img
              class="feature-image"
              :src="adminUiImage"
              alt="Admin interface preview"
              loading="lazy"
              decoding="async"
              width="1600"
              height="934"
            />
          </picture>
        </div>
      </section>

      <section class="ops-grid reveal reveal-up">
        <article class="ops-panel reveal reveal-left reveal-delay-1">
          <p class="eyebrow">Easy management</p>
          <h3>Management workflows without the spreadsheet sprawl.</h3>
          <p>
            With many useful features such as item management, user management, transaction logs,
            and more, keeping track of inventory has never been easier.
          </p>
        </article>
        <article class="ops-panel reveal reveal-up reveal-delay-2">
          <p class="eyebrow">Why it matters</p>
          <h3>Master your inventory.</h3>
          <p>
            ItemTraxx solves issues with keeping track of inventory: who has what item, when it was
            taken, when it was returned, and what items are currently out.
          </p>
        </article>
        <article class="ops-panel reveal reveal-right reveal-delay-3">
          <p class="eyebrow">Fit</p>
          <h3>Built for teams, organizations, and individual users.</h3>
          <p>
            ItemTraxx is flexible and scalable, making it a fit for schools, smaller and larger teams, and
            organizations of any size that need cleaner inventory operations. We also offer individual plans 
            for single-user use.
          </p>
        </article>
      </section>

      <section class="faq-section reveal reveal-up">
        <div class="faq-header">
          <p class="eyebrow">Frequently asked questions</p>
          <h2>Answers to the common stuff.</h2>
        </div>
        <div class="faq-list">
          <article v-for="(item, index) in faqItems" :key="item.q" class="faq-item">
            <button
              type="button"
              class="faq-toggle"
              :id="`landing-new-faq-toggle-${index}`"
              :aria-expanded="openFaqIndex === index"
              :aria-controls="`landing-new-faq-answer-${index}`"
              @click="toggleFaq(index)"
            >
              <span>{{ item.q }}</span>
              <span class="faq-symbol" aria-hidden="true">{{ openFaqIndex === index ? "−" : "+" }}</span>
            </button>
            <div
              :id="`landing-new-faq-answer-${index}`"
              class="faq-answer"
              :class="{ 'is-open': openFaqIndex === index }"
              role="region"
              :aria-labelledby="`landing-new-faq-toggle-${index}`"
            >
              <p>{{ item.a }}</p>
            </div>
          </article>
        </div>
      </section>

      <section class="final-strip reveal reveal-up">
        <div>
          <p class="eyebrow">Ready to simplify inventory tracking?</p>
          <h2>Get started with ItemTraxx and streamline your inventory management.</h2>
          <p>Simplify your inventory management with ItemTraxx today.</p>
          <div class="final-actions">
            <RouterLink class="cta-primary" to="/login" @click="trackCta('login', 'final')">Go to Login</RouterLink>
            <RouterLink class="cta-secondary" to="/pricing" @click="trackCta('pricing', 'final')">Pricing</RouterLink>
          </div>
        </div>
      </section>
    </main>

    <div class="landing-footer shell">
      <PublicFooter />
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, onUnmounted, ref } from 'vue';
import { RouterLink } from 'vue-router';
import { trackAnalyticsEvent } from "../services/analyticsService";
import adminUiImage from '../assets/landing/admin_ui.png';
import adminUiImage800 from '../assets/landing/admin_ui-800.webp';
import adminUiImage1200 from '../assets/landing/admin_ui-1200.webp';
import adminUiImage1600 from '../assets/landing/admin_ui-1600.webp';
import checkoutReturnUiImage from '../assets/landing/checkout_return_ui.png';
import checkoutReturnUiImage800 from '../assets/landing/checkout_return_ui-800.webp';
import checkoutReturnUiImage1200 from '../assets/landing/checkout_return_ui-1200.webp';
import checkoutReturnUiImage1600 from '../assets/landing/checkout_return_ui-1600.webp';
import { fetchSystemStatus } from '../services/systemStatusService';
import PublicFooter from "../components/PublicFooter.vue";

const themeMode = ref<"light" | "dark">("dark");
const brandLogoUrl = computed(() => import.meta.env.VITE_BRAND_LOGO_DARK_URL || "");

type ShowcaseVariant = {
  label: string;
  pill: string;
  title: string;
  body: string;
  points: string[];
};

const showcaseVariants: ShowcaseVariant[] = [
  {
    label: 'Why teams use it',
    pill: 'Core value',
    title: 'Simple inventory tracking without spreadsheet headaches.',
    body: 'ItemTraxx keeps checkout, returns, and management work in one place so teams can move fast without losing accountability.',
    points: ['Know who has what item', 'See what is out and what came back', 'Keep admin control clean and auditable'],
  },
  {
    label: 'Built for operators',
    pill: 'Workflow',
    title: 'Fast daily usage for the people actually moving gear.',
    body: 'ItemTraxx is designed for real checkout desks and busy equipment rooms, not just admin reporting after the fact.',
    points: ['Quick borrower load and scan flow', 'Low-friction returns', 'Less time spent fixing bad records'],
  },
  {
    label: 'Visibility',
    pill: 'Operations',
    title: 'Clear status on every item and transaction.',
    body: 'You can quickly see who has an item, when it left, and whether inventory is clean, overdue, or missing context.',
    points: ['Track active checkouts', 'Review return history', 'Reduce guessing and manual follow-up'],
  },
  {
    label: 'Admin control',
    pill: 'Management',
    title: 'Admin workflows that stay simple as inventory grows.',
    body: 'Borrowers, gear, logs, and settings stay in one system so admins can manage more without the interface turning into a mess.',
    points: ['Manage borrowers and items', 'Review logs and audits', 'Keep settings and administrative actions in one place'],
  },
  {
    label: 'Designed for teams of any size',
    pill: 'Fit',
    title: 'A better fit for school programs, small teams, and organizations of any size.',
    body: 'ItemTraxx is built for programs where gear moves constantly and staff need a reliable way to keep things organized.',
    points: ['Works for classrooms and media rooms', 'Handles shared equipment cleanly', 'Supports day-to-day accountability'],
  },
  {
    label: 'Less cleanup',
    pill: 'Reliability',
    title: 'Spend less time cleaning up inventory mistakes.',
    body: 'ItemTraxx reduces the loose ends that usually pile up when equipment is tracked with forms, spreadsheets, and memory.',
    points: ['Fewer missing handoffs', 'Cleaner records over time', 'Better transaction history'],
  },
];

const rotatingShowcase = showcaseVariants[Math.floor(Math.random() * showcaseVariants.length)];

const statusLabel = ref('Unknown');
const statusClass = ref<'status-ok' | 'status-warn' | 'status-down' | 'status-unknown'>('status-unknown');

const faqItems = [
  {
    q: 'How quickly can I get started?',
    a: 'You can get started with ItemTraxx fast. Simply contact support at support@itemtraxx.com to set up your account and user. Once you have your credentials, you can log in and start managing your inventory right away.',
  },
  {
    q: 'Does ItemTraxx keep a transaction history?',
    a: 'Yes, ItemTraxx keeps a detailed transaction history that logs every checkout, return, and inventory change. This allows you to track who has what items, when they were taken, and when they were returned.',
  },
  {
    q: 'Is ItemTraxx suitable for my school/team/organization?',
    a: 'Yes, ItemTraxx is designed to be flexible and scalable, making it a great fit for schools, small teams, larger organizations, and individual users.',
  },
  {
    q: 'How do I request a demo?',
    a: 'You can request a demo by clicking the "Request Demo" button at the top of this page and submitting the demo request form',
  },
  {
    q: 'I found a bug, how do I report it?',
    a: 'Please report it by contacting support to report any bugs or issues you encounter.',
  },
  {
    q: 'I want to suggest a feature, how can I do that?',
    a: 'Please use the contact support links to suggest any features you would like to see.',
  },
  {
    q: 'Is this the same as ItemTrax or Item Traxx?',
    a: 'Yes. If you searched for ItemTrax or Item Traxx, this is the official ItemTraxx website.',
  },
  {
    q: 'Is there a limit to how many items, transactions, and members I can have?',
    a: 'No, there are no limits to the number of items, transactions, or members you can have in ItemTraxx. The system is designed to scale with your needs.',
  },
];

const openFaqIndex = ref<number | null>(null);

const toggleFaq = (index: number) => {
  openFaqIndex.value = openFaqIndex.value === index ? null : index;
};

const trackCta = (
  cta: 'pricing' | 'demo' | 'login',
  location: 'header' | 'hero' | 'final',
) => {
  void trackAnalyticsEvent("landing_new_cta_click", { cta, location });
};

const refreshSystemStatus = async () => {
  const response = await fetchSystemStatus();
  if (!response) {
    statusLabel.value = 'Unknown';
    statusClass.value = 'status-unknown';
    return;
  }

  if (response.ok && response.payload.status === 'operational') {
    statusLabel.value = 'Running';
    statusClass.value = 'status-ok';
    return;
  }

  if (response.status >= 500 || response.payload.status === 'down') {
    statusLabel.value = 'Down';
    statusClass.value = 'status-down';
    return;
  }

  statusLabel.value = 'Degraded';
  statusClass.value = 'status-warn';
};

let observer: IntersectionObserver | null = null;
let statusTimer: number | null = null;
let themeObserver: MutationObserver | null = null;

const startStatusPolling = () => {
  if (statusTimer || document.visibilityState === 'hidden') return;
  statusTimer = window.setInterval(() => {
    void refreshSystemStatus();
  }, 60_000);
};

const stopStatusPolling = () => {
  if (!statusTimer) return;
  window.clearInterval(statusTimer);
  statusTimer = null;
};

const handleVisibilityChange = () => {
  if (document.visibilityState === 'hidden') {
    stopStatusPolling();
    return;
  }
  void refreshSystemStatus();
  startStatusPolling();
};

onMounted(() => {
  const syncTheme = () => {
    themeMode.value = document.documentElement.getAttribute('data-theme') === 'light' ? 'light' : 'dark';
  };
  syncTheme();
  themeObserver = new MutationObserver(syncTheme);
  themeObserver.observe(document.documentElement, {
    attributes: true,
    attributeFilter: ['data-theme'],
  });
  window.scrollTo({ top: 0, left: 0, behavior: 'auto' });
  void refreshSystemStatus();
  startStatusPolling();
  document.addEventListener('visibilitychange', handleVisibilityChange);

  const prefersReducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const revealElements = document.querySelectorAll<HTMLElement>('.reveal');

  if (prefersReducedMotion) {
    revealElements.forEach((el) => el.classList.add('is-visible'));
    return;
  }

  observer = new IntersectionObserver(
    (entries) => {
      entries.forEach((entry) => {
        if (entry.isIntersecting) {
          entry.target.classList.add('is-visible');
          observer?.unobserve(entry.target);
        }
      });
    },
    { threshold: 0.14, rootMargin: '0px 0px -30px 0px' },
  );

  revealElements.forEach((el) => observer?.observe(el));
});

onBeforeUnmount(() => {
  observer?.disconnect();
  observer = null;
  stopStatusPolling();
  document.removeEventListener('visibilitychange', handleVisibilityChange);
});

onUnmounted(() => {
  if (themeObserver) {
    themeObserver.disconnect();
    themeObserver = null;
  }
});
</script>

<style scoped>
.landing-new {
  position: relative;
  min-height: 100vh;
  margin: 0;
  padding: 1.35rem 0 4rem;
  overflow: hidden;
  color: #f5f7fb;
  background:
    radial-gradient(circle at top left, rgba(25, 194, 168, 0.16), transparent 22%),
    radial-gradient(circle at 82% 18%, rgba(25, 67, 155, 0.22), transparent 28%),
    linear-gradient(180deg, #10161f 0%, #090d14 100%);
}

.skip-link {
  position: absolute;
  left: 1rem;
  top: 0.75rem;
  transform: translateY(-180%);
  background: #0b1324;
  color: #fff;
  padding: 0.5rem 0.75rem;
  border-radius: 8px;
  font-weight: 600;
  z-index: 30;
  transition: transform 0.2s ease;
}

.skip-link:focus-visible {
  transform: translateY(0);
}

.shell {
  width: min(1280px, 92%);
  margin: 0 auto;
  position: relative;
  z-index: 2;
}

.ambient,
.grid-noise {
  pointer-events: none;
  position: absolute;
}

.ambient {
  border-radius: 999px;
  filter: blur(44px);
  opacity: 0.4;
}

.ambient-one {
  width: 22rem;
  height: 22rem;
  top: 5rem;
  left: -7rem;
  background: rgba(25, 194, 168, 0.2);
}

.ambient-two {
  width: 20rem;
  height: 20rem;
  top: 26rem;
  right: -6rem;
  background: rgba(25, 67, 155, 0.24);
}

.grid-noise {
  inset: 0;
  background-image:
    linear-gradient(rgba(255, 255, 255, 0.025) 1px, transparent 1px),
    linear-gradient(90deg, rgba(255, 255, 255, 0.025) 1px, transparent 1px);
  background-size: 36px 36px;
  mask-image: linear-gradient(180deg, rgba(0, 0, 0, 0.55), transparent 92%);
  opacity: 0.16;
}

.landing-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 1rem;
  padding: calc(0.6rem + env(safe-area-inset-top, 0px)) 0 1.8rem;
}

.brand-mark {
  display: inline-flex;
  align-items: center;
  text-decoration: none;
}

.brand-mark-full {
  height: 4.5rem;
  width: auto;
  object-fit: contain;
  flex-shrink: 0;
  display: block;
  transform: translateY(-2px);
}

.landing-nav {
  display: flex;
  align-items: center;
  gap: 0.7rem;
  flex-wrap: wrap;
}

.landing-nav a {
  color: rgba(235, 239, 244, 0.82);
  text-decoration: none;
}

.status-pill,
.nav-cta,
.cta-secondary,
.cta-primary {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  min-height: 2.15rem;
  padding: 0.42rem 0.85rem;
  border-radius: 10px;
  text-decoration: none;
  font-weight: 600;
  transition: transform 0.16s ease, box-shadow 0.16s ease, background-color 0.16s ease;
}

.status-pill {
  gap: 0.55rem;
  background: rgba(255, 255, 255, 0.05);
  border: 1px solid rgba(255, 255, 255, 0.08);
  white-space: nowrap;
}

.nav-cta,
.cta-secondary {
  background:
    linear-gradient(180deg, rgba(31, 40, 54, 0.94) 0%, rgba(17, 23, 32, 0.98) 100%);
  border: 1px solid rgba(77, 97, 122, 0.4);
  color: #f5f7fb;
  box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.04);
}

.cta-primary,
.nav-cta:hover,
.cta-secondary:hover,
.cta-primary:hover {
  box-shadow: 0 16px 32px rgba(25, 67, 155, 0.18);
  transform: translateY(-1px);
}

.cta-primary {
  background-image: linear-gradient(90deg, #19c2a8 0%, #19439b 100%);
  background-repeat: no-repeat;
  background-size: 100% 100%;
  background-origin: border-box;
  color: #f7fbff;
  border: 1px solid transparent;
}

.nav-cta:hover,
.cta-secondary:hover {
  border-color: rgba(39, 196, 172, 0.58);
  background:
    linear-gradient(180deg, rgba(29, 66, 75, 0.98) 0%, rgba(16, 37, 48, 1) 100%);
  box-shadow:
    inset 0 1px 0 rgba(115, 255, 233, 0.08),
    0 16px 32px rgba(25, 194, 168, 0.14);
  color: #e9fffb;
}

.status-dot {
  width: 0.6rem;
  height: 0.6rem;
  border-radius: 999px;
  display: inline-block;
}

.status-ok { background: #2fd17c; }
.status-warn { background: #f5b642; }
.status-down { background: #f35f6f; }
.status-unknown { background: #7b8698; }

.landing-main {
  display: grid;
  gap: 2rem;
}

.hero-grid,
.hero-copy,
.showcase-card,
.feature-band,
.feature-band-copy,
.feature-band-visual,
.final-strip,
.ops-grid,
.ops-panel,
.faq-section {
  opacity: 0;
  filter: blur(12px);
  transition:
    opacity 0.8s cubic-bezier(0.22, 1, 0.36, 1),
    transform 0.8s cubic-bezier(0.22, 1, 0.36, 1),
    filter 0.8s cubic-bezier(0.22, 1, 0.36, 1);
  will-change: opacity, transform, filter;
}

.reveal-up {
  transform: translateY(42px) scale(0.985);
}

.reveal-left {
  transform: translateX(-48px) scale(0.985);
}

.reveal-right {
  transform: translateX(48px) scale(0.985);
}

.reveal.is-visible {
  opacity: 1;
  transform: translateY(0);
  filter: blur(0);
}

.reveal.is-visible.reveal-left,
.reveal.is-visible.reveal-right {
  transform: translateX(0) scale(1);
}

.reveal.is-visible.reveal-up {
  transform: translateY(0) scale(1);
}

.reveal-delay-1 { transition-delay: 0.14s; }
.reveal-delay-2 { transition-delay: 0.28s; }
.reveal-delay-3 { transition-delay: 0.42s; }

.hero-grid {
  display: grid;
  grid-template-columns: minmax(0, 1.02fr) minmax(21rem, 0.98fr);
  gap: 1.8rem;
  align-items: stretch;
}

.hero-copy,
.feature-band,
.final-strip,
.ops-panel {
  border: 1px solid rgba(74, 92, 116, 0.34);
  background: linear-gradient(180deg, rgba(20, 27, 37, 0.94) 0%, rgba(12, 17, 24, 0.98) 100%);
  box-shadow: 0 18px 44px rgba(0, 0, 0, 0.22);
}

.hero-copy {
  border-radius: 28px;
  padding: 3rem;
  display: grid;
  align-content: center;
}

.hero-showcase {
  display: grid;
  gap: 1.3rem;
}

.eyebrow,
.showcase-label {
  margin: 0 0 0.85rem;
  font-size: 0.78rem;
  font-weight: 700;
  letter-spacing: 0.16em;
  text-transform: uppercase;
  color: rgba(214, 237, 233, 0.72);
}

.hero-copy h1,
.feature-band-copy h2,
.final-strip h2 {
  margin: 0;
  font-size: clamp(2.8rem, 5vw, 5.6rem);
  line-height: 0.98;
  letter-spacing: -0.06em;
}

.hero-body,
.feature-band-copy p,
.final-strip p,
.ops-panel p,
.ops-panel li,
.hero-points li,
.showcase-card p {
  color: rgba(222, 229, 238, 0.76);
}

.hero-body {
  margin: 1.35rem 0 0;
  max-width: 37rem;
  font-size: 1.4rem;
  line-height: 1.5;
  color: rgba(241, 245, 251, 0.9);
}

.hero-support {
  margin: 1.2rem 0 0;
  max-width: 36rem;
  font-size: 1rem;
  line-height: 1.8;
  color: rgba(222, 229, 238, 0.72);
}

.hero-actions,
.final-actions {
  display: flex;
  gap: 0.95rem;
  flex-wrap: wrap;
  margin-top: 1.9rem;
}

.hero-points {
  margin: 1.7rem 0 0;
  padding-left: 1.2rem;
  display: grid;
  gap: 0.6rem;
}

.hero-points li {
  line-height: 1.5;
}

.showcase-card {
  border-radius: 24px;
  padding: 1.75rem;
  border: 1px solid rgba(74, 92, 116, 0.34);
  background: linear-gradient(180deg, rgba(20, 27, 37, 0.94) 0%, rgba(12, 17, 24, 0.98) 100%);
}

.showcase-primary {
  display: grid;
  gap: 1.1rem;
}

.showcase-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 0.8rem;
}

.showcase-pill {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  padding: 0.35rem 0.75rem;
  border-radius: 999px;
  font-size: 0.78rem;
  font-weight: 600;
  background: rgba(25, 194, 168, 0.11);
  color: #85efe1;
  border: 1px solid rgba(25, 194, 168, 0.24);
}

.showcase-primary h2 {
  margin: 0;
  font-size: clamp(1.8rem, 3vw, 2.65rem);
  line-height: 1.12;
  letter-spacing: -0.05em;
  padding: 0.08em 0 0 0.04em;
}

.showcase-points {
  margin: 0;
  padding-left: 1.1rem;
  color: rgba(232, 238, 246, 0.84);
}

.showcase-points li + li {
  margin-top: 0.6rem;
}

.showcase-secondary {
  overflow: hidden;
}

.showcase-image,
.feature-image {
  display: block;
  width: 100%;
  height: auto;
  border-radius: 18px;
  border: 1px solid rgba(94, 113, 138, 0.22);
}

.ops-panel {
  border-radius: 22px;
  padding: 1.7rem;
}

.ops-panel h3 {
  margin: 0 0 0.8rem;
  font-size: 1.35rem;
  letter-spacing: -0.04em;
}

.feature-band {
  display: grid;
  grid-template-columns: minmax(0, 0.95fr) minmax(20rem, 1.05fr);
  gap: 1.6rem;
  border-radius: 28px;
  padding: 1.85rem;
}

.feature-band-copy,
.feature-band-visual {
  border-radius: 22px;
  overflow: hidden;
}

.feature-checks {
  margin: 1.2rem 0 0;
  padding-left: 1.2rem;
  color: rgba(235, 240, 248, 0.84);
}

.feature-checks li + li {
  margin-top: 0.6rem;
}

.ops-grid {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 1.2rem;
}

.final-strip {
  border-radius: 28px;
  padding: 2.1rem;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 1.5rem;
}

.faq-section {
  display: grid;
  gap: 1.25rem;
}

.faq-header h2 {
  margin: 0;
  font-size: clamp(2rem, 4vw, 3rem);
  line-height: 1.02;
  letter-spacing: -0.05em;
}

.faq-list {
  display: grid;
  gap: 1rem;
}

.faq-item {
  border-radius: 18px;
  border: 1px solid rgba(74, 92, 116, 0.34);
  background: linear-gradient(180deg, rgba(20, 27, 37, 0.94) 0%, rgba(12, 17, 24, 0.98) 100%);
  overflow: hidden;
}

.faq-toggle {
  width: 100%;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 1rem;
  padding: 1.15rem 1.3rem;
  background: transparent;
  border: 0;
  color: #f6f7fb;
  text-align: left;
  font: inherit;
  cursor: pointer;
}

.faq-toggle:hover,
.faq-toggle:focus-visible {
  background: linear-gradient(180deg, rgba(24, 33, 46, 0.98) 0%, rgba(14, 20, 29, 0.98) 100%);
  box-shadow: none;
}

.faq-symbol {
  font-size: 1.4rem;
  color: rgba(126, 232, 219, 0.9);
}

.faq-answer {
  display: grid;
  grid-template-rows: 0fr;
  transition: grid-template-rows 0.2s ease;
}

.faq-answer > p {
  overflow: hidden;
  margin: 0;
  padding: 0 1.3rem 0;
  color: rgba(222, 229, 238, 0.78);
  line-height: 1.72;
}

.faq-answer.is-open {
  grid-template-rows: 1fr;
}

.faq-answer.is-open > p {
  padding-bottom: 1rem;
}

.landing-footer {
  margin-top: 3.6rem;
  padding: 1rem 0 0;
  color: rgba(216, 224, 235, 0.76);
}

.landing-footer :deep(.public-footer) {
  width: 100%;
  margin-top: 0;
  color: inherit;
}

@media (max-width: 1100px) {
  .hero-grid,
  .feature-band,
  .ops-grid,
  .final-strip {
    grid-template-columns: 1fr;
  }

  .final-strip {
    align-items: flex-start;
    flex-direction: column;
  }

}

@media (max-width: 720px) {
  .shell {
    width: min(100%, calc(100% - 1.5rem));
  }

  .landing-header {
    align-items: center;
    flex-direction: row;
    gap: 0.7rem;
    padding: calc(0.35rem + env(safe-area-inset-top, 0px)) 0 1.25rem;
  }

  .landing-nav {
    flex: 1;
    justify-content: flex-end;
    flex-wrap: nowrap;
    gap: 0.5rem;
    min-width: 0;
    overflow-x: auto;
    scrollbar-width: none;
    padding-left: 0.15rem;
  }

  .landing-nav::-webkit-scrollbar {
    display: none;
  }

  .brand-mark {
    flex-shrink: 0;
  }

  .brand-mark-full {
    height: 3rem;
  }

  .landing-nav a,
  .status-pill,
  .nav-cta {
    font-size: 0.74rem;
  }

  .status-pill,
  .nav-cta,
  .cta-secondary,
  .cta-primary {
    min-height: 1.7rem;
    padding: 0.26rem 0.58rem;
    border-radius: 999px;
  }

  .status-pill {
    gap: 0.38rem;
    padding-inline: 0.52rem 0.62rem;
  }

  .status-dot {
    width: 0.45rem;
    height: 0.45rem;
  }

  .landing-footer {
    align-items: flex-start;
    flex-direction: column;
    gap: 1rem;
  }

  .footer-grid {
    width: 100%;
    grid-template-columns: repeat(2, minmax(0, 1fr));
    gap: 1.2rem 1.8rem;
  }

  .hero-copy,
  .showcase-card,
  .feature-band,
  .ops-panel,
  .final-strip {
    border-radius: 22px;
  }

  .hero-copy,
  .feature-band,
  .final-strip {
    padding: 1.2rem;
  }

  .hero-copy h1,
  .feature-band-copy h2,
  .final-strip h2 {
    font-size: clamp(2.2rem, 10vw, 3.25rem);
  }
}
</style>
