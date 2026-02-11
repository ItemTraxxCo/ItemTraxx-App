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
        <p class="muted support-note">
          Trouble signing in? Contact support at support@itemtraxx.com.
          By using this software, you agree to our
          <a :href="termsUrl" target="_blank" rel="noreferrer">terms and conditions</a>
          and
          <a :href="privacyUrl" target="_blank" rel="noreferrer">privacy policy</a>.
        </p>
        <div class="form-actions">
          <button type="submit" :disabled="isLoading">Sign in</button>
        </div>
      </form>

      <p v-if="error" class="error">{{ error }}</p>
    </div>
    <div v-if="isLoading" class="toast toast-persist">
      <div class="toast-title">Loading...</div>
      <div class="toast-body">Signing you in.</div>
    </div>
    <div v-if="toastMessage" class="toast">
      <div class="toast-title">Limit reached.</div>
      <div class="toast-body">{{ toastMessage }}</div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { onUnmounted, ref } from "vue";
import { useRouter } from "vue-router";
import { tenantLogin } from "../services/authService";

const router = useRouter();
const accessCode = ref("");
const password = ref("");
const error = ref("");
const isLoading = ref(false);
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
let toastTimer: number | null = null;

const showLimiterUnavailableToast = () => {
  toastMessage.value =
    "Login unavailable. Please try again later.";
  if (toastTimer) {
    window.clearTimeout(toastTimer);
  }
  toastTimer = window.setTimeout(() => {
    toastMessage.value = "";
    toastTimer = null;
  }, 4000);
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
    await tenantLogin(accessCode.value.trim(), password.value);
    await router.push("/tenant/checkout");
  } catch (err) {
    if (err instanceof Error && err.message === "LIMITER_UNAVAILABLE") {
      error.value = "";
      showLimiterUnavailableToast();
      return;
    }
    error.value = err instanceof Error ? err.message : "Sign in failed.";
  } finally {
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
