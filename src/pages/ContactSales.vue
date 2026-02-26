<template>
  <div class="page contact-sales-page">
    <div class="page-nav-left">
      <RouterLink class="button-link" to="/pricing">Return to pricing</RouterLink>
    </div>

    <h1>Contact Sales</h1>
    <p class="muted">Send your request and our team will respond from support@itemtraxx.com.</p>

    <section class="card">
      <form class="form" @submit.prevent="handleSend">
        <label>
          Please Select Plan
          <select v-model="plan" required>
            <option value="core">ItemTraxx Core Plan</option>
            <option value="growth">ItemTraxx Growth Plan</option>
            <option value="enterprise">ItemTraxx Enterprise Plan</option>
          </select>
        </label>

        <label v-if="plan === 'enterprise'">
          Number of schools (7 or above)
          <input v-model.number="schoolCount" type="number" min="1" step="1" placeholder="Enter number of schools" />
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
          Organization
          <input
            v-model.trim="organization"
            type="text"
            required
            maxlength="160"
            placeholder="School, district, or organization"
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
            {{ isSending ? "Sending..." : "Send" }}
          </button>
        </div>
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
import { submitContactSalesLead } from "../services/contactSalesService";

type PlanId = "core" | "growth" | "enterprise";

const plan = ref<PlanId>("core");
const fullName = ref("");
const organization = ref("");
const schoolCount = ref<number | null>(null);
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
  if (!fullName.value || !organization.value || !replyEmail.value) return false;
  if (plan.value === "enterprise" && (!schoolCount.value || schoolCount.value < 1)) return false;
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
      plan: plan.value,
      schools_count: plan.value === "enterprise" ? schoolCount.value : null,
      name: fullName.value,
      organization: organization.value,
      reply_email: replyEmail.value,
      details: details.value,
      turnstile_token: turnstileToken.value ?? "",
      website: website.value,
    });
    success.value = "Request sent. You will receive a confirmation email from support@itemtraxx.com confirming that we have received your request within 24hr. Our sales team will follow up shortly after. Thank you for your interest in ItemTraxx!";
    details.value = "";
    website.value = "";
  } catch (err) {
    error.value = err instanceof Error ? err.message : "Unable to send request.";
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
}

.honeypot {
  position: absolute;
  left: -9999px;
  top: auto;
  width: 1px;
  height: 1px;
  overflow: hidden;
}
</style>
