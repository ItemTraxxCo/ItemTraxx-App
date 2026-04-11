<template>
  <div class="page contact-sales-page">
    <RouterLink class="brand-mark" to="/" aria-label="ItemTraxx home">
      <img v-if="brandLogoUrl" class="brand-mark-full" :src="brandLogoUrl" alt="ItemTraxx Co" />
    </RouterLink>

    <div class="page-nav-left pricing-top-nav">
      <RouterLink class="pricing-back-link" :to="returnPath" aria-label="Return to previous page" @click.prevent="$router.back()">
        <svg viewBox="0 0 24 24" aria-hidden="true">
          <path d="M15 5 8 12l7 7" />
        </svg>
      </RouterLink>
      <span class="pricing-breadcrumb"> </span>
    </div>

    <div class="page-intro">
      <h1>{{ pageTitle }}</h1>
      <p class="muted">{{ pageLead }}</p>
    </div>

    <section class="sales-section">
      <form class="form sales-form" @submit.prevent="handleSend">
        <label class="field field-name">
          Name
          <input
            v-model.trim="fullName"
            type="text"
            required
            maxlength="120"
            placeholder="Your full name"
          />
        </label>

        <label class="field field-reply-email">
          Reply email address
          <input
            v-model.trim="replyEmail"
            type="email"
            required
            placeholder="name@district.org"
          />
        </label>

        <label v-if="!isDemoIntent" class="field field-plan">
          <span class="field-label">Please Select Plan</span>
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

        <label class="field field-organization">
          School, district or organization name (leave blank for individual plans)
          <input
            v-model.trim="organization"
            type="text"
            :required="requiresOrganization"
            maxlength="160"
            :placeholder="organizationPlaceholder"
          />
        </label>

        <label v-if="requiresUnits" class="field field-full">
          {{ unitsLabel }}
          <input v-model.number="schoolCount" type="number" min="1" step="1" :placeholder="unitsPlaceholder" />
        </label>

        <label class="field field-full">
          Additional information
          <textarea
            v-model.trim="details"
            rows="6"
            maxlength="2500"
            placeholder="Tell us anything else you'd like us to know."
          ></textarea>
        </label>

        <label v-if="turnstileSiteKey" class="field field-full">
          Security Check
          <div :ref="setTurnstileContainerRef"></div>
          <p class="muted security-note">Complete security check to enable send.</p>
        </label>

        <input
          v-model="website"
          type="text"
          class="honeypot"
          autocomplete="off"
          tabindex="-1"
          aria-hidden="true"
        />

        <div class="form-actions field-full">
          <button type="submit" class="button-primary" :disabled="isSending || !canSubmit">
            {{ isSending ? "Sending..." : submitLabel }}
          </button>
        </div>
        <p class="submit-legal-note field-full">
          By clicking Submit Sales Request, you agree to our <RouterLink to="/privacy">Privacy Policy</RouterLink> and <RouterLink to="/legal">Terms of Service</RouterLink>.
        </p>
      </form>
      <p v-if="error" class="error">{{ error }}</p>
    </section>

    <PublicFooter />
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref } from "vue";
import { RouterLink, useRoute, useRouter } from "vue-router";
import PublicFooter from "../components/PublicFooter.vue";
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
const lightBrandLogoUrl = import.meta.env.VITE_BRAND_LOGO_LIGHT_URL as string | undefined;
const darkBrandLogoUrl = import.meta.env.VITE_BRAND_LOGO_DARK_URL as string | undefined;
const themeMode = ref<"light" | "dark">("dark");
const brandLogoUrl = computed(() =>
  themeMode.value === "light"
    ? lightBrandLogoUrl || darkBrandLogoUrl || ""
    : darkBrandLogoUrl || lightBrandLogoUrl || ""
);
const turnstileSiteKey = import.meta.env.VITE_TURNSTILE_SITE_KEY as string | undefined;
const {
  containerRef: turnstileContainerRef,
  token: turnstileToken,
  reset: resetTurnstile,
} = useTurnstile(turnstileSiteKey);
let themeObserver: MutationObserver | null = null;

const isDemoIntent = computed(() => route.query.intent === "demo");

const pageTitle = computed(() => (isDemoIntent.value ? "Request a Demo" : "Contact Sales"));
const pageLead = computed(() =>
  isDemoIntent.value
    ? "Send your demo request and our team will respond within 48 hours to schedule next steps."
    : "Send your request and our team will respond within 48 hours."
);
const submitLabel = computed(() => (isDemoIntent.value ? "Request Demo" : "Submit Sales Request"));
const returnPath = computed(() => (isDemoIntent.value ? "/" : "/pricing"));

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
.contact-sales-page {
  max-width: 1080px;
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

.pricing-top-nav {
  margin-bottom: 1rem;
}

.pricing-back-link {
  width: 2.4rem;
  height: 2.4rem;
  border-radius: 999px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  border: 1px solid rgba(77, 97, 122, 0.4);
  background: linear-gradient(180deg, rgba(31, 40, 54, 0.46) 0%, rgba(17, 23, 32, 0.34) 100%);
  backdrop-filter: blur(2px);
  color: #ffffff;
  text-decoration: none;
  transition: transform 0.16s ease, border-color 0.16s ease, background 0.16s ease;
}

.pricing-back-link:hover {
  text-decoration: none;
  transform: translateY(-1px);
  border-color: rgba(39, 196, 172, 0.58);
  background: linear-gradient(180deg, rgba(29, 66, 75, 0.62) 0%, rgba(16, 37, 48, 0.54) 100%);
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

.pricing-breadcrumb {
  color: rgba(225, 232, 240, 0.72);
  font-size: 0.95rem;
}

.page-intro {
  display: grid;
  gap: 0.45rem;
  margin-bottom: 1rem;
}

.page-intro h1 {
  margin: 0;
  font-size: clamp(1.4rem, 3vw, 2.4rem);
  line-height: 1.06;
  letter-spacing: -0.05em;
}

.page-intro .muted {
  margin: 0;
  max-width: 62ch;
  line-height: 1.55;
}

.sales-section {
  margin-bottom: 0.6rem;
}

.sales-form {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 1rem 1.2rem;
}

.field {
  min-width: 0;
  margin-top: 0;
}

.field-full {
  grid-column: 1 / -1;
}

.field-name {
  grid-column: 1;
}

.field-reply-email {
  grid-column: 2;
}

.field-plan {
  grid-column: 1;
}

.field-organization {
  grid-column: 2;
}

.field-label {
  display: block;
}

.sales-form :is(input, select, textarea) {
  box-shadow: 0 1px 3px color-mix(in srgb, #000 10%, transparent);
}

@media (max-width: 720px) {
  .contact-sales-page {
    padding-top: calc(1.25rem + env(safe-area-inset-top, 0px));
  }

  .brand-mark {
    margin-bottom: 0.25rem;
  }

  .brand-mark-full {
    height: 3.9rem;
  }

  .page-intro {
    margin-bottom: 0.85rem;
  }

  .sales-form {
    grid-template-columns: 1fr;
    gap: 0.85rem;
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
  margin: 0.4rem 0 1.25rem;
  padding-bottom: 0.85rem;
  border-bottom: 2px solid color-mix(in srgb, var(--border) 78%, transparent);
  color: inherit;
  opacity: 0.72;
  font-size: 0.92rem;
}

.security-note {
  font-size: 0.84rem;
}

.form-actions .button-primary:disabled {
  background: color-mix(in srgb, var(--surface-2) 84%, #8b9097 16%);
  border-color: color-mix(in srgb, var(--border) 78%, #8b9097 22%);
  color: color-mix(in srgb, currentColor 65%, transparent);
  box-shadow: none;
  cursor: not-allowed;
  opacity: 0.8;
}
</style>
