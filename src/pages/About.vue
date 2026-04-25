<template>
  <div class="page about-page">
    <RouterLink class="brand-mark" to="/" aria-label="ItemTraxx home">
      <img v-if="brandLogoUrl" class="brand-mark-full" :src="brandLogoUrl" alt="ItemTraxx Co" />
    </RouterLink>

    <main class="about-container">
      <div class="page-nav-left about-top-nav">
        <RouterLink class="about-back-link" to="/" aria-label="Return to home" @click.prevent="$router.back()">
          <svg viewBox="0 0 24 24" aria-hidden="true">
            <path d="M15 5 8 12l7 7" />
          </svg>
        </RouterLink>
        <span class="about-breadcrumb"></span>
      </div>

      <section class="about-hero">
        <p class="about-eyebrow">About ItemTraxx</p>
        <h1>The people and thinking behind ItemTraxx.</h1>
        <p class="about-lead">
          ItemTraxx is built to make inventory tracking simpler, more accountable, and easier to run
          day to day for schools, districts, organizations, and individual operators.
        </p>
      </section>

      <section class="about-grid">
        <article class="about-card about-card-wide">
          <p class="about-section-label">How ItemTraxx Started</p>
          <h2>Started from a real inventory problem.</h2>
          <p v-for="paragraph in storyParagraphs" :key="paragraph">{{ paragraph }}</p>
        </article>

        <article class="about-card">
          <p class="about-section-label">What We Care About</p>
          <h2>Operating principles</h2>
          <ul class="about-list">
            <li v-for="value in values" :key="value.title">
              <strong>{{ value.title }}</strong>
              <span>{{ value.description }}</span>
            </li>
          </ul>
        </article>
      </section>

      <section class="about-grid about-grid-compact">
        <article class="about-card">
          <p class="about-section-label">Who We Build For</p>
          <h2>Use cases that shaped the product.</h2>
          <ul class="about-list">
            <li v-for="segment in customerSegments" :key="segment.title">
              <strong>{{ segment.title }}</strong>
              <span>{{ segment.description }}</span>
            </li>
          </ul>
        </article>

        <article class="about-card">
          <p class="about-section-label">How We Operate</p>
          <h2>How ItemTraxx is run.</h2>
          <ul class="about-list">
            <li v-for="item in operatingModel" :key="item.title">
              <strong>{{ item.title }}</strong>
              <span>{{ item.description }}</span>
            </li>
          </ul>
        </article>
      </section>

      <section class="about-team">
        <div class="about-team-header">
          <p class="about-section-label">The People Behind ItemTraxx</p>
          <h2>Our Team</h2>
          <p>
          
          </p>
        </div>

        <div class="team-grid">
          <article v-for="member in teamMembers" :key="member.name" class="team-card">
            <p class="team-role">{{ member.role }}</p>
            <h3>{{ member.name }}</h3>
            <p>{{ member.bio }}</p>
          </article>
        </div>
      </section>

      <PublicFooter />

    </main>
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref } from 'vue';
import { RouterLink } from 'vue-router';
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

const storyParagraphs = [
  'ItemTraxx started as the kind of idea most people would brush off. In our broadcast class, gear kept going missing, and my broadcast teacher jokingly told me to build an app to track it.',
  'I took that seriously and built the first version. It worked as a prototype, but it also had a lot of flaws, rough edges, and structural problems that became obvious once it was used in the real world.',
  'After working through those issues, I realized patching the original build was the wrong path. I scrapped it, rebuilt the product with a cleaner foundation, and that became the ItemTraxx we use today.',
];

const values = [
  {
    title: 'Accountability',
    description: 'Clear visibility into who has what, when it moved, and what still needs attention.',
  },
  {
    title: 'Simplicity',
    description: 'Fast daily workflows for real operators, not just admin reporting after the fact.',
  },
  {
    title: 'Reliability',
    description: 'A product that is meant to hold up during normal day-to-day operations, not just demos.',
  },
  {
    title: 'Security and control',
    description: 'Protected access, audit visibility, and operational safeguards built into the system.',
  },
];

const customerSegments = [
  {
    title: 'Schools and classrooms',
    description: 'Track shared gear cleanly across borrowers, staff, and media or production environments.',
  },
  {
    title: 'Districts and multi-site groups',
    description: 'Run a shared platform with district-aware routing, visibility, and admin control.',
  },
  {
    title: 'Organizations and teams',
    description: 'Manage inventory across multiple locations, operating units, or internal groups.',
  },
  {
    title: 'Individual operators',
    description: 'Use ItemTraxx without an organization structure when you only need one account.',
  },
];

const operatingModel = [
  {
    title: 'Support-first setup',
    description: 'Sales, support, and onboarding are handled directly instead of through self-serve setup sprawl. We value direct relationships with our customers and hands-on support over self-serve scale for its own sake.',
  },
  {
    title: 'Invoice-based billing',
    description: 'District, organization, and individual plans are managed with direct billing workflows via our invoice system.',
  },
  {
    title: 'Controlled rollouts',
    description: 'Product changes are shipped carefully with monitoring, status visibility, and backup options if needed.',
  },
  {
    title: 'Real-world product iteration',
    description: 'ItemTraxx is built on real-world usage feedback, not generic feature requests. We focus on solving problems that come up in actual operations instead of building for hypothetical use cases.',
  },
];

const teamMembers = [
  {
    name: 'Dennis Frenkel',
    role: 'Founder and CEO',
    bio: 'Bio coming soon.',
  },
  {
    name: 'Leo Xing',
    role: 'Co Founder and UI/UX Lead',
    bio: 'Bio coming soon.',
  },
    {
    name: 'Cheezit',
    role: 'Team dog and morale officer',
    bio: 'Avid watermelon enjoyer.',
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
.about-page {
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

.about-container {
  width: 100%;
}

.about-top-nav {
  margin-bottom: 1.25rem;
}

.about-back-link {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 2.4rem;
  height: 2.4rem;
  border-radius: 999px;
  border: 1px solid var(--border);
  background: var(--surface);
  color: var(--text);
  transition: transform 0.16s ease, border-color 0.16s ease, background 0.16s ease;
}

.about-back-link:hover {
  transform: translateY(-1px);
  border-color: var(--text);
  background: var(--surface-2);
}

.about-back-link svg {
  width: 1rem;
  height: 1rem;
  stroke: currentColor;
  stroke-width: 2;
  fill: none;
  stroke-linecap: round;
  stroke-linejoin: round;
}

.about-hero,
.about-card,
.about-team,
.team-card {
  border: 2px solid color-mix(in srgb, var(--border) 58%, transparent);
  background: transparent;
  box-shadow: none;
}

.about-hero {
  border-radius: 1rem;
  padding: 2.4rem;
  margin-bottom: 1.5rem;
}

.about-eyebrow,
.about-section-label,
.team-role {
  margin: 0 0 0.8rem;
  font-size: 0.76rem;
  letter-spacing: 0.18em;
  text-transform: uppercase;
  color: color-mix(in srgb, var(--text) 64%, var(--accent) 36%);
}

.about-hero h1,
.about-card h2,
.about-team-header h2 {
  margin: 0;
  font-size: clamp(1.4rem, 3vw, 2.4rem);
  line-height: 1.05;
  letter-spacing: -0.04em;
}

.about-card h2,
.about-team-header h2 {
  font-size: clamp(1.4rem, 2.6vw, 2.2rem);
}

.about-lead,
.about-card p,
.about-team-header p,
.team-card p {
  margin: 1rem 0 0;
  color: color-mix(in srgb, var(--text) 84%, transparent);
  line-height: 1.7;
}

.about-actions {
  display: flex;
  flex-wrap: wrap;
  gap: 0.8rem;
  margin-top: 1.4rem;
}

.about-primary,
.about-secondary,
.about-link-grid a {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  min-height: 2.9rem;
  padding: 0.75rem 1.15rem;
  border-radius: 999px;
  font-weight: 600;
  text-decoration: none;
  transition: transform 160ms ease, border-color 160ms ease, background 160ms ease;
}

.about-primary {
  background: var(--text);
  color: var(--page-bg);
}

.about-secondary,
.about-link-grid a {
  border: 2px solid color-mix(in srgb, var(--border) 72%, transparent);
  background: color-mix(in srgb, var(--surface-2) 68%, transparent);
  color: inherit;
}

.about-primary:hover,
.about-secondary:hover,
.about-link-grid a:hover {
  transform: translateY(-1px);
}

.about-grid {
  display: grid;
  grid-template-columns: minmax(0, 1.3fr) minmax(0, 1fr);
  gap: 1.2rem;
  margin-bottom: 2rem;
}

.about-grid-compact {
  grid-template-columns: repeat(2, minmax(0, 1fr));
}

.about-card,
.about-team {
  border-radius: 1rem;
}

.about-card {
  padding: 1.6rem;
}

.about-list {
  display: grid;
  gap: 1rem;
  margin: 1.2rem 0 0;
  padding: 0;
  list-style: none;
}

.about-list li {
  display: grid;
  gap: 0.25rem;
}

.about-list strong {
  color: inherit;
}

.about-list span {
  color: color-mix(in srgb, var(--text) 84%, transparent);
  line-height: 1.65;
}

.about-team {
  margin: 1.4rem 0 6.5rem;
  padding: 1.8rem;
  background: transparent;
}

.about-team-header {
  max-width: 52rem;
  margin-bottom: 1.4rem;
}

.team-grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 1rem;
}

.team-card {
  border-radius: 1.35rem;
  padding: 1.4rem;
}

.team-card h3 {
  margin: 0;
  font-size: 1.3rem;
}

.team-card p {
  margin-top: 0.7rem;
}

@media (max-width: 900px) {
  .about-page {
    padding-top: calc(1.25rem + env(safe-area-inset-top, 0px));
  }

  .brand-mark {
    margin-bottom: 0.25rem;
  }

  .brand-mark-full {
    height: 3.9rem;
  }

  .about-grid,
  .about-grid-compact,
  .team-grid {
    grid-template-columns: 1fr;
  }

  .about-hero {
    padding: 1.7rem;
  }

  .about-team {
    padding: 1.4rem;
    margin-bottom: 4rem;
  }
}
</style>
