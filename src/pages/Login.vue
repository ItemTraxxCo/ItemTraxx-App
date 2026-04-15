<template>
  <div class="login-page-shell" :class="`theme-${themeMode}`">
    <div class="login-split-panel">
      <section class="login-story-panel">
        <header class="story-header">
          <img
            class="story-brand-logo"
            :src="brandLogoUrl"
            alt="ItemTraxx Co"
          />
          <RouterLink class="story-back-link" to="/">Back</RouterLink>
        </header>

        <div class="story-copy-wrap">
          <transition name="story-fade" mode="out-in">
            <article :key="activeStoryIndex" class="story-copy-card">
              <p class="story-kicker">{{ storySlides[activeStoryIndex].kicker }}</p>
              <h2>{{ storySlides[activeStoryIndex].title }}</h2>
              <p class="story-body">{{ storySlides[activeStoryIndex].body }}</p>
            </article>
          </transition>
        </div>

        <div class="story-indicators" aria-label="Login highlights">
          <span
            v-for="(_, index) in storySlides"
            :key="index"
            class="story-indicator"
            :class="{ active: index === activeStoryIndex }"
          ></span>
        </div>
      </section>

      <section class="login-form-panel">
        <div class="login-form-wrap">
          <img
            v-if="brandLogoUrl"
            class="compact-brand-logo"
            :src="brandLogoUrl"
            alt="ItemTraxx Co"
          />
          <RouterLink class="story-back-link compact-back-link" to="/">Back</RouterLink>
          <h1>Sign in</h1>
          <p class="login-panel-copy">Use your ItemTraxx access code and password to enter your ItemTraxx app.</p>

          <form class="form login-form" @submit.prevent="handleTenantLogin">
            <label>
               
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

            <label class="password-field">
               
              <span class="password-input-wrap">
                <input
                  v-model="password"
                  :type="showPassword ? 'text' : 'password'"
                  placeholder="Enter password"
                />
                <button
                  type="button"
                  class="password-visibility-toggle"
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
              <RouterLink class="link-button password-help-link" to="/forgot-password">
                Forgot password?
              </RouterLink>
            </label>

            <label v-if="turnstileSiteKey" class="security-check-field">
              Security Check
              <div :ref="setTurnstileContainerRef"></div>
            </label>

            <div class="form-actions">
              <button
                type="submit"
                class="button-primary login-submit-button"
                :disabled="!canSubmit || isLoading"
              >
                Sign in
              </button>
            </div>

            <p class="admin-login-note">
              Admin? <RouterLink to="/tenant/admin-login">Go to admin sign in</RouterLink>
            </p>

            <p class="muted support-note">
              Trouble signing in? Contact our support team from the top-right menu for help.
              <br />
              By using this software, you agree to our
              <a :href="legalUrl" target="_blank" rel="noreferrer">legal terms and policies</a>.
            </p>
          </form>

          <p v-if="error" class="error">{{ error }}</p>
        </div>
      </section>
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
import { computed, onMounted, onUnmounted, ref } from "vue";
import { RouterLink, useRouter } from "vue-router";
import { createDistrictSessionHandoff, tenantLogin } from "../services/authService";
import { useTurnstile } from "../composables/useTurnstile";
import { buildDistrictAppHandoffUrl } from "../services/districtService";
import { getDistrictState } from "../store/districtState";
import { getAuthState } from "../store/authState";
import { capturePostHogEvent, identifyPostHogUser } from "../services/posthogService";

const router = useRouter();
const district = getDistrictState();
const accessCode = ref("");
const password = ref("");
const showPassword = ref(false);
const error = ref("");
const isLoading = ref(false);
const toastTitle = ref("");
const toastMessage = ref("");
const lightBrandLogoUrl = import.meta.env.VITE_BRAND_LOGO_LIGHT_URL as string | undefined;
const darkBrandLogoUrl = import.meta.env.VITE_BRAND_LOGO_DARK_URL as string | undefined;
const legalUrl =
  import.meta.env.VITE_LEGAL_URL ||
  "https://www.itemtraxx.com/legal";
const storySlides = [
  {
    kicker: "Streamlined checkouts",
    title: "Track equipment without the spreadsheet scramble.",
    body: "Fast and secure sign-ins, clear checkout history, and secure routing that optimizes your inventory tracking."
  },
  {
    kicker: "Admin Controls",
    title: "Keep user activity, gear, status, and more all in one place.",
    body: "ItemTraxx keeps returns, audits, and issue workflows organized without making admins fight the interface."
  },
  {
    kicker: "Built for anyone",
    title: "Seamlessly track your inventory regardless of team size.",
    body: "From administrative overview to daily checkouts, every flow stays scoped to your user, fully secure."
  },
  {
    kicker: "Designed for simplicity",
    title: "Manage items without complicated systems.",
    body: "Quick checkouts, clear logs, and simple dashboards help your team stay organized without slowing anyone down."
  },
  {
    kicker: "Support you can actually count on",
    title: "Our team is here to help whenever you need us.",
    body: "Whether you have a question about setup, need help with a workflow, or just want to share feedback, we're always ready to chat."
  },
  {
    kicker: "Made for busy teams",
    title: "Handle daily checkouts in seconds.",
    body: "Fast workflows keep lines moving while still recording every transaction and user."
  },
  {
    kicker: "Secure and reliable",
    title: "Your data is safe with us.",
    body: "We use industry best practices to keep your data secure, and we're always here to help if you need us."
  },
  {kicker: "Operational clarity",
  title: "Every checkout tracked. Every return recorded.",
  body: "Detailed logs give administrators full insight into inventory activity."
},
] as const;
const activeStoryIndex = ref(0);
const themeMode = ref<"light" | "dark">("dark");
const brandLogoUrl = computed(() =>
  themeMode.value === "light"
    ? lightBrandLogoUrl || darkBrandLogoUrl || ""
    : darkBrandLogoUrl || lightBrandLogoUrl || ""
);
const turnstileSiteKey = import.meta.env.VITE_TURNSTILE_SITE_KEY as
  | string
  | undefined;
const {
  containerRef: turnstileContainerRef,
  token: turnstileToken,
  reset: resetTurnstile,
} = useTurnstile(turnstileSiteKey);
const canSubmit = computed(() => {
  const hasAccessCode = accessCode.value.trim().length > 0;
  const hasPassword = password.value.length > 0;
  const hasTurnstile = !turnstileSiteKey || Boolean(turnstileToken.value);
  return hasAccessCode && hasPassword && hasTurnstile;
});
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
let storyTimer: number | null = null;
let themeObserver: MutationObserver | null = null;

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

const getTenantSignInErrorMessage = (message: string) => {
  const normalized = message.trim().toLowerCase();
  if (
    normalized.includes("invalid tenant access code") ||
    normalized.includes("invalid access code") ||
    normalized.includes("invalid credentials") ||
    normalized.includes("invalid password") ||
    normalized === "unauthorized"
  ) {
    return "Invalid access code or password.";
  }
  if (normalized.includes("timed out")) {
    return "Sign in timed out. Please try again.";
  }
  return null;
};

const handleTenantLogin = async () => {
  error.value = "";
  isLoading.value = true;
  try {
    if (turnstileSiteKey && !turnstileToken.value) {
      error.value = "Complete the security check and try again.";
      return;
    }
    const session = await tenantLogin(
      accessCode.value.trim(),
      password.value,
      turnstileToken.value || undefined
    );
    const auth = getAuthState();
    if (auth.userId) {
      identifyPostHogUser(auth.userId, { email: auth.email ?? undefined, role: auth.role ?? undefined });
    }
    capturePostHogEvent("tenant_login_succeeded", { login_method: "password" });
    if (!district.isDistrictHost && session?.districtSlug) {
      const handoffCode = await createDistrictSessionHandoff(session.districtSlug);
      window.location.replace(
        buildDistrictAppHandoffUrl(
          session.districtSlug,
          "/tenant/checkout",
          {
            tokenHash: handoffCode.tokenHash,
            loginMethod: "password",
            loginLocation: "regular_login",
          }
        )
      );
      return;
    }
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
      showToast("Access blocked", "This account cannot sign in right now. Please contact support.");
      return;
    }
    if (err instanceof Error && err.message === "MAINTENANCE_MODE") {
      error.value = "";
      showToast("Maintenance mode", "Sign in is temporarily unavailable. Please try again later.");
      return;
    }
    const errorMessage = err instanceof Error ? err.message : "Sign in failed.";
    if (errorMessage === "Admin verification required.") {
      error.value = "";
      showToast("Admin verification required", "Please sign in again to continue.");
      return;
    }
    const signInErrorMessage = getTenantSignInErrorMessage(errorMessage);
    if (signInErrorMessage) {
      error.value = "";
      showToast("Sign in failed.", signInErrorMessage);
      capturePostHogEvent("tenant_login_failed", { error_type: errorMessage });
      return;
    }
    capturePostHogEvent("tenant_login_failed", { error_type: errorMessage });
    error.value = errorMessage;
  } finally {
    isLoading.value = false;
    if (turnstileSiteKey) {
      try {
        resetTurnstile();
      } catch (turnstileError) {
        console.error("Please reload the page. Failed to reset Turnstile widget:", turnstileError);
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
  if (storyTimer) {
    window.clearInterval(storyTimer);
    storyTimer = null;
  }
  if (themeObserver) {
    themeObserver.disconnect();
    themeObserver = null;
  }
});

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
  cancelIdlePrefetch = scheduleIdle(prefetchTenantRoutes, 1000);
  prefetchTimer = window.setTimeout(() => {
    prefetchTenantRoutes();
  }, 2500);
  storyTimer = window.setInterval(() => {
    activeStoryIndex.value = (activeStoryIndex.value + 1) % storySlides.length;
  }, 4200);
});
</script>

<style scoped>
.login-page-shell {
  --login-page-bg:
    radial-gradient(circle at top, rgba(25, 194, 168, 0.16), transparent 34%),
    radial-gradient(circle at bottom right, rgba(25, 67, 155, 0.18), transparent 38%),
    linear-gradient(180deg, #11151c 0%, #090c12 100%);
  --login-story-bg:
    radial-gradient(circle at top left, rgba(25, 194, 168, 0.24), transparent 30%),
    radial-gradient(circle at bottom right, rgba(25, 67, 155, 0.28), transparent 36%),
    linear-gradient(180deg, #10161f 0%, #090d14 100%);
  --login-story-orb:
    radial-gradient(circle at 10% 25%, rgba(255, 255, 255, 0.08), transparent 26%),
    linear-gradient(160deg, rgba(25, 194, 168, 0.16), rgba(6, 9, 15, 0.92));
  --login-story-brand: #f6f7fb;
  --login-story-text: #f7f7fb;
  --login-story-kicker: rgba(214, 237, 233, 0.72);
  --login-story-body: rgba(227, 234, 242, 0.78);
  --login-back-bg: rgba(255, 255, 255, 0.08);
  --login-back-text: #f8f7ff;
  --login-form-bg: linear-gradient(180deg, #161b23 0%, #0d1117 100%);
  --login-heading: #f6f5fa;
  --login-copy: rgba(213, 222, 232, 0.68);
  --login-label: #efedf7;
  --login-input-bg: rgba(28, 34, 43, 0.92);
  --login-input-border: rgba(70, 84, 101, 0.42);
  --login-input-text: #fcfbff;
  --login-input-placeholder: rgba(188, 198, 210, 0.48);
  --login-help-link: color-mix(in srgb, var(--accent) 68%, #b9d7ff 32%);
  --login-help-link-hover: color-mix(in srgb, var(--accent) 82%, white 18%);
  --login-support: rgba(226, 223, 236, 0.68);
  --login-support-link: #d9d0ff;
  min-height: 100vh;
  min-height: 100dvh;
  width: 100%;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 0;
  overflow-y: auto;
  background: var(--login-page-bg);
}

.login-page-shell.theme-light {
  --login-page-bg:
    radial-gradient(circle at top, rgba(25, 194, 168, 0.16), transparent 30%),
    radial-gradient(circle at bottom right, rgba(25, 67, 155, 0.14), transparent 34%),
    linear-gradient(180deg, #eef5f8 0%, #dde7ee 100%);
  --login-story-bg:
    radial-gradient(circle at top left, rgba(25, 194, 168, 0.18), transparent 30%),
    radial-gradient(circle at bottom right, rgba(25, 67, 155, 0.18), transparent 32%),
    linear-gradient(180deg, #dce8ef 0%, #cfdce4 100%);
  --login-story-orb:
    radial-gradient(circle at 10% 25%, rgba(255, 255, 255, 0.18), transparent 26%),
    linear-gradient(160deg, rgba(25, 194, 168, 0.16), rgba(25, 67, 155, 0.22));
  --login-story-brand: #0e1722;
  --login-story-text: #0f172a;
  --login-story-kicker: rgba(30, 41, 59, 0.64);
  --login-story-body: rgba(15, 23, 42, 0.72);
  --login-back-bg: rgba(15, 23, 42, 0.08);
  --login-back-text: #0f172a;
  --login-form-bg: linear-gradient(180deg, #fbfdff 0%, #edf3f7 100%);
  --login-heading: #111827;
  --login-copy: rgba(17, 24, 39, 0.7);
  --login-label: #1f2937;
  --login-input-bg: rgba(255, 255, 255, 0.95);
  --login-input-border: rgba(148, 163, 184, 0.34);
  --login-input-text: #111827;
  --login-input-placeholder: rgba(71, 85, 105, 0.56);
  --login-help-link: #19439b;
  --login-help-link-hover: #12337a;
  --login-support: rgba(31, 41, 55, 0.72);
  --login-support-link: #19439b;
}

.login-page-shell.theme-light .story-indicator {
  background: rgba(15, 23, 42, 0.16);
}

.login-page-shell.theme-light .story-back-link {
  box-shadow: inset 0 0 0 1px rgba(15, 23, 42, 0.08);
}

.login-split-panel {
  width: 100%;
  min-height: 100vh;
  min-height: 100dvh;
  display: grid;
  grid-template-columns: minmax(24rem, 1.02fr) minmax(24rem, 0.9fr);
  gap: 0;
  border-radius: 0;
  overflow: visible;
  background: transparent;
  box-shadow: none;
}

.login-story-panel {
  position: relative;
  display: flex;
  flex-direction: column;
  justify-content: space-between;
  padding: 1.8rem 1.9rem 2rem;
  border-radius: 0;
  overflow: hidden;
  background: var(--login-story-bg);
}

.login-story-panel::after {
  content: "";
  position: absolute;
  inset: auto -14% -10% 12%;
  height: 58%;
  border-radius: 999px;
  background: var(--login-story-orb);
  filter: blur(2px);
  transform: rotate(-8deg);
  opacity: 0.9;
}

.story-header,
.story-copy-wrap,
.story-indicators {
  position: relative;
  z-index: 1;
}

.story-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 1rem;
}

.story-brand-logo {
  height: 3.8rem;
  width: auto;
  object-fit: contain;
  display: block;
  transform: translateY(-2px);
}

.story-back-link {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  padding: 0.65rem 1rem;
  border-radius: 999px;
  background: var(--login-back-bg);
  color: var(--login-back-text);
  text-decoration: none;
  font-weight: 500;
  transition: transform 0.16s ease, background-color 0.16s ease, box-shadow 0.16s ease;
}

.story-back-link:hover {
  text-decoration: none;
  transform: translateY(-1px);
  background: color-mix(in srgb, rgba(255, 255, 255, 0.08) 70%, var(--accent) 30%);
  box-shadow: 0 10px 20px rgba(25, 194, 168, 0.14);
}

.compact-back-link {
  display: none;
  margin: 0 0 1.1rem;
  width: fit-content;
}

.story-copy-wrap {
  flex: 1;
  display: flex;
  align-items: center;
  justify-content: center;
}

.story-copy-card {
  max-width: 29rem;
  color: var(--login-story-text);
}

.story-kicker {
  margin: 0 0 0.8rem;
  font-size: 0.82rem;
  letter-spacing: 0.14em;
  text-transform: uppercase;
  color: var(--login-story-kicker);
}

.story-copy-card h2 {
  margin: 0 0 0.95rem;
  font-size: clamp(2.6rem, 5vw, 4.25rem);
  line-height: 1.02;
  letter-spacing: -0.05em;
}

.story-body {
  margin: 0;
  max-width: 26rem;
  font-size: 1.15rem;
  line-height: 1.65;
  color: var(--login-story-body);
}

.story-indicators {
  display: flex;
  justify-content: center;
  gap: 0.7rem;
}

.story-indicator {
  width: 2.65rem;
  height: 0.28rem;
  border-radius: 999px;
  background: rgba(255, 255, 255, 0.18);
  transition: background-color 0.25s ease, transform 0.25s ease;
}

.story-indicator.active {
  background: linear-gradient(90deg, #19c2a8 0%, #19439b 100%);
  transform: scaleX(1.04);
}

.story-fade-enter-active,
.story-fade-leave-active {
  transition: opacity 0.3s ease, transform 0.3s ease;
}

.story-fade-enter-from,
.story-fade-leave-to {
  opacity: 0;
  transform: translateY(12px);
}

.login-form-panel {
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 2rem 1.75rem;
  background: var(--login-form-bg);
  border-radius: 0;
}

.login-form-wrap {
  width: min(100%, 34rem);
}

.compact-brand-logo {
  display: none;
  height: 3.2rem;
  width: auto;
  object-fit: contain;
  margin: 0 0 0.85rem;
}

.login-form-wrap h1 {
  margin: 0;
  font-size: clamp(2.6rem, 4.5vw, 4rem);
  line-height: 1;
  letter-spacing: -0.06em;
  color: var(--login-heading);
}

.login-panel-copy {
  margin: 1rem 0 2rem;
  color: var(--login-copy);
  font-size: 1rem;
}

.login-form :deep(label) {
  color: var(--login-label);
}

.login-form input {
  box-sizing: border-box;
  min-height: 4rem;
  border-radius: 14px;
  border: 1px solid var(--login-input-border);
  background: var(--login-input-bg);
  color: var(--login-input-text);
  padding: 1rem 1.15rem;
  font-size: 1.08rem;
  line-height: 1.35;
}

.login-form input::placeholder {
  color: var(--login-input-placeholder);
  font-size: 1.02rem;
}

.password-field {
  position: relative;
}

.password-input-wrap {
  position: relative;
  display: block;
}

.password-field input {
  padding-right: 4.25rem;
}

.password-visibility-toggle {
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
  color: color-mix(in srgb, var(--login-copy) 78%, white 22%);
  cursor: pointer;
}

.password-visibility-toggle:hover {
  color: var(--login-heading);
  transform: translateY(-50%);
}

.password-visibility-toggle:focus-visible {
  outline: 2px solid var(--accent);
  outline-offset: 2px;
  border-radius: 999px;
}

.password-visibility-toggle svg {
  width: 1.1rem;
  height: 1.1rem;
  stroke: currentColor;
  stroke-width: 1.8;
  fill: none;
  stroke-linecap: round;
  stroke-linejoin: round;
}

.password-help-link {
  position: absolute;
  right: 0;
  bottom: -1.65rem;
  display: inline-flex;
  color: var(--login-help-link);
  text-decoration: none;
  font-weight: 500;
}

.password-help-link:hover {
  color: var(--login-help-link-hover);
  text-decoration: underline;
}

.security-check-field {
  display: block;
  margin-top: 2.25rem;
  color: #efedf7;
}

.login-submit-button {
  width: 100%;
  min-height: 3.7rem;
  margin-top: 1rem;
  border-radius: 12px;
  background-image: linear-gradient(90deg, #19c2a8 0%, #19439b 100%);
  background-repeat: no-repeat;
  background-size: 100% 100%;
  background-origin: border-box;
  border-color: transparent;
  color: #f8fbff;
  box-shadow: 0 16px 28px rgba(25, 67, 155, 0.24);
}

.login-submit-button:disabled {
  background: #8d99b8;
  border-color: #8d99b8;
  color: rgba(248, 251, 255, 0.92);
  box-shadow: none;
  cursor: not-allowed;
}

.login-submit-button:hover:not(:disabled) {
  background-image: linear-gradient(90deg, #22ccb1 0%, #2357bf 100%);
}

.admin-login-note {
  margin: 0.15rem 0 0;
  font-size: 0.9rem;
  color: var(--login-copy);
}

.admin-login-note a {
  color: var(--login-help-link);
  font-weight: 600;
}

.admin-login-note a:hover {
  color: var(--login-help-link-hover);
}

.support-note {
  max-width: 34rem;
  font-size: 0.8rem;
  line-height: 1.55;
  margin-top: 0.95rem;
  color: var(--login-support);
}

.support-note a {
  color: var(--login-support-link);
}

@media (max-width: 980px) {
  .login-split-panel {
    grid-template-columns: 1fr;
    min-height: 100vh;
    border-radius: 0;
  }

  .login-story-panel {
    min-height: 26rem;
  }

  .login-form-panel {
    border-radius: 0;
  }
}

@media (max-height: 940px) {
  .login-split-panel {
    grid-template-columns: 1fr;
  }

  .login-story-panel {
    display: none;
  }

  .login-form-panel {
    padding: 1.5rem;
  }

  .login-form-wrap {
    width: min(100%, 36rem);
  }

  .compact-brand-logo {
    display: block;
  }

  .compact-back-link {
    display: inline-flex;
  }
}

@media (max-width: 640px) {
  .login-page-shell {
    padding: 0;
  }

  .login-split-panel {
    border-radius: 0;
  }

  .login-story-panel,
  .login-form-panel {
    padding: 1.25rem;
  }

  .login-story-panel,
  .login-form-panel {
    border-radius: 0;
  }

  .story-header {
    flex-direction: column;
    align-items: flex-start;
  }

  .password-help-link {
    position: static;
    margin-top: 0.55rem;
  }

  .security-check-field {
    margin-top: 1rem;
  }
}
</style>
