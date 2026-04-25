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
          <span class="super-password-input-wrap">
            <input
              v-model="password"
              :type="showPassword ? 'text' : 'password'"
              placeholder="Enter password"
              autocomplete="current-password"
            />
            <button
              type="button"
              class="super-password-visibility-toggle"
              :aria-label="showPassword ? 'Hide password' : 'Show password'"
              :aria-pressed="showPassword"
              @click="showPassword = !showPassword"
            >
              <svg v-if="showPassword" viewBox="0 0 24 24" aria-hidden="true">
                <path d="M3 3l18 18" />
                <path d="M10.58 10.58a2 2 0 102.84 2.84" />
                <path d="M9.88 5.09A10.94 10.94 0 0112 4c5 0 9.27 3.11 11 8-0.69 1.94-1.91 3.61-3.5 4.85" />
                <path d="M6.61 6.61C4.62 7.9 3.06 9.76 2 12c1.73 4.89 6 8 10 8a9.88 9.88 0 004.23-.93" />
              </svg>
              <svg v-else viewBox="0 0 24 24" aria-hidden="true">
                <path d="M2 12s3.5-8 10-8 10 8 10 8-3.5 8-10 8-10-8-10-8z" />
                <circle cx="12" cy="12" r="3" />
              </svg>
            </button>
          </span>
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
  getPendingSuperAdminChallengeToken,
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
const showPassword = ref(false);
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
      error.value = "Invalid email or password.";
      showToast("Verification failed", "Invalid email or password.");
    } else if (message === "Access denied.") {
      error.value = "This account does not have super admin access.";
      showToast("Access denied", "This account does not have super admin access.");
    } else {
      error.value = "Unable to sign in. Please try again.";
      showToast("Verification failed", "Unable to sign in. Please try again.");
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
    const userMessage = message.toLowerCase().includes("verify") || message.toLowerCase().includes("code")
      ? "Invalid or expired verification code."
      : "Unable to verify code. Please try again.";
    error.value = userMessage;
    showToast("Verification failed", userMessage);
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
    error.value = "Unable to resend the verification code right now. Please try again.";
    showToast("Resend failed", "Unable to resend the verification code right now. Please try again.");
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
  const pendingChallengeToken = getPendingSuperAdminChallengeToken();
  if (
    (pendingEmail && pendingChallengeToken) ||
    (auth.isAuthenticated && auth.role === "super_admin" && !auth.hasSecondaryAuth)
  ) {
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
  --super-auth-page-bg: #101010;
  --super-auth-panel-bg: #151515;
  --super-auth-text: #f3f3f0;
  --super-auth-muted: #a7a7a0;
  --super-auth-border: #2f2f2c;
  --super-auth-input-bg: #101010;
  --super-auth-button-bg: #f3f3f0;
  --super-auth-button-text: #101010;
  --super-auth-button-border: #f3f3f0;
  min-height: 100vh;
  min-height: 100dvh;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 2rem;
  overflow-y: auto;
  background: var(--super-auth-page-bg);
  color: var(--super-auth-text);
}

.super-auth-shell.theme-light {
  --super-auth-page-bg: #f7f7f5;
  --super-auth-panel-bg: #ffffff;
  --super-auth-text: #171717;
  --super-auth-muted: #5f6368;
  --super-auth-border: #d8d8d3;
  --super-auth-input-bg: #ffffff;
  --super-auth-button-bg: #171717;
  --super-auth-button-text: #ffffff;
  --super-auth-button-border: #171717;
}

.super-auth-panel {
  width: min(100%, 34rem);
  padding: 1.8rem 1.9rem 2rem;
  border-radius: 24px;
  border: 1px solid var(--super-auth-border);
  background: var(--super-auth-panel-bg);
}

.super-auth-kicker {
  margin: 0 0 0.8rem;
  font-size: 0.82rem;
  letter-spacing: 0.14em;
  text-transform: uppercase;
  color: var(--super-auth-muted);
}

.super-auth-copy h1 {
  margin: 0;
  color: var(--super-auth-text);
}

.super-auth-subtitle {
  margin: 1rem 0 1.8rem;
  color: var(--super-auth-muted);
}

.super-auth-form input {
  min-height: 3.6rem;
  border-radius: 999px;
  border-color: var(--super-auth-border);
  background: var(--super-auth-input-bg);
  color: var(--super-auth-text);
}

.super-auth-form :deep(label) {
  color: var(--super-auth-text);
}

.super-auth-form .button-primary {
  border-color: var(--super-auth-button-border);
  background: var(--super-auth-button-bg);
  color: var(--super-auth-button-text);
}

.super-password-field {
  position: relative;
}

.super-password-input-wrap {
  position: relative;
  display: block;
}

.super-password-field input {
  padding-right: 4.25rem;
}

.super-password-visibility-toggle {
  position: absolute;
  top: 50%;
  right: 1rem;
  transform: translateY(-50%);
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 1.5rem;
  height: 1.5rem;
  padding: 0;
  border: 0;
  background: transparent;
  color: color-mix(in srgb, var(--super-auth-muted) 82%, var(--super-auth-text) 18%);
  cursor: pointer;
}

.super-password-visibility-toggle:hover {
  color: var(--super-auth-text);
  transform: translateY(-50%);
}

.super-password-visibility-toggle:focus-visible {
  outline: 2px solid var(--accent);
  outline-offset: 2px;
  border-radius: 999px;
}

.super-password-visibility-toggle svg {
  width: 1.1rem;
  height: 1.1rem;
  stroke: currentColor;
  stroke-width: 1.8;
  fill: none;
  stroke-linecap: round;
  stroke-linejoin: round;
}

.super-password-help-link {
  position: absolute;
  right: 0;
  top: calc(100% + 0.45rem);
  font-size: 0.82rem;
  color: var(--super-auth-muted);
  text-decoration: none;
}

.super-password-help-link:hover {
  color: var(--super-auth-text);
  text-decoration: underline;
}

.super-password-field + label {
  margin-top: 1.6rem;
}

.verification-copy {
  margin: 0 0 1rem;
  color: var(--super-auth-muted);
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
