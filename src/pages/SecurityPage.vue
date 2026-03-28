<template>
  <div class="security-page">
    <div class="security-orb security-orb-one" aria-hidden="true"></div>
    <div class="security-orb security-orb-two" aria-hidden="true"></div>
    <div class="grid-noise" aria-hidden="true"></div>

    <main class="security-container">
      <div class="page-nav-left security-top-nav">
        <RouterLink class="security-back-link" to="/" aria-label="Return to home">
          <svg viewBox="0 0 24 24" aria-hidden="true">
            <path d="M15 5 8 12l7 7" />
          </svg>
        </RouterLink>
        <span class="security-breadcrumb">Security</span>
      </div>

      <section class="security-hero">
        <p class="security-eyebrow">Security here at ItemTraxx Co</p>
        <h1>Current security practices and operational controls.</h1>
        <p class="security-lead">
          ItemTraxx uses industry-standard security practices and operational controls. This page provides a 
          factual overview of what is in place today. It is not a roadmap or a statement of future plans, and 
          it does not include private internal controls that are in place but not 
          documented here due to security considerations. If you have questions about our security practices or want to request 
          additional information, please contact us through
          <RouterLink to="/contact-support">Contact Support</RouterLink>
          .
        </p>
        <div class="security-hero-actions">
          <RouterLink class="security-primary-link" to="/contact-support">Report a security issue</RouterLink>
          <a class="security-secondary-link" href="https://itemtraxx.com/.well-known/security.txt" target="_blank" rel="noreferrer">View security.txt</a>
        </div>
      </section>

      <section class="security-grid">
        <article class="security-card security-card-wide">
          <p class="security-section-label">Access and Identity</p>
          <h2>Protected sign-in flows and scoped access.</h2>
          <ul class="security-list">
            <li v-for="item in accessControls" :key="item.title">
              <strong>{{ item.title }}</strong>
              <span>{{ item.description }}</span>
            </li>
          </ul>
        </article>

        <article class="security-card">
          <p class="security-section-label">Traffic and Request Controls</p>
          <h2>Traffic filtered before it even reaches our servers.</h2>
          <ul class="security-list">
            <li v-for="item in edgeControls" :key="item.title">
              <strong>{{ item.title }}</strong>
              <span>{{ item.description }}</span>
            </li>
          </ul>
        </article>
      </section>

      <section class="security-grid security-grid-compact">
        <article class="security-card">
          <p class="security-section-label">Data and Auditability</p>
          <h2>User separation and operational traceability for maximum security and ease of use.</h2>
          <ul class="security-list">
            <li v-for="item in dataControls" :key="item.title">
              <strong>{{ item.title }}</strong>
              <span>{{ item.description }}</span>
            </li>
          </ul>
        </article>

        <article class="security-card">
          <p class="security-section-label">Operations</p>
          <h2>Backups, monitoring, and deployment guardrails.</h2>
          <ul class="security-list">
            <li v-for="item in operationsControls" :key="item.title">
              <strong>{{ item.title }}</strong>
              <span>{{ item.description }}</span>
            </li>
          </ul>
        </article>
      </section>

      <section class="security-stack">
        <div class="security-stack-header">
          <p class="security-section-label">Our Security Approach</p>
          <h2>How security work is handled operationally.</h2>
          <p>
            The control categories and operational practices that are in place today.
          </p>
        </div>

        <div class="security-stack-grid">
          <article v-for="item in securityApproach" :key="item.title" class="security-tool-card">
            <p class="security-tool-label">{{ item.category }}</p>
            <h3>{{ item.title }}</h3>
            <p>{{ item.description }}</p>
          </article>
        </div>
      </section>

      <section class="security-disclosure">
        <article class="security-card security-card-wide">
          <p class="security-section-label">Reporting and Disclosure</p>
          <h2>How to report a security issue.</h2>
          <p>
            If you believe you found a security issue in ItemTraxx, report it through
            <RouterLink to="/contact-support">Contact Support</RouterLink>
            or email
            <a href="mailto:support@itemtraxx.com">support@itemtraxx.com</a>.
          </p>
          <p>
            Current reporting guidance, response expectations, and contact details are published in
            <a href="https://itemtraxx.com/.well-known/security.txt" target="_blank" rel="noreferrer">security.txt</a>.
          </p>
          <p class="security-note">
            ItemTraxx does not currently claim third-party compliance certifications on this page.
            This page is limited to the practices and controls that are already documented and in use. 
            Private controls and practices that are not documented here are still in place, but are not 
            listed due to security considerations. If you have questions about our security practices or 
            want to request additional information, please contact us through
            <RouterLink to="/contact-support">Contact Support</RouterLink>
            .
          </p>
        </article>
      </section>

      <PublicFooter />
    </main>
  </div>
</template>

<script setup lang="ts">
import { RouterLink } from "vue-router";
import PublicFooter from "../components/PublicFooter.vue";

const accessControls = [
  {
    title: "Protected login verification",
    description:
      "All logins use Cloudflare verification, and the verification is enforced server-side on the relevant auth paths.",
  },
  {
    title: "Fine-grained role-based access",
    description:
      "ItemTraxx uses scoped roles with route and server access checks aligned to those roles to ensure proper authorization and no unauthorized access to your data.",
  },
  {
    title: "Session handling",
    description:
      "Session refresh, expiry handling, and verification windows are coordinated so privileged pages do not rely on stale client state alone.",
  },
];

const edgeControls = [
  {
    title: "Edge proxy layer",
    description:
      "A Cloudflare security layer sits in front of ItemTraxx traffic and is used for request control, routing, and additional operational safeguards for security.",
  },
  {
    title: "Security headers",
    description:
      "ItemTraxx is served with Content Security Policy and related security headers as part of our security baseline.",
  },
  {
    title: "Rate limiting",
    description:
      "Critical public and auth-facing flows include rate-limit controls to reduce abuse and repeated request pressure.",
  },
];

const dataControls = [
  {
    title: "Row-level isolation",
    description:
      "ItemTraxx servers use row-level security and is used to scope protected data access by user and role where applicable.",
  },
  {
    title: "Audit visibility",
    description:
      "ItemTraxx keeps transaction history and privileged audit logging to preserve visibility into operational and admin actions.",
  },
  {
    title: "Scoped admin tooling",
    description:
      "Tenant, organization, and other admin tools are separated by access model instead of exposing one flat administrative surface.",
  },
];

const operationsControls = [
  {
    title: "Encrypted backups",
    description:
      "ItemTraxx server backups are encrypted and scheduled through internal processes, with documented restore context and retention handling for smooth operations.",
  },
  {
    title: "Monitoring and error reporting",
    description:
      "ItemTraxx uses third-party services for error monitoring and tracing, and other services for operational analytics, plus operational alerts and workflow notifications through internal systems to stay on top of issues.",
  },
  {
    title: "Pre release checks and runbooks",
    description:
      "Security checks, extensive testing, and deploy tooling is completed before public release instead of failing in user-facing versions. This allows for better control and visibility into the security posture and overall performance of the application.",
  },
];

const securityApproach = [
  {
    category: "Prevention",
    title: "Access control and request verification",
    description:
      "Protected routes, server access checks, request verification, and abuse controls are used to reduce unauthorized access and automated misuse of ItemTraxx and your data.",
  },
  {
    category: "Detection",
    title: "Monitoring and operational visibility",
    description:
      "Application monitoring, alerting, audit visibility, and workflow reporting are used to surface unexpected failures and operational regressions in development, beta, and client-facing environments.",
  },
  {
    category: "Change management",
    title: "Pre release checks and runbooks",
    description:
      "Security checks, extensive testing, and deploy tooling is completed before public release instead of failing in user-facing versions. This allows for better control and visibility into the security posture and overall performance of the application.",
  },
  {
    category: "Recovery",
    title: "Backup and restore readiness",
    description:
      "Encrypted backups, restore context, and operational recovery documentation are maintained as part of the production operations standard.",
  },
  {
    category: "Response",
    title: "Incident response and escalation",
    description:
      "ItemTraxx maintains incident-response and operational playbooks for triage, escalation, rollback, and status handling when production and client-facing issues occur.",
  },
  {
    category: "Disclosure",
    title: "Security reporting and remediation",
    description:
      "Security issues can be reported through the published support and disclosure channels, and the engineering workflow includes documented remediation and follow-up practices.",
  },
];
</script>

<style scoped>
.security-page {
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

.security-page::before {
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

.security-orb {
  position: absolute;
  border-radius: 999px;
  filter: blur(40px);
  opacity: 0.38;
  pointer-events: none;
}

.security-orb-one {
  width: 20rem;
  height: 20rem;
  top: 5rem;
  left: -6rem;
  background: rgba(30, 202, 183, 0.24);
}

.security-orb-two {
  width: 24rem;
  height: 24rem;
  top: 9rem;
  right: -8rem;
  background: rgba(38, 104, 226, 0.2);
}

.security-container {
  position: relative;
  z-index: 1;
  width: min(1120px, calc(100% - 2rem));
  margin: 0 auto;
}

.security-top-nav {
  display: flex;
  align-items: center;
  gap: 0.9rem;
  margin-bottom: 1.25rem;
}

.security-back-link {
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

.security-back-link:hover {
  border-color: rgba(56, 208, 177, 0.55);
  transform: translateX(-1px);
}

.security-back-link svg {
  width: 1.1rem;
  height: 1.1rem;
  stroke: currentColor;
  stroke-width: 2;
  fill: none;
  stroke-linecap: round;
  stroke-linejoin: round;
}

.security-breadcrumb {
  font-size: 0.88rem;
  letter-spacing: 0.08em;
  text-transform: uppercase;
  color: #89a4c5;
}

.security-hero,
.security-card,
.security-tool-card {
  position: relative;
  overflow: hidden;
  border: 1px solid rgba(112, 138, 180, 0.16);
  background: linear-gradient(180deg, rgba(18, 26, 41, 0.95), rgba(11, 18, 31, 0.92));
  box-shadow: 0 28px 64px rgba(5, 10, 18, 0.34);
}

.security-hero::after,
.security-card::after,
.security-tool-card::after {
  content: "";
  position: absolute;
  inset: 0;
  background: linear-gradient(120deg, rgba(255, 255, 255, 0.04), transparent 46%);
  pointer-events: none;
}

.security-hero {
  padding: clamp(2rem, 4vw, 3.2rem);
  border-radius: 2rem;
  margin-bottom: 1.5rem;
}

.security-eyebrow,
.security-section-label,
.security-tool-label {
  margin: 0 0 0.9rem;
  font-size: 0.76rem;
  letter-spacing: 0.12em;
  text-transform: uppercase;
  color: #8be6d6;
}

.security-hero h1,
.security-card h2,
.security-stack-header h2 {
  margin: 0;
  line-height: 1.05;
}

.security-hero h1 {
  max-width: 100%;
  padding-right: 1.1rem;
  font-size: clamp(2.2rem, 5.8vw, 3.9rem);
}

.security-lead,
.security-card p,
.security-tool-card p,
.security-stack-header p,
.security-list span,
.security-disclosure a {
  color: rgba(231, 236, 245, 0.82);
}

.security-lead {
  max-width: 48rem;
  margin: 1.25rem 0 0;
  font-size: 1.02rem;
  line-height: 1.75;
}

.security-hero-actions {
  display: flex;
  flex-wrap: wrap;
  gap: 0.9rem;
  margin-top: 1.5rem;
}

.security-primary-link,
.security-secondary-link {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  box-sizing: border-box;
  max-width: 100%;
  min-height: 2.5rem;
  padding: 0.55rem 1rem;
  border-radius: 999px;
  text-decoration: none;
  font-weight: 600;
  transition: transform 160ms ease, border-color 160ms ease, background 160ms ease;
}

.security-primary-link {
  background: linear-gradient(135deg, #1fc8ad, #245ec6);
  color: #08111d;
}

.security-secondary-link {
  border: 1px solid rgba(136, 154, 184, 0.26);
  background: rgba(10, 17, 31, 0.56);
  color: #f5f7fb;
}

.security-primary-link:hover,
.security-secondary-link:hover {
  transform: translateY(-1px);
}

.security-grid {
  display: grid;
  grid-template-columns: minmax(0, 1.3fr) minmax(0, 0.9fr);
  gap: 1rem;
  margin-top: 1rem;
}

.security-grid-compact {
  grid-template-columns: repeat(2, minmax(0, 1fr));
}

.security-card,
.security-tool-card {
  border-radius: 1.6rem;
  padding: 1.6rem;
}

.security-card-wide {
  min-height: 100%;
}

.security-list {
  list-style: none;
  margin: 1rem 0 0;
  padding: 0;
  display: grid;
  gap: 1rem;
}

.security-list li {
  display: grid;
  gap: 0.35rem;
}

.security-list strong {
  color: #f5f7fb;
  font-size: 1rem;
}

.security-stack {
  margin-top: 1rem;
  border: 1px solid rgba(112, 138, 180, 0.16);
  border-radius: 2rem;
  padding: clamp(1.5rem, 3vw, 2rem);
  background: linear-gradient(180deg, rgba(15, 22, 34, 0.9), rgba(10, 16, 28, 0.88));
  box-shadow: 0 24px 54px rgba(5, 10, 18, 0.28);
}

.security-stack-header {
  max-width: 44rem;
}

.security-stack-grid {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 1rem;
  margin-top: 1.35rem;
}

.security-disclosure {
  margin-top: 1rem;
}

.security-note {
  margin-top: 1rem;
  color: #8be6d6;
}

@media (max-width: 980px) {
  .security-grid,
  .security-grid-compact,
  .security-stack-grid {
    grid-template-columns: 1fr;
  }
}

@media (max-width: 640px) {
  .security-page {
    padding-top: calc(1.25rem + env(safe-area-inset-top, 0px));
  }

  .security-container {
    width: min(1120px, calc(100% - 1rem));
  }

  .security-card,
  .security-tool-card,
  .security-hero,
  .security-stack {
    border-radius: 1.4rem;
  }

  .security-hero-actions {
    flex-direction: column;
  }

  .security-primary-link,
  .security-secondary-link {
    width: 100%;
    max-width: 100%;
  }
}
</style>
