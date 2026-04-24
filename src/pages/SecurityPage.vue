<template>
  <div class="page security-page">
    <RouterLink class="brand-mark" to="/" aria-label="ItemTraxx home">
      <img v-if="brandLogoUrl" class="brand-mark-full" :src="brandLogoUrl" alt="ItemTraxx Co" />
    </RouterLink>

    <main class="security-container">
      <div class="page-nav-left security-top-nav">
        <RouterLink class="security-back-link" to="/" aria-label="Return to home" @click.prevent="$router.back()">
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
          <RouterLink class="security-primary-link" to="/report-security-issue">Report a security issue</RouterLink>
          <a class="security-secondary-link" href="https://itemtraxx.com/.well-known/security.txt" target="_blank" rel="noreferrer">View security.txt</a>
        </div>
      </section>

      <section class="security-grid">
        <article class="security-card security-card-wide security-outline-only">
          <p class="security-section-label">Access and Identity</p>
          <h2>Protected sign-in flows and scoped access.</h2>
          <ul class="security-list">
            <li v-for="item in accessControls" :key="item.title">
              <strong>{{ item.title }}</strong>
              <span>{{ item.description }}</span>
            </li>
          </ul>
        </article>

        <article class="security-card security-outline-only">
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

      <section class="security-grid security-grid-compact security-section-gap-after">
        <article class="security-card security-outline-only">
          <p class="security-section-label">Data and Auditability</p>
          <h2>User separation and operational traceability for maximum security and ease of use.</h2>
          <ul class="security-list">
            <li v-for="item in dataControls" :key="item.title">
              <strong>{{ item.title }}</strong>
              <span>{{ item.description }}</span>
            </li>
          </ul>
        </article>

        <article class="security-card security-outline-only">
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

      <section class="security-grid security-grid-full security-section-gap-after">
        <article class="security-card security-card-wide security-outline-only">
          <p class="security-section-label">Third-Party Provider Certifications</p>
          <h2>Certifications held by our supporting infrastructure providers.</h2>
          <p>
            This list contains security certifications for our third-party providers, where available.
          </p>
          <ul class="security-list">
            <li v-for="item in thirdPartyProviderCertifications" :key="item.provider">
              <strong>{{ item.provider }}</strong>
              <span>{{ item.certifications }}</span>
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
            <RouterLink to="/report-security-issue">the security issue reporting page</RouterLink>
            or email
            <a href="mailto:support@itemtraxx.com">support@itemtraxx.com</a>.
          </p>
          <p>
            Contact details are published in
            <a href="https://itemtraxx.com/.well-known/security.txt" target="_blank" rel="noreferrer">security.txt</a>.
            Reporting guidance is available on
            <RouterLink to="/report-security-issue">the security issue reporting page</RouterLink>.
          </p>
          <p class="security-note">
            ItemTraxx does not currently claim third-party compliance certifications on this page.
            Public compliance mappings supported by current security monitoring are available on the
            <RouterLink to="/compliance">Compliance page</RouterLink>.
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
import { computed, onMounted, onUnmounted, ref } from "vue";
import { RouterLink } from "vue-router";
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

const accessControls = [
  {
    title: "Protected login verification",
    description:
      "All logins use Cloudflare security verifications and multi-step authorization checks, and the verification is enforced server-side on the relevant auth paths.",
  },
  {
    title: "Fine-grained role-based access",
    description:
      "ItemTraxx uses scoped roles with route and server access checks aligned to those roles to ensure proper authorization and no unauthorized access to your data.",
  },
  {
    title: "Session handling",
    description:
      "Session refresh, expiry handling, and verification windows are coordinated so privileged pages do not rely on stale client state alone. Authorization is enforced client side and server side.",
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
      "ItemTraxx is served with Content Security Policy (CSP) and related security headers as part of our security baseline and industry standard.",
  },
  {
    title: "DDoS Protection",
    description:
      "ItemTraxx combats Distributed Denial of Service attacks in several ways to mitigate resource abuse and prevent service disruption. Critical public and auth-facing flows include rate-limit controls, server side security checks, and more.",
  },
];

const dataControls = [
  {
    title: "User isolation",
    description:
      "ItemTraxx servers use row-level security and fine-grained access to scope protected data access by user and role where applicable to ensure only your data is available to you.",
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
  {
    title: "Customer Data Encryption",
    description:
      "All customer data on ItemTraxx servers is encrypted at rest with AES-256 and in transit via TLS.",
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
      "ItemTraxx uses third-party services for error monitoring and tracing (Sentry) and operational analytics (PostHog), plus operational alerts and workflow notifications through internal systems to stay on top of issues. Analytics and diagnostics tooling is only enabled after user consent through the cookie banner. In some environments, session replay sampling (Sentry Replay and/or PostHog Replay) may be enabled after consent for debugging and incident investigation. In addition to internal security reviews, we use tools to scan our code for vulnerabilities including GitHub, Aikido, and GitGuardian.",
  },
  {
    title: "Pre release checks and runbooks",
    description:
      "Security checks, extensive testing, and deployment tooling is completed before public release instead of failing in user-facing versions. This allows for better control and visibility into the security posture and overall performance of the application.",
  },
];

const thirdPartyProviderCertifications = [
  {
    provider: "Cloudflare",
    certifications: "SOC 2 Type II, ISO 27001, PCI DSS",
  },
  {
    provider: "Vercel",
    certifications: "SOC 2 Type II, ISO 27001",
  },
  {
    provider: "Supabase",
    certifications: "SOC 2 Type II",
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
      "ItemTraxx maintains incident-response and operational documentation for triage, escalation, rollback, and status handling when production and client-facing issues occur.",
  },
  {
    category: "Disclosure",
    title: "Security reporting and remediation",
    description:
      "Security issues can be reported through the published support and disclosure channels, and the engineering workflow includes documented remediation and follow-up practices.",
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
.security-page {
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

.security-container {
  width: 100%;
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
  width: 2.4rem;
  height: 2.4rem;
  border-radius: 999px;
  border: 1px solid rgba(77, 97, 122, 0.4);
  background: linear-gradient(180deg, rgba(31, 40, 54, 0.46) 0%, rgba(17, 23, 32, 0.34) 100%);
  backdrop-filter: blur(2px);
  color: #ffffff;
  text-decoration: none;
  transition: transform 0.16s ease, border-color 0.16s ease, background 0.16s ease;
}

.security-back-link:hover {
  text-decoration: none;
  transform: translateY(-1px);
  border-color: rgba(39, 196, 172, 0.58);
  background: linear-gradient(180deg, rgba(29, 66, 75, 0.62) 0%, rgba(16, 37, 48, 0.54) 100%);
  box-shadow: 0 16px 32px rgba(25, 194, 168, 0.14);
}

.security-back-link svg {
  width: 1.2rem;
  height: 1.2rem;
  stroke: currentColor;
  stroke-width: 2.2;
  fill: none;
  stroke-linecap: round;
  stroke-linejoin: round;
}

.security-breadcrumb {
  color: color-mix(in srgb, var(--text) 72%, transparent);
  font-size: 0.95rem;
}

.security-hero,
.security-card,
.security-tool-card {
  border: 1px solid color-mix(in srgb, var(--border) 0%, transparent);
  background: transparent;
  box-shadow: none;
}

.security-hero {
  padding: clamp(2rem, 4vw, 3.2rem);
  border-radius: 1.4rem;
  margin-bottom: 1.5rem;
}

.security-eyebrow,
.security-section-label,
.security-tool-label {
  margin: 0 0 0.9rem;
  font-size: 0.76rem;
  letter-spacing: 0.12em;
  text-transform: uppercase;
  color: color-mix(in srgb, var(--text) 64%, var(--accent) 36%);
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
  font-size: clamp(1.4rem, 3vw, 2.4rem);
}

.security-lead,
.security-card p,
.security-tool-card p,
.security-stack-header p,
.security-list span,
.security-disclosure a {
  color: color-mix(in srgb, var(--text) 84%, transparent);
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
  border: 1px solid color-mix(in srgb, var(--border) 72%, transparent);
  background: color-mix(in srgb, var(--surface-2) 64%, transparent);
  color: inherit;
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

.security-grid-full {
  grid-template-columns: 1fr;
}


.security-section-gap-after {
  margin-bottom: 1.8rem;
}

.security-card,
.security-tool-card {
  border-radius: 1rem;
  padding: 1.6rem;
}

.security-outline-only {
  border: 1px solid color-mix(in srgb, var(--border) 58%, transparent);
  background: transparent;
  box-shadow: none;
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
  color: inherit;
  font-size: 1rem;
}

.security-stack {
  margin-top: 1rem;
  border: 1px solid color-mix(in srgb, var(--border) 58%, transparent);
  border-radius: 1rem;
  padding: clamp(1.5rem, 3vw, 2rem);
  background: transparent;
  box-shadow: none;
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
  color: color-mix(in srgb, var(--text) 84%, transparent);
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

  .brand-mark {
    margin-bottom: 0.25rem;
  }

  .brand-mark-full {
    height: 3.9rem;
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
