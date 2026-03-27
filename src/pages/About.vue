<template>
  <div class="about-page">
    <div class="about-orb about-orb-one" aria-hidden="true"></div>
    <div class="about-orb about-orb-two" aria-hidden="true"></div>
    <div class="grid-noise" aria-hidden="true"></div>

    <main class="about-container">
      <div class="page-nav-left about-top-nav">
        <RouterLink class="about-back-link" to="/" aria-label="Return to home">
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
import { RouterLink } from 'vue-router';
import PublicFooter from "../components/PublicFooter.vue";

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
    description: 'Track shared gear cleanly across students, staff, and media or production environments.',
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
    description: 'Sales, support, and onboarding are handled directly instead of through self-serve setup sprawl.',
  },
  {
    title: 'Invoice-based billing',
    description: 'District, organization, and individual plans are managed with direct billing workflows.',
  },
  {
    title: 'Controlled rollouts',
    description: 'Product changes are shipped carefully with monitoring, status visibility, and backup options if needed.',
  },
  {
    title: 'Real-world product iteration',
    description: 'ItemTraxx is built on real-world usage feedback, not generic feature requests.',
  },
];

const teamMembers = [
  {
    name: 'Dennis Frenkel',
    role: 'Owner and CEO',
    bio: 'Bio coming soon.',
  },
  {
    name: 'Leo Xing',
    role: 'Co Founder and UI/UX Lead',
    bio: 'Bio coming soon.',
  },
    {
    name: 'Cheezit',
    role: 'team dog and morale officer',
    bio: 'Likes watermelon.',
  },
];
</script>

<style scoped>
.about-page {
  position: relative;
  min-height: 100vh;
  padding: 2rem 0 3.5rem;
  background:
    radial-gradient(circle at 15% 18%, rgba(36, 214, 196, 0.16), transparent 36%),
    radial-gradient(circle at 82% 12%, rgba(27, 83, 184, 0.18), transparent 33%),
    linear-gradient(180deg, #09111f 0%, #0d1524 48%, #0a1120 100%);
  color: #f5f7fb;
  overflow: hidden;
}

.about-orb {
  position: absolute;
  border-radius: 999px;
  filter: blur(40px);
  opacity: 0.38;
  pointer-events: none;
}

.about-orb-one {
  width: 20rem;
  height: 20rem;
  top: 5rem;
  left: -6rem;
  background: rgba(30, 202, 183, 0.24);
}

.about-orb-two {
  width: 24rem;
  height: 24rem;
  top: 9rem;
  right: -8rem;
  background: rgba(38, 104, 226, 0.2);
}

.about-container {
  position: relative;
  z-index: 1;
  width: min(1120px, calc(100% - 2rem));
  margin: 0 auto;
}

.about-top-nav {
  margin-bottom: 1.25rem;
}

.about-back-link {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 2.75rem;
  height: 2.75rem;
  border-radius: 999px;
  border: 1px solid rgba(136, 154, 184, 0.28);
  background: rgba(10, 17, 31, 0.72);
  color: #f5f7fb;
  transition: border-color 160ms ease, transform 160ms ease;
}

.about-back-link:hover {
  border-color: rgba(56, 208, 177, 0.55);
  transform: translateX(-1px);
}

.about-back-link svg {
  width: 1.1rem;
  height: 1.1rem;
  stroke: currentColor;
  stroke-width: 2;
  fill: none;
  stroke-linecap: round;
  stroke-linejoin: round;
}

.about-hero,
.about-card,
.team-card {
  position: relative;
  overflow: hidden;
  border: 1px solid rgba(112, 138, 180, 0.16);
  background: linear-gradient(180deg, rgba(18, 26, 41, 0.95), rgba(11, 18, 31, 0.92));
  box-shadow: 0 28px 64px rgba(5, 10, 18, 0.34);
}

.about-hero {
  border-radius: 2rem;
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
  color: #89a4c5;
}

.about-hero h1,
.about-card h2,
.about-team-header h2 {
  margin: 0;
  font-size: clamp(2rem, 4vw, 3.4rem);
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
  color: rgba(231, 236, 245, 0.82);
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
  background: linear-gradient(135deg, #38d0b1, #35a2e7);
  color: #07101d;
}

.about-secondary,
.about-link-grid a {
  border: 1px solid rgba(136, 154, 184, 0.26);
  background: rgba(11, 18, 31, 0.6);
  color: #f5f7fb;
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
  border-radius: 1.6rem;
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
  color: #f5f7fb;
}

.about-list span {
  color: rgba(231, 236, 245, 0.78);
  line-height: 1.65;
}

.about-team {
  margin: 1.4rem 0;
  padding: 1.8rem;
  background: linear-gradient(180deg, rgba(17, 27, 45, 0.94), rgba(10, 17, 31, 0.92));
  border: 1px solid rgba(112, 138, 180, 0.16);
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
  }
}
</style>
