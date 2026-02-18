<template>
  <div class="landing-page">
    <div class="bg-orb orb-one" aria-hidden="true"></div>
    <div class="bg-orb orb-two" aria-hidden="true"></div>
    <div class="bg-orb orb-three" aria-hidden="true"></div>

    <header class="site-header container">
      <div class="site-brand">ItemTraxx Co</div>
      <div class="header-actions">
        <a
          class="status-badge"
          href="https://statuspage.incident.io/itemtraxx-status"
          target="_blank"
          rel="noreferrer"
          aria-label="Open system status page"
        >
          <span class="status-dot" :class="statusClass" aria-hidden="true"></span>
          {{ statusLabel }}
        </a>
        <a class="support-link" href="mailto:support@itemtraxx.com">Support</a>
        <RouterLink class="login-button" to="/login">Login</RouterLink>
      </div>
    </header>

    <main class="container">
      <section class="hero-section reveal">
        <h1>ItemTraxx</h1>
        <p class="hero-subtext">
          Losing track of where stuff goes? ItemTraxx is the right service for you.
        </p>
        <p class="hero-description">
          Closed beta now live. Contact us to get early access and start mastering your inventory with ItemTraxx's streamlined checkout, returns, and admin management.
        </p>
        <div class="hero-actions">
          <a
            class="hero-button hero-button-dark"
            href="mailto:support@itemtraxx.com"
            @click="trackCta('contact_sales', 'hero')"
          >
            Contact Sales
          </a>
          <a
            class="hero-button hero-button-light"
            href="mailto:support@itemtraxx.com?subject=Request%20Demo%20-%20ItemTraxx"
            @click="trackCta('request_demo', 'hero')"
          >
            Request Demo
          </a>
        </div>
        <div class="trust-strip" aria-label="Key product benefits">
          <span>Secure auth</span>
          <span>Audit logs</span>
          <span>Fast checkouts</span>
        </div>
      </section>

      <div class="section-divider" aria-hidden="true"></div>
      <section class="how-it-works reveal">
        <h2>How it works</h2>
        <p>
          Start quickly with a clean flow that keeps checkout, return, and admin oversight in
          one system.
        </p>
        <div class="steps-grid">
          <article class="step-card reveal reveal-delay-1">
            <div class="step-icon" aria-hidden="true">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8">
                <path d="M4 8.5A2.5 2.5 0 0 1 6.5 6H17.5A2.5 2.5 0 0 1 20 8.5V15.5A2.5 2.5 0 0 1 17.5 18H6.5A2.5 2.5 0 0 1 4 15.5V8.5Z"/>
                <path d="M8.5 12H15.5"/>
                <circle cx="8" cy="12" r="0.5" fill="currentColor"/>
              </svg>
            </div>
            <h3>Sign in</h3>
            <p>Users access their tenant quickly and securely with controlled authentication.</p>
          </article>
          <article class="step-card reveal reveal-delay-2">
            <div class="step-icon" aria-hidden="true">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8">
                <path d="M5 7h14"/>
                <path d="M7 7v10"/>
                <path d="M10 7v10"/>
                <path d="M14 7v10"/>
                <path d="M17 7v10"/>
                <rect x="4" y="5" width="16" height="14" rx="2"/>
              </svg>
            </div>
            <h3>Scan and transact</h3>
            <p>Checkout and returns are processed with clear status and low-friction workflows.</p>
          </article>
          <article class="step-card reveal reveal-delay-3">
            <div class="step-icon" aria-hidden="true">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8">
                <path d="M9 4h6"/>
                <rect x="4" y="3" width="16" height="18" rx="2"/>
                <path d="M8 9h8"/>
                <path d="M8 13h8"/>
                <path d="M8 17h5"/>
              </svg>
            </div>
            <h3>Manage and audit</h3>
            <p>Admins keep inventory clean with logs, usage visibility, and more administrative actions.</p>
          </article>
        </div>
      </section>

      <div class="section-divider" aria-hidden="true"></div>
      <section class="feature-section feature-split reveal">
        <div class="feature-text">
          <div class="feature-heading">
            <span class="feature-icon" aria-hidden="true">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8">
                <path d="M12 3l7 3v6c0 5-3.3 8.5-7 9-3.7-.5-7-4-7-9V6l7-3Z"/>
                <path d="m9.3 12.2 1.9 1.9 3.5-3.5"/>
              </svg>
            </span>
            <h3>Simple usage</h3>
          </div>
          <p>Simple UI keeps everything minimal, sleek, and easy to navigate confusion free.</p>
        </div>
        <div class="feature-mockup">
          <img
            class="feature-image"
            :src="checkoutReturnUiImage"
            alt="Checkout and return interface preview"
            loading="lazy"
          />
        </div>
      </section>

      <div class="section-divider" aria-hidden="true"></div>
      <section class="feature-section feature-split reverse reveal">
        <div class="feature-text">
          <div class="feature-heading">
            <span class="feature-icon" aria-hidden="true">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8">
                <rect x="3" y="4" width="18" height="16" rx="2"/>
                <path d="M7 9h10"/>
                <path d="M7 13h4"/>
                <path d="M14 13h3"/>
              </svg>
            </span>
            <h3>Easy management</h3>
          </div>
          <p>
            With many useful features such as item management, student management,
            transaction logs, etc. keeping track of inventory has never been easier.
          </p>
        </div>
        <div class="feature-mockup">
          <img
            class="feature-image"
            :src="adminUiImage"
            alt="Admin panel interface preview"
            loading="lazy"
          />
        </div>
      </section>

      <div class="section-divider" aria-hidden="true"></div>
      <section class="double-feature reveal">
        <article class="double-feature-card glass-panel reveal reveal-delay-1">
          <h3>Clean up messy inventories.</h3>
          <p>
            ItemTraxx aims to solve the issues with messy inventories. Whether you run a small
            media production company with gear constantly on the move, or a workshop with tools
            going in and out, ItemTraxx is the go-to inventory tracking solution.
          </p>
        </article>
        <article class="double-feature-card glass-panel reveal reveal-delay-2">
          <h3>Master your inventory.</h3>
          <p>
            ItemTraxx also aims to solve issues with keeping track of inventory. Who has what
            item, when it was taken, when it was returned, and what items are out.
          </p>
        </article>
      </section>

      <div class="section-divider" aria-hidden="true"></div>
      <section class="faq-section reveal">
        <h2>Frequently asked questions</h2>
        <div class="faq-list">
          <article v-for="(item, index) in faqItems" :key="item.q" class="faq-item">
            <button
              type="button"
              class="faq-toggle"
              :aria-expanded="openFaqIndex === index"
              @click="toggleFaq(index)"
            >
              {{ item.q }}
              <span class="faq-symbol" aria-hidden="true">+</span>
            </button>
            <div class="faq-answer" :class="{ 'is-open': openFaqIndex === index }">
              <p>{{ item.a }}</p>
            </div>
          </article>
        </div>
      </section>

      <div class="section-divider" aria-hidden="true"></div>
      <section class="final-cta reveal">
        <h2>Ready to simplify inventory tracking?</h2>
        <p>Get started with ItemTraxx and streamline checkout, returns, and admin control.</p>
        <div class="final-cta-actions">
          <RouterLink
            class="hero-button hero-button-dark"
            to="/login"
            @click="trackCta('go_to_login', 'final_cta')"
          >
            Go to Login
          </RouterLink>
          <a
            class="hero-button hero-button-light"
            href="mailto:support@itemtraxx.com"
            @click="trackCta('contact_sales', 'final_cta')"
          >
            Contact Sales
          </a>
        </div>
      </section>
    </main>

    <footer class="site-footer">
      <p class="footer-brand">ItemTraxx Co</p>
      <div class="footer-links">
        <a href="mailto:support@itemtraxx.com">Support</a>
        <a
          href="https://statuspage.incident.io/itemtraxx-status"
          target="_blank"
          rel="noreferrer"
        >
          Status
        </a>
        <a :href="privacyUrl" target="_blank" rel="noreferrer">Privacy Policy</a>
        <a :href="termsUrl" target="_blank" rel="noreferrer">Legal</a>
      </div>
    </footer>

  </div>
</template>

<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref } from "vue";
import { RouterLink } from "vue-router";
import { track } from "@vercel/analytics";
import adminUiImage from "../assets/landing/admin_ui.png";
import checkoutReturnUiImage from "../assets/landing/checkout_return_ui.png";
import { getEdgeFunctionsBaseUrl } from "../services/edgeFunctionClient";

const termsUrl =
  import.meta.env.VITE_TERMS_URL ||
  "https://github.com/ItemTraxxCo/ItemTraxx-App/blob/main/TERMS.md";
const privacyUrl =
  import.meta.env.VITE_PRIVACY_URL ||
  "https://github.com/ItemTraxxCo/ItemTraxx-App/blob/main/PRIVACY.md";
const statusFunctionName = import.meta.env.VITE_STATUS_FUNCTION || "system-status";
const statusLabel = ref("Unknown");
const statusClass = ref<"status-ok" | "status-warn" | "status-down" | "status-unknown">(
  "status-unknown",
);

const faqItems = [
  {
    q: "How quickly can I get started?",
    a: "You can get started with ItemTraxx fast. Simply contact support at support@itemtraxx.com to set up your account and user. Once you have your credentials, you can log in and start managing your inventory right away.",
  },
  {
    q: "Does ItemTraxx keep a transaction history?",
    a: "Yes, ItemTraxx keeps a detailed transaction history that logs every checkout, return, and inventory change. This allows you to track who has what items, when they were taken, and when they were returned.",
  },
  {
    q: "Is this a fit for schools and small teams?",
    a: "Yes, ItemTraxx is designed to be flexible and scalable, making it a great fit for schools, small teams, and even larger organizations. Whether you're managing a small inventory or a large one, ItemTraxx can help you keep track of everything efficiently.",
  },
  {
    q: "How do I request a demo?",
    a: "You can request a demo by contacting our support team at support@itemtraxx.com.",
  },
  {
    q: "I found a bug, how do I report it?",
    a: "Please contact support at support@itemtraxx.com to report any bugs or issues you encounter.",
  },
  {
    q: "I want to suggest a feature, how can I do that?",
    a: "Please contact support at support@itemtraxx.com to suggest any features you'd like to see.",
  },
  {
    q: "Is this the same as ItemTrax or Item Traxx?",
    a: "Yes. If you searched for ItemTrax or Item Traxx, this is the official ItemTraxx site.",
  },
  {
    q: "Is there a limit to how many items, transactions, and students I can have?",
    a: "No, there are no limits to the number of items, transactions, or students you can have in ItemTraxx. Our system is designed to scale with your needs, so you can manage as much inventory as you require without worrying about hitting any limits.",
  },
];
const openFaqIndex = ref<number | null>(null);

const toggleFaq = (index: number) => {
  openFaqIndex.value = openFaqIndex.value === index ? null : index;
};

const trackCta = (
  cta: "contact_sales" | "request_demo" | "go_to_login",
  location: "hero" | "final_cta",
) => {
  track("landing_cta_click", { cta, location });
};

let observer: IntersectionObserver | null = null;
let statusTimer: number | null = null;

const refreshSystemStatus = async () => {
  const functionsBaseUrl = getEdgeFunctionsBaseUrl();
  if (!functionsBaseUrl) {
    statusLabel.value = "Unknown";
    statusClass.value = "status-unknown";
    return;
  }

  const controller = new AbortController();
  const timeoutId = window.setTimeout(() => controller.abort(), 3500);
  try {
    const response = await fetch(`${functionsBaseUrl}/${statusFunctionName}`, {
      method: "GET",
      signal: controller.signal,
    });

    const payload = (await response.json().catch(() => ({}))) as {
      status?: string;
    };

    if (response.ok && payload.status === "operational") {
      statusLabel.value = "Running";
      statusClass.value = "status-ok";
      return;
    }

    if (response.status >= 500 || payload.status === "down") {
      statusLabel.value = "Down";
      statusClass.value = "status-down";
      return;
    }

    statusLabel.value = "Degraded";
    statusClass.value = "status-warn";
  } catch {
    statusLabel.value = "Unknown";
    statusClass.value = "status-unknown";
  } finally {
    window.clearTimeout(timeoutId);
  }
};

onMounted(() => {
  const prefersReducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  const revealElements = document.querySelectorAll<HTMLElement>(".reveal");
  void refreshSystemStatus();
  statusTimer = window.setInterval(() => {
    void refreshSystemStatus();
  }, 60_000);

  if (prefersReducedMotion) {
    revealElements.forEach((el) => el.classList.add("is-visible"));
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
    { threshold: 0.15, rootMargin: "0px 0px -40px 0px" },
  );

  revealElements.forEach((el) => observer?.observe(el));
});

onBeforeUnmount(() => {
  observer?.disconnect();
  observer = null;
  if (statusTimer) {
    window.clearInterval(statusTimer);
    statusTimer = null;
  }
});
</script>

<style scoped>
.landing-page {
  min-height: 100vh;
  margin: -2.5rem -2rem -3rem;
  padding: 1.2rem 0 3.4rem;
  background: linear-gradient(180deg, #1f4ca3 0%, #38d0b1 100%);
  color: #ffffff;
  position: relative;
  overflow: hidden;
}

.container {
  width: min(1180px, 92%);
  margin: 0 auto;
  position: relative;
  z-index: 2;
}

.bg-orb {
  position: absolute;
  border-radius: 999px;
  filter: blur(30px);
  opacity: 0.26;
  pointer-events: none;
}

.orb-one {
  width: 320px;
  height: 320px;
  top: 120px;
  left: -90px;
  background: rgba(129, 178, 255, 0.7);
}

.orb-two {
  width: 270px;
  height: 270px;
  top: 460px;
  right: -60px;
  background: rgba(92, 224, 200, 0.75);
}

.orb-three {
  width: 360px;
  height: 360px;
  bottom: 120px;
  left: 18%;
  background: rgba(77, 137, 255, 0.46);
}

.site-header {
  position: fixed;
  top: var(--top-banner-offset, 0px);
  left: 50%;
  transform: translateX(-50%);
  z-index: 20;
  width: min(1180px, 92%);
  padding-top: 0.95rem;
  display: flex;
  align-items: center;
  justify-content: space-between;
}

.site-brand {
  font-size: 1.6rem;
  font-weight: 700;
  letter-spacing: 0.01em;
}

.header-actions {
  display: flex;
  align-items: center;
  gap: 0.9rem;
}

.status-badge {
  display: inline-flex;
  align-items: center;
  gap: 0.4rem;
  border: 1px solid rgba(255, 255, 255, 0.24);
  background: rgba(8, 24, 50, 0.25);
  color: #ffffff;
  text-decoration: none;
  border-radius: 999px;
  padding: 0.38rem 0.62rem;
  font-size: 0.82rem;
  font-weight: 600;
}

.status-dot {
  width: 0.5rem;
  height: 0.5rem;
  border-radius: 999px;
  display: inline-block;
}

.status-ok {
  background: #38d17d;
}

.status-warn {
  background: #f3b44d;
}

.status-down {
  background: #ef4f4f;
}

.status-unknown {
  background: #9aa4af;
}

.support-link {
  color: #ffffff;
  font-size: 1rem;
  text-decoration: underline;
}

.login-button {
  border: 1px solid rgba(10, 23, 49, 0.85);
  background: #ffffff;
  color: #142947;
  border-radius: 8px;
  padding: 0.5rem 0.92rem;
  font-size: 0.95rem;
  font-weight: 700;
  text-decoration: none;
}

.hero-section {
  text-align: center;
  padding-top: 6.2rem;
}

.hero-section h1 {
  margin: 0 0 1rem;
  font-size: clamp(2.6rem, 5.8vw, 4.6rem);
  font-weight: 800;
}

.hero-subtext {
  margin: 0 auto;
  max-width: 820px;
  font-size: clamp(1rem, 2vw, 1.24rem);
  font-weight: 600;
  color: rgba(255, 255, 255, 0.94);
}

.hero-description {
  margin: 1.3rem auto 0;
  max-width: 900px;
  color: rgba(255, 255, 255, 0.88);
  font-size: clamp(0.96rem, 1.45vw, 1.08rem);
  line-height: 1.64;
}

.hero-actions,
.final-cta-actions {
  margin-top: 1.9rem;
  display: flex;
  justify-content: center;
  gap: 0.8rem;
}

.hero-button {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  border-radius: 10px;
  padding: 0.72rem 1.2rem;
  font-weight: 700;
  border: 1px solid transparent;
  transition: transform 0.15s ease, filter 0.2s ease;
  text-decoration: none;
}

.hero-button:hover {
  transform: translateY(-1px);
  filter: brightness(1.03);
}

.hero-button-dark {
  background: #111111;
  color: #ffffff;
}

.hero-button-light {
  background: #ffffff;
  color: #0e2654;
  border-color: rgba(12, 34, 74, 0.7);
}

.trust-strip {
  margin: 1.8rem auto 0;
  display: inline-flex;
  align-items: center;
  gap: 1.1rem;
  font-size: 0.88rem;
  color: rgba(255, 255, 255, 0.9);
  border-radius: 999px;
  border: 1px solid rgba(255, 255, 255, 0.25);
  padding: 0.5rem 0.95rem;
  background: rgba(5, 20, 46, 0.2);
}

.trust-strip span {
  display: inline-flex;
  align-items: center;
  gap: 0.45rem;
}

.trust-strip span::before {
  content: "";
  width: 7px;
  height: 7px;
  border-radius: 999px;
  background: rgba(255, 255, 255, 0.84);
}

.section-divider {
  margin-top: 4.2rem;
  height: 1px;
  width: 100%;
  background: linear-gradient(
    90deg,
    rgba(255, 255, 255, 0),
    rgba(255, 255, 255, 0.48),
    rgba(255, 255, 255, 0)
  );
}

.how-it-works,
.faq-section,
.final-cta {
  margin-top: 4.4rem;
}

.how-it-works h2,
.faq-section h2,
.final-cta h2 {
  margin: 0;
  font-size: clamp(1.8rem, 3vw, 2.4rem);
  color: #06172f;
}

.how-it-works > p,
.final-cta > p {
  margin: 0.9rem 0 0;
  color: rgba(7, 23, 43, 0.85);
  max-width: 760px;
  line-height: 1.7;
}

.steps-grid {
  margin-top: 1.6rem;
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 1rem;
}

.step-card {
  border-radius: 14px;
  border: 1px solid rgba(255, 255, 255, 0.24);
  background: rgba(255, 255, 255, 0.22);
  backdrop-filter: blur(6px);
  padding: 1.1rem;
}

.step-icon,
.feature-icon {
  width: 2.2rem;
  height: 2.2rem;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  border-radius: 10px;
  color: #0d2f66;
  background: rgba(255, 255, 255, 0.65);
  border: 1px solid rgba(14, 45, 88, 0.2);
}

.step-icon svg,
.feature-icon svg {
  width: 1.3rem;
  height: 1.3rem;
}

.step-card h3 {
  margin: 0.7rem 0 0.45rem;
  font-size: 1.1rem;
  color: #06172f;
}

.step-card p {
  margin: 0;
  color: rgba(7, 23, 43, 0.82);
  line-height: 1.6;
}

.feature-section {
  margin-top: 4.4rem;
}

.feature-split {
  display: grid;
  grid-template-columns: 1fr 1fr;
  align-items: center;
  gap: 2.2rem;
}

.feature-heading {
  display: flex;
  align-items: center;
  gap: 0.65rem;
  margin-bottom: 0.8rem;
}

.feature-text h3 {
  margin: 0;
  font-size: clamp(1.65rem, 2.7vw, 2.15rem);
  color: #06172f;
}

.feature-text p {
  margin: 0;
  color: rgba(7, 23, 43, 0.82);
  line-height: 1.7;
  max-width: 560px;
}

.feature-mockup {
  display: flex;
  justify-content: center;
}

.feature-image {
  width: min(540px, 100%);
  height: auto;
  border-radius: 14px;
  border: 1px solid rgba(9, 21, 37, 0.14);
  background: #f5f5f5;
  display: block;
  box-shadow: 0 8px 18px rgba(0, 0, 0, 0.12);
  transition: transform 0.2s ease, box-shadow 0.22s ease;
}

.feature-image:hover {
  transform: translateY(-3px);
  box-shadow: 0 14px 24px rgba(0, 0, 0, 0.18);
}

.double-feature {
  margin-top: 5.4rem;
  display: grid;
  gap: 2.2rem;
  grid-template-columns: repeat(2, minmax(0, 1fr));
}

.double-feature-card h3 {
  margin: 0 0 0.8rem;
  font-size: 1.65rem;
  color: #06172f;
}

.double-feature-card p {
  margin: 0;
  color: rgba(7, 23, 43, 0.82);
  line-height: 1.72;
}

.glass-panel {
  border-radius: 16px;
  border: 1px solid rgba(255, 255, 255, 0.22);
  background: rgba(255, 255, 255, 0.22);
  box-shadow: 0 8px 20px rgba(0, 0, 0, 0.12);
  backdrop-filter: blur(6px);
  padding: 1.2rem;
}

.faq-list {
  margin-top: 1.3rem;
  display: grid;
  gap: 0.8rem;
}

.faq-item {
  border-radius: 12px;
  border: 1px solid rgba(255, 255, 255, 0.28);
  background: rgba(255, 255, 255, 0.2);
  padding: 0.2rem 0.95rem;
}

.faq-toggle {
  width: 100%;
  display: flex;
  align-items: center;
  justify-content: space-between;
  background: transparent;
  border: 0;
  padding: 0.6rem 0;
  text-align: left;
  cursor: pointer;
  font-weight: 700;
  font-size: 1rem;
  color: #06172f;
}

.faq-symbol {
  font-size: 1.05rem;
  line-height: 1;
  transition: transform 0.22s ease;
}

.faq-toggle[aria-expanded="true"] .faq-symbol {
  transform: rotate(45deg);
}

.faq-answer {
  display: grid;
  grid-template-rows: 0fr;
  transition: grid-template-rows 0.26s ease;
}

.faq-answer.is-open {
  grid-template-rows: 1fr;
}

.faq-answer p {
  margin: 0;
  overflow: hidden;
  padding-top: 0;
  color: rgba(7, 23, 43, 0.84);
  line-height: 1.65;
  transition: padding-top 0.26s ease;
}

.faq-answer.is-open p {
  padding-top: 0.75rem;
  padding-bottom: 0.5rem;
}

.final-cta {
  border-radius: 16px;
  border: 1px solid rgba(255, 255, 255, 0.26);
  background: rgba(255, 255, 255, 0.2);
  backdrop-filter: blur(6px);
  padding: 1.4rem;
}

.site-footer {
  width: min(1180px, 92%);
  margin: 5.7rem auto 0;
  display: flex;
  align-items: center;
  justify-content: space-between;
  color: rgba(21, 26, 41, 0.95);
  position: relative;
  z-index: 2;
}

.footer-brand {
  margin: 0;
  font-size: 0.94rem;
  font-weight: 700;
}

.footer-links {
  display: flex;
  gap: 1rem;
  font-size: 0.84rem;
}

.footer-links a {
  color: rgba(17, 26, 45, 0.95);
}

.reveal {
  opacity: 0;
  transform: translateY(14px);
  transition: opacity 0.45s ease, transform 0.45s ease;
}

.reveal.is-visible {
  opacity: 1;
  transform: none;
}

.reveal-delay-1 {
  transition-delay: 0.06s;
}

.reveal-delay-2 {
  transition-delay: 0.12s;
}

.reveal-delay-3 {
  transition-delay: 0.18s;
}

@media (max-width: 1024px) {
  .site-header {
    width: min(920px, 92%);
  }

  .site-footer {
    width: min(920px, 92%);
  }

  .hero-section {
    padding-top: 5.5rem;
  }

  .steps-grid {
    grid-template-columns: 1fr;
  }

  .feature-split,
  .feature-split.reverse {
    grid-template-columns: 1fr;
  }

  .feature-split.reverse .feature-text {
    order: 2;
  }

  .feature-split.reverse .feature-mockup {
    order: 1;
  }

  .feature-text {
    text-align: center;
  }

  .feature-heading {
    justify-content: center;
  }

  .feature-text p {
    max-width: 100%;
  }
}

@media (max-width: 720px) {
  .landing-page {
    margin: -2.5rem -2rem -3rem;
    padding-bottom: 2.2rem;
  }

  .site-header {
    width: min(560px, 92%);
    padding-top: 0.58rem;
  }

  .hero-actions,
  .final-cta-actions {
    flex-direction: column;
    align-items: stretch;
  }

  .hero-button {
    width: 100%;
  }

  .double-feature {
    grid-template-columns: 1fr;
  }

  .double-feature-card:first-child {
    order: 2;
  }

  .double-feature-card:last-child {
    order: 1;
  }

  .feature-section,
  .double-feature,
  .section-divider,
  .site-footer,
  .faq-section,
  .final-cta,
  .how-it-works {
    margin-top: 4rem;
  }

  .site-brand {
    font-size: 1.2rem;
  }

  .support-link {
    font-size: 0.92rem;
  }

  .status-badge {
    font-size: 0.78rem;
    padding: 0.34rem 0.56rem;
  }

  .login-button {
    padding: 0.42rem 0.8rem;
    font-size: 0.9rem;
  }

  .site-footer {
    width: min(560px, 92%);
    flex-direction: column;
    align-items: flex-start;
    gap: 0.8rem;
    margin-top: 4.4rem;
  }

  .footer-links {
    flex-direction: column;
    align-items: flex-start;
    gap: 0.5rem;
  }

  .trust-strip {
    width: 100%;
    justify-content: center;
    flex-wrap: wrap;
    border-radius: 12px;
  }

}

@media (prefers-reduced-motion: reduce) {
  .reveal {
    opacity: 1;
    transform: none;
    transition: none;
  }

  .hero-button,
  .feature-image {
    transition: none;
  }
}
</style>
