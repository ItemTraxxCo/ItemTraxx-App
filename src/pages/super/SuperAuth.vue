<template>
  <div class="super-auth-shell" :class="`theme-${themeMode}`">
    <div class="super-auth-panel">
      <div class="super-auth-copy">
        <p class="super-auth-kicker">Restricted Access</p>
        <h1>{{ isCodeStep ? 'Email Verification' : 'Super Admin Verification' }}</h1>
        <p class="super-auth-subtitle">
          <template v-if="isCodeStep">
            Check your email for a 6-digit verification code to continue.
          </template>
          <template v-else>
            Enter your super admin credentials to start verification.
          </template>
        </p>
      </div>

      <form v-if="!isCodeStep" class="form super-auth-form" @submit.prevent="handleCredentialSubmit">
        <label>
          Email
          <input v-model="email" type="email" placeholder="Enter email" autocomplete="username" />
        </label>
        <label class="super-password-field">
          Password
          <input v-model="password" type="password" placeholder="Enter password" autocomplete="current-password" />
          <RouterLink
            class="link-button super-password-help-link"
            :to="{ path: '/forgot-password', query: { email: email.trim(), from: 'super-auth' } }"
          >
            Forgot password?
          </RouterLink>
        </label>
        <label>
          Security Check
          <div v-if="hasTurnstileSiteKey" :ref="setTurnstileContainerRef"></div>
          <p v-if="turnstileStatusMessage" :class="turnstileStatusClass">{{ turnstileStatusMessage }}</p>
          <p class="muted turnstile-help">
            <template v-if="hasTurnstileSiteKey">Complete security check to enable sign in.</template>
            <template v-else>Turnstile is configured through `VITE_TURNSTILE_SITE_KEY` and requires a dev server restart after env changes.</template>
          </p>
        </label>
        <div class="form-actions">
          <button type="submit" class="button-primary" :disabled="!canSubmitCredentials">Sign in</button>
        </div>
      </form>

      <form v-else class="form super-auth-form" @submit.prevent="handleCodeSubmit">
        <p class="verification-copy">
          Code sent to <strong>{{ verificationEmailLabel }}</strong>.
        </p>
        <label>
          Verification Code
          <input
            v-model="verificationCode"
            type="text"
            inputmode="numeric"
            autocomplete="one-time-code"
            placeholder="Enter 6-digit code"
            maxlength="6"
          />
        </label>
        <div class="form-actions verification-actions">
          <button type="submit" class="button-primary" :disabled="!canSubmitCode">Verify Code</button>
          <button type="button" class="button-link" :disabled="isLoading" @click="handleResendCode">Resend code</button>
          <button type="button" class="button-link" :disabled="isLoading" @click="handleStartOver">Start over</button>
        </div>
      </form>
      <p v-if="error" class="error">{{ error }}</p>
    </div>
    <div v-if="toastMessage" class="toast">
      <div class="toast-title">{{ toastTitle }}</div>
      <div class="toast-body">{{ toastMessage }}</div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref } from "vue";
import { RouterLink, useRouter } from "vue-router";
import {
  clearPendingSuperAdminVerificationEmail,
  getPendingSuperAdminVerificationEmail,
  signOut,
  superAdminLogin,
  resendSuperAdminEmailChallenge,
  verifySuperAdminEmailChallenge,
} from "../../services/authService";
import { useTurnstile } from "../../composables/useTurnstile";
import { getAuthState } from "../../store/authState";

const router = useRouter();
const auth = getAuthState();
const email = ref("");
const password = ref("");
const verificationCode = ref("");
const verificationEmail = ref<string | null>(null);
const error = ref("");
const isLoading = ref(false);
const isCodeStep = ref(false);
const toastTitle = ref("");
const toastMessage = ref("");
const themeMode = ref<"light" | "dark">("dark");
const turnstileSiteKey = (import.meta.env.VITE_TURNSTILE_SITE_KEY as string | undefined)?.trim();
const hasTurnstileSiteKey = !!turnstileSiteKey;
const {
  containerRef: turnstileContainerRef,
  token: turnstileToken,
  loadError: turnstileLoadError,
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
let toastTimer: number | null = null;
let themeObserver: MutationObserver | null = null;

const turnstileStatusMessage = computed(() => {
  if (!hasTurnstileSiteKey) {
    return "Turnstile site key is missing in the current frontend runtime.";
  }
  return turnstileLoadError.value || "";
});

const turnstileStatusClass = computed(() =>
  turnstileStatusMessage.value ? "error turnstile-error" : "muted turnstile-help"
);

const canSubmitCredentials = computed(() => {
  if (isLoading.value) return false;
  if (!email.value.trim() || !password.value.trim()) return false;
  if (!hasTurnstileSiteKey) return false;
  if (turnstileLoadError.value) return false;
  if (!turnstileToken.value) return false;
  return true;
});

const canSubmitCode = computed(() => {
  if (isLoading.value) return false;
  return /^\d{6}$/.test(verificationCode.value.trim());
});

const verificationEmailLabel = computed(() => verificationEmail.value || auth.email || "your email");

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

const enableCodeStep = (nextEmail: string | null) => {
  isCodeStep.value = true;
  verificationEmail.value = nextEmail;
  verificationCode.value = "";
};

const handleCredentialSubmit = async () => {
  error.value = "";
  if (!email.value.trim() || !password.value.trim()) {
    showToast("Verification blocked", "Enter email and password to continue.");
    return;
  }
  if (!hasTurnstileSiteKey) {
    error.value = "Security check is unavailable because the Turnstile site key is missing.";
    showToast("Security check unavailable", "Restart the dev server after restoring the Turnstile site key.");
    return;
  }
  if (turnstileLoadError.value) {
    error.value = turnstileLoadError.value;
    showToast("Security check unavailable", "Refresh the page and try again.");
    return;
  }
  if (!turnstileToken.value) {
    error.value = "Complete the security check and try again.";
    showToast("Security check required", "Complete the security check and try again.");
    return;
  }

  isLoading.value = true;
  try {
    const result = await superAdminLogin(
      email.value.trim(),
      password.value,
      turnstileToken.value ?? ""
    );
    enableCodeStep(result.email ?? email.value.trim());
    showToast("Code sent", "Check your email for the verification code.");
  } catch (err) {
    const message = err instanceof Error ? err.message : "Sign in failed.";
    if (message === "Invalid credentials.") {
      error.value = "Invalid super admin credentials.";
      showToast("Verification failed", "Invalid super admin credentials.");
    } else if (message === "Access denied.") {
      error.value = "Access denied.";
      showToast("Access denied", "This account cannot access super admin.");
    } else {
      error.value = message || "Verification failed. Please try again.";
      showToast("Verification failed", error.value);
    }
  } finally {
    isLoading.value = false;
    try {
      resetTurnstile();
    } catch (turnstileError) {
      console.error("Failed to reset super auth Turnstile widget:", turnstileError);
    }
  }
};

const handleCodeSubmit = async () => {
  error.value = "";
  if (!/^\d{6}$/.test(verificationCode.value.trim())) {
    error.value = "Enter the 6-digit verification code.";
    return;
  }

  isLoading.value = true;
  try {
    await verifySuperAdminEmailChallenge(verificationCode.value.trim());
    await router.push("/super-admin");
  } catch (err) {
    const message = err instanceof Error ? err.message : "Verification failed.";
    error.value = message;
    showToast("Verification failed", message);
  } finally {
    isLoading.value = false;
  }
};

const handleResendCode = async () => {
  error.value = "";
  isLoading.value = true;
  try {
    const result = await resendSuperAdminEmailChallenge();
    enableCodeStep(result.email ?? verificationEmail.value);
    showToast("Code sent", "A new verification code was emailed.");
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unable to resend code.";
    error.value = message;
    showToast("Resend failed", message);
  } finally {
    isLoading.value = false;
  }
};

const handleStartOver = async () => {
  clearPendingSuperAdminVerificationEmail();
  await signOut();
  isCodeStep.value = false;
  verificationCode.value = "";
  verificationEmail.value = null;
  password.value = "";
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

  const pendingEmail = getPendingSuperAdminVerificationEmail();
  if (pendingEmail || (auth.isAuthenticated && auth.role === "super_admin" && !auth.hasSecondaryAuth)) {
    enableCodeStep(pendingEmail ?? auth.email);
  }
});

onUnmounted(() => {
  if (toastTimer) {
    window.clearTimeout(toastTimer);
    toastTimer = null;
  }
  if (themeObserver) {
    themeObserver.disconnect();
    themeObserver = null;
  }
});
</script>

<style scoped>
.super-auth-shell {
  min-height: 100vh;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 2rem;
  background:
    radial-gradient(circle at top, rgba(25, 194, 168, 0.16), transparent 34%),
    radial-gradient(circle at bottom right, rgba(25, 67, 155, 0.18), transparent 38%),
    linear-gradient(180deg, #11151c 0%, #090c12 100%);
}

.super-auth-shell.theme-light {
  background:
    radial-gradient(circle at top, rgba(25, 194, 168, 0.16), transparent 30%),
    radial-gradient(circle at bottom right, rgba(25, 67, 155, 0.14), transparent 34%),
    linear-gradient(180deg, #eef5f8 0%, #dde7ee 100%);
}

.super-auth-panel {
  width: min(100%, 34rem);
  padding: 1.8rem 1.9rem 2rem;
  border-radius: 24px;
  border: 1px solid color-mix(in srgb, var(--border) 72%, var(--accent) 28%);
  background:
    radial-gradient(circle at top right, color-mix(in srgb, var(--accent) 10%, transparent 90%), transparent 28%),
    linear-gradient(180deg, color-mix(in srgb, var(--surface) 94%, transparent 6%) 0%, color-mix(in srgb, var(--surface-2) 92%, transparent 8%) 100%);
  box-shadow: 0 24px 48px rgba(0, 0, 0, 0.18);
}

.super-auth-kicker {
  margin: 0 0 0.8rem;
  font-size: 0.82rem;
  letter-spacing: 0.14em;
  text-transform: uppercase;
  color: var(--muted);
}

.super-auth-copy h1 {
  margin: 0;
}

.super-auth-subtitle {
  margin: 1rem 0 1.8rem;
  color: var(--muted);
}

.super-auth-form input {
  min-height: 3.6rem;
}

.super-password-field {
  position: relative;
}

.super-password-help-link {
  position: absolute;
  right: 0;
  top: calc(100% + 0.45rem);
  font-size: 0.82rem;
  color: color-mix(in srgb, var(--muted) 82%, var(--accent) 18%);
  text-decoration: none;
}

.super-password-help-link:hover {
  color: var(--text);
  text-decoration: underline;
}

.super-password-field + label {
  margin-top: 1.6rem;
}

.verification-copy {
  margin: 0 0 1rem;
  color: var(--muted);
}

.verification-actions {
  flex-wrap: wrap;
  gap: 0.75rem;
}

.turnstile-help {
  margin-top: 0.35rem;
  font-size: 0.78rem;
}

.turnstile-error {
  margin-top: 0.5rem;
  margin-bottom: 0;
  font-size: 0.82rem;
}
</style>
