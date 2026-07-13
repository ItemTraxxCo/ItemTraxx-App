<template>
  <div class="landing-new">
    <a class="skip-link" href="#landing-new-main">Skip to main content</a>

    <div class="ambient ambient-one" aria-hidden="true"></div>
    <div class="ambient ambient-two" aria-hidden="true"></div>
    <div class="grid-noise" aria-hidden="true"></div>

    <LandingHeader
      :brand-logo-url="brandLogoUrl"
      home-to="/"
      pricing-to="/pricing"
      support-to="/contact-support"
      login-to="/login"
      status-href="https://status.itemtraxx.com/"
      :status-label="statusLabel"
      :status-class="statusClass"
      @cta="trackCta"
    />

    <main id="landing-new-main" class="shell landing-main">
      <section class="hero-grid reveal reveal-up">
        <LandingHero pricing-to="/pricing" demo-to="/request-demo" @cta="trackCta" />
        <LandingShowcase
          :showcase="rotatingShowcase"
          :image-fallback="checkoutReturnUiImage"
          :image800="checkoutReturnUiImage800"
          :image1200="checkoutReturnUiImage1200"
          :image1600="checkoutReturnUiImage1600"
        />
      </section>

      <LandingFeatureSections
        :image-fallback="adminUiImage"
        :image800="adminUiImage800"
        :image1200="adminUiImage1200"
        :image1600="adminUiImage1600"
      />
      <LandingFaq :items="faqItems" :open-index="openFaqIndex" @toggle-faq="toggleFaq" />
      <LandingFinalCta login-to="/login" pricing-to="/pricing" @cta="trackCta" />
    </main>

    <div class="landing-footer shell">
      <PublicFooter />
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, onUnmounted, ref } from 'vue';
import { trackProductEvent } from "../services/productEvents";
import LandingHeader from '../components/landing/LandingHeader.vue';
import LandingHero from '../components/landing/LandingHero.vue';
import LandingShowcase from '../components/landing/LandingShowcase.vue';
import LandingFeatureSections from '../components/landing/LandingFeatureSections.vue';
import LandingFaq from '../components/landing/LandingFaq.vue';
import LandingFinalCta from '../components/landing/LandingFinalCta.vue';
import adminUiImage from '../assets/landing/admin_ui.png';
import adminUiImage800 from '../assets/landing/admin_ui-800.webp';
import adminUiImage1200 from '../assets/landing/admin_ui-1200.webp';
import adminUiImage1600 from '../assets/landing/admin_ui-1600.webp';
import checkoutReturnUiImage from '../assets/landing/checkout_return_ui.png';
import checkoutReturnUiImage800 from '../assets/landing/checkout_return_ui-800.webp';
import checkoutReturnUiImage1200 from '../assets/landing/checkout_return_ui-1200.webp';
import checkoutReturnUiImage1600 from '../assets/landing/checkout_return_ui-1600.webp';
import { useSystemStatus } from '../composables/useSystemStatus';
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

const { statusLabel, statusClass } = useSystemStatus();

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
let themeObserver: MutationObserver | null = null;

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

.landing-main {
  display: grid;
  gap: 2rem;
}

.hero-grid {
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

.reveal.is-visible {
  opacity: 1;
  transform: translateY(0);
  filter: blur(0);
}

.reveal.is-visible.reveal-up {
  transform: translateY(0) scale(1);
}

.hero-grid {
  display: grid;
  grid-template-columns: minmax(0, 1.02fr) minmax(21rem, 0.98fr);
  gap: 1.8rem;
  align-items: stretch;
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
  .hero-grid {
    grid-template-columns: 1fr;
  }
}

@media (max-width: 720px) {
  .shell {
    width: min(100%, calc(100% - 1.5rem));
  }

  .landing-footer {
    align-items: flex-start;
    flex-direction: column;
    gap: 1rem;
  }
}
</style>
