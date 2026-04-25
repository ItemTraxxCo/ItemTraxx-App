<template>
  <div class="admin-login-shell" :class="`theme-${themeMode}`">
    <RouterLink class="admin-auth-logo-link" to="/" aria-label="ItemTraxx home">
      <img v-if="brandLogoUrl" class="admin-auth-logo" :src="brandLogoUrl" alt="ItemTraxx Co" />
      <span v-else>ItemTraxx</span>
    </RouterLink>
    <section class="admin-login-panel">
      <div class="admin-login-content">
        <div class="admin-login-copy">
          <RouterLink class="admin-login-back" to="/tenant/checkout" aria-label="Back to checkout">
            <svg viewBox="0 0 24 24" aria-hidden="true">
              <path d="M15 5 8 12l7 7" />
            </svg>
          </RouterLink>
          <p class="admin-login-kicker">Tenant Admin or District/Organization Admin Access</p>
          <h1>Admin sign in</h1>
          <p class="admin-login-subtitle">
            Use your admin email and password to sign in. This is the correct sign in page for 
            tenant-level admins and district/organization admins.
          </p>
        </div>

        <form class="form admin-login-form" @submit.prevent="handleAdminLogin">
          <label>
             
            <input v-model="email" type="email" placeholder="Enter email" />
          </label>
          <label class="admin-password-field">
             
            <span class="admin-password-input-wrap">
              <input
                v-model="password"
                :type="showPassword ? 'text' : 'password'"
                placeholder="Enter password"
              />
              <button
                type="button"
                class="admin-password-visibility-toggle"
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
              class="link-button admin-password-help-link"
              :to="{ path: '/forgot-password', query: { email: email.trim(), from: 'admin-login' } }"
            >
              Forgot password?
            </RouterLink>
          </label>
          <label v-if="turnstileSiteKey" class="admin-security-check">
            
            <div :ref="setTurnstileContainerRef"></div>
            <p class="muted turnstile-help">Complete security check to enable sign in. If you do not see the security check please reload the page and try again.</p>
          </label>
          <div class="form-actions">
            <button
              type="submit"
              class="button-primary admin-login-submit"
              :disabled="!canSubmit || isLoading"
            >
              Sign in
            </button>
          </div>
        </form>
        <p v-if="error" class="error admin-login-error">{{ error }}</p>
      </div>
    </section>

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
import { computed, onMounted, onUnmounted, ref } from "vue";
import { RouterLink } from "vue-router";
import {
  createDistrictAdminSessionHandoff,
} from "../../../services/authService";
import { logAdminAction } from "../../../services/auditLogService";
import { useTurnstile } from "../../../composables/useTurnstile";
import { clearAdminVerification } from "../../../store/authState";
import { buildDistrictAppHandoffUrl } from "../../../services/districtService";
import { capturePostHogEvent, identifyPostHogUser } from "../../../services/posthogService";

const themeMode = ref<"light" | "dark">("dark");
const lightBrandLogoUrl = import.meta.env.VITE_BRAND_LOGO_LIGHT_URL as string | undefined;
const darkBrandLogoUrl = import.meta.env.VITE_BRAND_LOGO_DARK_URL as string | undefined;
const email = ref("");
const password = ref("");
const showPassword = ref(false);
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
let themeObserver: MutationObserver | null = null;

const brandLogoUrl = computed(() =>
  themeMode.value === "light"
    ? lightBrandLogoUrl || darkBrandLogoUrl || ""
    : darkBrandLogoUrl || lightBrandLogoUrl || ""
);

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
    const handoff = await createDistrictAdminSessionHandoff(
      email.value.trim(),
      password.value,
      turnstileToken.value ?? ""
    );
    if (!handoff.tokenHash) {
      throw new Error("Unable to prepare district sign-in.");
    }
    if (handoff.role === "tenant_admin" && !handoff.districtSlug) {
      devLog("auth_request_success_local_tenant_admin");
      identifyPostHogUser(email.value.trim(), { role: handoff.role });
      capturePostHogEvent("admin_login_succeeded", { role: handoff.role });
      const params = new URLSearchParams({
        itx_th: handoff.tokenHash,
        itx_lm: "password",
        itx_ll: "admin_login",
      });
      window.location.replace(`/tenant/admin#${params.toString()}`);
      return;
    }
    if (!handoff.districtSlug) {
      throw new Error("Unable to prepare district sign-in.");
    }
    const targetPath =
      handoff.role === "district_admin" ? "/district" : "/tenant/admin";
    devLog("auth_request_success");
    identifyPostHogUser(email.value.trim(), { role: handoff.role });
    capturePostHogEvent("admin_login_succeeded", { role: handoff.role });
    window.location.replace(
      buildDistrictAppHandoffUrl(handoff.districtSlug, targetPath, {
        tokenHash: handoff.tokenHash,
        loginMethod: "password",
        loginLocation: "admin_login",
      })
    );
    void logAdminAction({
      action_type: "admin_login",
      metadata: { email: email.value.trim() },
    }).catch(() => {
      // Audit logging is best-effort and should not block admin sign in.
    });
  } catch (err) {
    devLog("auth_request_failed");
    const message = err instanceof Error ? err.message : "Sign in failed.";
    capturePostHogEvent("admin_login_failed", { error_type: message });
    if (message === "Invalid credentials.") {
      error.value = "Invalid email or password.";
      showToast("Sign in failed", "Invalid email or password.");
    } else if (message === "Tenant disabled.") {
      error.value = "This account cannot sign in right now. Please contact support.";
      showToast("Access blocked", "This account cannot sign in right now. Please contact support.");
    } else if (message === "Access denied.") {
      error.value = "This account does not have admin access.";
      showToast("Access denied", "This account does not have admin access.");
    } else if (message === "No district assignment.") {
      error.value = "This admin account is not assigned to a district yet.";
      showToast("Not assigned", "This admin account is not assigned to a district yet.");
    } else if (message === "Unable to prepare district sign-in." || message === "Unable to complete district sign-in.") {
      error.value = "Unable to finish sign in. Please try again.";
      showToast("Sign in failed", "Unable to finish sign in. Please try again.");
    } else if (message === "Admin verification required.") {
      error.value = "Admin verification failed. Sign in again.";
      showToast("Admin verification required", "Please sign in again to continue.");
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
  const syncTheme = () => {
    themeMode.value =
      document.documentElement.getAttribute("data-theme") === "light"
        ? "light"
        : "dark";
  };
  syncTheme();
  themeObserver = new MutationObserver(syncTheme);
  themeObserver.observe(document.documentElement, {
    attributes: true,
    attributeFilter: ["data-theme"],
  });
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
.admin-login-shell {
  --admin-login-page-bg: #101010;
  --admin-login-panel-bg: #151515;
  --admin-login-heading: #f3f3f0;
  --admin-login-copy: #a7a7a0;
  --admin-login-label: #f3f3f0;
  --admin-login-input-bg: #101010;
  --admin-login-input-border: #2f2f2c;
  --admin-login-input-text: #f3f3f0;
  --admin-login-input-placeholder: #777770;
  --admin-login-kicker: #a7a7a0;
  --admin-login-back-bg: #20201d;
  --admin-login-back-text: #f3f3f0;
  --admin-login-primary-bg: #f3f3f0;
  --admin-login-primary-text: #101010;
  --admin-login-primary-border: #f3f3f0;
  min-height: 100vh;
  min-height: 100dvh;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 2rem;
  overflow-y: auto;
  background: var(--admin-login-page-bg);
}

.admin-login-shell.theme-light {
  --admin-login-page-bg: #f7f7f5;
  --admin-login-panel-bg: #ffffff;
  --admin-login-heading: #171717;
  --admin-login-copy: #5f6368;
  --admin-login-label: #171717;
  --admin-login-input-bg: #ffffff;
  --admin-login-input-border: #d8d8d3;
  --admin-login-input-text: #171717;
  --admin-login-input-placeholder: #777770;
  --admin-login-kicker: #6f736f;
  --admin-login-back-bg: #f1f1ee;
  --admin-login-back-text: #171717;
  --admin-login-primary-bg: #171717;
  --admin-login-primary-text: #ffffff;
  --admin-login-primary-border: #171717;
}

.admin-login-panel {
  width: min(100%, 54rem);
  min-height: min(42rem, calc(100dvh - 4rem));
  display: grid;
  grid-template-rows: auto 1fr;
  padding: 1.8rem 1.9rem 2rem;
  border: 0;
  background: transparent;
}

.admin-auth-logo-link {
  display: inline-flex;
  left: max(24px, env(safe-area-inset-left, 0px));
  position: absolute;
  text-decoration: none;
  top: max(24px, env(safe-area-inset-top, 0px));
  z-index: 1;
}

.admin-auth-logo {
  display: block;
  height: 72px;
  object-fit: contain;
  width: auto;
}

.admin-auth-logo-link span {
  font-family: Helvetica, "Helvetica Neue", Arial, sans-serif;
  font-size: 2rem;
  font-weight: 700;
  letter-spacing: -0.05em;
  color: var(--admin-login-heading);
}

.admin-login-back {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 2.3rem;
  height: 2.3rem;
  margin-bottom: 1rem;
  padding: 0;
  border-radius: 999px;
  background: transparent;
  color: var(--admin-login-back-text);
  text-decoration: none;
  font-weight: 500;
  transition: transform 0.16s ease, background-color 0.16s ease, color 0.16s ease;
}

.admin-login-back:hover {
  text-decoration: none;
  transform: translateY(-1px);
  background: var(--admin-login-back-bg);
  color: var(--admin-login-heading);
}

.admin-login-back svg {
  width: 1.35rem;
  height: 1.35rem;
  fill: none;
  stroke: currentColor;
  stroke-width: 1.9;
  stroke-linecap: round;
  stroke-linejoin: round;
}

.admin-login-content {
  width: min(100%, 34rem);
  margin: 0 auto;
  align-self: center;
}

.admin-login-kicker {
  margin: 0 0 0.85rem;
  font-size: 0.82rem;
  letter-spacing: 0.14em;
  text-transform: uppercase;
  color: var(--admin-login-kicker);
}

.admin-login-copy h1 {
  margin: 0;
  font-size: clamp(2.6rem, 5vw, 4rem);
  line-height: 1;
  letter-spacing: -0.06em;
  color: var(--admin-login-heading);
}

.admin-login-subtitle {
  margin: 1rem 0 2rem;
  color: var(--admin-login-copy);
  font-size: 1rem;
}

.admin-login-form :deep(label) {
  color: var(--admin-login-label);
}

.admin-login-form input {
  box-sizing: border-box;
  min-height: 4rem;
  border-radius: 999px;
  border: 1px solid var(--admin-login-input-border);
  background: var(--admin-login-input-bg);
  color: var(--admin-login-input-text);
  padding: 1rem 1.15rem;
  font-size: 1.08rem;
  line-height: 1.35;
}

.admin-login-form input::placeholder {
  color: var(--admin-login-input-placeholder);
  font-size: 1.02rem;
}

.admin-password-field {
  position: relative;
}

.admin-password-input-wrap {
  position: relative;
  display: block;
}

.admin-password-field input {
  padding-right: 4.25rem;
}

.admin-password-visibility-toggle {
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
  color: color-mix(in srgb, var(--admin-login-copy) 80%, white 20%);
  cursor: pointer;
}

.admin-password-visibility-toggle:hover {
  color: var(--admin-login-heading);
  transform: translateY(-50%);
}

.admin-password-visibility-toggle:focus-visible {
  outline: 2px solid var(--accent);
  outline-offset: 2px;
  border-radius: 999px;
}

.admin-password-visibility-toggle svg {
  width: 1.1rem;
  height: 1.1rem;
  stroke: currentColor;
  stroke-width: 1.8;
  fill: none;
  stroke-linecap: round;
  stroke-linejoin: round;
}

.admin-password-help-link {
  position: absolute;
  right: 0;
  top: calc(100% + 0.45rem);
  font-size: 0.82rem;
  color: color-mix(in srgb, var(--admin-login-copy) 84%, var(--accent) 16%);
  text-decoration: none;
}

.admin-password-help-link:hover {
  color: var(--admin-login-heading);
  text-decoration: underline;
}

.admin-security-check {
  display: block;
  margin-top: 1.6rem;
}

.admin-login-submit {
  width: 100%;
  min-height: 3.7rem;
  margin-top: 0.4rem;
  border-radius: 999px;
  background: var(--admin-login-primary-bg);
  border-color: var(--admin-login-primary-border);
  color: var(--admin-login-primary-text);
}

.admin-login-submit:disabled {
  opacity: 0.48;
  cursor: not-allowed;
}

.admin-login-submit:hover:not(:disabled) {
  transform: translateY(-1px);
}

.admin-login-error {
  margin-top: 1rem;
}

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

@media (max-width: 640px) {
  .admin-login-shell {
    padding: 1rem;
  }

  .admin-login-panel {
    min-height: calc(100vh - 2rem);
    padding: 1.25rem 0;
  }

  .admin-login-topbar {
    justify-content: flex-end;
  }

  .admin-auth-logo {
    height: 54px;
  }
}
</style>
