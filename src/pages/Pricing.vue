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
          Clear plan options for organizations, teams, and individual plans. Contact sales 
          for pricing related to schools or districts, multi-organization structure, or any questions about which plan is right for you.
        </p>
        <div class="pricing-actions">
          <RouterLink class="pricing-contact-button" to="/contact-sales">
            Contact Sales
          </RouterLink>
        </div>
      </section>

      <section class="pricing-section">
        <div class="pricing-section-header">
          <p class="pricing-section-eyebrow">Workspaces</p>
          <h2>Workspace Pricing</h2>
          <p>
            Multi-account structure with cross-tenant shared inventory and borrower management, with onboarding billed separately in year one (1) only. 
            This allows you to manage multiple tenant accounts (checkout and return portals) with shared inventory and borrower management efficiently.
          </p>
        </div>

        <section class="plan-grid" aria-label="Workspace pricing plans">
          <article class="plan-card">
            <h3>Workspace Core Plan</h3>
            <p class="plan-meta">Up to 5 tenant accounts</p>
            <p class="price">$4,499<span>/year</span></p>
            <p class="price-note">Listed price excludes the 1st year onboarding fee.</p>
            <ul>
              <li>Up to 5 tenant accounts within the workspace</li>
              <li>Unlimited checkout and return transactions</li>
              <li>Item tracking and status visibility</li>
              <li>Checkout and return system</li>
              <li>Standard support (72-hour response time)</li>
            </ul>
            <p class="onboarding">+1st Year Onboarding Fee: $1,850</p>
            <span class="discount-note">Discounts may be available for multi-year contracts.</span>
          </article>

          <article class="plan-card plan-highlight">
            <h3>Workspace Growth Plan</h3>
            <p class="plan-meta">5-10 tenant accounts</p>
            <p class="price">$9,000<span>/year</span></p>
            <p class="price-note">Listed price excludes the 1st year onboarding fee.</p>
            <ul>
              <li>Up to 10 tenant accounts within the workspace</li>
              <li>Unlimited checkout and return transactions</li>
              <li>Item tracking and status visibility</li>
              <li>Checkout and return system</li>
              <li>Standard support (72-hour response time)</li>
            </ul>
            <p class="onboarding">+1st Year Onboarding Fee: $3,850</p>
            <span class="discount-note">Discounts may be available for multi-year contracts.</span>
          </article>

          <article class="plan-card">
            <h3>Workspace Enterprise Plan</h3>
            <p class="plan-meta">10+ tenant accounts</p>
            <RouterLink class="price price-link" to="/contact-sales">Contact for pricing</RouterLink>
            <p class="starting">Starts at $9,500/year.</p>
            <p class="price-note">Listed price excludes the 1st year onboarding fee.</p>
            <ul>
              <li>Customized solution for requiring 10+ tenant accounts within the workspace</li>
              <li>Unlimited checkout and return transactions</li>
              <li>Item tracking and status visibility</li>
              <li>Checkout and return system</li>
              <li>Priority support (24-hour response time)</li>
            </ul>
            <p class="onboarding">
              +1st Year Onboarding Fee: Contact for pricing
            </p>
            <p class="enterprise-note">
              Listed price excludes the 1st year onboarding fee.
              Listed price may differ from the quoted price upon contact.
              Discounts may be available for multi-year contracts.
            </p>
          </article>
        </section>
      </section>

      <section class="pricing-section">
        <div class="dual-plan-grid">
          <div class="dual-plan-column">
            <div class="pricing-section-header">
              <p class="pricing-section-eyebrow">Edu</p>
              <h2>ItemTraxx for Schools</h2>
              <p>
                ItemTraxx for use in schools, districts, and educational institutions.
              </p>
              <p>
                Onboarding is billed separately in year one (1) only.
              </p>
            </div>
            <section class="plan-grid" aria-label="Education pricing plans">
              <article class="plan-card plan-card-full">
                <h3>Education Plan</h3>
                <p class="plan-meta">For educational institutions</p>
                <RouterLink class="price price-link" to="/contact-sales">Contact for pricing</RouterLink>
                <p class="starting">Starts at $5,499/year</p>
                <ul>
                  <li>Customized solutions for educational institutions</li>
                  <li>Unlimited checkout and return transactions</li>
                  <li>Item tracking and status visibility</li>
                  <li>Checkout and return system</li>
                  <li>Priority support (24-hour response time)</li>
                </ul>
                <p class="onboarding">
                  +1st Year Onboarding Fee: Contact for pricing
                </p>
                <p class="enterprise-note">
                  Listed price excludes the 1st year onboarding fee.
                  Listed price may differ from the quoted price upon contact.
                  Discounts may be available for multi-year contracts.
                </p>
              </article>
            </section>
          </div>

          <div class="dual-plan-column">
            <div class="pricing-section-header">
              <p class="pricing-section-eyebrow">Custom</p>
              <h2>Custom Plans</h2>
              <p>
                We offer custom plans tailored to your requirements.
              </p>
              <p>
                Onboarding is billed separately in year one (1) only.
              </p>
            </div>
            <section class="plan-grid" aria-label="Custom pricing plans">
              <article class="plan-card plan-card-full">
                <h3>Custom ItemTraxx Plan</h3>
                <p class="plan-meta">Tailored to your requirements</p>
                <RouterLink class="price price-link" to="/contact-sales">Contact for pricing</RouterLink>
                <ul>
                  <li>Customized solutions for your specific requirements</li>
                  <li>Unlimited checkout and return transactions</li>
                  <li>Item tracking and status visibility</li>
                  <li>Checkout and return system</li>
                  <li>Priority support (24-hour response time)</li>
                </ul>
                <p class="onboarding">
                  +1st Year Onboarding Fee: Contact for pricing
                </p>
                <p class="enterprise-note">
                  Discounts may be available for multi-year contracts.
                </p>
              </article>
            </section>
          </div>
        </div>
      </section>

      <section class="pricing-section pricing-section-individual">
        <div class="pricing-section-header">
          <p class="pricing-section-eyebrow">Individual pricing</p>
          <h2>Individual Pricing</h2>
          <p>
            For individual users who need ItemTraxx without a workspace.
          </p>
        </div>

        <section class="plan-grid plan-grid-two" aria-label="Individual pricing plans">
          <article class="plan-card">
            <h3>Individual Yearly Plan</h3>
            <p class="plan-meta">Single-user plan</p>
            <p class="price">$70.00<span>/year</span></p>
            <ul>
              <li>Single-user access to the ItemTraxx app</li>
              <li>Simple personal inventory tracking workflow</li>
              <li>Invoice-based billing</li>
            </ul>
            <p class="onboarding">Onboarding not available.</p>
          </article>

          <article class="plan-card">
            <h3>Individual Monthly Plan</h3>
            <p class="plan-meta">Single-user plan</p>
            <p class="price">$7.00<span>/month</span></p>
            <ul>
              <li>Month-to-month version of the individual plan</li>
              <li>Single-user access to the ItemTraxx app</li>
              <li>Invoice-based billing</li>
            </ul>
            <p class="onboarding">Onboarding not available.</p>
          </article>
        </section>
      </section>

      <div class="pricing-section-divider" aria-hidden="true">
        <span></span>
      </div>

      <section class="billing-card">
        <h2>Pricing FAQ</h2>
        <ul>
          <li><strong>Are plans annual or monthly?</strong> Workspace and education plans are annual. Individual plans are available annually or monthly. Final billing terms are confirmed through the quote and invoice process.</li>
          <li><strong>When is onboarding charged?</strong> Onboarding is a one-time fee in year one (1) only and is required for all new customers on workspace, education, and custom plans. Individual plans do not offer onboarding.</li>
          <li><strong>Can we move between plans?</strong> Yes. Plan changes, effective dates, and any proration or credit are confirmed through the quote and invoice process. Contact support for details.</li>
          <li><strong>How do we request a formal quote?</strong> Use the Contact Sales button above and we will provide an official quote.</li>
          <li><strong>How are plans billed?</strong> Plans are billed annually or monthly, depending on the plan and contract agreement.</li>
          <li><strong>What happens if you dont pay an invoice?</strong> If an invoice is not paid by the due date, a late fee may be applied, 
            and the account may be subject to suspension or cancellation. These terms apply to all customers on workspace, education, custom, and individual plans. See legal terms for more information.</li>
        </ul>
      </section>

      <section class="billing-card">
        <h2>What Onboarding Includes</h2>
        <ul class="onboarding-includes-list">
          <li>
            <strong>Workspace Core and Growth Plans:</strong>
            The onboarding fee is a one-time charge during year one and includes hassle-free
            addition of items and borrowers (you provide inventory and existing records, and we
            complete setup for you), a custom onboarding call covering product
            features, account setup (logins), and live Q&A/help, plus a dedicated Slack support
            channel during the first three (3) months of use with a 24-hour response SLA for the first
            three (3) months of use, after that moves to 72-hour response SLA via slack or email.
          </li>
          <li class="enterprise-onboarding-row">
            <strong>Workspace Enterprise Plan:</strong>
            The onboarding fee is a one-time charge during year one and includes hassle-free
            addition of items and borrowers (you provide inventory and existing records, and we
            complete setup for you), a custom onboarding call covering product
            features, account setup (logins), and live Q&A/help, plus a dedicated Slack support
            channel with a 24-hour response SLA via slack or email active throughout the full subscription term.
          </li>
          <li class="enterprise-onboarding-row">
            <strong>Education Plans:</strong>
            The onboarding fee is a one-time charge during year one and includes hassle-free
            addition of items and members (you provide inventory and existing records, and we
            complete setup for you), a custom onboarding call covering product
            features, account setup (logins), and live Q&A/help, plus a dedicated Slack support
            channel during the first three (3) months of use with a 24-hour response SLA for the first
            three (3) months of use, after that moves to 72-hour response SLA via slack or email.
          </li>
          <li class="enterprise-onboarding-row">
            <strong>Custom Plans:</strong>
            The onboarding fee is a one-time charge during year one and includes hassle-free
            addition of items and borrowers (you provide inventory and existing records, and we
            complete setup for you), a custom onboarding call covering product
            features, account setup (logins), and live Q&A/help, plus a dedicated Slack support
            channel with a 24-hour response SLA via slack or email active throughout the full subscription term. 
            *This may differ from the final agreement.
          </li>
          <li class="enterprise-onboarding-row">
            <strong>Individual Plans:</strong>
            Onboarding is not available for Individual Yearly or Individual Monthly plans. Individual
            Yearly and Individual Monthly plans have regular access to our support team via email with a 
            72-hour response SLA.
          </li>
        </ul>
      </section>

      <section class="billing-card">
        <h2>Billing Terms</h2>
        <ul>
          <li>Billing periods are finalized in the signed agreement for each customer.</li>
          <li>Applicable taxes and government fees are not included in listed pricing.</li>
          <li>Onboarding fee applies only to year one (1) of workspace and education subscription plans and is required.</li>
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

.pricing-section {
  margin-top: 1.75rem;
}

.pricing-section-individual {
  margin-top: 2.5rem;
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

.pricing-section-header p + p {
  margin-top: 0.15rem;
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

.price-link {
  display: inline-block;
  text-decoration: none;
  text-underline-offset: 3px;
  cursor: pointer;
}

.price-link:hover,
.price-link:focus-visible {
  color: var(--accent, #4a6cf7);
  text-decoration: underline;
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

.discount-note {
  display: block;
  margin-top: 0.5rem;
  font-size: 0.8rem;
  color: var(--text-muted, #7a8699);
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

.plan-card-full {
  grid-column: 1 / -1;
}

.dual-plan-grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 1.2rem;
  align-items: stretch;
}

.dual-plan-column {
  display: flex;
  flex-direction: column;
}

.dual-plan-column .plan-grid {
  flex: 1;
  display: flex;
}

.dual-plan-column .plan-card {
  flex: 1;
}

@media (max-width: 980px) {
  .dual-plan-grid {
    grid-template-columns: 1fr;
  }
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
  width: min(67px, 32vw);
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
