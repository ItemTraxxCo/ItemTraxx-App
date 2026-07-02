<template>
  <div class="lp">
    <a class="skip-link" href="#landing-new-main">Skip to main content</a>

    <svg class="bg-trails" viewBox="0 0 1440 900" preserveAspectRatio="xMaxYMid slice" aria-hidden="true">
      <defs>
        <linearGradient id="lp-trace" x1="0%" y1="100%" x2="100%" y2="0%">
          <stop offset="0%" stop-color="#2c5cf6" stop-opacity="0" />
          <stop offset="45%" stop-color="#2c5cf6" />
          <stop offset="78%" stop-color="#22c3ea" />
          <stop offset="100%" stop-color="#2ce9c4" />
        </linearGradient>
        <linearGradient id="lp-trace-soft" x1="0%" y1="100%" x2="100%" y2="0%">
          <stop offset="0%" stop-color="#2c5cf6" stop-opacity="0" />
          <stop offset="60%" stop-color="#2456d8" stop-opacity="0.55" />
          <stop offset="100%" stop-color="#22c3ea" stop-opacity="0.9" />
        </linearGradient>
      </defs>
      <path class="trail trail-a" d="M-80 880 C 480 840, 950 640, 1240 160" />
      <path class="trail trail-b" d="M60 910 C 560 880, 1040 700, 1330 260" />
      <path class="trail trail-c" d="M240 920 C 700 900, 1130 760, 1410 380" />
      <circle class="node node-1" cx="1240" cy="160" r="5" />
      <circle class="node node-2" cx="1330" cy="260" r="4" />
      <circle class="node node-3" cx="1410" cy="380" r="3.5" />
      <circle class="node node-4" cx="1120" cy="420" r="2.5" />
      <circle class="node node-5" cx="1010" cy="560" r="2" />
    </svg>
    <div class="bg-grid" aria-hidden="true"></div>

    <header class="lp-header shell">
      <RouterLink class="brand-mark" to="/">
        <img class="brand-mark-full" :src="brandLogoUrl" alt="ItemTraxx Co" />
      </RouterLink>
      <nav class="lp-nav" aria-label="Primary">
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

    <main id="landing-new-main" class="shell lp-main">
      <section class="hero">
        <div class="hero-copy reveal">
          <p class="eyebrow">Inventory tracking made simple<span class="caret" aria-hidden="true">▍</span></p>
          <h1 class="hero-title"><span>Item</span><span class="grad-text">Traxx</span></h1>
          <p class="tagline" aria-label="Smart. Track. Transform.">
            <span class="tag-blue">Smart.</span>
            <span class="tag-cyan">Track.</span>
            <span class="tag-mint">Transform.</span>
          </p>
          <p class="hero-body">
            Losing track of where stuff goes? ItemTraxx is the right service for you.
          </p>
          <p class="hero-support">
            Contact us to start mastering your inventory with ItemTraxx's checkout,
            returns, and admin management.
          </p>
          <div class="hero-actions">
            <RouterLink class="cta-primary" to="/pricing" @click="trackCta('pricing', 'hero')">Pricing</RouterLink>
            <RouterLink class="cta-secondary" to="/request-demo" @click="trackCta('demo', 'hero')">
              Request Demo
            </RouterLink>
          </div>
        </div>

        <div class="hero-panel reveal reveal-delay-1">
          <article class="ledger" aria-label="Checkout flow demo">
            <header class="ledger-head">
              <span class="ledger-title">Checkout and return</span>
              <span class="live-pill"><span class="live-dot" aria-hidden="true"></span>Demo</span>
            </header>
            <div class="demo-app">
              <p class="demo-app-brand">ItemTraxx</p>
              <p class="demo-app-copy">Checkout and return</p>
              <div class="demo-card">
                <div>
                  <span class="demo-label">Borrower ID</span>
                  <div class="demo-input-row">
                    <div class="demo-input" :class="{ 'is-focus': demoStage === 'typing' }">
                      <span v-if="demoTyped">{{ demoTyped }}</span>
                      <span v-else class="demo-placeholder">Enter borrower ID</span>
                      <span v-if="demoStage === 'typing'" class="demo-caret" aria-hidden="true">▍</span>
                    </div>
                    <span class="demo-btn" :class="{ 'is-active': demoStage === 'loading' }">Load borrower</span>
                  </div>
                  <p v-if="!demoBorrowerVisible" class="demo-hint">Enter a borrower ID to begin.</p>
                </div>

                <Transition name="demo-fade">
                  <div v-if="demoBorrowerVisible" class="demo-summary">
                    <p class="demo-summary-name">
                      <strong>jordan.m</strong>
                      <span class="demo-muted"> ID: 24187</span>
                    </p>
                    <p class="demo-muted">No items currently checked out.</p>
                  </div>
                </Transition>

                <Transition name="demo-fade">
                  <div v-if="demoBorrowerVisible">
                    <span class="demo-label">Item barcode</span>
                    <div class="demo-input-row">
                      <div class="demo-input" :class="{ 'is-focus': demoStage === 'scan' }">
                        <span v-if="demoStage === 'scan'">ITX-0147</span>
                        <span v-else class="demo-placeholder">Scan or enter barcode</span>
                      </div>
                      <span class="demo-btn" :class="{ 'is-active': demoStage === 'scan' }">Add barcode</span>
                    </div>
                  </div>
                </Transition>

                <Transition name="demo-fade">
                  <div v-if="demoStage === 'scanned' || demoStage === 'submitting'">
                    <p class="demo-subheading">Items</p>
                    <p class="demo-item-row">
                      Canon EOS R50
                      <span class="demo-muted"> (ITX-0147)</span>
                      <span class="demo-tag">Checkout</span>
                      <span class="demo-remove">Remove</span>
                    </p>
                  </div>
                </Transition>

                <Transition name="demo-fade">
                  <span
                    v-if="demoBorrowerVisible"
                    class="demo-btn demo-submit"
                    :class="{ 'is-active': demoStage === 'submitting' }"
                  >
                    Complete transaction
                  </span>
                </Transition>

                <Transition name="demo-fade">
                  <div v-if="demoStage === 'submitted'" class="demo-toast">
                    <p class="demo-toast-title">Transaction complete (Success).</p>
                    <p class="demo-muted">processed: 1 checkout(s), 0 return(s)</p>
                  </div>
                </Transition>
              </div>
            </div>
            <p class="ledger-caption">The actual flow: load a borrower, scan barcodes, complete the transaction.</p>
          </article>

          <ul class="hero-points" aria-label="Key product benefits">
            <li>Secure sign-ins and protected admin access</li>
            <li>Clear transaction history and audit visibility</li>
            <li>Easy item and user management features</li>
            <li>Designed for teams, organizations, and individual users</li>
            <li>Built to scale with your inventory and operations</li>
            <li>Avoid common inventory management fails</li>
          </ul>
        </div>
      </section>

      <div class="marquee" aria-label="Product capabilities">
        <div class="marquee-track">
          <span v-for="cap in capabilities" :key="cap" class="marquee-item">
            {{ cap }}<span class="marquee-star" aria-hidden="true">✦</span>
          </span>
          <span v-for="cap in capabilities" :key="`dup-${cap}`" class="marquee-item" aria-hidden="true">
            {{ cap }}<span class="marquee-star">✦</span>
          </span>
        </div>
      </div>

      <section class="feature-band reveal">
        <div class="feature-copy">
          <p class="eyebrow">Simple usage</p>
          <h2>Simple UI keeps everything minimal, sleek, and easy to navigate.</h2>
          <p class="section-sub">Confusion free, for admins and borrowers alike.</p>
          <ul class="check-list">
            <li>Fast sign in and transaction flow</li>
            <li>Clean and clear user-facing workflow design</li>
            <li>Light and dark appearance modes available</li>
          </ul>
        </div>
      </section>

      <section class="pillars reveal">
        <article class="pillar">
          <span class="pillar-num" aria-hidden="true">01</span>
          <p class="eyebrow">Easy management</p>
          <h3>Management workflows without the spreadsheet sprawl.</h3>
          <p>
            With many useful features such as item management, user management, transaction logs,
            and more, keeping track of inventory has never been easier.
          </p>
        </article>
        <article class="pillar">
          <span class="pillar-num" aria-hidden="true">02</span>
          <p class="eyebrow">Why it matters</p>
          <h3>Master your inventory.</h3>
          <p>
            ItemTraxx solves issues with keeping track of inventory: who has what item, when it was
            taken, when it was returned, and what items are currently out.
          </p>
        </article>
        <article class="pillar">
          <span class="pillar-num" aria-hidden="true">03</span>
          <p class="eyebrow">Fit</p>
          <h3>Built for teams, organizations, and individual users.</h3>
          <p>
            ItemTraxx is flexible and scalable, making it a fit for schools, smaller and larger
            teams, and organizations of any size that need cleaner inventory operations. We also
            offer individual plans for single-user use.
          </p>
        </article>
      </section>

      <section class="why reveal">
        <div class="section-head">
          <p class="eyebrow">Why teams run ItemTraxx</p>
          <h2>One system for the whole checkout loop.</h2>
        </div>
        <div class="why-grid">
          <article v-for="(variant, index) in showcaseVariants" :key="variant.title" class="why-card">
            <header class="why-head">
              <span class="why-index">{{ String(index + 1).padStart(2, "0") }}</span>
              <span class="why-pill">{{ variant.pill }}</span>
            </header>
            <p class="why-label">{{ variant.label }}</p>
            <h3>{{ variant.title }}</h3>
            <p class="why-body">{{ variant.body }}</p>
            <ul class="why-points">
              <li v-for="point in variant.points" :key="point">{{ point }}</li>
            </ul>
          </article>
        </div>
      </section>

      <section class="faq reveal">
        <div class="section-head">
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
              <span class="faq-index" aria-hidden="true">{{ String(index + 1).padStart(2, "0") }}</span>
              <span class="faq-q">{{ item.q }}</span>
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

      <section class="final-strip reveal">
        <p class="eyebrow">Ready to simplify your inventory tracking?</p>
        <h2>Get started with ItemTraxx and advance your inventory management.</h2>
        <p class="section-sub">Simplify your inventory management with ItemTraxx today.</p>
        <div class="final-actions">
          <RouterLink class="cta-primary" to="/login" @click="trackCta('login', 'final')">Go to Login</RouterLink>
          <RouterLink class="cta-secondary" to="/pricing" @click="trackCta('pricing', 'final')">Pricing</RouterLink>
        </div>
      </section>
    </main>

    <div class="lp-footer shell">
      <PublicFooter />
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from 'vue';
import { RouterLink } from 'vue-router';
import { trackAnalyticsEvent } from "../services/analyticsService";
import { capturePostHogEvent } from "../services/posthogService";
import { fetchSystemStatus } from '../services/systemStatusService';
import PublicFooter from "../components/PublicFooter.vue";

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

const capabilities = [
  'Checkout & returns',
  'Transaction history',
  'Audit logs',
  'Item management',
  'User management',
  'Admin controls',
  'Light & dark modes',
  'No item limits',
  'Built to scale',
];

type DemoStage =
  | 'idle'
  | 'typing'
  | 'loading'
  | 'loaded'
  | 'scan'
  | 'scanned'
  | 'submitting'
  | 'submitted';

const DEMO_BORROWER_ID = '24187';
const demoStage = ref<DemoStage>('idle');
const demoTyped = ref('');
let demoHoldTicks = 0;

const demoBorrowerVisible = computed(() =>
  demoStage.value === 'loaded'
  || demoStage.value === 'scan'
  || demoStage.value === 'scanned'
  || demoStage.value === 'submitting',
);

const demoHold = (ticks: number, next: DemoStage) => {
  if (++demoHoldTicks >= ticks) {
    demoHoldTicks = 0;
    demoStage.value = next;
  }
};

const advanceDemo = () => {
  switch (demoStage.value) {
    case 'idle':
      demoHold(2, 'typing');
      break;
    case 'typing':
      if (demoTyped.value.length < DEMO_BORROWER_ID.length) {
        demoTyped.value = DEMO_BORROWER_ID.slice(0, demoTyped.value.length + 1);
      } else {
        demoStage.value = 'loading';
      }
      break;
    case 'loading':
      demoHold(1, 'loaded');
      break;
    case 'loaded':
      demoHold(3, 'scan');
      break;
    case 'scan':
      demoHold(2, 'scanned');
      break;
    case 'scanned':
      demoHold(3, 'submitting');
      break;
    case 'submitting':
      demoHoldTicks = 0;
      demoTyped.value = '';
      demoStage.value = 'submitted';
      break;
    case 'submitted':
      demoHold(6, 'idle');
      break;
  }
};

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
  capturePostHogEvent("landing_cta_clicked", { cta, location });
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
let demoTimer: number | null = null;

const startStatusPolling = () => {
  if (statusTimer || document.visibilityState === 'hidden') return;
  statusTimer = window.setInterval(() => {
    void refreshSystemStatus();
  }, 300_000);
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
  window.scrollTo({ top: 0, left: 0, behavior: 'auto' });
  void refreshSystemStatus();
  startStatusPolling();
  document.addEventListener('visibilitychange', handleVisibilityChange);

  const prefersReducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const revealElements = document.querySelectorAll<HTMLElement>('.reveal');

  if (prefersReducedMotion) {
    revealElements.forEach((el) => el.classList.add('is-visible'));
    demoTyped.value = DEMO_BORROWER_ID;
    demoStage.value = 'scanned';
    return;
  }

  demoTimer = window.setInterval(advanceDemo, 450);

  observer = new IntersectionObserver(
    (entries) => {
      entries.forEach((entry) => {
        if (entry.isIntersecting) {
          entry.target.classList.add('is-visible');
          observer?.unobserve(entry.target);
        }
      });
    },
    { threshold: 0.12, rootMargin: '0px 0px -30px 0px' },
  );

  revealElements.forEach((el) => observer?.observe(el));
});

onBeforeUnmount(() => {
  observer?.disconnect();
  observer = null;
  stopStatusPolling();
  if (demoTimer) {
    window.clearInterval(demoTimer);
    demoTimer = null;
  }
  document.removeEventListener('visibilitychange', handleVisibilityChange);
});
</script>

<style scoped>
.lp {
  --lp-bg: #030509;
  --lp-panel: rgba(10, 16, 28, 0.78);
  --lp-panel-solid: #0a101c;
  --lp-line: rgba(124, 156, 214, 0.16);
  --lp-line-strong: rgba(124, 156, 214, 0.3);
  --lp-ink: #eef3fb;
  --lp-mute: rgba(206, 219, 238, 0.62);
  --lp-blue: #2c5cf6;
  --lp-cyan: #22c3ea;
  --lp-mint: #2ce9c4;
  --lp-trace: linear-gradient(90deg, #2c5cf6 0%, #22c3ea 52%, #2ce9c4 100%);
  --lp-display: "Sora", "Inter", "Segoe UI", sans-serif;
  --lp-mono: "JetBrains Mono", "SFMono-Regular", Menlo, monospace;

  position: relative;
  min-height: 100vh;
  margin: 0;
  padding: 1.35rem 0 4rem;
  overflow: hidden;
  font-family: var(--lp-display);
  color: var(--lp-ink);
  background:
    radial-gradient(ellipse 60% 40% at 85% 8%, rgba(44, 92, 246, 0.14), transparent 70%),
    radial-gradient(ellipse 50% 35% at 15% 92%, rgba(34, 195, 234, 0.06), transparent 70%),
    linear-gradient(180deg, #05070d 0%, var(--lp-bg) 45%, #04060b 100%);
}

/* ---------- background layers ---------- */

.bg-trails {
  position: absolute;
  inset: 0;
  width: 100%;
  height: min(100vh, 60rem);
  pointer-events: none;
  opacity: 0.85;
}

.trail {
  fill: none;
  stroke: url(#lp-trace);
  stroke-linecap: round;
}

.trail-a { stroke-width: 2.6; opacity: 0.8; }
.trail-b { stroke-width: 1.6; opacity: 0.5; stroke: url(#lp-trace-soft); }
.trail-c { stroke-width: 1.1; opacity: 0.3; stroke: url(#lp-trace-soft); }

.node {
  fill: var(--lp-cyan);
  opacity: 0.9;
  animation: node-pulse 3.4s ease-in-out infinite;
}

.node-1 { fill: var(--lp-mint); }
.node-2 { animation-delay: 0.6s; }
.node-3 { animation-delay: 1.2s; fill: var(--lp-mint); }
.node-4 { animation-delay: 1.8s; fill: var(--lp-blue); }
.node-5 { animation-delay: 2.4s; }

@keyframes node-pulse {
  0%, 100% { opacity: 0.35; }
  50% { opacity: 1; }
}

.bg-grid {
  position: absolute;
  inset: 0;
  pointer-events: none;
  background-image:
    linear-gradient(rgba(148, 180, 235, 0.05) 1px, transparent 1px),
    linear-gradient(90deg, rgba(148, 180, 235, 0.05) 1px, transparent 1px);
  background-size: 44px 44px;
  mask-image: radial-gradient(ellipse 90% 55% at 50% 0%, rgba(0, 0, 0, 0.5), transparent 90%);
}

/* ---------- shared ---------- */

.shell {
  width: min(1240px, 92%);
  margin: 0 auto;
  position: relative;
  z-index: 2;
}

.skip-link {
  position: absolute;
  left: 1rem;
  top: 0.75rem;
  transform: translateY(-180%);
  background: var(--lp-panel-solid);
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

.lp a:focus-visible,
.lp button:focus-visible {
  outline: 2px solid var(--lp-cyan);
  outline-offset: 2px;
}

.eyebrow {
  margin: 0 0 1rem;
  font-family: var(--lp-mono);
  font-size: 0.74rem;
  font-weight: 500;
  letter-spacing: 0.22em;
  text-transform: uppercase;
  color: var(--lp-cyan);
}

.eyebrow::before {
  content: "// ";
  color: var(--lp-mute);
}

.section-head {
  max-width: 46rem;
  margin-bottom: 2rem;
}

.section-head h2,
.feature-copy h2,
.final-strip h2 {
  margin: 0;
  font-size: clamp(1.9rem, 3.6vw, 3rem);
  line-height: 1.08;
  letter-spacing: -0.045em;
  font-weight: 700;
}

.section-sub {
  margin: 1rem 0 0;
  color: var(--lp-mute);
  line-height: 1.7;
  max-width: 40rem;
}

.grad-text {
  background: var(--lp-trace);
  -webkit-background-clip: text;
  background-clip: text;
  color: transparent;
}

/* ---------- header ---------- */

.lp-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 1rem;
  padding: calc(0.6rem + env(safe-area-inset-top, 0px)) 0 2rem;
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
}

.lp-nav {
  display: flex;
  align-items: center;
  gap: 1.1rem;
  flex-wrap: wrap;
}

.lp-nav > a {
  color: rgba(226, 235, 247, 0.82);
  text-decoration: none;
  font-size: 0.92rem;
  font-weight: 600;
  transition: color 0.15s ease;
}

.lp-nav > a:hover {
  color: var(--lp-ink);
}

.status-pill {
  display: inline-flex;
  align-items: center;
  gap: 0.5rem;
  padding: 0.36rem 0.8rem;
  border-radius: 999px;
  border: 1px solid var(--lp-line);
  background: rgba(12, 19, 33, 0.7);
  font-family: var(--lp-mono);
  font-size: 0.74rem !important;
  letter-spacing: 0.08em;
  text-transform: uppercase;
  white-space: nowrap;
}

.status-dot {
  width: 0.55rem;
  height: 0.55rem;
  border-radius: 999px;
  display: inline-block;
}

.status-ok { background: #2fd17c; box-shadow: 0 0 8px rgba(47, 209, 124, 0.8); }
.status-warn { background: #f5b642; box-shadow: 0 0 8px rgba(245, 182, 66, 0.8); }
.status-down { background: #f35f6f; box-shadow: 0 0 8px rgba(243, 95, 111, 0.8); }
.status-unknown { background: #7b8698; }

.nav-cta,
.cta-primary,
.cta-secondary {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  min-height: 2.4rem;
  padding: 0.5rem 1.15rem;
  border-radius: 12px;
  text-decoration: none;
  font-weight: 700;
  font-size: 0.95rem;
  letter-spacing: -0.01em;
  transition: transform 0.16s ease, box-shadow 0.16s ease, border-color 0.16s ease, color 0.16s ease;
}

.nav-cta,
.cta-secondary {
  color: var(--lp-ink);
  border: 1px solid var(--lp-line-strong);
  background: rgba(14, 22, 38, 0.72);
}

.nav-cta:hover,
.cta-secondary:hover {
  transform: translateY(-1px);
  border-color: rgba(44, 233, 196, 0.55);
  box-shadow: 0 12px 30px rgba(34, 195, 234, 0.14);
  color: #e9fffb;
}

.cta-primary {
  position: relative;
  color: #04121c;
  background: #19c2a8;
  border: 1px solid transparent;
}

.cta-primary:hover {
  transform: translateY(-1px);
  background: #1fd6b9;
}

/* ---------- main / hero ---------- */

.lp-main {
  display: grid;
  gap: 4.5rem;
}

.hero {
  display: grid;
  grid-template-columns: minmax(0, 1.05fr) minmax(21rem, 0.95fr);
  gap: 3rem;
  align-items: center;
  padding-top: 1.5rem;
}

.hero-copy .eyebrow {
  margin-bottom: 1.4rem;
}

.caret {
  margin-left: 0.2rem;
  color: var(--lp-mint);
  animation: caret-blink 1.1s steps(1) infinite;
}

@keyframes caret-blink {
  0%, 100% { opacity: 1; }
  50% { opacity: 0; }
}

.hero-title {
  margin: 0;
  font-size: clamp(3.4rem, 8.5vw, 7rem);
  line-height: 0.96;
  letter-spacing: -0.055em;
  font-weight: 800;
}

.tagline {
  margin: 1.1rem 0 0;
  font-size: clamp(1.05rem, 2vw, 1.4rem);
  font-weight: 700;
  letter-spacing: -0.02em;
  display: flex;
  gap: 0.55em;
  flex-wrap: wrap;
}

.tag-blue { color: #4d79ff; }
.tag-cyan { color: var(--lp-cyan); }
.tag-mint { color: var(--lp-mint); }

.hero-body {
  margin: 1.6rem 0 0;
  max-width: 34rem;
  font-size: 1.3rem;
  line-height: 1.5;
  color: rgba(238, 243, 251, 0.92);
}

.hero-support {
  margin: 1rem 0 0;
  max-width: 33rem;
  line-height: 1.75;
  color: var(--lp-mute);
}

.hero-actions,
.final-actions {
  display: flex;
  gap: 0.95rem;
  flex-wrap: wrap;
  margin-top: 2rem;
}

/* ---------- ledger ---------- */

.hero-panel {
  display: grid;
  gap: 1.4rem;
}

.ledger {
  position: relative;
  border-radius: 20px;
  border: 1px solid var(--lp-line);
  background: var(--lp-panel);
  padding: 1.25rem 1.35rem 1.1rem;
  overflow: hidden;
}

.ledger::before {
  content: "";
  position: absolute;
  inset: 0 0 auto;
  height: 1px;
  background: var(--lp-trace);
  opacity: 0.85;
}

.ledger-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 1rem;
}

.ledger-title {
  font-family: var(--lp-mono);
  font-size: 0.74rem;
  letter-spacing: 0.2em;
  text-transform: uppercase;
  color: var(--lp-mute);
}

.live-pill {
  display: inline-flex;
  align-items: center;
  gap: 0.42rem;
  font-family: var(--lp-mono);
  font-size: 0.68rem;
  letter-spacing: 0.16em;
  text-transform: uppercase;
  color: var(--lp-mint);
}

.live-dot {
  width: 0.5rem;
  height: 0.5rem;
  border-radius: 999px;
  background: var(--lp-mint);
  box-shadow: 0 0 10px rgba(44, 233, 196, 0.9);
  animation: node-pulse 1.8s ease-in-out infinite;
}

.demo-app {
  min-height: 21rem;
  border-radius: 14px;
  background: #f7f7f5;
  color: #171717;
  font-family: "Inter", "Segoe UI", sans-serif;
  padding: 1rem 1.1rem 1.1rem;
}

.demo-app-brand {
  margin: 0;
  font-size: 1.2rem;
  font-weight: 800;
  letter-spacing: -0.055em;
  line-height: 1;
}

.demo-app-copy {
  margin: 0.3rem 0 0.75rem;
  font-size: 0.8rem;
  color: #5f6368;
}

.demo-card {
  display: grid;
  align-content: start;
  gap: 0.85rem;
  padding: 1rem;
  border-radius: 16px;
  border: 1px solid #d8d8d3;
  background: #ffffff;
}

.demo-label {
  display: block;
  margin-bottom: 0.4rem;
  font-size: 0.82rem;
  font-weight: 500;
}

.demo-input-row {
  display: flex;
  gap: 0.55rem;
  align-items: center;
}

.demo-input {
  flex: 1;
  min-width: 0;
  display: flex;
  align-items: center;
  height: 2.2rem;
  padding: 0 0.72rem;
  border-radius: 12px;
  border: 1px solid #c9c9c2;
  background: #ffffff;
  font-size: 0.85rem;
  transition: border-color 0.2s ease, box-shadow 0.2s ease;
}

.demo-input.is-focus {
  border-color: #171717;
  box-shadow: 0 0 0 3px rgba(23, 23, 23, 0.08);
}

.demo-placeholder {
  color: #9aa0a6;
}

.demo-caret {
  color: #171717;
  animation: caret-blink 0.9s steps(1) infinite;
}

.demo-btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  min-height: 2.2rem;
  padding: 0.36rem 0.8rem;
  border-radius: 12px;
  background: #171717;
  color: #ffffff;
  font-size: 0.8rem;
  font-weight: 600;
  white-space: nowrap;
  transition: filter 0.2s ease, transform 0.2s ease;
}

.demo-btn.is-active {
  filter: brightness(1.7);
  transform: scale(0.97);
}

.demo-hint {
  margin: 0.55rem 0 0;
  font-size: 0.78rem;
  color: #5f6368;
}

.demo-summary {
  display: grid;
  gap: 0.3rem;
}

.demo-summary-name {
  margin: 0;
  font-size: 0.88rem;
}

.demo-muted {
  color: #5f6368;
  font-size: 0.78rem;
}

.demo-subheading {
  margin: 0 0 0.35rem;
  font-size: 0.82rem;
  font-weight: 700;
}

.demo-item-row {
  margin: 0;
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  font-size: 0.84rem;
}

.demo-tag,
.demo-remove {
  display: inline-flex;
  align-items: center;
  margin-left: 0.5rem;
  padding: 0.2rem 0.55rem;
  border-radius: 999px;
  font-size: 0.72rem;
  font-weight: 600;
  border: 1px solid #d8d8d3;
  background: #f1f1ee;
  white-space: nowrap;
}

.demo-tag {
  color: #0b5;
}

.demo-remove {
  color: #171717;
}

.demo-submit {
  justify-self: start;
}

.demo-toast {
  display: grid;
  gap: 0.25rem;
  padding: 0.75rem 0.9rem;
  border-radius: 12px;
  border: 1px solid #d8d8d3;
  background: #f1f1ee;
}

.demo-toast-title {
  margin: 0;
  font-size: 0.84rem;
  font-weight: 700;
  color: #15803d;
}

.ledger-caption {
  margin: 1rem 0 0;
  font-size: 0.82rem;
  color: var(--lp-mute);
}

.demo-fade-enter-from {
  opacity: 0;
  transform: translateY(10px);
}

.demo-fade-enter-active {
  transition: opacity 0.35s ease, transform 0.35s cubic-bezier(0.22, 1, 0.36, 1);
}

.demo-fade-leave-active {
  transition: opacity 0.22s ease;
}

.demo-fade-leave-to {
  opacity: 0;
}

/* ---------- hero points ---------- */

.hero-points {
  margin: 0;
  padding: 0;
  list-style: none;
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 0.65rem 1.1rem;
}

.hero-points li {
  position: relative;
  padding-left: 1.45rem;
  font-size: 0.88rem;
  line-height: 1.5;
  color: rgba(222, 231, 243, 0.82);
}

.hero-points li::before {
  content: "✓";
  position: absolute;
  left: 0;
  top: 0;
  font-family: var(--lp-mono);
  font-weight: 600;
  background: var(--lp-trace);
  -webkit-background-clip: text;
  background-clip: text;
  color: transparent;
}

/* ---------- marquee ---------- */

.marquee {
  position: relative;
  overflow: hidden;
  padding: 1.1rem 0;
  border-top: 1px solid var(--lp-line);
  border-bottom: 1px solid var(--lp-line);
  mask-image: linear-gradient(90deg, transparent, #000 8%, #000 92%, transparent);
}

.marquee-track {
  display: flex;
  width: max-content;
  animation: marquee-slide 30s linear infinite;
}

.marquee-item {
  display: inline-flex;
  align-items: center;
  font-family: var(--lp-mono);
  font-size: 0.78rem;
  letter-spacing: 0.2em;
  text-transform: uppercase;
  color: rgba(196, 212, 236, 0.66);
  white-space: nowrap;
}

.marquee-star {
  margin: 0 1.6rem;
  background: var(--lp-trace);
  -webkit-background-clip: text;
  background-clip: text;
  color: transparent;
}

@keyframes marquee-slide {
  from { transform: translateX(0); }
  to { transform: translateX(-50%); }
}

/* ---------- feature band ---------- */

.feature-band {
  display: grid;
  justify-items: start;
}

.check-list {
  margin: 1.6rem 0 0;
  padding: 0;
  list-style: none;
  display: grid;
  gap: 0.75rem;
}

.check-list li {
  position: relative;
  padding-left: 1.6rem;
  color: rgba(228, 236, 247, 0.85);
  line-height: 1.55;
}

.check-list li::before {
  content: "✓";
  position: absolute;
  left: 0;
  font-family: var(--lp-mono);
  font-weight: 600;
  background: var(--lp-trace);
  -webkit-background-clip: text;
  background-clip: text;
  color: transparent;
}

/* ---------- pillars ---------- */

.pillars {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 1.3rem;
}

.pillar {
  position: relative;
  border-radius: 20px;
  border: 1px solid var(--lp-line);
  background: var(--lp-panel);
  padding: 1.8rem 1.7rem;
  overflow: hidden;
  transition: border-color 0.2s ease, transform 0.2s ease;
}

.pillar:hover {
  border-color: rgba(34, 195, 234, 0.4);
  transform: translateY(-3px);
}

.pillar-num {
  display: block;
  font-family: var(--lp-mono);
  font-size: 2.6rem;
  font-weight: 600;
  line-height: 1;
  margin-bottom: 1.1rem;
  background: var(--lp-trace);
  -webkit-background-clip: text;
  background-clip: text;
  color: transparent;
  opacity: 0.9;
}

.pillar h3,
.why-card h3 {
  margin: 0 0 0.75rem;
  font-size: 1.28rem;
  line-height: 1.25;
  letter-spacing: -0.03em;
  font-weight: 700;
}

.pillar p:last-child,
.why-body {
  margin: 0;
  color: var(--lp-mute);
  line-height: 1.7;
  font-size: 0.95rem;
}

/* ---------- why grid ---------- */

.why-grid {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 1.3rem;
}

.why-card {
  display: flex;
  flex-direction: column;
  border-radius: 20px;
  border: 1px solid var(--lp-line);
  background: var(--lp-panel);
  padding: 1.6rem 1.5rem;
  transition: border-color 0.2s ease, transform 0.2s ease;
}

.why-card:hover {
  border-color: rgba(44, 233, 196, 0.38);
  transform: translateY(-3px);
}

.why-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 1rem;
}

.why-index {
  font-family: var(--lp-mono);
  font-size: 0.8rem;
  color: rgba(150, 178, 220, 0.55);
}

.why-pill {
  font-family: var(--lp-mono);
  font-size: 0.62rem;
  letter-spacing: 0.14em;
  text-transform: uppercase;
  padding: 0.28rem 0.65rem;
  border-radius: 999px;
  color: #8af0d9;
  background: rgba(44, 233, 196, 0.08);
  border: 1px solid rgba(44, 233, 196, 0.24);
}

.why-label {
  margin: 0 0 0.5rem;
  font-family: var(--lp-mono);
  font-size: 0.68rem;
  letter-spacing: 0.18em;
  text-transform: uppercase;
  color: var(--lp-cyan);
}

.why-body {
  margin-bottom: 1.1rem;
}

.why-points {
  margin: auto 0 0;
  padding: 0.9rem 0 0;
  list-style: none;
  border-top: 1px solid var(--lp-line);
  display: grid;
  gap: 0.45rem;
}

.why-points li {
  position: relative;
  padding-left: 1.15rem;
  font-size: 0.82rem;
  color: rgba(210, 222, 240, 0.72);
  line-height: 1.5;
}

.why-points li::before {
  content: "▸";
  position: absolute;
  left: 0;
  color: var(--lp-cyan);
}

/* ---------- faq ---------- */

.faq-list {
  border-top: 1px solid var(--lp-line);
}

.faq-item {
  border-bottom: 1px solid var(--lp-line);
}

.faq-toggle {
  width: 100%;
  display: flex;
  align-items: baseline;
  gap: 1.1rem;
  padding: 1.2rem 0.4rem;
  background: transparent;
  border: 0;
  color: var(--lp-ink);
  text-align: left;
  font: inherit;
  font-weight: 600;
  cursor: pointer;
  transition: color 0.15s ease;
}

.faq-toggle:hover .faq-q {
  background: var(--lp-trace);
  -webkit-background-clip: text;
  background-clip: text;
  color: transparent;
}

.faq-index {
  font-family: var(--lp-mono);
  font-size: 0.78rem;
  color: rgba(150, 178, 220, 0.55);
  flex-shrink: 0;
}

.faq-q {
  flex: 1;
  font-size: 1.05rem;
  letter-spacing: -0.02em;
}

.faq-symbol {
  font-family: var(--lp-mono);
  font-size: 1.3rem;
  line-height: 1;
  color: var(--lp-mint);
  flex-shrink: 0;
}

.faq-answer {
  display: grid;
  grid-template-rows: 0fr;
  transition: grid-template-rows 0.22s ease;
}

.faq-answer > p {
  overflow: hidden;
  margin: 0;
  padding: 0 2.6rem 0;
  color: var(--lp-mute);
  line-height: 1.75;
}

.faq-answer.is-open {
  grid-template-rows: 1fr;
}

.faq-answer.is-open > p {
  padding-bottom: 1.3rem;
}

/* ---------- final strip ---------- */

.final-strip {
  position: relative;
  text-align: center;
  padding: 4rem 1.5rem;
  border-radius: 26px;
  border: 1px solid var(--lp-line);
  background: var(--lp-panel);
  overflow: hidden;
}

.final-strip::before {
  content: "";
  position: absolute;
  left: 50%;
  bottom: -6rem;
  width: 34rem;
  height: 14rem;
  transform: translateX(-50%);
  background: radial-gradient(ellipse, rgba(44, 92, 246, 0.35), rgba(34, 195, 234, 0.12) 55%, transparent 75%);
  filter: blur(30px);
  pointer-events: none;
}

.final-strip::after {
  content: "";
  position: absolute;
  inset: 0 0 auto;
  height: 1px;
  background: var(--lp-trace);
  opacity: 0.8;
}

.final-strip .section-sub {
  margin-inline: auto;
}

.final-strip h2 {
  max-width: 44rem;
  margin-inline: auto;
}

.final-actions {
  justify-content: center;
  position: relative;
}

/* ---------- footer ---------- */

.lp-footer {
  margin-top: 3.6rem;
  padding: 1rem 0 0;
  color: rgba(216, 224, 235, 0.76);
}

.lp-footer :deep(.public-footer) {
  width: 100%;
  margin-top: 0;
  color: inherit;
}

/* ---------- reveal ---------- */

.reveal {
  opacity: 0;
  transform: translateY(30px);
  filter: blur(10px);
  transition:
    opacity 0.75s cubic-bezier(0.22, 1, 0.36, 1),
    transform 0.75s cubic-bezier(0.22, 1, 0.36, 1),
    filter 0.75s cubic-bezier(0.22, 1, 0.36, 1);
  will-change: opacity, transform, filter;
}

.reveal.is-visible {
  opacity: 1;
  transform: translateY(0);
  filter: blur(0);
}

.reveal-delay-1 { transition-delay: 0.15s; }

@media (prefers-reduced-motion: reduce) {
  .marquee-track { animation: none; }
  .caret,
  .node,
  .live-dot,
  .demo-caret { animation: none; }
  .reveal {
    opacity: 1;
    transform: none;
    filter: none;
    transition: none;
  }
}

/* ---------- responsive ---------- */

@media (max-width: 1100px) {
  .hero {
    grid-template-columns: 1fr;
  }

  .pillars,
  .why-grid {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }
}

@media (max-width: 760px) {
  .shell {
    width: min(100%, calc(100% - 1.5rem));
  }

  .lp-header {
    align-items: center;
    gap: 0.7rem;
    padding-bottom: 1.4rem;
  }

  .lp-nav {
    flex: 1;
    justify-content: flex-end;
    flex-wrap: nowrap;
    gap: 0.55rem;
    min-width: 0;
    overflow-x: auto;
    scrollbar-width: none;
  }

  .lp-nav::-webkit-scrollbar {
    display: none;
  }

  .brand-mark {
    flex-shrink: 0;
  }

  .brand-mark-full {
    height: 3rem;
  }

  .lp-nav > a {
    font-size: 0.78rem;
  }

  .status-pill {
    font-size: 0.62rem !important;
    padding: 0.28rem 0.6rem;
  }

  .nav-cta {
    min-height: 1.9rem;
    padding: 0.3rem 0.75rem;
    font-size: 0.8rem;
  }

  .lp-main {
    gap: 3.2rem;
  }

  .hero-points {
    grid-template-columns: 1fr;
  }

  .pillars,
  .why-grid {
    grid-template-columns: 1fr;
  }

  .demo-input-row {
    flex-wrap: wrap;
  }

  .demo-app {
    min-height: 24rem;
  }

  .final-strip {
    padding: 2.6rem 1.2rem;
  }

  .faq-answer > p {
    padding-left: 0.4rem;
    padding-right: 0.4rem;
  }
}
</style>
