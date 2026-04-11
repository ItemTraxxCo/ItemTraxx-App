<template>
  <div class="legal-page">
    <main class="legal-shell">
      <div class="legal-container">
      <div class="page-nav-left legal-top-nav">
        <div class="legal-top-nav-left">
          <RouterLink class="legal-back-link" to="/" aria-label="Return to home" @click.prevent="$router.back()">
            <svg viewBox="0 0 24 24" aria-hidden="true">
              <path d="M15 5 8 12l7 7" />
            </svg>
          </RouterLink>
          <span class="legal-breadcrumb"></span>
        </div>
        <button
          type="button"
          class="legal-theme-toggle"
          :aria-label="themeMode === 'dark' ? 'Switch to light mode' : 'Switch to dark mode'"
          @click="toggleTheme"
        >
          <span class="legal-theme-toggle-label">{{ themeMode === "dark" ? "Dark" : "Light" }}</span>
          <span class="legal-theme-toggle-track" :data-theme="themeMode">
            <span class="legal-theme-toggle-thumb"></span>
          </span>
        </button>
      </div>

      <header class="legal-header">
        <h1>ItemTraxx Subscription Agreement and Policies</h1>
        <p>
          Effective date: March 21, 2026. This document combines the ItemTraxx legal terms,
          software license, privacy policy, and security guidelines into one official legal
          reference.
        </p>
        <p>
          This Agreement is entered into between ItemTraxx Co, a California company, and the organization, 
          district, team, or individual purchasing and using the service.
        </p>
        <p>
          Last updated: March 07, 2026. ItemTraxx may update this document from time to time. Continued use of 
          the service after updates means you accept the revised terms.
        </p>
      </header>

      <section>
        <h2>1. Agreement and Scope</h2>
        <p>
          By accessing, using ItemTraxx, you agree to this legal agreement and policy document.
          If you do not agree, do not use the service. ItemTraxx is provided for inventory and
          asset tracking workflows used by schools, businesses, and authorized organizations.

          Payment of an invoice, execution of a quote, or continued use of the service constitutes acceptance of this Agreement.
        </p>
      </section>

      <section>
        <h2>2. Service Description</h2>
        <p>
          ItemTraxx provides tenant-based access to checkout/return workflows, administrative tools,
          audit logs, and related operational features. Access is permission-based and may be
          created, suspended, or removed by ItemTraxx Co or an authorized administrator at any time.
        </p>
      </section>

      <section>
        <h2>3. Account and Access Rules</h2>
        <ul>
          <li>Use ItemTraxx only for authorized, lawful business or school operations.</li>
          <li>Provide accurate information and keep credentials confidential.</li>
          <li>Do not attempt unauthorized access or service disruption.</li>
          <li>Do not use ItemTraxx for illegal, abusive, or fraudulent activity.</li>
          <li>ItemTraxx Co may suspend or terminate access for violations of this agreement or misuse.</li>
        </ul>
      </section>

      <section>
        <h2>4. License and Intellectual Property</h2>
        <p>
          ItemTraxx and all related source code, documentation, design, branding, and assets are
          proprietary to ItemTraxx Co. A California company. You receive a limited right to use the software for its
          intended purpose. You may not copy, modify, redistribute, reverse engineer, decompile,
          disassemble, sublicense, or commercially exploit the software without prior written
          approval from ItemTraxx Co.
        </p>
      </section>

      <section>
        <h2>5. Data Ownership and Processing</h2>
        <p>
          You retain ownership of data your organization, district, school, team, individual inputs into ItemTraxx. You grant ItemTraxx
          Co permission to host, process, and secure that data as required to operate the service.
          We do not sell or rent personal information.
        </p>
        <p>
          ItemTraxx Co does not use customer data for advertising, profiling, or resale purposes.
        </p>
      </section>

      <section>
        <h2>6. Privacy Policy</h2>
        <p>ItemTraxx may process the following categories of information:</p>
        <ul>
          <li>Account information (organization, school, district, team, role, authentication-related data)</li>
          <li>Usage data and audit activity data</li>
          <li>Device, browser, technical information, and approximate IP-based location used for session security</li>
          <li>Inventory and transaction records</li>
        </ul>
        <p>Your data is used to provide and improve the service, secure accounts, and show approximate session location in account security views.</p>
        <p>
          Data is retained only as necessary for service operations, contractual requirements, and
          legal compliance. Certain backup and audit records may persist for limited operational
          windows.
        </p>
      </section>

      <section>
        <h2>7. Security Guidelines and Reporting</h2>
        <p>
          ItemTraxx uses layered security controls, including access control, audit logging,
          security headers, and protected authentication flows.
        </p>
        <p>
          If you discover a potential vulnerability, report it responsibly to
          <a href="mailto:support@itemtraxx.com">support@itemtraxx.com</a> with reproduction steps and attachments (if available).
          If you discover a potential vulnerability, you must never publicly disclose it without prior written coordination and written consent with ItemTraxx Co.
        </p>
        <p>
          Target response windows:
        </p>
        <ul>
          <li>Initial acknowledgment: within 72 hours</li>
          <li>Severity triage target: within 5 business days</li>
          <li>Critical remediation: expedited as soon as practical</li>
        </ul>
      </section>

      <section>
        <h2>8. Availability, Warranty, and Liability</h2>
        <p>
          ItemTraxx is provided on an "as is" and "as available" basis. ItemTraxx Co does not
          guarantee uninterrupted, error-free, or always-available service, and does not guarantee
          100% uptime. Service availability may be affected by maintenance, updates, or unforeseen issues.
        </p>
        <p>
          To the fullest extent permitted by law, ItemTraxx Co disclaims warranties and is not
          liable for indirect, incidental, special, or consequential damages resulting from use or
          inability to use the service.
        </p>
        <p>
          The total liability of ItemTraxx Co arising out of or related to this Agreement shall not exceed 
          the total fees paid by the customer to ItemTraxx Co during the twelve (12) months preceding the 
          event giving rise to the claim.
        </p>
      </section>

      <section>
        <h2>9. Billing and Subscription Terms</h2>
        <ul>
          <li>
            <strong>Billing:</strong> Fees are billed according to the applicable quote, order
            form, or subscription plan accepted by the customer.
          </li>
          <li>
            <strong>Subscription terms:</strong> Access is provided for the term selected at
            purchase and remains subject to this legal agreement and service policies.
          </li>
          <li>
            <strong>Non refundability:</strong> Unless required by law or explicitly agreed in
            writing, all payments are non-refundable.
          </li>
          <li>
            <strong>Renewal:</strong> Subscriptions renew according to the accepted commercial
            terms unless canceled before the renewal date under the applicable cancellation window.
          </li>
          <li>
            <strong>Renewal cycle and payment terms:</strong> Plans renew annually for School District and Organization plans. 
            Individual plans are billed annually or monthly based on the plan selected by the customer at time of purchase. Unless
            otherwise agreed in writing, invoice payment terms are Net 15.
          </li>
          <li>
            <strong>Late payment:</strong> ItemTraxx Co may suspend or restrict service access for
            overdue balances and may apply lawful late fees or collection costs where permitted. 
            Account suspension/disabling for non payment does not relieve the customer of payment obligations.
          </li>
          <li>
            <strong>Overdue balances:</strong> Invoices are due according to the payment terms
            stated on the invoice. If payment is not received within the stated payment period, the
            account may be considered overdue. ItemTraxx Co may send reminder notices and may
            suspend or restrict service access for accounts with overdue balances until payment is
            received.
          </li>
          <li>
            <strong>Collections:</strong> If an account remains unpaid for an extended period,
            ItemTraxx Co may pursue lawful collection of outstanding balances, including applicable
            collection costs where permitted by law.
          </li>
          <li>
            <strong>Cancellation:</strong> Customers may cancel their subscription by providing
            written notice at least fifteen (15) days before the renewal date. Cancellation will take effect at the end of the
            current subscription term billing cycle. Access to the service will continue until the end of the paid
            subscription period billing cycle, after which access may be suspended or terminated. After the final
            billing cycle ends, customer data is archived for one (1) year, then permanently deleted
            from ItemTraxx systems. Cancellation requests must be submitted via contact support or
            email to
            <a href="mailto:support@itemtraxx.com">support@itemtraxx.com</a>.
          </li>
          <li>
            <strong>No partial refunds:</strong> Because subscriptions provide access for a fixed
            term, cancellations do not result in partial refunds for unused time unless required by
            law or agreed in writing from ItemTraxx Co.
          </li>
          <li>
            <strong>Between-plan movement protocol:</strong> Plan upgrades are allowed at any time
            and billing is prorated for the remainder of the current billing cycle. Plan
            downgrades are also allowed at any time and restrictions of the new plan apply at the start 
            of the next billing cycle; credit is issued for the unused portion of the current billing 
            cycle, and downgraded plan limits and restrictions take effect at the start of the next billing cycle.
          </li>
        </ul>
      </section>

      <section>
        <h2>10. Restrictions, Enforcement, and Termination</h2>
        <p>
          Violations of this policy may result in account restriction, account suspension, or
          account termination of service access. Upon termination, all license rights end immediately. 
          Customers may terminate the subscription at the end of the applicable subscription 
          term in accordance with the agreed cancellation window. Upon termination, customer data
          will be archived for one (1) year after which it will be permanently deleted in accordance 
          with ItemTraxx Co data retention practices.
        </p>
      </section>

      <section>
        <h2>11. Indemnification</h2>
        <p>
          The customer agrees to indemnify and hold harmless ItemTraxx Co from claims arising from
          the customer's misuse of the service or violation of this Agreement.
        </p>
      </section>

      <section>
        <h2>12. Force Majeure</h2>
        <p>
          ItemTraxx Co is not liable for failure or delay in performance due to causes beyond its
          reasonable control, including but not limited to natural disasters, internet outages,
          governmental actions, labor disputes, or service provider failures.
        </p>
      </section>

      <section>
        <h2>13. Governing Law</h2>
        <p>
          This Agreement is governed by the laws of the State of California, without regard to conflict of law principles,
          without limiting any mandatory legal rights where prohibited by law.
        </p>
      </section>

      <section>
        <h2>14. Changes to This Document</h2>
        <p>
          ItemTraxx Co may revise this legal document from time to time. Continued use of the
          service after updates to this document means you accept the revised terms, except for material changes described below.
        </p>
        <p>
          For material changes that affect pricing, renewal terms, or core subscription rights,
          ItemTraxx Co will provide at least fourteen (14) days notice before such changes take
          effect for the next renewal term.
        </p>
      </section>

      <section>
        <h2>15. Contact</h2>
        <p>
          For legal, privacy, and security inquiries, please
          <a href="https://www.itemtraxx.com/contact-support" target="_blank" rel="noreferrer noopener">contact support here</a>
        </p>
      </section>
      </div>
    </main>

    <div class="legal-footer-wrap">
      <PublicFooter />
    </div>
  </div>
</template>

<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref } from "vue";
import { RouterLink } from "vue-router";
import PublicFooter from "../components/PublicFooter.vue";

const themeMode = ref<"light" | "dark">("light");
let themeObserver: MutationObserver | null = null;

const syncThemeMode = () => {
  themeMode.value = document.documentElement.getAttribute("data-theme") === "dark" ? "dark" : "light";
};

const toggleTheme = () => {
  const next = themeMode.value === "dark" ? "light" : "dark";
  document.documentElement.setAttribute("data-theme", next);
  localStorage.setItem("itemtraxx-theme", next);
  themeMode.value = next;
};

onMounted(() => {
  syncThemeMode();
  themeObserver = new MutationObserver(syncThemeMode);
  themeObserver.observe(document.documentElement, {
    attributes: true,
    attributeFilter: ["data-theme"],
  });
});

onBeforeUnmount(() => {
  themeObserver?.disconnect();
});
</script>

<style scoped>
.legal-page {
  min-height: 100vh;
  padding: 2rem 1rem 3rem;
}

.legal-footer-wrap {
  width: min(1280px, 92%);
  margin-left: auto;
  margin-right: auto;
  position: relative;
  z-index: 2;
  margin-top: 2.25rem;
  padding-top: 0.85rem;
  border-top: 3px solid color-mix(in srgb, var(--border) 72%, transparent);
}

.legal-container {
  background: transparent;
  border: none;
  border-radius: 0;
  padding: 1.5rem;
  box-shadow: none;
}

.legal-top-nav {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 1rem;
}

.legal-top-nav-left {
  display: flex;
  align-items: center;
}

.legal-back-link {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 2.5rem;
  height: 2.5rem;
  border-radius: 999px;
  border: 1px solid color-mix(in srgb, var(--accent) 22%, var(--border));
  background: color-mix(in srgb, var(--card) 78%, var(--surface) 22%);
  color: var(--text);
  transition:
    transform 160ms ease,
    border-color 160ms ease,
    box-shadow 180ms ease,
    background-color 180ms ease;
}

.legal-back-link svg {
  width: 1.1rem;
  height: 1.1rem;
  fill: none;
  stroke: currentColor;
  stroke-width: 1.9;
  stroke-linecap: round;
  stroke-linejoin: round;
}

.legal-back-link:hover,
.legal-back-link:focus-visible {
  transform: translateY(-1px);
  border-color: color-mix(in srgb, var(--accent) 60%, transparent);
  background: color-mix(in srgb, var(--accent) 16%, var(--card) 84%);
  box-shadow: 0 10px 28px color-mix(in srgb, var(--accent) 18%, transparent);
}

.legal-theme-toggle {
  display: inline-flex;
  align-items: center;
  gap: 0.7rem;
  padding: 0.38rem 0.45rem 0.38rem 0.8rem;
  border-radius: 999px;
  border: 1px solid color-mix(in srgb, var(--accent) 18%, var(--border));
  background: color-mix(in srgb, var(--card) 84%, var(--surface) 16%);
  color: var(--text);
  font: inherit;
  cursor: pointer;
  transition:
    transform 160ms ease,
    border-color 160ms ease,
    box-shadow 180ms ease,
    background-color 180ms ease;
}

.legal-theme-toggle:hover,
.legal-theme-toggle:focus-visible {
  transform: translateY(-1px);
  border-color: color-mix(in srgb, var(--accent) 45%, transparent);
  box-shadow: 0 10px 28px color-mix(in srgb, var(--accent) 16%, transparent);
}

.legal-theme-toggle-label {
  font-size: 0.86rem;
  font-weight: 600;
}

.legal-theme-toggle-track {
  display: inline-flex;
  align-items: center;
  width: 2.5rem;
  height: 1.45rem;
  padding: 0.14rem;
  border-radius: 999px;
  background: color-mix(in srgb, var(--muted) 42%, transparent);
  transition: background-color 160ms ease;
}

.legal-theme-toggle-track[data-theme="dark"] {
  background: color-mix(in srgb, var(--accent) 54%, transparent);
}

.legal-theme-toggle-thumb {
  width: 1.05rem;
  height: 1.05rem;
  border-radius: 999px;
  background: #fff;
  box-shadow: 0 4px 10px rgba(4, 10, 22, 0.18);
  transform: translateX(0);
  transition: transform 160ms ease;
}

.legal-theme-toggle-track[data-theme="dark"] .legal-theme-toggle-thumb {
  transform: translateX(1.03rem);
}

.legal-header h1 {
  margin: 0;
  font-size: clamp(1.7rem, 3.6vw, 2.4rem);
}

.legal-header p {
  margin: 0.75rem 0 0;
  color: var(--muted);
  line-height: 1.6;
}

section {
  margin-top: 1.35rem;
}

h2 {
  margin: 0;
  font-size: 1.08rem;
}

p,
li {
  color: var(--text);
  font-size: 0.8rem;
  line-height: 1.65;
}

ul {
  margin: 0.6rem 0 0;
  padding-left: 1.25rem;
}

a {
  color: var(--accent);
}

@media (max-width: 640px) {
  .legal-top-nav {
    gap: 0.75rem;
    align-items: flex-start;
  }

  .legal-theme-toggle {
    padding-left: 0.65rem;
  }

  .legal-theme-toggle-label {
    font-size: 0.8rem;
  }
}
</style>
