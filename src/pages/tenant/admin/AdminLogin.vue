<template>
  <div class="page">
    <h1>Admin Sign In</h1>
    <p>Enter admin credentials.</p>

    <div class="card">
      <form class="form" @submit.prevent="handleAdminLogin">
        <label>
          Email
          <input v-model="email" type="email" placeholder="Enter email" />
        </label>
        <label>
          Password
          <input v-model="password" type="password" placeholder="Enter password" />
        </label>
        <label v-if="turnstileSiteKey">
          Security Check
          <div :ref="setTurnstileContainerRef"></div>
          <p class="muted turnstile-help">Complete security check to enable sign in.</p>
        </label>
        <div class="form-actions">
          <button type="submit" class="button-primary" :disabled="!canSubmit">
            Sign in
          </button>
        </div>
      </form>
      <p v-if="error" class="error">{{ error }}</p>
    </div>
    <div v-if="toastMessage" class="toast">
      <div class="toast-title">{{ toastTitle }}</div>
      <div class="toast-body">{{ toastMessage }}</div>
    </div>

    <RouterLink class="link" to="/tenant/checkout">Back to checkout</RouterLink>
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref } from "vue";
import { RouterLink, useRouter } from "vue-router";
import { adminLogin } from "../../../services/authService";
import { touchTenantAdminSession } from "../../../services/adminOpsService";
import { logAdminAction } from "../../../services/auditLogService";
import { useTurnstile } from "../../../composables/useTurnstile";
import { clearAdminVerification } from "../../../store/authState";

const router = useRouter();
const email = ref("");
const password = ref("");
const error = ref("");
const isLoading = ref(false);
const toastTitle = ref("");
const toastMessage = ref("");
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

const canSubmit = computed(() => {
  if (isLoading.value) return false;
  if (!email.value.trim() || !password.value.trim()) return false;
  if (turnstileSiteKey && !turnstileToken.value) return false;
  return true;
});

const devLog = (message: string, data?: Record<string, unknown>) => {
  if (!import.meta.env.DEV) return;
  // Keep logs high-level to avoid sensitive data exposure.
  console.debug(`[admin-login] ${message}`, data ?? {});
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

const handleAdminLogin = async () => {
  devLog("submit_click_received", {
    hasEmail: !!email.value.trim(),
    hasPassword: !!password.value.trim(),
    hasTurnstileKey: !!turnstileSiteKey,
    hasTurnstileToken: !!turnstileToken.value,
  });
  error.value = "";
  if (!email.value.trim() || !password.value.trim()) {
    devLog("submit_blocked_empty_fields");
    showToast("Sign in blocked", "Enter email and password to continue.");
    return;
  }
  if (turnstileSiteKey && !turnstileToken.value) {
    devLog("submit_blocked_turnstile_missing");
    error.value = "Complete the security check and try again.";
    showToast("Security check required", "Complete the security check and try again.");
    return;
  }
  isLoading.value = true;
  try {
    devLog("auth_request_start");
    await adminLogin(email.value.trim(), password.value);
    devLog("auth_request_success");
    await logAdminAction({
      action_type: "admin_login",
      metadata: { email: email.value.trim() },
    });
    try {
      await touchTenantAdminSession();
    } catch (sessionErr) {
      const message = sessionErr instanceof Error ? sessionErr.message : "";
      if (!message.includes("Session controls unavailable")) {
        throw sessionErr;
      }
    }
    await router.push("/tenant/admin");
  } catch (err) {
    devLog("auth_request_failed");
    const message = err instanceof Error ? err.message : "Sign in failed.";
    if (message === "Invalid credentials.") {
      error.value = "Invalid admin credentials.";
      showToast("Sign in failed", "Invalid admin credentials.");
    } else if (message === "Tenant disabled.") {
      error.value = "Tenant is disabled. Access is blocked.";
      showToast("Access blocked", "Tenant is disabled. Access is blocked.");
    } else if (message === "Access denied.") {
      error.value = "Access denied for this tenant admin panel.";
      showToast("Access denied", "This account cannot access the admin panel.");
    } else {
      error.value = "Sign in failed. Please try again.";
      showToast("Sign in failed", "Please try again.");
    }
  } finally {
    isLoading.value = false;
    if (turnstileSiteKey) {
      try {
        resetTurnstile();
      } catch (turnstileError) {
        devLog("turnstile_reset_failed");
        console.error("Failed to reset admin Turnstile widget:", turnstileError);
      }
    }
  }
};

onMounted(() => {
  clearAdminVerification();
});

onUnmounted(() => {
  if (toastTimer) {
    window.clearTimeout(toastTimer);
    toastTimer = null;
  }
});
</script>

<style scoped>
.turnstile-help {
  margin-top: 0.35rem;
  font-size: 0.78rem;
}

.toast {
  position: fixed;
  right: 1rem;
  bottom: 1rem;
  min-width: 230px;
  max-width: 340px;
  border-radius: 12px;
  border: 1px solid var(--border);
  background: var(--surface);
  padding: 0.75rem 0.85rem;
  box-shadow: 0 10px 24px rgba(0, 0, 0, 0.18);
  z-index: 1000;
}

.toast-title {
  font-weight: 700;
  font-size: 0.9rem;
}

.toast-body {
  margin-top: 0.2rem;
  font-size: 0.84rem;
  color: var(--muted);
}
</style>
