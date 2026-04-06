<template>
  <div class="internal-auth-shell" :class="`theme-${themeMode}`">
    <div class="internal-auth-panel">
      <div class="internal-auth-copy">
        <p class="internal-auth-kicker">Internal Console</p>
        <h1>{{ isCodeStep ? 'Email Verification' : 'ItemTraxx Internal Access' }}</h1>
        <p class="internal-auth-subtitle">
          <template v-if="isCodeStep">
            Check your email for a 6-digit verification code to continue into internal operations.
          </template>
          <template v-else>
            Sign in with your existing super admin account to access internal operations.
          </template>
        </p>
      </div>

      <form v-if="!isCodeStep" class="form internal-auth-form" @submit.prevent="handleCredentialSubmit">
        <label>
          Email
          <input v-model="email" type="email" placeholder="Enter email" autocomplete="username" />
        </label>
        <label class="internal-password-field">
          Password
          <span class="internal-password-input-wrap">
            <input
              v-model="password"
              :type="showPassword ? 'text' : 'password'"
              placeholder="Enter password"
              autocomplete="current-password"
            />
            <button
              type="button"
              class="internal-password-visibility-toggle"
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
        </label>
        <label v-if="turnstileSiteKey">
          Security Check
          <div :ref="setTurnstileContainerRef"></div>
          <p class="muted turnstile-help">Complete security check to continue.</p>
        </label>
        <div class="form-actions">
          <button type="submit" class="button-primary" :disabled="!canSubmitCredentials">
            Send Verification Code
          </button>
        </div>
      </form>

      <form v-else class="form internal-auth-form" @submit.prevent="handleCodeSubmit">
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
import { useRouter } from "vue-router";
import {
  clearPendingSuperAdminVerificationEmail,
  getPendingSuperAdminVerificationEmail,
  resendSuperAdminEmailChallenge,
  signOut,
  superAdminLogin,
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

let toastTimer: number | null = null;
let themeObserver: MutationObserver | null = null;

const canSubmitCredentials = computed(() => {
  if (isLoading.value) return false;
  if (!email.value.trim() || !password.value.trim()) return false;
  if (turnstileSiteKey && !turnstileToken.value) return false;
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
    showToast("Sign-in blocked", "Enter email and password to continue.");
    return;
  }
  if (turnstileSiteKey && !turnstileToken.value) {
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
      showToast("Sign in failed", "Invalid email or password.");
    } else if (message === "Access denied.") {
      error.value = "This account does not have internal access.";
      showToast("Access denied", "This account does not have internal access.");
    } else {
      error.value = "Unable to sign in. Please try again.";
      showToast("Sign in failed", "Unable to sign in. Please try again.");
    }
  } finally {
    isLoading.value = false;
    if (turnstileSiteKey) {
      try {
        resetTurnstile();
      } catch (turnstileError) {
        console.error("Failed to reset internal auth Turnstile widget:", turnstileError);
      }
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
    await router.push("/internal");
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
    themeMode.value =
      document.documentElement.getAttribute("data-theme") === "light" ? "light" : "dark";
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
.internal-auth-shell {
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

.internal-auth-shell.theme-light {
  background:
    radial-gradient(circle at top, rgba(25, 194, 168, 0.16), transparent 30%),
    radial-gradient(circle at bottom right, rgba(25, 67, 155, 0.14), transparent 34%),
    linear-gradient(180deg, #eef5f8 0%, #dde7ee 100%);
}

.internal-auth-panel {
  width: min(100%, 34rem);
  padding: 1.8rem 1.9rem 2rem;
  border-radius: 24px;
  border: 1px solid color-mix(in srgb, var(--border) 72%, var(--accent) 28%);
  background:
    radial-gradient(circle at top right, color-mix(in srgb, var(--accent) 10%, transparent 90%), transparent 28%),
    linear-gradient(180deg, color-mix(in srgb, var(--surface) 94%, transparent 6%) 0%, color-mix(in srgb, var(--surface-2) 92%, transparent 8%) 100%);
  box-shadow: 0 24px 48px rgba(0, 0, 0, 0.18);
}

.internal-auth-kicker {
  margin: 0 0 0.8rem;
  font-size: 0.82rem;
  letter-spacing: 0.14em;
  text-transform: uppercase;
  color: var(--muted);
}

.internal-auth-copy h1 {
  margin: 0;
}

.internal-auth-subtitle {
  margin: 1rem 0 1.8rem;
  color: var(--muted);
}

.internal-auth-form input {
  min-height: 3.6rem;
}

.internal-password-field {
  position: relative;
}

.internal-password-input-wrap {
  position: relative;
  display: block;
}

.internal-password-field input {
  padding-right: 4.25rem;
}

.internal-password-visibility-toggle {
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
  color: color-mix(in srgb, var(--muted) 82%, var(--text) 18%);
  cursor: pointer;
}

.internal-password-visibility-toggle:hover {
  color: var(--text);
  transform: translateY(-50%);
}

.internal-password-visibility-toggle:focus-visible {
  outline: 2px solid var(--accent);
  outline-offset: 2px;
  border-radius: 999px;
}

.internal-password-visibility-toggle svg {
  width: 1.1rem;
  height: 1.1rem;
  stroke: currentColor;
  stroke-width: 1.8;
  fill: none;
  stroke-linecap: round;
  stroke-linejoin: round;
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
</style>
