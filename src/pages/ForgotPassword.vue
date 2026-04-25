<template>
  <div class="page forgot-shell" :class="`theme-${themeMode}`">
    <main class="forgot-container">
      <RouterLink class="brand-mark" to="/" aria-label="ItemTraxx home">
        <img v-if="brandLogoUrl" class="brand-mark-full" :src="brandLogoUrl" alt="ItemTraxx Co" />
      </RouterLink>

      <div class="page-nav-left forgot-top-nav">
        <RouterLink class="forgot-back-link" :to="backLinkTarget" :aria-label="backLinkLabel" @click.prevent="$router.back()">
          <svg viewBox="0 0 24 24" aria-hidden="true">
            <path d="M15 5 8 12l7 7" />
          </svg>
        </RouterLink>
        <span class="forgot-breadcrumb">{{ backLinkLabel }}</span>
      </div>

      <div class="forgot-copy">
        <h1>Forgot Password</h1>
        <p class="forgot-subtitle">Enter your account email and we'll send a reset link. If your account is registered to the email you enter, you will receive an email with a link to reset your password shortly. The link will expire in 60 minutes and is only valid for one use. If you do not receive a password reset email, please reach out to our support team.</p>
      </div>

      <form class="form" @submit.prevent="sendResetEmail">
        <label>
          Account Email
          <input
            v-model="email"
            type="email"
            placeholder="name@organization.com"
            autocomplete="email"
            autocapitalize="off"
            autocorrect="off"
            spellcheck="false"
          />
        </label>

        <div class="form-actions">
          <button type="submit" class="button-primary forgot-submit-button" :disabled="isLoading || !email.trim()">
            {{ isLoading ? "Sending..." : "Send reset link" }}
          </button>
        </div>
      </form>

      <p v-if="error" class="error">{{ error }}</p>
      <p v-if="success" class="muted forgot-success">
        Password reset link sent. Check your inbox and follow the link to continue. The link will expire in 60 minutes. If you don't receive the email, check your spam folder or try again.
      </p>

    </main>

    <PublicFooter />
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref } from "vue";
import { RouterLink, useRoute } from "vue-router";
import PublicFooter from "../components/PublicFooter.vue";
import { supabase } from "../services/supabaseClient";

const RESET_ERROR_MESSAGE = "Unable to send reset link. Please try again.";

const BACK_LINK_BY_SOURCE: Record<string, { to: string; label: string }> = {
  "admin-login": {
    to: "/tenant/admin-login",
    label: "Back to admin login",
  },
  "super-auth": {
    to: "/super-auth",
    label: "Back to super admin login",
  },
};

const route = useRoute();
const lightBrandLogoUrl = import.meta.env.VITE_BRAND_LOGO_LIGHT_URL as string | undefined;
const darkBrandLogoUrl = import.meta.env.VITE_BRAND_LOGO_DARK_URL as string | undefined;
const email = ref("");
const error = ref("");
const success = ref(false);
const isLoading = ref(false);
const themeMode = ref<"light" | "dark">("dark");
let themeObserver: MutationObserver | null = null;

const routeSource = computed(() =>
  typeof route.query.from === "string" ? route.query.from : ""
);

const brandLogoUrl = computed(() =>
  themeMode.value === "light"
    ? lightBrandLogoUrl || darkBrandLogoUrl || ""
    : darkBrandLogoUrl || lightBrandLogoUrl || ""
);

const backLinkTarget = computed(() =>
  BACK_LINK_BY_SOURCE[routeSource.value]?.to ?? "/login"
);

const backLinkLabel = computed(() =>
  BACK_LINK_BY_SOURCE[routeSource.value]?.label ?? "Back to login"
);

const syncThemeMode = () => {
  themeMode.value = document.documentElement.getAttribute("data-theme") === "light" ? "light" : "dark";
};

const sendResetEmail = async () => {
  error.value = "";
  success.value = false;

  const normalizedEmail = email.value.trim().toLowerCase();
  if (!normalizedEmail || !normalizedEmail.includes("@")) {
    error.value = "Enter a valid account email.";
    return;
  }

  isLoading.value = true;
  try {
    const redirectTo = `${window.location.origin}/reset-password`;
    const { error: resetError } = await supabase.auth.resetPasswordForEmail(normalizedEmail, {
      redirectTo,
    });

    if (resetError) {
      error.value = RESET_ERROR_MESSAGE;
      return;
    }

    success.value = true;
  } catch {
    error.value = RESET_ERROR_MESSAGE;
  } finally {
    isLoading.value = false;
  }
};

onMounted(() => {
  const presetEmail = typeof route.query.email === "string" ? route.query.email.trim() : "";
  if (presetEmail) {
    email.value = presetEmail;
  }
  syncThemeMode();
  themeObserver = new MutationObserver(syncThemeMode);
  themeObserver.observe(document.documentElement, {
    attributes: true,
    attributeFilter: ["data-theme"],
  });
});

onUnmounted(() => {
  if (themeObserver) {
    themeObserver.disconnect();
    themeObserver = null;
  }
});
</script>

<style scoped>
.forgot-shell {
  max-width: 1080px;
  padding-top: calc(2rem + env(safe-area-inset-top, 0px));
}

.forgot-container {
  width: min(100%, 760px);
  margin-bottom: 0;
}

.forgot-shell :deep(.public-footer) {
  margin-top: 21rem;
}

.brand-mark {
  display: inline-flex;
  align-items: center;
  text-decoration: none;
  margin-bottom: 0.45rem;
}

.brand-mark-full {
  height: 4.6rem;
  width: auto;
  object-fit: contain;
  display: block;
}

.forgot-top-nav {
  display: flex;
  align-items: center;
  gap: 0.8rem;
  margin-bottom: 1.05rem;
}

.forgot-back-link {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 2.2rem;
  height: 2.2rem;
  border-radius: 999px;
  border: 1px solid rgba(77, 97, 122, 0.4);
  background: var(--surface);
  color: inherit;
  text-decoration: none;
  transition: transform 0.16s ease, border-color 0.16s ease, background 0.16s ease;
}

.forgot-back-link:hover {
  text-decoration: none;
  transform: translateY(-1px);
  border-color: var(--text);
  background: var(--surface-2);
}

.forgot-back-link svg {
  width: 1.1rem;
  height: 1.1rem;
  stroke: currentColor;
  stroke-width: 2.2;
  stroke-linecap: round;
  stroke-linejoin: round;
  fill: none;
}

.forgot-breadcrumb {
  font-size: 0.92rem;
  color: var(--muted);
}

.forgot-copy h1 {
  margin: 0;
  font-size: clamp(1.4rem, 3vw, 2.4rem);
  line-height: 1.06;
  letter-spacing: -0.04em;
}

.forgot-subtitle {
  margin: 0.85rem 0 1.45rem;
  max-width: 78ch;
  color: var(--muted);
}

.forgot-success {
  margin-top: 1rem;
}

.forgot-panel :is(input[type="email"]) {
}

.forgot-submit-button {
  width: 100%;
  min-height: 3rem;
  border-radius: 999px;
  background: var(--button-primary-bg);
  border-color: transparent;
}

.forgot-submit-button:disabled {
  background: color-mix(in srgb, var(--surface-2) 84%, #8b9097 16%);
  border-color: color-mix(in srgb, var(--border) 78%, #8b9097 22%);
  color: color-mix(in srgb, currentColor 65%, transparent);
  box-shadow: none;
  cursor: not-allowed;
  opacity: 0.8;
}

@media (max-width: 640px) {
  .forgot-shell {
    padding-top: calc(1.25rem + env(safe-area-inset-top, 0px));
  }

  .forgot-container {
    width: min(100%, calc(100% - 0.25rem));
    margin-bottom: 0;
  }

  .forgot-shell :deep(.public-footer) {
    margin-top: 13rem;
  }

  .brand-mark-full {
    height: 3.85rem;
  }
}
</style>
