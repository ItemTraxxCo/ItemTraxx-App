<template>
  <div class="reset-shell" :class="`theme-${themeMode}`">
    <div class="reset-panel">
      <div class="reset-copy">
        <p class="reset-kicker">Account Recovery</p>
        <h1>Reset Password</h1>
        <p class="reset-subtitle">Set a new password for your account.</p>
      </div>

      <form class="form reset-form" @submit.prevent="handleReset">
        <label>
          New Password
          <input
            v-model="newPassword"
            type="password"
            placeholder="Enter new password"
            autocomplete="new-password"
          />
        </label>
        <label>
          Confirm Password
          <input
            v-model="confirmPassword"
            type="password"
            placeholder="Re-enter new password"
            autocomplete="new-password"
          />
        </label>
        <div class="form-actions">
          <button type="submit" class="button-primary" :disabled="isLoading || !isReady">
            Update Password
          </button>
        </div>
      </form>
      <p v-if="error" class="error">{{ error }}</p>
      <p v-if="success" class="muted">
        Password successfully updated. Please check your email for confirmation and try signing in again.
      </p>
      <RouterLink class="link" to="/login">Back to login</RouterLink>
    </div>
  </div>
</template>

<script setup lang="ts">
import { onMounted, onUnmounted, ref } from "vue";
import { RouterLink } from "vue-router";
import { supabase } from "../services/supabaseClient";

const newPassword = ref("");
const confirmPassword = ref("");
const error = ref("");
const isLoading = ref(false);
const isReady = ref(false);
const success = ref(false);
const themeMode = ref<"light" | "dark">("dark");
let themeObserver: MutationObserver | null = null;

const checkRecoverySession = async () => {
  const attempt = async () => {
    const { data } = await supabase.auth.getSession();
    return !!data.session;
  };

  // Give Supabase a moment to parse recovery hash tokens from URL.
  if (await attempt()) {
    isReady.value = true;
    if (window.location.hash) {
      window.history.replaceState({}, document.title, `${window.location.pathname}${window.location.search}`);
    }
    return;
  }
  await new Promise((resolve) => window.setTimeout(resolve, 250));
  isReady.value = await attempt();
  if (isReady.value && window.location.hash) {
    window.history.replaceState({}, document.title, `${window.location.pathname}${window.location.search}`);
  }
};

const handleReset = async () => {
  error.value = "";
  if (!isReady.value) {
    error.value = "Invalid or expired reset link. Request a new reset email.";
    return;
  }
  if (newPassword.value.length < 8) {
    error.value = "Password must be at least 8 characters.";
    return;
  }
  if (newPassword.value !== confirmPassword.value) {
    error.value = "Passwords do not match.";
    return;
  }

  isLoading.value = true;
  try {
    const { error: updateError } = await supabase.auth.updateUser({
      password: newPassword.value,
    });
    if (updateError) {
      error.value = "Unable to update password. Request a new reset link and try again.";
      return;
    }
    success.value = true;
    await supabase.auth.signOut({ scope: "local" });
  } finally {
    isLoading.value = false;
  }
};

onMounted(async () => {
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
  await checkRecoverySession();
  if (!isReady.value) {
    error.value = "Invalid or expired reset link. Request a new reset email.";
  }
});

onUnmounted(() => {
  if (themeObserver) {
    themeObserver.disconnect();
    themeObserver = null;
  }
});
</script>

<style scoped>
.reset-shell {
  --reset-page-bg: #101010;
  --reset-panel-bg: transparent;
  --reset-text: #f3f3f0;
  --reset-muted: #a7a7a0;
  --reset-border: #2f2f2c;
  --reset-input-bg: #151515;
  --reset-button-bg: #f3f3f0;
  --reset-button-text: #101010;
  min-height: 100vh;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 2rem;
  background: var(--reset-page-bg);
  color: var(--reset-text);
}

.reset-shell.theme-light {
  --reset-page-bg: #f7f7f5;
  --reset-text: #171717;
  --reset-muted: #5f6368;
  --reset-border: #d8d8d3;
  --reset-input-bg: #ffffff;
  --reset-button-bg: #171717;
  --reset-button-text: #ffffff;
}

.reset-panel {
  width: min(100%, 34rem);
  padding: 1.8rem 1.9rem 2rem;
  border: 0;
  background: var(--reset-panel-bg);
}

.reset-kicker {
  margin: 0 0 0.8rem;
  font-size: 0.82rem;
  letter-spacing: 0.14em;
  text-transform: uppercase;
  color: var(--reset-muted);
}

.reset-copy h1 {
  margin: 0;
}

.reset-subtitle {
  margin: 1rem 0 1.8rem;
  color: var(--reset-muted);
}

.reset-form input {
  min-height: 3.6rem;
  border-radius: 999px;
  border-color: var(--reset-border);
  background: var(--reset-input-bg);
  color: var(--reset-text);
}

.reset-form .button-primary {
  border-color: var(--reset-button-bg);
  background: var(--reset-button-bg);
  color: var(--reset-button-text);
}
</style>
