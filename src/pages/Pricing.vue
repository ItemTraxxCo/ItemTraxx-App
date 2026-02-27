<template>
  <div class="pricing-shell">
    <div class="pricing-orb orb-one" aria-hidden="true"></div>
    <div class="pricing-orb orb-two" aria-hidden="true"></div>
    <div class="pricing-orb orb-three" aria-hidden="true"></div>
    <div class="page pricing-page">
      <div class="page-nav-left">
        <RouterLink class="pricing-back-link" to="/" aria-label="Return to home">
          <svg viewBox="0 0 24 24" aria-hidden="true">
            <path d="M15 5 8 12l7 7" />
          </svg>
        </RouterLink>
      </div>

      <h1>ItemTraxx Pricing</h1>
      <p class="muted">
        Annual subscriptions by district size. All plans are subject to onboarding fees in year one.
      </p>
      <div class="pricing-actions">
        <RouterLink class="pricing-contact-button" to="/contact-sales">
          Contact Sales
        </RouterLink>
      </div>

      <section class="plan-grid" aria-label="Pricing plans">
        <article class="card plan-card">
          <h2>ItemTraxx Core Plan</h2>
          <p class="price">$1,250.00<span>/year</span></p>
          <p class="price-note">Listed price excludes the 1st year onboarding fee.</p>
          <ul>
            <li>Up to 3 schools within the district</li>
            <li>Unlimited staff accounts</li>
            <li>Item tracking and status visibility</li>
            <li>Checkout and return system</li>
            <li>Standard support (72-hour response time)</li>
          </ul>
          <p class="onboarding">+1st Year Onboarding Fee: $750.00</p>
        </article>

        <article class="card plan-card plan-highlight">
          <h2>ItemTraxx Growth Plan</h2>
          <p class="price">$3,500.00<span>/year</span></p>
          <p class="price-note">Listed price excludes the 1st year onboarding fee.</p>
          <ul>
            <li>Up to 6 schools within the district</li>
            <li>Unlimited staff accounts</li>
            <li>Item tracking and status visibility</li>
            <li>Checkout and return system</li>
            <li>Standard support (72-hour response time)</li>
          </ul>
          <p class="onboarding">+1st Year Onboarding Fee: $1,250.00</p>
        </article>

        <article class="card plan-card">
          <h2>ItemTraxx Enterprise Plan</h2>
          <p class="price">Contact for pricing</p>
          <p class="starting">Starts at $4,500.00 (excluding 1st year fees)</p>
          <ul>
            <li>Base coverage for first 7 schools within the district</li>
            <li>Unlimited staff accounts</li>
            <li>Item tracking and status visibility</li>
            <li>Checkout and return system</li>
            <li>Priority support (24-hour response time)</li>
          </ul>
          <p class="onboarding">+1st Year Onboarding Fee: Contact for pricing (starts at $1,500.00)</p>
          <p class="enterprise-note">
            For full enterprise pricing (quote for more than 7 schools) and multi-district scope, use the contact sales button above.
          </p>
        </article>
      </section>

      <section class="card billing-card">
        <h2>Pricing FAQ</h2>
        <ul>
          <li><strong>Are plans annual or monthly?</strong> All plans are annual subscriptions.</li>
          <li><strong>When is onboarding charged?</strong> Onboarding is a one-time fee in year one only.</li>
          <li><strong>Can we move between plans?</strong> Yes. Upgrades are prorated; downgrades apply next billing cycle.</li>
          <li><strong>How do we request a formal quote?</strong> Use the Contact Sales button above and we will provide an official quote.</li>
        </ul>
      </section>

      <section class="card billing-card">
        <h2>What Onboarding Includes</h2>
        <ul class="onboarding-includes-list">
          <li>
            <strong>Core and Growth Plans:</strong>
            The onboarding fee is a one-time charge during year one and includes hassle-free
            addition of items and students (you provide inventory and existing records, and we
            complete setup for you), a custom onboarding call (1-2 hours) covering product
            features, account setup (logins), and live Q&A/help, plus a dedicated Slack support
            channel during the first 3 months of use with a 24-hour response SLA.
          </li>
          <li class="enterprise-onboarding-row">
            <strong>Enterprise Plan:</strong>
            The onboarding fee is a one-time charge during year one and includes hassle-free
            addition of items and students (you provide inventory and existing records, and we
            complete setup for you), a custom onboarding call (1-2 hours) covering product
            features, account setup (logins), and live Q&A/help, plus a dedicated Slack support
            channel with a 24-hour response SLA active throughout the full subscription term.
          </li>
        </ul>
      </section>

      <section class="card billing-card">
        <h2>Billing Terms</h2>
        <ul>
          <li>All plans are billed annually.</li>
          <li>Applicable taxes and government fees are not included in listed pricing.</li>
          <li>Onboarding fee applies only to year one (1) of subscription and is required.</li>
          <li>Renewal terms and final scope are confirmed in the signed agreement.</li>
          <li>
            Full subscription policies:
            <a href="https://www.itemtraxx.com/legal" target="_blank" rel="noreferrer">
              itemtraxx.com/legal
            </a>
          </li>
        </ul>
      </section>
    </div>
  </div>
</template>

<script setup lang="ts">
import { RouterLink } from "vue-router";
</script>

<style scoped>
.pricing-shell {
  min-height: 100vh;
  width: 100vw;
  max-width: none;
  position: relative;
  left: 50%;
  right: 50%;
  margin-left: -50vw;
  margin-right: -50vw;
  margin-top: -2.5rem;
  margin-bottom: -3rem;
  padding: 2.1rem 0 3.2rem;
  background: linear-gradient(180deg, #1f4ca3 0%, #38d0b1 100%);
  color: #ffffff;
  overflow-x: clip;
  overflow-y: hidden;
}

.pricing-page {
  max-width: 1140px;
  width: 100%;
  box-sizing: border-box;
  padding-inline: clamp(1.1rem, 3vw, 1.75rem);
  position: relative;
  z-index: 2;
}

.pricing-back-link {
  width: 2.4rem;
  height: 2.4rem;
  border-radius: 999px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  border: 1px solid rgba(255, 255, 255, 0.28);
  background: rgba(7, 23, 43, 0.24);
  color: #ffffff;
  text-decoration: none;
  transition: transform 0.16s ease, border-color 0.16s ease, background 0.16s ease;
}

.pricing-back-link:hover {
  text-decoration: none;
  transform: translateY(-1px);
  border-color: rgba(255, 255, 255, 0.6);
  background: rgba(7, 23, 43, 0.34);
}

.pricing-back-link svg {
  width: 1.2rem;
  height: 1.2rem;
  stroke: currentColor;
  stroke-width: 2.2;
  stroke-linecap: round;
  stroke-linejoin: round;
  fill: none;
}

.pricing-orb {
  position: absolute;
  border-radius: 999px;
  filter: blur(30px);
  opacity: 0.26;
  pointer-events: none;
}

.orb-one {
  width: 320px;
  height: 320px;
  top: 90px;
  left: -100px;
  background: rgba(129, 178, 255, 0.7);
}

.orb-two {
  width: 270px;
  height: 270px;
  top: 420px;
  right: -70px;
  background: rgba(92, 224, 200, 0.75);
}

.orb-three {
  width: 360px;
  height: 360px;
  bottom: 110px;
  left: 16%;
  background: rgba(77, 137, 255, 0.46);
}

.pricing-actions {
  margin-top: 0.9rem;
  margin-bottom: 0.3rem;
}

.pricing-contact-button {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  border-radius: 12px;
  border: 1px solid rgba(255, 255, 255, 0.38);
  background: rgba(7, 23, 43, 0.35);
  color: #ffffff;
  font-weight: 700;
  text-decoration: none;
  padding: 0.58rem 1.05rem;
  transition: transform 0.16s ease, background 0.16s ease, border-color 0.16s ease;
}

.pricing-contact-button:hover {
  text-decoration: none;
  transform: translateY(-1px);
  background: rgba(7, 23, 43, 0.5);
  border-color: rgba(255, 255, 255, 0.58);
}

.plan-grid {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 1rem;
  margin-top: 1rem;
}

.plan-card {
  display: flex;
  flex-direction: column;
  border-radius: 14px;
  border: 1px solid rgba(255, 255, 255, 0.4);
  background: rgba(255, 255, 255, 0.32);
  backdrop-filter: blur(6px);
  box-shadow: none;
}

.plan-card h2 {
  margin: 0;
  font-size: 1.2rem;
  color: #06172f;
}

.price {
  margin: 0.65rem 0 0.4rem;
  font-size: 1.7rem;
  font-weight: 700;
  color: #06172f;
}

.price span {
  margin-left: 0.25rem;
  font-size: 0.92rem;
  font-weight: 500;
  color: rgba(7, 23, 43, 0.75);
}

.starting {
  margin: 0 0 0.7rem;
  font-size: 0.9rem;
  color: rgba(7, 23, 43, 0.82);
}

.price-note {
  margin: 0 0 0.8rem;
  font-size: 0.84rem;
  color: rgba(7, 23, 43, 0.72);
}

.plan-card ul {
  margin: 0;
  padding-left: 1.1rem;
  display: grid;
  gap: 0.45rem;
  color: rgba(7, 23, 43, 0.85);
}

.onboarding {
  margin: 0.9rem 0 0;
  padding-top: 0.8rem;
  border-top: 1px solid rgba(14, 45, 88, 0.18);
  font-weight: 600;
  font-size: 0.92rem;
  color: #06172f;
}

.enterprise-note {
  margin: 0.65rem 0 0;
  font-size: 0.88rem;
  color: rgba(7, 23, 43, 0.82);
}

.enterprise-note a {
  color: #0a2a5f;
  font-weight: 700;
  text-decoration: underline;
  text-underline-offset: 2px;
}

.enterprise-note a:hover {
  color: #061b3f;
}

.plan-highlight {
  border-color: rgba(255, 255, 255, 0.34);
  box-shadow: 0 10px 28px rgba(6, 23, 47, 0.18);
}

.billing-card {
  margin-top: 1rem;
  border-radius: 14px;
  border: 1px solid rgba(255, 255, 255, 0.4);
  background: rgba(255, 255, 255, 0.32);
  backdrop-filter: blur(6px);
  box-shadow: none;
}

.billing-card h2 {
  margin-top: 0;
  color: #06172f;
}

.billing-card ul {
  margin: 0;
  padding-left: 1.1rem;
  display: grid;
  gap: 0.45rem;
  color: rgba(7, 23, 43, 0.85);
}

.onboarding-includes-list {
  gap: 0.8rem;
}

.enterprise-onboarding-row {
  margin-top: 0.2rem;
  padding-top: 0.8rem;
  border-top: 1px dashed rgba(6, 27, 63, 0.35);
}

.billing-card a {
  color: #0a2a5f;
  font-weight: 700;
  text-decoration: underline;
  text-underline-offset: 2px;
}

.billing-card a:hover {
  color: #061b3f;
}

@media (max-width: 980px) {
  .pricing-shell {
    margin-top: -2.5rem;
    margin-bottom: -3rem;
    padding: 1.6rem 0 2.6rem;
  }

  .pricing-page {
    padding-inline: 1.1rem;
  }

  .plan-grid {
    grid-template-columns: 1fr;
  }
}
</style>
