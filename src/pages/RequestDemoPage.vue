<template>
  <div class="page request-demo-page">
    <RouterLink class="brand-mark" to="/" aria-label="ItemTraxx home">
      <img v-if="brandLogoUrl" class="brand-mark-full" :src="brandLogoUrl" alt="ItemTraxx Co" />
    </RouterLink>

    <div class="page-nav-left pricing-top-nav">
      <RouterLink class="pricing-back-link" to="/" aria-label="Return to home" @click.prevent="$router.back()">
        <svg viewBox="0 0 24 24" aria-hidden="true">
          <path d="M15 5 8 12l7 7" />
        </svg>
      </RouterLink>
      <span class="pricing-breadcrumb"> </span>
    </div>

    <div class="page-intro">
      <h1>Request a Demo</h1>
      <p class="muted">
        Send a demo request and our team will follow up within 72 hours (within active hours) to schedule next
        steps.
      </p>
    </div>

    <section class="demo-section">
      <form class="form demo-form" novalidate @submit.prevent="handleSend">
        <label class="field" :class="{ 'field-invalid': fieldErrors.fullName }">
          Name
          <input
            v-model.trim="fullName"
            type="text"
            required
            maxlength="120"
            placeholder="Your full name"
            :aria-invalid="fieldErrors.fullName ? 'true' : undefined"
            @input="clearFieldError('fullName')"
          />
          <span v-if="fieldErrors.fullName" class="field-error">{{ fieldErrors.fullName }}</span>
        </label>

        <label class="field" :class="{ 'field-invalid': fieldErrors.replyEmail }">
          Reply email address
          <input
            v-model.trim="replyEmail"
            type="email"
            required
            placeholder="name@organization.org"
            :aria-invalid="fieldErrors.replyEmail ? 'true' : undefined"
            @input="clearFieldError('replyEmail')"
          />
          <span v-if="fieldErrors.replyEmail" class="field-error">{{ fieldErrors.replyEmail }}</span>
        </label>

        <label class="field field-full" :class="{ 'field-invalid': fieldErrors.organization }">
          School, organization, district, or team (type "N/A" if not applicable)
          <input
            v-model.trim="organization"
            type="text"
            required
            maxlength="160"
            placeholder="District, school, organization, or team name"
            :aria-invalid="fieldErrors.organization ? 'true' : undefined"
            @input="clearFieldError('organization')"
          />
          <span v-if="fieldErrors.organization" class="field-error">{{ fieldErrors.organization }}</span>
        </label>

        <label class="field field-full">
          What would you like to see?
          <textarea
            v-model.trim="details"
            rows="6"
            maxlength="2500"
            placeholder="Tell us about your workflow, what you want to track, and any questions you want covered in the demo."
          ></textarea>
        </label>

        <label v-if="turnstileSiteKey" class="field field-full">
          
          <div :ref="setTurnstileContainerRef"></div>
          <p class="muted security-note">Complete security check and ensure all fields are filled out before sending. If you do not see the security check please reload the page and try again.</p>
          <span v-if="fieldErrors.turnstile" class="field-error">{{ fieldErrors.turnstile }}</span>
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
          <button type="submit" class="button-primary" :disabled="isSending">
            {{ isSending ? "Sending..." : "Send Demo Request" }}
          </button>
        </div>
        <p class="submit-legal-note field-full">
          By clicking Send Demo Request, you agree to our <RouterLink to="/privacy">Privacy Policy</RouterLink> and <RouterLink to="/legal">Terms of Service</RouterLink>.
        </p>
      </form>
      <p v-if="error" class="error">{{ error }}</p>
    </section>

    <PublicFooter />
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref, watch } from "vue";
import { RouterLink, useRouter } from "vue-router";
import PublicFooter from "../components/PublicFooter.vue";
import { useTurnstile } from "../composables/useTurnstile";
import { toUserFacingErrorMessage } from "../services/appErrors";
import { submitContactSalesLead } from "../services/contactSalesService";
import { saveSubmissionConfirmation } from "../services/submissionConfirmation";

const router = useRouter();
const fullName = ref("");
const organization = ref("");
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

const setTurnstileContainerRef = (el: Element | { $el?: Element } | null) => {
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

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const fieldErrors = ref<Record<string, string>>({});

const clearFieldError = (field: string) => {
  if (fieldErrors.value[field]) {
    const next = { ...fieldErrors.value };
    delete next[field];
    fieldErrors.value = next;
  }
};

const validate = () => {
  const errors: Record<string, string> = {};
  if (!fullName.value) errors.fullName = "Please enter your name.";
  if (!replyEmail.value) errors.replyEmail = "Please enter your reply email address.";
  else if (!EMAIL_PATTERN.test(replyEmail.value)) errors.replyEmail = "Please enter a valid email address.";
  if (!organization.value) errors.organization = "Please enter your school, organization, district, or team.";
  if (turnstileSiteKey && !turnstileToken.value) errors.turnstile = "Please complete the security check.";
  fieldErrors.value = errors;
  return Object.keys(errors).length === 0;
};

// Clear the security-check error as soon as a Turnstile token arrives.
watch(turnstileToken, (value) => {
  if (value) clearFieldError("turnstile");
});

const handleSend = () => {
  void send();
};

const send = async () => {
  error.value = "";
  if (!validate()) {
    error.value = "Complete required fields and security check.";
    return;
  }
  isSending.value = true;
  try {
    const response = await submitContactSalesLead({
      plan: "other",
      name: fullName.value,
      organization: organization.value,
      reply_email: replyEmail.value,
      details: details.value,
      turnstile_token: turnstileToken.value ?? "",
      website: website.value,
      intent: "demo",
    });

    saveSubmissionConfirmation({
      kind: "demo",
      submissionRef: response?.lead_id ?? `demo-${Date.now()}`,
      submittedAt: new Date().toISOString(),
    });

    await router.push({ name: "public-submit-confirmation" });
  } catch (err) {
    error.value = toUserFacingErrorMessage(err, "Unable to send demo request.");
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
.request-demo-page {
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
  stroke: currentColor;
  stroke-width: 2.2;
  stroke-linecap: round;
  stroke-linejoin: round;
  fill: none;
}

.pricing-breadcrumb {
  color: var(--muted);
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

.demo-section {
  margin-bottom: 0.6rem;
}

.demo-form {
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

.demo-form :is(input, select, textarea) {
}

@media (max-width: 720px) {
  .request-demo-page {
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

  .demo-form {
    grid-template-columns: 1fr;
    gap: 0.85rem;
  }
}

.honeypot {
  position: absolute;
  left: -9999px;
  width: 1px;
  height: 1px;
  opacity: 0;
  pointer-events: none;
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

.field-invalid :is(input, select, textarea) {
  border-color: var(--danger);
}

.field-error {
  display: block;
  margin-top: 0.3rem;
  color: var(--danger);
  font-size: 0.84rem;
  font-weight: 500;
}

.error {
  margin: 0.6rem 0 0;
  color: var(--danger);
  font-weight: 500;
}
</style>
