<template>
  <div class="page contact-sales-page">
    <div class="page-nav-left">
      <RouterLink class="button-link" :to="returnPath">{{ returnLabel }}</RouterLink>
    </div>

    <h1>{{ pageTitle }}</h1>
    <p class="muted">{{ pageLead }}</p>

    <section class="card">
      <form class="form" @submit.prevent="handleSend">
        <label v-if="!isDemoIntent">
          Please Select Plan
          <select v-model="plan" required>
            <option value="district_core">ItemTraxx District Core Plan</option>
            <option value="district_growth">ItemTraxx District Growth Plan</option>
            <option value="district_enterprise">ItemTraxx District Enterprise Plan</option>
            <option value="organization_starter">ItemTraxx Organization Starter Plan</option>
            <option value="organization_scale">ItemTraxx Organization Scale Plan</option>
            <option value="organization_enterprise">ItemTraxx Organization Enterprise Plan</option>
            <option value="individual_yearly">ItemTraxx Individual Yearly Plan</option>
            <option value="individual_monthly">ItemTraxx Individual Monthly Plan</option>
            <option value="other">Other</option>
          </select>
        </label>

        <label v-if="requiresUnits">
          {{ unitsLabel }}
          <input v-model.number="schoolCount" type="number" min="1" step="1" :placeholder="unitsPlaceholder" />
        </label>

        <label>
          Name
          <input
            v-model.trim="fullName"
            type="text"
            required
            maxlength="120"
            placeholder="Your full name"
          />
        </label>

        <label>
          School, organization, district, or team (Leave blank if you are inquiring for the individual plans)
          <input
            v-model.trim="organization"
            type="text"
            :required="requiresOrganization"
            maxlength="160"
            :placeholder="organizationPlaceholder"
          />
        </label>

        <label>
          Reply email address
          <input
            v-model.trim="replyEmail"
            type="email"
            required
            placeholder="name@district.org"
          />
        </label>

        <label>
          Additional information
          <textarea
            v-model.trim="details"
            rows="6"
            maxlength="2500"
            placeholder="Tell us anything else you'd like us to know."
          ></textarea>
        </label>

        <label v-if="turnstileSiteKey">
          Security Check
          <div :ref="setTurnstileContainerRef"></div>
          <p class="muted">Complete security check to enable send.</p>
        </label>

        <input
          v-model="website"
          type="text"
          class="honeypot"
          autocomplete="off"
          tabindex="-1"
          aria-hidden="true"
        />

        <div class="form-actions">
          <button type="submit" class="button-primary" :disabled="isSending || !canSubmit">
            {{ isSending ? "Sending..." : submitLabel }}
          </button>
        </div>
        <p class="submit-legal-note">
          By sending, you agree to <RouterLink to="/legal">Legal</RouterLink>.
        </p>
      </form>
      <p v-if="error" class="error">{{ error }}</p>
    </section>
  </div>
</template>

<script setup lang="ts">
import { computed, ref } from "vue";
import { RouterLink, useRoute, useRouter } from "vue-router";
import { useTurnstile } from "../composables/useTurnstile";
import { submitContactSalesLead } from "../services/contactSalesService";
import { toUserFacingErrorMessage } from "../services/appErrors";
import { saveSubmissionConfirmation } from "../services/submissionConfirmation";

type PlanId =
  | "district_core"
  | "district_growth"
  | "district_enterprise"
  | "organization_starter"
  | "organization_scale"
  | "organization_enterprise"
  | "individual_yearly"
  | "individual_monthly"
  | "other";

const route = useRoute();
const router = useRouter();

const plan = ref<PlanId>("district_core");
const fullName = ref("");
const organization = ref("");
const schoolCount = ref<number | null>(null);
const replyEmail = ref("");
const details = ref("");
const website = ref("");
const isSending = ref(false);
const error = ref("");
const turnstileSiteKey = import.meta.env.VITE_TURNSTILE_SITE_KEY as string | undefined;
const {
  containerRef: turnstileContainerRef,
  token: turnstileToken,
  reset: resetTurnstile,
} = useTurnstile(turnstileSiteKey);

const isDemoIntent = computed(() => route.query.intent === "demo");

const pageTitle = computed(() => (isDemoIntent.value ? "Request a Demo" : "Contact Sales"));
const pageLead = computed(() =>
  isDemoIntent.value
    ? "Send your demo request and our team will respond from support@itemtraxx.com to schedule next steps."
    : "Send your request and our team will respond from support@itemtraxx.com."
);
const submitLabel = computed(() => (isDemoIntent.value ? "Request Demo" : "Send"));
const returnPath = computed(() => (isDemoIntent.value ? "/" : "/pricing"));
const returnLabel = computed(() => (isDemoIntent.value ? "Back" : "Back"));

const setTurnstileContainerRef = (
  el: Element | { $el?: Element } | null
) => {
  if (el instanceof HTMLElement) {
    turnstileContainerRef.value = el;
    return;
  }
  if (el && "$el" in el && el.$el instanceof HTMLElement) {
    turnstileContainerRef.value = el.$el;
    return;
  }
  turnstileContainerRef.value = null;
};

const canSubmit = computed(() => {
  if (!fullName.value || !replyEmail.value) return false;
  if (requiresOrganization.value && !organization.value) return false;
  if (requiresUnits.value && (!schoolCount.value || schoolCount.value < 1)) return false;
  if (turnstileSiteKey && !turnstileToken.value) return false;
  return true;
});

const effectivePlan = computed<PlanId>(() => (isDemoIntent.value ? "other" : plan.value));

const requiresOrganization = computed(
  () => !isDemoIntent.value && !["individual_yearly", "individual_monthly", "other"].includes(effectivePlan.value)
);

const requiresUnits = computed(
  () => effectivePlan.value === "district_enterprise" || effectivePlan.value === "organization_enterprise"
);

const unitsLabel = computed(() =>
  effectivePlan.value === "district_enterprise"
    ? "Number of schools (7 or above)"
    : "Number of locations or teams (7 or above)"
);

const unitsPlaceholder = computed(() =>
  effectivePlan.value === "district_enterprise" ? "Enter number of schools" : "Enter number of locations or teams"
);

const organizationPlaceholder = computed(() => {
  if (isDemoIntent.value) return "School, district, or organization (optional)";
  if (effectivePlan.value.startsWith("district_")) return "District name";
  if (effectivePlan.value.startsWith("organization_")) return "Organization or team name";
  if (effectivePlan.value.startsWith("individual_")) return "Optional";
  return "School, district, organization, or leave blank";
});

const handleSend = () => {
  void send();
};

const send = async () => {
  if (isSending.value) return;
  error.value = "";
  if (!canSubmit.value || (turnstileSiteKey && !turnstileToken.value)) {
    error.value = "Complete required fields and security check.";
    return;
  }
  isSending.value = true;
  try {
    const response = await submitContactSalesLead({
      plan: effectivePlan.value,
      schools_count: requiresUnits.value ? schoolCount.value : null,
      name: fullName.value,
      organization: organization.value,
      reply_email: replyEmail.value,
      details: details.value,
      turnstile_token: turnstileToken.value ?? "",
      website: website.value,
      intent: isDemoIntent.value ? "demo" : "sales",
    });

    saveSubmissionConfirmation({
      kind: isDemoIntent.value ? "Demo request" : "Sales request",
      title: isDemoIntent.value ? "Demo request sent." : "Sales request sent.",
      lead: isDemoIntent.value
        ? "Your demo request was submitted. We will follow up from support@itemtraxx.com to schedule next steps."
        : "Your sales request was submitted. We will follow up from support@itemtraxx.com with next steps.",
      submittedAt: new Date().toISOString(),
      referenceId: response?.lead_id ?? null,
      fields: [
        { label: "Reply email", value: replyEmail.value },
        { label: "Name", value: fullName.value },
        ...(organization.value ? [{ label: "Organization", value: organization.value }] : []),
        { label: "Plan", value: isDemoIntent.value ? "Demo request" : effectivePlan.value.replaceAll("_", " ") },
      ],
    });

    await router.push({ name: "public-submit-confirmation" });
  } catch (err) {
    error.value = toUserFacingErrorMessage(err, "Unable to send request.");
  } finally {
    isSending.value = false;
    if (turnstileSiteKey) {
      try {
        resetTurnstile();
      } catch {
        // no-op
      }
    }
  }
};
</script>

<style scoped>
.contact-sales-page {
  max-width: 860px;
  padding-top: calc(2rem + env(safe-area-inset-top, 0px));
}

@media (max-width: 720px) {
  .contact-sales-page {
    padding-top: calc(1.25rem + env(safe-area-inset-top, 0px));
  }
}

.honeypot {
  position: absolute;
  left: -9999px;
  top: auto;
  width: 1px;
  height: 1px;
  overflow: hidden;
}

.submit-legal-note {
  margin: 0.4rem 0 0;
  color: inherit;
  opacity: 0.72;
  font-size: 0.92rem;
}
</style>
