<template>
  <div class="page">
    <div class="page-nav-left">
      <RouterLink class="pricing-back-link" to="/" aria-label="Return to home">
        <svg viewBox="0 0 24 24" aria-hidden="true">
          <path d="M15 5 8 12l7 7" />
        </svg>
      </RouterLink>
    </div>
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
          Trouble signing in? Contact our support team by clicking the menu in the top right and then "Contact Support".
          By using this software, you agree to our
          <a :href="legalUrl" target="_blank" rel="noreferrer">legal terms and policies</a>.
        </p>
        <div class="form-actions">
          <button type="submit" class="button-primary" :disabled="isLoading">
            Sign in
          </button>
        </div>
        <div class="login-secondary-actions">
          <RouterLink class="link-button" to="/forgot-password">Forgot password?</RouterLink>
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
import { onMounted, onUnmounted, ref } from "vue";
import { RouterLink, useRouter } from "vue-router";
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
const legalUrl =
  import.meta.env.VITE_LEGAL_URL ||
  "https://www.itemtraxx.com/legal";
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
let prefetchTimer: number | null = null;
let cancelIdlePrefetch: (() => void) | null = null;

const prefetchTenantRoutes = () => {
  void import("./tenant/Checkout.vue");
  void import("./tenant/admin/AdminLogin.vue");
};

const scheduleIdle = (callback: () => void, timeout = 1200) => {
  if (typeof window.requestIdleCallback === "function") {
    const idleId = window.requestIdleCallback(callback, { timeout });
    return () => window.cancelIdleCallback(idleId);
  }
  const timerId = window.setTimeout(callback, timeout);
  return () => window.clearTimeout(timerId);
};

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
    if (err instanceof Error && err.message === "TENANT_DISABLED") {
      error.value = "";
      showToast("Access blocked", "Tenant is disabled. Access is blocked.");
      return;
    }
    if (err instanceof Error && err.message === "MAINTENANCE_MODE") {
      error.value = "";
      showToast("Maintenance mode", "Sign in is temporarily unavailable. Please try again later.");
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
    isLoading.value = false;
    if (turnstileSiteKey) {
      try {
        resetTurnstile();
      } catch (turnstileError) {
        console.error("Failed to reset Turnstile widget:", turnstileError);
      }
    }
  }
};

onUnmounted(() => {
  if (toastTimer) {
    window.clearTimeout(toastTimer);
    toastTimer = null;
  }
  if (prefetchTimer) {
    window.clearTimeout(prefetchTimer);
    prefetchTimer = null;
  }
  if (cancelIdlePrefetch) {
    cancelIdlePrefetch();
    cancelIdlePrefetch = null;
  }
});

onMounted(() => {
  cancelIdlePrefetch = scheduleIdle(prefetchTenantRoutes, 1000);
  prefetchTimer = window.setTimeout(() => {
    prefetchTenantRoutes();
  }, 2500);
});
</script>

<style scoped>
.pricing-back-link {
  width: 2.4rem;
  height: 2.4rem;
  border-radius: 999px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  border: 1px solid rgba(255, 255, 255, 0.28);
  background: rgba(7, 23, 43, 0.24);
  color: #ffffff;
  text-decoration: none;
  transition: transform 0.16s ease, border-color 0.16s ease, background 0.16s ease;
}

.pricing-back-link:hover {
  text-decoration: none;
  transform: translateY(-1px);
  border-color: rgba(255, 255, 255, 0.6);
  background: rgba(7, 23, 43, 0.34);
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

.login-secondary-actions {
  margin-top: 0.6rem;
}

.link-button {
  border: 0;
  background: transparent;
  padding: 0;
  color: var(--link-color);
  font-weight: 600;
  cursor: pointer;
}

.link-button:hover {
  text-decoration: underline;
  transform: none;
}

.link-button:disabled {
  opacity: 0.6;
  cursor: not-allowed;
  text-decoration: none;
}
</style>
