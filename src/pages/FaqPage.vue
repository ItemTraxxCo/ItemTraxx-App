<template>
  <div class="faq-page-public">
    <div class="faq-orb faq-orb-one" aria-hidden="true"></div>
    <div class="faq-orb faq-orb-two" aria-hidden="true"></div>
    <div class="grid-noise" aria-hidden="true"></div>

    <main class="faq-container-public">
      <div class="page-nav-left faq-top-nav-public">
        <RouterLink class="faq-back-link-public" to="/" aria-label="Return to home">
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
import { ref } from "vue";
import { RouterLink } from "vue-router";
import PublicFooter from "../components/PublicFooter.vue";

const openFaqKey = ref<string | null>(null);

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
    ],
  },
  {
    title: "Product Use",
    items: [
      {
        q: "Does ItemTraxx keep transaction history?",
        a: "Yes. Checkout, return, and related administrative activity are retained so teams can review who had what item and when it moved.",
      },
      {
        q: "Can it work for schools and small teams?",
        a: "Yes. ItemTraxx is designed for school programs, classrooms, districts, teams, and other environments where shared gear moves constantly.",
      },
      {
        q: "Can admins manage borrowers and gear separately?",
        a: "Yes. Borrower management, inventory management, logs, and other admin workflows are separated into dedicated operational pages.",
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
        q: "Where can I review security and privacy information?",
        a: "Use the Trust, Security, Privacy, and Legal pages. Those pages collect the current public material for operational and policy review.",
      },
      {
        q: "Where can I check whether ItemTraxx is currently up?",
        a: "Use the public status page for current service health and incident visibility.",
      },
    ],
  },
];
</script>

<style scoped>
.faq-page-public {
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

.faq-page-public::before {
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

.faq-orb {
  position: absolute;
  border-radius: 999px;
  filter: blur(40px);
  opacity: 0.38;
  pointer-events: none;
}

.faq-orb-one {
  width: 20rem;
  height: 20rem;
  top: 5rem;
  left: -6rem;
  background: rgba(30, 202, 183, 0.24);
}

.faq-orb-two {
  width: 24rem;
  height: 24rem;
  top: 9rem;
  right: -8rem;
  background: rgba(38, 104, 226, 0.2);
}

.faq-container-public {
  position: relative;
  z-index: 1;
  width: min(1120px, calc(100% - 2rem));
  margin: 0 auto;
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
  width: 2.6rem;
  height: 2.6rem;
  border-radius: 999px;
  border: 1px solid rgba(140, 157, 189, 0.24);
  background: rgba(9, 17, 31, 0.58);
  color: #f5f7fb;
  text-decoration: none;
  backdrop-filter: blur(18px);
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
  color: rgba(155, 231, 220, 0.78);
}

.faq-hero-public,
.faq-group-card,
.faq-item-public {
  border-radius: 1.5rem;
  border: 1px solid rgba(120, 136, 169, 0.18);
  background: rgba(13, 21, 36, 0.72);
  box-shadow: 0 28px 80px rgba(3, 8, 18, 0.28);
  backdrop-filter: blur(18px);
}

.faq-hero-public {
  margin-bottom: 1.5rem;
  padding: 1.7rem 1.6rem;
}

.faq-hero-public h1 {
  margin: 0.55rem 0 0.85rem;
  font-size: clamp(2.2rem, 4vw, 3.6rem);
  line-height: 0.96;
  letter-spacing: -0.05em;
}

.faq-lead-public,
.faq-answer-public p {
  color: rgba(230, 236, 247, 0.82);
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

  .faq-container-public {
    width: min(100%, calc(100% - 1.25rem));
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
