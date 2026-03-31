<template>
  <div class="forgot-shell" :class="`theme-${themeMode}`">
    <div class="forgot-panel">
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
          <button type="submit" class="button-primary forgot-submit-button" :disabled="isLoading">
            {{ isLoading ? "Sending..." : "Send reset link" }}
          </button>
        </div>
      </form>

      <p v-if="error" class="error">{{ error }}</p>
      <p v-if="success" class="muted forgot-success">
        Password reset link sent. Check your inbox and follow the link to continue. The link will expire in 60 minutes. If you don't receive the email, check your spam folder or try again.
      </p>

      <RouterLink class="link back-link" :to="backLinkTarget">{{ backLinkLabel }}</RouterLink>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref } from "vue";
import { RouterLink, useRoute } from "vue-router";
import { supabase } from "../services/supabaseClient";

const route = useRoute();
const email = ref("");
const error = ref("");
const success = ref(false);
const isLoading = ref(false);
const themeMode = ref<"light" | "dark">("dark");
let themeObserver: MutationObserver | null = null;

const backLinkTarget = computed(() =>
  route.query.from === "admin-login"
    ? "/tenant/admin-login"
    : route.query.from === "super-auth"
      ? "/super-auth"
      : "/login"
);

const backLinkLabel = computed(() =>
  route.query.from === "admin-login"
    ? "Back to admin login"
    : route.query.from === "super-auth"
      ? "Back to super admin login"
      : "Back to login"
);

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
      error.value = "Unable to send reset link right now. Please try again.";
      return;
    }

    success.value = true;
  } catch (requestError) {
    error.value = "Unable to send reset link right now. Please try again.";
  } finally {
    isLoading.value = false;
  }
};

onMounted(() => {
  const presetEmail = typeof route.query.email === "string" ? route.query.email.trim() : "";
  if (presetEmail) {
    email.value = presetEmail;
  }
  themeMode.value = document.documentElement.getAttribute("data-theme") === "light" ? "light" : "dark";
  themeObserver = new MutationObserver(() => {
    themeMode.value = document.documentElement.getAttribute("data-theme") === "light" ? "light" : "dark";
  });
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

.forgot-shell.theme-light {
  background:
    radial-gradient(circle at top, rgba(25, 194, 168, 0.16), transparent 30%),
    radial-gradient(circle at bottom right, rgba(25, 67, 155, 0.14), transparent 34%),
    linear-gradient(180deg, #eef5f8 0%, #dde7ee 100%);
}

.forgot-panel {
  width: min(100%, 34rem);
  padding: 1.8rem 1.9rem 2rem;
  border-radius: 24px;
  border: 1px solid color-mix(in srgb, var(--border) 72%, var(--accent) 28%);
  background:
    radial-gradient(circle at top right, color-mix(in srgb, var(--accent) 10%, transparent 90%), transparent 28%),
    linear-gradient(180deg, color-mix(in srgb, var(--surface) 94%, transparent 6%) 0%, color-mix(in srgb, var(--surface-2) 92%, transparent 8%) 100%);
  box-shadow: 0 24px 48px rgba(0, 0, 0, 0.18);
}

.forgot-copy h1 {
  margin: 0;
}

.forgot-subtitle {
  margin: 1rem 0 1.8rem;
  color: var(--muted);
}

.forgot-success {
  margin-top: 1rem;
}

.back-link {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  margin-top: 1rem;
  padding: 0;
  text-decoration: none;
  font-weight: 500;
  color: color-mix(in srgb, var(--accent) 70%, #7b8cff 30%);
  transition:
    color 0.2s ease,
    transform 0.15s ease;
}

.back-link:hover {
  text-decoration: underline;
  transform: translateY(-1px);
  color: color-mix(in srgb, var(--accent) 78%, #7b8cff 22%);
}

.forgot-submit-button {
  width: 100%;
  min-height: 3rem;
  border-radius: 999px;
  background:
    linear-gradient(90deg,
      color-mix(in srgb, var(--accent) 88%, #3dc8ff 12%) 0%,
      color-mix(in srgb, var(--button-primary-bg) 72%, #4f5dff 28%) 100%);
  border-color: transparent;
  box-shadow: 0 14px 28px rgba(25, 194, 168, 0.18);
}
</style>
