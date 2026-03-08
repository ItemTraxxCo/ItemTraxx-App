<template>
  <div class="admin-login-shell" :class="`theme-${themeMode}`">
    <section class="admin-login-panel">
      <div class="admin-login-topbar">
        <div class="admin-login-brand">ItemTraxx</div>
        <RouterLink class="admin-login-back" to="/tenant/checkout">Back to checkout</RouterLink>
      </div>

      <div class="admin-login-content">
        <div class="admin-login-copy">
          <p class="admin-login-kicker">User Admin Access</p>
          <h1>Admin sign in</h1>
          <p class="admin-login-subtitle">
            Use your admin email and password to manage students, gear, logs, and your user settings.
          </p>
        </div>

        <form class="form admin-login-form" @submit.prevent="handleAdminLogin">
          <label>
             
            <input v-model="email" type="email" placeholder="Enter email" />
          </label>
          <label>
             
            <input v-model="password" type="password" placeholder="Enter password" />
          </label>
          <label v-if="turnstileSiteKey" class="admin-security-check">
            Security Check
            <div :ref="setTurnstileContainerRef"></div>
            <p class="muted turnstile-help">Complete security check to enable sign in.</p>
          </label>
          <div class="form-actions">
            <button type="submit" class="button-primary admin-login-submit" :disabled="!canSubmit">
              Sign in
            </button>
          </div>
        </form>
        <p v-if="error" class="error admin-login-error">{{ error }}</p>
      </div>
    </section>

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
  adminLogin,
  createDistrictAdminSessionHandoff,
} from "../../../services/authService";
import { touchTenantAdminSession } from "../../../services/adminOpsService";
import { logAdminAction } from "../../../services/auditLogService";
import { useTurnstile } from "../../../composables/useTurnstile";
import { clearAdminVerification } from "../../../store/authState";
import { buildDistrictAppHandoffUrl } from "../../../services/districtService";
import { getDistrictState } from "../../../store/districtState";

const router = useRouter();
const districtHost = getDistrictState();
const themeMode = ref<"light" | "dark">("dark");
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
let themeObserver: MutationObserver | null = null;

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
    if (!districtHost.isDistrictHost) {
      try {
        const handoff = await createDistrictAdminSessionHandoff(
          email.value.trim(),
          password.value
        );
        if (!handoff.rootOnly && handoff.code && handoff.districtSlug) {
          const targetPath =
            handoff.role === "district_admin" ? "/district" : "/tenant/admin";
          window.location.assign(
            buildDistrictAppHandoffUrl(handoff.districtSlug, targetPath, handoff.code)
          );
          return;
        }
      } catch (handoffError) {
        const handoffMessage =
          handoffError instanceof Error ? handoffError.message : "";
        if (handoffMessage !== "No district assignment.") {
          throw handoffError;
        }
      }
    }
    const session = await adminLogin(email.value.trim(), password.value);
    devLog("auth_request_success");
    await router.push(session?.role === "district_admin" ? "/district" : "/tenant/admin");
    void logAdminAction({
      action_type: "admin_login",
      metadata: { email: email.value.trim() },
    }).catch(() => {
      // Audit logging is best-effort and should not block admin sign in.
    });
    void touchTenantAdminSession().catch(() => {
      // Session controls are best-effort and should not block access.
    });
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
    } else if (message === "No district assignment.") {
      error.value = "This admin account is not assigned to a district.";
      showToast("No district assigned", "This admin account is not assigned to a district.");
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
  --admin-login-page-bg:
    radial-gradient(circle at top, rgba(25, 194, 168, 0.16), transparent 34%),
    radial-gradient(circle at bottom right, rgba(25, 67, 155, 0.18), transparent 38%),
    linear-gradient(180deg, #11151c 0%, #090c12 100%);
  --admin-login-panel-bg:
    radial-gradient(circle at top right, rgba(25, 194, 168, 0.14), transparent 28%),
    linear-gradient(180deg, #161b23 0%, #0d1117 100%);
  --admin-login-heading: #f6f5fa;
  --admin-login-copy: rgba(213, 222, 232, 0.68);
  --admin-login-label: #efedf7;
  --admin-login-input-bg: rgba(28, 34, 43, 0.92);
  --admin-login-input-border: rgba(70, 84, 101, 0.42);
  --admin-login-input-text: #fcfbff;
  --admin-login-input-placeholder: rgba(188, 198, 210, 0.48);
  --admin-login-kicker: rgba(214, 237, 233, 0.72);
  --admin-login-back-bg: rgba(255, 255, 255, 0.08);
  --admin-login-back-text: #f8f7ff;
  min-height: 100vh;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 2rem;
  background: var(--admin-login-page-bg);
}

.admin-login-shell.theme-light {
  --admin-login-page-bg:
    radial-gradient(circle at top, rgba(25, 194, 168, 0.16), transparent 30%),
    radial-gradient(circle at bottom right, rgba(25, 67, 155, 0.14), transparent 34%),
    linear-gradient(180deg, #eef5f8 0%, #dde7ee 100%);
  --admin-login-panel-bg:
    radial-gradient(circle at top right, rgba(25, 194, 168, 0.12), transparent 24%),
    linear-gradient(180deg, #fbfdff 0%, #edf3f7 100%);
  --admin-login-heading: #111827;
  --admin-login-copy: rgba(17, 24, 39, 0.7);
  --admin-login-label: #1f2937;
  --admin-login-input-bg: rgba(255, 255, 255, 0.95);
  --admin-login-input-border: rgba(148, 163, 184, 0.34);
  --admin-login-input-text: #111827;
  --admin-login-input-placeholder: rgba(71, 85, 105, 0.56);
  --admin-login-kicker: rgba(30, 41, 59, 0.64);
  --admin-login-back-bg: rgba(15, 23, 42, 0.08);
  --admin-login-back-text: #0f172a;
}

.admin-login-panel {
  width: min(100%, 54rem);
  min-height: min(42rem, calc(100vh - 4rem));
  display: grid;
  grid-template-rows: auto 1fr;
  padding: 1.8rem 1.9rem 2rem;
  border-radius: 24px;
  border: 1px solid color-mix(in srgb, var(--border) 72%, var(--accent) 28%);
  background: var(--admin-login-panel-bg);
  box-shadow: 0 24px 48px rgba(0, 0, 0, 0.18);
}

.admin-login-topbar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 1rem;
}

.admin-login-brand {
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
  padding: 0.65rem 1rem;
  border-radius: 999px;
  background: var(--admin-login-back-bg);
  color: var(--admin-login-back-text);
  text-decoration: none;
  font-weight: 500;
  transition: transform 0.16s ease, background-color 0.16s ease, box-shadow 0.16s ease;
}

.admin-login-back:hover {
  text-decoration: none;
  transform: translateY(-1px);
  background: color-mix(in srgb, var(--admin-login-back-bg) 70%, var(--accent) 30%);
  box-shadow: 0 10px 20px rgba(25, 194, 168, 0.14);
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
  border-radius: 14px;
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

.admin-security-check {
  display: block;
  margin-top: 0.6rem;
}

.admin-login-submit {
  width: 100%;
  min-height: 3.7rem;
  margin-top: 0.4rem;
  border-radius: 12px;
  background-image: linear-gradient(90deg, #19c2a8 0%, #19439b 100%);
  background-repeat: no-repeat;
  background-size: 100% 100%;
  background-origin: border-box;
  border-color: transparent;
  color: #f8fbff;
  box-shadow: 0 16px 28px rgba(25, 67, 155, 0.24);
}

.admin-login-submit:hover:not(:disabled) {
  background-image: linear-gradient(90deg, #22ccb1 0%, #2357bf 100%);
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

@media (max-width: 640px) {
  .admin-login-shell {
    padding: 1rem;
  }

  .admin-login-panel {
    min-height: calc(100vh - 2rem);
    padding: 1.25rem;
    border-radius: 18px;
  }

  .admin-login-topbar {
    flex-direction: column;
    align-items: flex-start;
  }
}
</style>
