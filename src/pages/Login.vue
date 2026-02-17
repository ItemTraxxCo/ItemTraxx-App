<template>
  <div class="page">
    <h1 class="brand-title">
      <img
        v-if="logoUrl"
        class="brand-logo"
        :src="logoUrl"
        alt="ItemTraxx logo"
      />
      ItemTraxx
    </h1>
    <h3>Sign in</h3>
    <div class="card">
      <form class="form" @submit.prevent="handleTenantLogin">
        <label>
          Access Code
          <input
            v-model="accessCode"
            type="text"
            placeholder="Enter access code"
            autocomplete="off"
            autocapitalize="off"
            autocorrect="off"
            spellcheck="false"
          />
        </label>
        <label>
          Password
          <input v-model="password" type="password" placeholder="Enter password" />
        </label>
        <label v-if="turnstileSiteKey">
          Security Check
          <div :ref="setTurnstileContainerRef"></div>
        </label>
        <p class="muted support-note">
          Trouble signing in? Contact support at support@itemtraxx.com.
          By using this software, you agree to our
          <a :href="termsUrl" target="_blank" rel="noreferrer">terms and conditions</a>
          and
          <a :href="privacyUrl" target="_blank" rel="noreferrer">privacy policy</a>.
        </p>
        <div class="form-actions">
          <button type="submit" class="button-primary" :disabled="isLoading">
            Sign in
          </button>
        </div>
      </form>

      <p v-if="error" class="error">{{ error }}</p>
    </div>
    <div v-if="isLoading" class="toast toast-persist">
      <div class="toast-title">Loading...</div>
      <div class="toast-body">Signing you in.</div>
    </div>
    <div v-if="toastMessage" class="toast">
      <div class="toast-title">{{ toastTitle }}</div>
      <div class="toast-body">{{ toastMessage }}</div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { onUnmounted, ref } from "vue";
import { useRouter } from "vue-router";
import { tenantLogin } from "../services/authService";
import { useTurnstile } from "../composables/useTurnstile";

const router = useRouter();
const accessCode = ref("");
const password = ref("");
const error = ref("");
const isLoading = ref(false);
const toastTitle = ref("");
const toastMessage = ref("");
const superAdminAccessCode = import.meta.env
  .VITE_SUPER_ADMIN_ACCESS_CODE as string | undefined;
const logoUrl = import.meta.env.VITE_LOGO_URL as string | undefined;
const termsUrl =
  import.meta.env.VITE_TERMS_URL ||
  "https://github.com/ItemTraxxCo/ItemTraxx-App/blob/main/TERMS.md";
const privacyUrl =
  import.meta.env.VITE_PRIVACY_URL ||
  "https://github.com/ItemTraxxCo/ItemTraxx-App/blob/main/PRIVACY.md";
const turnstileSiteKey = import.meta.env.VITE_TURNSTILE_SITE_KEY as
  | string
  | undefined;
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
let toastTimer: number | null = null;

const showToast = (title: string, message: string) => {
  toastTitle.value = title;
  toastMessage.value = message;
  if (toastTimer) {
    window.clearTimeout(toastTimer);
  }
  toastTimer = window.setTimeout(() => {
    toastTitle.value = "";
    toastMessage.value = "";
    toastTimer = null;
  }, 4000);
};

const isCredentialFailure = (message: string) => {
  const normalized = message.trim().toLowerCase();
  return (
    normalized.includes("invalid tenant access code") ||
    normalized.includes("invalid access code") ||
    normalized.includes("invalid credentials") ||
    normalized.includes("invalid password") ||
    normalized === "unauthorized"
  );
};

const handleTenantLogin = async () => {
  error.value = "";
  isLoading.value = true;
  try {
    if (
      superAdminAccessCode &&
      accessCode.value.trim() === superAdminAccessCode
    ) {
      await router.push("/super-auth");
      return;
    }
    if (turnstileSiteKey && !turnstileToken.value) {
      error.value = "Complete the security check and try again.";
      return;
    }
    await tenantLogin(
      accessCode.value.trim(),
      password.value,
      turnstileToken.value || undefined
    );
    await router.push("/tenant/checkout");
  } catch (err) {
    if (err instanceof Error && err.message === "LIMITER_UNAVAILABLE") {
      error.value = "";
      showToast(
        "Rate Limit reached. Please try again later.",
        "Login unavailable. Please try again later."
      );
      return;
    }
    if (err instanceof Error && err.message === "TURNSTILE_FAILED") {
      error.value = "Security check failed. Please try again.";
      return;
    }
    const errorMessage = err instanceof Error ? err.message : "Sign in failed.";
    if (isCredentialFailure(errorMessage)) {
      error.value = "";
      showToast("Sign in failed.", errorMessage);
      return;
    }
    error.value = errorMessage;
  } finally {
    if (turnstileSiteKey) {
      resetTurnstile();
    }
    isLoading.value = false;
  }
};

onUnmounted(() => {
  if (toastTimer) {
    window.clearTimeout(toastTimer);
    toastTimer = null;
  }
});
</script>
