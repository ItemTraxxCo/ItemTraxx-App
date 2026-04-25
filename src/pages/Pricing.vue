<template>
  <div class="pricing-shell">
    <div class="pricing-orb orb-one" aria-hidden="true"></div>
    <div class="pricing-orb orb-two" aria-hidden="true"></div>
    <div class="grid-noise" aria-hidden="true"></div>

    <div class="pricing-page">
      <div class="page-nav-left pricing-top-nav">
        <RouterLink class="pricing-back-link" to="/" aria-label="Return to home" @click.prevent="$router.back()">
          <svg viewBox="0 0 24 24" aria-hidden="true">
            <path d="M15 5 8 12l7 7" />
          </svg>
        </RouterLink>
        <span class="pricing-breadcrumb"> </span>
      </div>

      <section class="pricing-hero">
        <p class="pricing-eyebrow">Pricing</p>
        <h1>Simple pricing for teams of any size.</h1>
        <p class="pricing-lead">
          Clear plan options for districts, organizations, and individual plans. Contact sales 
          for custom quotes, multi-district pricing, or any questions about which plan is right
            for you.
        </p>
        <div class="pricing-actions">
          <RouterLink class="pricing-contact-button" to="/contact-sales">
            Contact Sales
          </RouterLink>
          <RouterLink class="pricing-secondary-button" to="/login">
            Go to Login
          </RouterLink>
        </div>
      </section>

      <section class="pricing-section">
        <div class="pricing-section-header">
          <p class="pricing-section-eyebrow">School District category</p>
          <h2>School District Pricing</h2>
          <p>
            Annual subscription pricing is based on the
            number of schools in the district, with onboarding billed separately in year one (1) only.
          </p>
        </div>

        <section class="plan-grid" aria-label="District pricing plans">
          <article class="plan-card">
            <h3>ItemTraxx School District Core Plan</h3>
            <p class="plan-meta">1-3 schools in district</p>
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

          <article class="plan-card plan-highlight">
            <h3>ItemTraxx School District Growth Plan</h3>
            <p class="plan-meta">4-6 schools in district</p>
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

          <article class="plan-card">
            <h3>ItemTraxx School District Enterprise Plan</h3>
            <p class="plan-meta">7+ schools in district</p>
            <p class="price">Contact for pricing</p>
            <p class="starting">Starts at $4,500/year</p>
            <ul>
              <li>Coverage for 7+ schools within the district</li>
              <li>Unlimited staff accounts</li>
              <li>Item tracking and status visibility</li>
              <li>Checkout and return system</li>
              <li>Priority support (24-hour response time)</li>
            </ul>
            <p class="onboarding">
              +1st Year Onboarding Fee: Contact for pricing (Starts at $1,500.00)
            </p>
            <p class="enterprise-note">
              For full enterprise pricing (quote for more than 7 schools) and multi-district scope,
              use the contact sales button above.
            </p>
          </article>
        </section>
      </section>

      <section class="pricing-section">
        <div class="pricing-section-header">
          <p class="pricing-section-eyebrow">Organization category</p>
          <h2>Organization Pricing</h2>
          <p>
            For organizations, pricing is based on the number of locations or operating units.
            Onboarding is billed separately in year one (1) only.
          </p>
        </div>

        <section class="plan-grid" aria-label="Organization pricing plans">
          <article class="plan-card">
            <h3>ItemTraxx Organization Starter Plan</h3>
            <p class="plan-meta">1-3 locations or teams</p>
            <p class="price">$1,250.00<span>/year</span></p>
            <ul>
              <li>Up to 3 locations or teams within your organization</li>
              <li>Unlimited staff accounts</li>
              <li>Item tracking and status visibility</li>
              <li>Checkout and return system</li>
              <li>Standard support (72-hour response time)</li>
            </ul>
            <p class="onboarding">+1st Year Onboarding Fee: $500.00 / year</p>
          </article>

          <article class="plan-card plan-highlight">
            <h3>ItemTraxx Organization Scale Plan</h3>
            <p class="plan-meta">4-6 locations or teams</p>
            <p class="price">$3,500.00<span>/year</span></p>
            <ul>
              <li>Up to 6 locations or teams within your organization</li>
              <li>Unlimited staff accounts</li>
              <li>Item tracking and status visibility</li>
              <li>Checkout and return system</li>
              <li>Standard support (72-hour response time)</li>
            </ul>
            <p class="onboarding">+1st Year Onboarding Fee: $1,000.00 / year</p>
          </article>

          <article class="plan-card">
            <h3>ItemTraxx Organization Enterprise Plan</h3>
            <p class="plan-meta">7+ locations or teams</p>
            <p class="price">Contact for pricing</p>
            <p class="starting">Starts at $4,500/year</p>
            <ul>
              <li>Customized solution for large-scale organizations requiring 7+ locations or teams</li>
              <li>Unlimited staff accounts</li>
              <li>Item tracking and status visibility</li>
              <li>Checkout and return system</li>
              <li>Priority support (24-hour response time)</li>
            </ul>
            <p class="onboarding">
              +1st Year Onboarding Fee: Contact for pricing (starts at $500.00)
            </p>
            <p class="enterprise-note">
              For full enterprise pricing (quote for more than 7 locations or teams), use the
              contact sales button above.
            </p>
          </article>
        </section>
      </section>

      <section class="pricing-section">
        <div class="pricing-section-header">
          <p class="pricing-section-eyebrow">Individual category</p>
          <h2>Individual Pricing</h2>
          <p>
            For single operators who need ItemTraxx without an organization or district structure.
          </p>
        </div>

        <section class="plan-grid plan-grid-two" aria-label="Individual pricing plans">
          <article class="plan-card">
            <h3>ItemTraxx Individual Yearly Plan</h3>
            <p class="plan-meta">Single-user plan</p>
            <p class="price">$70.00<span>/year</span></p>
            <ul>
              <li>Single-user access on the main ItemTraxx app</li>
              <li>Simple personal inventory tracking workflow</li>
              <li>Invoice-based billing</li>
            </ul>
            <p class="onboarding">Onboarding not available</p>
          </article>

          <article class="plan-card">
            <h3>ItemTraxx Individual Monthly Plan</h3>
            <p class="plan-meta">Single-user plan</p>
            <p class="price">$7.00<span>/month</span></p>
            <ul>
              <li>Month-to-month version of the individual plan</li>
              <li>Single-user access on the main ItemTraxx app</li>
              <li>Invoice-based billing</li>
            </ul>
            <p class="onboarding">Onboarding not available</p>
          </article>
        </section>
      </section>

      <div class="pricing-section-divider" aria-hidden="true">
        <span></span>
      </div>

      <section class="billing-card">
        <h2>Pricing FAQ</h2>
        <ul>
          <li><strong>Are plans annual or monthly?</strong> District and organization plans are annual. Individual plans are available annually or monthly.</li>
          <li><strong>When is onboarding charged?</strong> Onboarding is a one-time fee in year one (1) only and is required for all new customers.</li>
          <li><strong>Can we move between plans?</strong> Yes. Upgrades are prorated; downgrades apply next billing cycle. Contact support for details.</li>
          <li><strong>How do we request a formal quote?</strong> Use the Contact Sales button above and we will provide an official quote.</li>
          <li><strong>How are plans billed?</strong> Plans are billed annually or monthly, depending on the plan selected via invoice.</li>
          <li><strong>What payment methods do you accept?</strong> We accept payment via credit card or ACH bank transfer. Contact sales for details.</li>
          <li><strong>What happens if you dont pay an invoice?</strong> If an invoice is not paid by the due date, a late fee may be applied, 
            and the account may be subject to suspension or cancellation. These terms apply to all customers. See legal terms for more information.</li>
        </ul>
      </section>

      <section class="billing-card">
        <h2>What Onboarding Includes</h2>
        <ul class="onboarding-includes-list">
          <li>
            <strong>District Core and Growth Plans:</strong>
            The onboarding fee is a one-time charge during year one and includes hassle-free
            addition of items and borrowers (you provide inventory and existing records, and we
            complete setup for you), a custom onboarding call covering product
            features, account setup (logins), and live Q&A/help, plus a dedicated Slack support
            channel during the first three (3) months of use with a 24-hour response SLA for the first
            three (3) months of use, after that moves to 72-hour response SLA.
          </li>
          <li class="enterprise-onboarding-row">
            <strong>District Enterprise Plan:</strong>
            The onboarding fee is a one-time charge during year one and includes hassle-free
            addition of items and borrowers (you provide inventory and existing records, and we
            complete setup for you), a custom onboarding call covering product
            features, account setup (logins), and live Q&A/help, plus a dedicated Slack support
            channel with a 24-hour response SLA active throughout the full subscription term.
          </li>
          <li class="enterprise-onboarding-row">
            <strong>Organization Starter and Scale Plans:</strong>
            The onboarding fee is a one-time charge during year one and includes hassle-free
            addition of items and members (you provide inventory and existing records, and we
            complete setup for you), a custom onboarding call covering product
            features, account setup (logins), and live Q&A/help, plus a dedicated Slack support
            channel during the first three (3) months of use with a 24-hour response SLA for the first
            three (3) months of use, after that moves to 72-hour response SLA.
          </li>
          <li class="enterprise-onboarding-row">
            <strong>Organization Enterprise Plan:</strong>
            The onboarding fee is a one-time charge during year one and includes hassle-free
            addition of items and members (you provide inventory and existing records, and we
            complete setup for you), a custom onboarding call covering product
            features, account setup (logins), and live Q&A/help, plus a dedicated Slack support
            channel with a 24-hour response SLA active throughout the full subscription term.
          </li>
          <li class="enterprise-onboarding-row">
            <strong>Individual Plans:</strong>
            Onboarding is not available for Individual Yearly or Individual Monthly plans. Individual
            Yeary and Individual Monthly plans have regular access to our support team via email with a 
            72-hour response SLA.
          </li>
        </ul>
      </section>

      <section class="billing-card">
        <h2>Billing Terms</h2>
        <ul>
          <li>District and organization plans are billed annually. Individual plans are available annually or monthly.</li>
          <li>Applicable taxes and government fees are not included in listed pricing.</li>
          <li>Onboarding fee applies only to year one (1) of District and Organization subscription plans and is required.</li>
          <li>Renewal terms and final scope are confirmed in the signed agreement.</li>
          <li>Overdue invoices may result in reminder notices, service suspension, or collection efforts where permitted by law.</li>
          <li>
            Full subscription policies:
            <a href="https://www.itemtraxx.com/legal" target="_blank" rel="noreferrer">
              itemtraxx.com/legal
            </a>
          </li>
        </ul>
      </section>

      <PublicFooter />
    </div>
  </div>
</template>

<script setup lang="ts">
import { RouterLink } from "vue-router";
import PublicFooter from "../components/PublicFooter.vue";
</script>

<style scoped>
.pricing-shell {
  min-height: 100vh;
  position: relative;
  margin-top: -2.5rem;
  margin-bottom: -3rem;
  margin-left: -2rem;
  margin-right: -2rem;
  padding: calc(2rem + env(safe-area-inset-top, 0px)) 0 3.2rem;
  background: var(--page-bg);
  color: var(--text);
  overflow-x: hidden;
}

.pricing-page {
  max-width: 1240px;
  width: min(92%, 1240px);
  margin: 0 auto;
  box-sizing: border-box;
  position: relative;
  z-index: 2;
}

.grid-noise,
.pricing-orb {
  display: none;
}

.pricing-top-nav {
  margin-bottom: 1rem;
}

.pricing-back-link {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 2.4rem;
  height: 2.4rem;
  border-radius: 999px;
  border: 1px solid var(--border);
  background: var(--surface);
  color: var(--text);
  text-decoration: none;
  transition: transform 0.16s ease, border-color 0.16s ease, background 0.16s ease;
}

.pricing-back-link:hover {
  text-decoration: none;
  transform: translateY(-1px);
  border-color: var(--text);
  background: var(--surface-2);
}

.pricing-back-link svg {
  width: 1.2rem;
  height: 1.2rem;
  fill: none;
  stroke: currentColor;
  stroke-width: 2.2;
  stroke-linecap: round;
  stroke-linejoin: round;
}

.pricing-breadcrumb {
  color: var(--muted);
  font-size: 0.95rem;
}

.pricing-hero {
  border: 1px solid var(--border);
  background: var(--surface);
  border-radius: 28px;
  padding: 2.6rem;
}

.pricing-eyebrow {
  margin: 0 0 0.9rem;
  font-size: 0.78rem;
  font-weight: 700;
  letter-spacing: 0.16em;
  text-transform: uppercase;
  color: var(--muted);
}

.pricing-hero h1 {
  margin: 0;
  font-size: clamp(1.4rem, 3vw, 2.4rem);
  line-height: 0.98;
  letter-spacing: -0.06em;
}

.pricing-lead {
  margin: 1.25rem 0 0;
  max-width: 42rem;
  font-size: 1.1rem;
  line-height: 1.75;
  color: var(--muted);
}

.pricing-actions {
  margin-top: 1.6rem;
  display: flex;
  gap: 0.9rem;
  flex-wrap: wrap;
}

.pricing-contact-button {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  min-height: 2.4rem;
  border-radius: 999px;
  border: 1px solid var(--text);
  background: var(--text);
  color: var(--page-bg);
  font-weight: 700;
  text-decoration: none;
  padding: 0.45rem 0.95rem;
  transition: transform 0.16s ease, background 0.16s ease, border-color 0.16s ease, box-shadow 0.16s ease;
}

.pricing-contact-button:hover {
  text-decoration: none;
  transform: translateY(-1px);
  
}

.pricing-secondary-button {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  min-height: 2.4rem;
  border-radius: 999px;
  border: 1px solid var(--border);
  background: var(--surface);
  color: var(--text);
  font-weight: 700;
  text-decoration: none;
  padding: 0.45rem 0.95rem;
  transition: transform 0.16s ease, background 0.16s ease, border-color 0.16s ease, box-shadow 0.16s ease;
}

.pricing-secondary-button:hover {
  text-decoration: none;
  transform: translateY(-1px);
  border-color: var(--text);
  background: var(--surface-2);
}

.pricing-section {
  margin-top: 1.75rem;
}

.pricing-section-header {
  max-width: 52rem;
  margin-bottom: 1rem;
}

.pricing-section-eyebrow {
  margin: 0 0 0.45rem;
  font-size: 0.76rem;
  font-weight: 700;
  letter-spacing: 0.16em;
  text-transform: uppercase;
  color: var(--muted);
}

.pricing-section-header h2 {
  margin: 0;
  font-size: clamp(1.8rem, 2.8vw, 2.4rem);
  line-height: 1.05;
  letter-spacing: -0.04em;
  color: var(--text);
}

.pricing-section-header p {
  margin: 0.8rem 0 0;
  line-height: 1.7;
  color: var(--muted);
}

.plan-grid {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 1.2rem;
  margin-top: 1.6rem;
}

.plan-card {
  display: flex;
  flex-direction: column;
  border-radius: 22px;
  padding: 1.6rem;
  border: 1px solid var(--border);
  background: var(--surface);
}

.plan-card h2 {
  margin: 0;
  font-size: 1.2rem;
  color: var(--text);
}

.plan-card h3 {
  margin: 0;
  font-size: 1.2rem;
  color: var(--text);
}

.plan-meta {
  margin: 0.4rem 0 0;
  font-size: 0.82rem;
  font-weight: 700;
  letter-spacing: 0.12em;
  text-transform: uppercase;
  color: var(--muted);
}

.price {
  margin: 0.65rem 0 0.4rem;
  font-size: 1.7rem;
  font-weight: 700;
  color: var(--text);
}

.price span {
  margin-left: 0.25rem;
  font-size: 0.92rem;
  font-weight: 500;
  color: var(--muted);
}

.starting {
  margin: 0 0 0.7rem;
  font-size: 0.9rem;
  color: var(--muted);
}

.price-note {
  margin: 0 0 0.8rem;
  font-size: 0.84rem;
  color: var(--muted);
}

.plan-card ul {
  margin: 0;
  padding-left: 1.1rem;
  display: grid;
  gap: 0.45rem;
  color: var(--muted);
}

.onboarding {
  margin: 0.9rem 0 0;
  padding-top: 0.8rem;
  border-top: 1px solid rgba(74, 92, 116, 0.24);
  font-weight: 600;
  font-size: 0.92rem;
  color: var(--text);
}

.enterprise-note {
  margin: 0.65rem 0 0;
  font-size: 0.88rem;
  color: var(--muted);
}

.enterprise-note a {
  color: var(--text);
  font-weight: 700;
  text-decoration: underline;
  text-underline-offset: 2px;
}

.enterprise-note a:hover {
  color: var(--text);
}

.plan-highlight {
  border-color: var(--text);
}

.billing-card {
  margin-top: 1.2rem;
  border-radius: 22px;
  padding: 1.6rem;
  border: 1px solid var(--border);
  background: var(--surface);
}

.pricing-section-divider {
  margin-top: 2rem;
  display: flex;
  justify-content: center;
}

.pricing-section-divider span {
  width: min(6767px, 32vw);
  height: 1px;
  border-radius: 999px;
  background: var(--border);
}

.billing-card h2 {
  margin-top: 0;
  color: var(--text);
}

.billing-card ul {
  margin: 0;
  padding-left: 1.1rem;
  display: grid;
  gap: 0.45rem;
  color: var(--muted);
}

.onboarding-includes-list {
  gap: 0.8rem;
}

.enterprise-onboarding-row {
  margin-top: 0.2rem;
  padding-top: 0.8rem;
  border-top: 1px dashed rgba(74, 92, 116, 0.35);
}

.billing-card a {
  color: var(--text);
  font-weight: 700;
  text-decoration: underline;
  text-underline-offset: 2px;
}

.billing-card a:hover {
  color: var(--muted);
}

@media (max-width: 980px) {
  .pricing-shell {
    margin-top: -2.5rem;
    margin-bottom: -3rem;
    padding: calc(1.25rem + env(safe-area-inset-top, 0px)) 0 2.6rem;
  }

  .pricing-page {
    width: min(100%, calc(100% - 1.5rem));
  }

  .plan-grid {
    grid-template-columns: 1fr;
  }
}

.plan-grid-two {
  grid-template-columns: repeat(2, minmax(0, 1fr));
}

@media (max-width: 980px) {
  .plan-grid-two {
    grid-template-columns: 1fr;
  }
}
</style>
