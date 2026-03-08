<template>
  <div class="pricing-shell">
    <div class="pricing-orb orb-one" aria-hidden="true"></div>
    <div class="pricing-orb orb-two" aria-hidden="true"></div>
    <div class="grid-noise" aria-hidden="true"></div>

    <div class="pricing-page">
      <div class="page-nav-left pricing-top-nav">
        <RouterLink class="pricing-back-link" to="/" aria-label="Return to home">
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
          <p class="pricing-section-eyebrow">District category</p>
          <h2>District Pricing</h2>
          <p>
            Annual subscription pricing is based on the
            number of schools in the district, with onboarding billed separately in year one (1) only.
          </p>
        </div>

        <section class="plan-grid" aria-label="District pricing plans">
          <article class="plan-card">
            <h3>ItemTraxx Core Plan</h3>
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
            <h3>ItemTraxx Growth Plan</h3>
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
            <h3>ItemTraxx Enterprise Plan</h3>
            <p class="plan-meta">7+ schools in district</p>
            <p class="price">Contact for pricing</p>
            <p class="starting">Formula = $4,500 + (# of schools − 7) × $900 / year</p>
            <ul>
              <li>Base coverage for the first 7 schools within the district</li>
              <li>Unlimited staff accounts</li>
              <li>Item tracking and status visibility</li>
              <li>Checkout and return system</li>
              <li>Priority support (24-hour response time)</li>
            </ul>
            <p class="onboarding">
              +1st Year Onboarding Fee: Contact for pricing ( Starts at $1,500.00)
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
            For non-school district teams, pricing is based on the number of locations or operating units.
            Onboarding is billed seperatly in year one (1) only.
          </p>
        </div>

        <section class="plan-grid" aria-label="Organization pricing plans">
          <article class="plan-card">
            <h3>Starter</h3>
            <p class="plan-meta">1-3 locations or teams</p>
            <p class="price">$1,250.00<span>/year</span></p>
            <ul>
              <li>Designed for smaller organizations and single-site operations</li>
              <li>Checkout and return workflows for shared inventory</li>
              <li>Staff access and core reporting</li>
            </ul>
            <p class="onboarding">Onboarding Fee: $500.00 / year</p>
          </article>

          <article class="plan-card plan-highlight">
            <h3>Scale</h3>
            <p class="plan-meta">4-7 locations or teams</p>
            <p class="price">$3,500.00<span>/year</span></p>
            <ul>
              <li>Built for growing organizations with multiple operating units</li>
              <li>District-style control across locations and teams</li>
              <li>Expanded setup and support coverage</li>
            </ul>
            <p class="onboarding">Onboarding Fee: $1,000.00 / year</p>
          </article>

          <article class="plan-card">
            <h3>Enterprise</h3>
            <p class="plan-meta">7+ locations or teams</p>
            <p class="price">Contact for pricing</p>
            <p class="starting">Formula = $4,500 + (# of units − 7) × $900 / year</p>
            <ul>
              <li>For large multi-site organizations with custom rollout needs</li>
              <li>Priority operational support and enterprise coordination</li>
              <li>Units = max # of locations or teams</li>
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
            <h3>Individual Yearly</h3>
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
            <h3>Individual Monthly</h3>
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
          <li><strong>When is onboarding charged?</strong> Onboarding is a one-time fee in year one only.</li>
          <li><strong>Can we move between plans?</strong> Yes. Upgrades are prorated; downgrades apply next billing cycle.</li>
          <li><strong>How do we request a formal quote?</strong> Use the Contact Sales button above and we will provide an official quote.</li>
        </ul>
      </section>

      <section class="billing-card">
        <h2>What Onboarding Includes</h2>
        <ul class="onboarding-includes-list">
          <li>
            <strong>District Core and Growth Plans:</strong>
            The onboarding fee is a one-time charge during year one and includes hassle-free
            addition of items and students (you provide inventory and existing records, and we
            complete setup for you), a custom onboarding call covering product
            features, account setup (logins), and live Q&A/help, plus a dedicated Slack support
            channel during the first three (3) months of use with a 24-hour response SLA for the first
            three (3) months of use, after that moves to 72-hour response SLA.
          </li>
          <li class="enterprise-onboarding-row">
            <strong>District Enterprise Plan:</strong>
            The onboarding fee is a one-time charge during year one and includes hassle-free
            addition of items and students (you provide inventory and existing records, and we
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
  position: relative;
  margin-top: -2.5rem;
  margin-bottom: -3rem;
  margin-left: -2rem;
  margin-right: -2rem;
  padding: 2rem 0 3.2rem;
  background:
    radial-gradient(circle at top left, rgba(25, 194, 168, 0.14), transparent 22%),
    radial-gradient(circle at 82% 18%, rgba(25, 67, 155, 0.2), transparent 28%),
    linear-gradient(180deg, #10161f 0%, #090d14 100%);
  color: #ffffff;
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

.grid-noise {
  position: absolute;
  inset: 0;
  pointer-events: none;
  background-image:
    linear-gradient(rgba(255, 255, 255, 0.025) 1px, transparent 1px),
    linear-gradient(90deg, rgba(255, 255, 255, 0.025) 1px, transparent 1px);
  background-size: 36px 36px;
  mask-image: linear-gradient(180deg, rgba(0, 0, 0, 0.55), transparent 92%);
  opacity: 0.16;
}

.pricing-back-link {
  width: 2.4rem;
  height: 2.4rem;
  border-radius: 999px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  border: 1px solid rgba(77, 97, 122, 0.4);
  background: linear-gradient(180deg, rgba(31, 40, 54, 0.94) 0%, rgba(17, 23, 32, 0.98) 100%);
  color: #ffffff;
  text-decoration: none;
  transition: transform 0.16s ease, border-color 0.16s ease, background 0.16s ease;
}

.pricing-back-link:hover {
  text-decoration: none;
  transform: translateY(-1px);
  border-color: rgba(39, 196, 172, 0.58);
  background: linear-gradient(180deg, rgba(29, 66, 75, 0.98) 0%, rgba(16, 37, 48, 1) 100%);
  box-shadow: 0 16px 32px rgba(25, 194, 168, 0.14);
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
  filter: blur(44px);
  opacity: 0.36;
  pointer-events: none;
}

.orb-one {
  width: 320px;
  height: 320px;
  top: 60px;
  left: -100px;
  background: rgba(25, 194, 168, 0.26);
}

.orb-two {
  width: 340px;
  height: 340px;
  top: 360px;
  right: -70px;
  background: rgba(25, 67, 155, 0.26);
}

.pricing-top-nav {
  margin-bottom: 1rem;
}

.pricing-breadcrumb {
  color: rgba(225, 232, 240, 0.72);
  font-size: 0.95rem;
}

.pricing-hero {
  border: 1px solid rgba(74, 92, 116, 0.34);
  background: linear-gradient(180deg, rgba(20, 27, 37, 0.94) 0%, rgba(12, 17, 24, 0.98) 100%);
  box-shadow: 0 18px 44px rgba(0, 0, 0, 0.22);
  border-radius: 28px;
  padding: 2.6rem;
}

.pricing-eyebrow {
  margin: 0 0 0.9rem;
  font-size: 0.78rem;
  font-weight: 700;
  letter-spacing: 0.16em;
  text-transform: uppercase;
  color: rgba(214, 237, 233, 0.72);
}

.pricing-hero h1 {
  margin: 0;
  font-size: clamp(2.7rem, 5vw, 5rem);
  line-height: 0.98;
  letter-spacing: -0.06em;
}

.pricing-lead {
  margin: 1.25rem 0 0;
  max-width: 42rem;
  font-size: 1.1rem;
  line-height: 1.75;
  color: rgba(222, 229, 238, 0.76);
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
  border-radius: 10px;
  border: 1px solid transparent;
  background-image: linear-gradient(90deg, #19c2a8 0%, #19439b 100%);
  background-repeat: no-repeat;
  background-size: 100% 100%;
  background-origin: border-box;
  color: #f7fbff;
  font-weight: 700;
  text-decoration: none;
  padding: 0.45rem 0.95rem;
  transition: transform 0.16s ease, background 0.16s ease, border-color 0.16s ease, box-shadow 0.16s ease;
}

.pricing-contact-button:hover {
  text-decoration: none;
  transform: translateY(-1px);
  background-image: linear-gradient(90deg, #22ccb1 0%, #2357bf 100%);
  box-shadow: 0 16px 32px rgba(25, 67, 155, 0.18);
}

.pricing-secondary-button {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  min-height: 2.4rem;
  border-radius: 10px;
  border: 1px solid rgba(77, 97, 122, 0.4);
  background: linear-gradient(180deg, rgba(31, 40, 54, 0.94) 0%, rgba(17, 23, 32, 0.98) 100%);
  color: #f5f7fb;
  box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.04);
  font-weight: 700;
  text-decoration: none;
  padding: 0.45rem 0.95rem;
  transition: transform 0.16s ease, background 0.16s ease, border-color 0.16s ease, box-shadow 0.16s ease;
}

.pricing-secondary-button:hover {
  text-decoration: none;
  transform: translateY(-1px);
  border-color: rgba(39, 196, 172, 0.58);
  background: linear-gradient(180deg, rgba(29, 66, 75, 0.98) 0%, rgba(16, 37, 48, 1) 100%);
  box-shadow:
    inset 0 1px 0 rgba(115, 255, 233, 0.08),
    0 16px 32px rgba(25, 194, 168, 0.14);
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
  color: rgba(214, 237, 233, 0.68);
}

.pricing-section-header h2 {
  margin: 0;
  font-size: clamp(1.8rem, 2.8vw, 2.4rem);
  line-height: 1.05;
  letter-spacing: -0.04em;
  color: #f7fbff;
}

.pricing-section-header p {
  margin: 0.8rem 0 0;
  line-height: 1.7;
  color: rgba(222, 229, 238, 0.74);
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
  border: 1px solid rgba(74, 92, 116, 0.34);
  background: linear-gradient(180deg, rgba(20, 27, 37, 0.94) 0%, rgba(12, 17, 24, 0.98) 100%);
  box-shadow: 0 18px 44px rgba(0, 0, 0, 0.22);
}

.plan-card h2 {
  margin: 0;
  font-size: 1.2rem;
  color: #f5f7fb;
}

.plan-card h3 {
  margin: 0;
  font-size: 1.2rem;
  color: #f5f7fb;
}

.plan-meta {
  margin: 0.4rem 0 0;
  font-size: 0.82rem;
  font-weight: 700;
  letter-spacing: 0.12em;
  text-transform: uppercase;
  color: rgba(137, 239, 225, 0.78);
}

.price {
  margin: 0.65rem 0 0.4rem;
  font-size: 1.7rem;
  font-weight: 700;
  color: #f5f7fb;
}

.price span {
  margin-left: 0.25rem;
  font-size: 0.92rem;
  font-weight: 500;
  color: rgba(222, 229, 238, 0.72);
}

.starting {
  margin: 0 0 0.7rem;
  font-size: 0.9rem;
  color: rgba(222, 229, 238, 0.78);
}

.price-note {
  margin: 0 0 0.8rem;
  font-size: 0.84rem;
  color: rgba(222, 229, 238, 0.68);
}

.plan-card ul {
  margin: 0;
  padding-left: 1.1rem;
  display: grid;
  gap: 0.45rem;
  color: rgba(222, 229, 238, 0.8);
}

.onboarding {
  margin: 0.9rem 0 0;
  padding-top: 0.8rem;
  border-top: 1px solid rgba(74, 92, 116, 0.24);
  font-weight: 600;
  font-size: 0.92rem;
  color: #f5f7fb;
}

.enterprise-note {
  margin: 0.65rem 0 0;
  font-size: 0.88rem;
  color: rgba(222, 229, 238, 0.78);
}

.enterprise-note a {
  color: #89efe1;
  font-weight: 700;
  text-decoration: underline;
  text-underline-offset: 2px;
}

.enterprise-note a:hover {
  color: #b9fff5;
}

.plan-highlight {
  border-color: rgba(25, 194, 168, 0.3);
  box-shadow:
    0 18px 44px rgba(0, 0, 0, 0.24),
    inset 0 0 0 1px rgba(25, 194, 168, 0.14);
}

.billing-card {
  margin-top: 1.2rem;
  border-radius: 22px;
  padding: 1.6rem;
  border: 1px solid rgba(74, 92, 116, 0.34);
  background: linear-gradient(180deg, rgba(20, 27, 37, 0.94) 0%, rgba(12, 17, 24, 0.98) 100%);
  box-shadow: 0 18px 44px rgba(0, 0, 0, 0.22);
}

.pricing-section-divider {
  margin-top: 2rem;
  display: flex;
  justify-content: center;
}

.pricing-section-divider span {
  width: min(220px, 32vw);
  height: 1px;
  border-radius: 999px;
  background: linear-gradient(
    90deg,
    rgba(25, 194, 168, 0) 0%,
    rgba(25, 194, 168, 0.55) 20%,
    rgba(68, 111, 207, 0.62) 50%,
    rgba(25, 194, 168, 0.55) 80%,
    rgba(25, 194, 168, 0) 100%
  );
  box-shadow: 0 0 28px rgba(25, 194, 168, 0.12);
}

.billing-card h2 {
  margin-top: 0;
  color: #f5f7fb;
}

.billing-card ul {
  margin: 0;
  padding-left: 1.1rem;
  display: grid;
  gap: 0.45rem;
  color: rgba(222, 229, 238, 0.8);
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
  color: #89efe1;
  font-weight: 700;
  text-decoration: underline;
  text-underline-offset: 2px;
}

.billing-card a:hover {
  color: #b9fff5;
}

@media (max-width: 980px) {
  .pricing-shell {
    margin-top: -2.5rem;
    margin-bottom: -3rem;
    padding: 1.6rem 0 2.6rem;
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
