<template>
  <div class="page faq-page-public">
    <RouterLink class="brand-mark" to="/" aria-label="ItemTraxx home">
      <img v-if="brandLogoUrl" class="brand-mark-full" :src="brandLogoUrl" alt="ItemTraxx Co" />
    </RouterLink>

    <main class="faq-container-public">
      <div class="page-nav-left faq-top-nav-public">
        <RouterLink class="faq-back-link-public" to="/" aria-label="Return to home" @click.prevent="$router.back()">
          <svg viewBox="0 0 24 24" aria-hidden="true">
            <path d="M15 5 8 12l7 7" />
          </svg>
        </RouterLink>
        <span class="faq-breadcrumb-public">FAQ</span>
      </div>

      <section class="faq-hero-public">
        <p class="faq-eyebrow-public">ItemTraxx FAQ</p>
        <h1>Common questions about ItemTraxx, setup, support, and operations.</h1>
        <p class="faq-lead-public">
          This page covers the common questions we expect from schools, districts,
          organizations, and individual operators reviewing or using ItemTraxx. 
          If you have a question that isn't covered here, please contact support 
          so we can help and consider adding it to this list.
        </p>
      </section>

      <section class="faq-groups">
        <article v-for="group in faqGroups" :key="group.title" class="faq-group-card">
          <p class="faq-section-label-public">{{ group.title }}</p>
          <div class="faq-list-public">
            <article v-for="(item, index) in group.items" :key="item.q" class="faq-item-public">
              <button
                type="button"
                class="faq-toggle-public"
                :aria-expanded="openFaqKey === `${group.title}-${index}`"
                :aria-controls="`faq-answer-${group.title}-${index}`"
                @click="toggleFaq(`${group.title}-${index}`)"
              >
                <span>{{ item.q }}</span>
                <span class="faq-symbol-public" aria-hidden="true">
                  {{ openFaqKey === `${group.title}-${index}` ? "−" : "+" }}
                </span>
              </button>
              <div
                :id="`faq-answer-${group.title}-${index}`"
                class="faq-answer-public"
                :class="{ 'is-open': openFaqKey === `${group.title}-${index}` }"
              >
                <p>{{ item.a }}</p>
              </div>
            </article>
          </div>
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

const openFaqKey = ref<string | null>(null);
const lightBrandLogoUrl = import.meta.env.VITE_BRAND_LOGO_LIGHT_URL as string | undefined;
const darkBrandLogoUrl = import.meta.env.VITE_BRAND_LOGO_DARK_URL as string | undefined;
const themeMode = ref<"light" | "dark">("dark");
const brandLogoUrl = computed(() =>
  themeMode.value === "light"
    ? lightBrandLogoUrl || darkBrandLogoUrl || ""
    : darkBrandLogoUrl || lightBrandLogoUrl || ""
);
let themeObserver: MutationObserver | null = null;

const toggleFaq = (key: string) => {
  openFaqKey.value = openFaqKey.value === key ? null : key;
};

const faqGroups = [
  {
    title: "Getting Started",
    items: [
      {
        q: "How quickly can I get started?",
        a: "ItemTraxx can be set up quickly. Contact support, get your account provisioned, and then sign in to begin managing inventory.",
      },
      {
        q: "Do I need a district setup to use ItemTraxx?",
        a: "No. ItemTraxx supports districts, organizations, and individual operators depending on the account type and provisioning flow.",
      },
      {
        q: "Is ItemTraxx self-serve?",
        a: "Core setup and onboarding are still support-led. That keeps account setup, routing, and operational expectations cleaner for customers.",
      },
      {
        q: "Who is ItemTraxx for?",
        a: "ItemTraxx is built for schools, districts, teams, organizations, and individual users who need cleaner inventory checkout, return, and oversight workflows.",
      },
    ],
  },
  {
    title: "Product Use",
    items: [
      {
        q: "What kinds of items can I track?",
        a: "ItemTraxx is intended for shared inventory such as gear, tools, equipment, and other assets that move between people, rooms, or teams.",
      },
      {
        q: "Does ItemTraxx keep transaction history?",
        a: "Yes. Checkout, return, and related administrative activity are retained so teams can review who had what item and when it moved.",
      },
      {
        q: "Can multiple people use the same tenant?",
        a: "Yes. ItemTraxx supports shared operational use with role-based access so the right people can check out inventory or manage admin workflows.",
      },
      {
        q: "Can admins manage borrowers and gear separately?",
        a: "Yes. Borrower management, inventory management, logs, and other admin workflows are separated into dedicated operational pages.",
      },
      {
        q: "What happens if an item is already checked out?",
        a: "ItemTraxx is designed to prevent conflicting checkout state. If an item is already assigned to another borrower, it should not be available for a second checkout until it is returned.",
      },
      {
        q: "Does ItemTraxx work on mobile?",
        a: "Yes. ItemTraxx is designed to work across modern desktop and mobile environments, including operator flows that need to be usable on smaller screens.",
      },
    ],
  },
  {
    title: "Plans and Access",
    items: [
      {
        q: "Can it work for schools and small teams?",
        a: "Yes. ItemTraxx is designed for school programs, classrooms, districts, teams, and other environments where shared gear moves constantly.",
      },
      {
        q: "Can I use ItemTraxx as an individual user?",
        a: "Yes. ItemTraxx also supports individual use, in addition to district and organization plans.",
      },
      {
        q: "How does pricing work?",
        a: "Pricing is organized around district, organization, and individual use. The pricing page explains the plan categories, and contact sales can help with fit or quotes.",
      },
      {
        q: "Can I request a demo before committing?",
        a: "Yes. Use Contact Sales or Request Demo to ask for a walkthrough or planning conversation.",
      },
    ],
  },
  {
    title: "Support and Trust",
    items: [
      {
        q: "How do I report a bug or operational issue?",
        a: "Use Contact Support. Include the issue details, what you were trying to do, and any screenshots or context that help reproduction.",
      },
      {
        q: "How do I get help with login or account access issues?",
        a: "Use Contact Support and include the account context, device, browser, and the point where the issue occurred so support can triage it faster.",
      },
      {
        q: "Where can I review security and privacy information?",
        a: "Use the Trust, Security, Privacy, Legal, Cookies, and Accessibility pages. Those pages collect the current public material for operational and policy review.",
      },
      {
        q: "Where can I check whether ItemTraxx is currently up?",
        a: "Use the public status page for current service health and incident visibility.",
      },
    ],
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
.faq-page-public {
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

.faq-container-public {
  width: 100%;
}

.faq-top-nav-public {
  display: flex;
  align-items: center;
  gap: 0.9rem;
  margin-bottom: 1.25rem;
}

.faq-back-link-public {
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

.faq-back-link-public:hover {
  transform: translateY(-1px);
  border-color: rgba(39, 196, 172, 0.58);
  background: linear-gradient(180deg, rgba(29, 66, 75, 0.62) 0%, rgba(16, 37, 48, 0.54) 100%);
  box-shadow: 0 16px 32px rgba(25, 194, 168, 0.14);
}

.faq-back-link-public svg {
  width: 1rem;
  height: 1rem;
  fill: none;
  stroke: currentColor;
  stroke-linecap: round;
  stroke-linejoin: round;
  stroke-width: 2;
}

.faq-breadcrumb-public,
.faq-section-label-public,
.faq-eyebrow-public {
  text-transform: uppercase;
  letter-spacing: 0.22em;
  font-size: 0.74rem;
  font-weight: 700;
  color: color-mix(in srgb, var(--text) 64%, var(--accent) 36%);
}

.faq-hero-public,
.faq-group-card,
.faq-item-public {
  border-radius: 1rem;
  border: 1px solid color-mix(in srgb, var(--border) 46%, transparent);
  background: transparent;
  box-shadow: none;
}

.faq-hero-public {
  margin-bottom: 1.5rem;
  padding: 1.7rem 1.6rem;
}

.faq-hero-public h1 {
  margin: 0.55rem 0 0.85rem;
  font-size: clamp(1.4rem, 3vw, 2.4rem);
  line-height: 0.96;
  letter-spacing: -0.05em;
}

.faq-lead-public,
.faq-answer-public p {
  color: color-mix(in srgb, var(--text) 84%, transparent);
  line-height: 1.72;
}

.faq-groups {
  display: grid;
  gap: 1rem;
}

.faq-group-card {
  padding: 1.35rem;
}

.faq-list-public {
  display: grid;
  gap: 0.75rem;
}

.faq-item-public {
  overflow: hidden;
}

.faq-toggle-public {
  width: 100%;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 1rem;
  padding: 1rem 1.1rem;
  border: none;
  background: transparent;
  color: inherit;
  font: inherit;
  text-align: left;
  cursor: pointer;
}

.faq-toggle-public:focus-visible {
  outline: 2px solid color-mix(in srgb, var(--accent) 60%, transparent);
  outline-offset: 2px;
}

.faq-symbol-public {
  font-size: 1.3rem;
  line-height: 1;
}

.faq-answer-public {
  display: grid;
  grid-template-rows: 0fr;
  transition: grid-template-rows 180ms ease;
}

.faq-answer-public p {
  overflow: hidden;
  margin: 0;
  padding: 0 1.1rem 0;
}

.faq-answer-public.is-open {
  grid-template-rows: 1fr;
}

.faq-answer-public.is-open p {
  padding-bottom: 1rem;
}

@media (max-width: 720px) {
  .faq-page-public {
    padding-top: calc(1.25rem + env(safe-area-inset-top, 0px));
  }

  .brand-mark {
    margin-bottom: 0.25rem;
  }

  .brand-mark-full {
    height: 3.9rem;
  }

  .faq-hero-public,
  .faq-group-card,
  .faq-item-public {
    border-radius: 1.15rem;
  }

  .faq-hero-public,
  .faq-group-card {
    padding: 1.15rem 1rem;
  }
}
</style>
