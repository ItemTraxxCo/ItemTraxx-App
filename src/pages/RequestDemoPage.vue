<template>
  <div class="page request-demo-page">
    <div class="page-nav-left">
      <RouterLink class="button-link" to="/">Back</RouterLink>
    </div>

    <h1>Request a Demo</h1>
    <p class="muted">
      Send a demo request and our team will follow up from support@itemtraxx.com to schedule next
      steps.
    </p>

    <section class="card">
      <form class="form" @submit.prevent="handleSend">
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
          School, organization, district, or team (type "N/A" if not applicable)
          <input
            v-model.trim="organization"
            type="text"
            required
            maxlength="160"
            placeholder="District, school, organization, or team name"
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
          What would you like to see?
          <textarea
            v-model.trim="details"
            rows="6"
            maxlength="2500"
            placeholder="Tell us about your workflow, what you want to track, and any questions you want covered in the demo."
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
            {{ isSending ? "Sending..." : "Request Demo" }}
          </button>
        </div>
        <p class="submit-legal-note">
          By sending, you agree to <RouterLink to="/legal">Legal</RouterLink>.
        </p>
      </form>
      <p v-if="error" class="error">{{ error }}</p>
      <p v-if="success" class="success">{{ success }}</p>
    </section>
  </div>
</template>

<script setup lang="ts">
import { computed, ref } from "vue";
import { RouterLink } from "vue-router";
import { useTurnstile } from "../composables/useTurnstile";
import { toUserFacingErrorMessage } from "../services/appErrors";
import { submitContactSalesLead } from "../services/contactSalesService";

const fullName = ref("");
const organization = ref("");
const replyEmail = ref("");
const details = ref("");
const website = ref("");
const isSending = ref(false);
const error = ref("");
const success = ref("");
const turnstileSiteKey = import.meta.env.VITE_TURNSTILE_SITE_KEY as string | undefined;
const {
  containerRef: turnstileContainerRef,
  token: turnstileToken,
  reset: resetTurnstile,
} = useTurnstile(turnstileSiteKey);

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

const canSubmit = computed(() => {
  if (!fullName.value || !organization.value || !replyEmail.value) return false;
  if (turnstileSiteKey && !turnstileToken.value) return false;
  return true;
});

const handleSend = () => {
  void send();
};

const send = async () => {
  error.value = "";
  success.value = "";
  if (!canSubmit.value || (turnstileSiteKey && !turnstileToken.value)) {
    error.value = "Complete required fields and security check.";
    return;
  }
  isSending.value = true;
  try {
    await submitContactSalesLead({
      plan: "other",
      name: fullName.value,
      organization: organization.value,
      reply_email: replyEmail.value,
      details: details.value,
      turnstile_token: turnstileToken.value ?? "",
      website: website.value,
      intent: "demo",
    });
    success.value =
      "Demo request sent. You will receive a confirmation email from support@itemtraxx.com within 24 hours. Our team will follow up shortly to schedule next steps.";
    details.value = "";
    website.value = "";
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
</script>

<style scoped>
.request-demo-page {
  max-width: 860px;
  padding-top: calc(2rem + env(safe-area-inset-top, 0px));
}

@media (max-width: 720px) {
  .request-demo-page {
    padding-top: calc(1.25rem + env(safe-area-inset-top, 0px));
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
</style>
