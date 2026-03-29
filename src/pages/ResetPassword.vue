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
    return;
  }
  await new Promise((resolve) => window.setTimeout(resolve, 250));
  isReady.value = await attempt();
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
      error.value = updateError.message || "Unable to update password.";
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

.reset-shell.theme-light {
  background:
    radial-gradient(circle at top, rgba(25, 194, 168, 0.16), transparent 30%),
    radial-gradient(circle at bottom right, rgba(25, 67, 155, 0.14), transparent 34%),
    linear-gradient(180deg, #eef5f8 0%, #dde7ee 100%);
}

.reset-panel {
  width: min(100%, 34rem);
  padding: 1.8rem 1.9rem 2rem;
  border-radius: 24px;
  border: 1px solid color-mix(in srgb, var(--border) 72%, var(--accent) 28%);
  background:
    radial-gradient(circle at top right, color-mix(in srgb, var(--accent) 10%, transparent 90%), transparent 28%),
    linear-gradient(180deg, color-mix(in srgb, var(--surface) 94%, transparent 6%) 0%, color-mix(in srgb, var(--surface-2) 92%, transparent 8%) 100%);
  box-shadow: 0 24px 48px rgba(0, 0, 0, 0.18);
}

.reset-kicker {
  margin: 0 0 0.8rem;
  font-size: 0.82rem;
  letter-spacing: 0.14em;
  text-transform: uppercase;
  color: var(--muted);
}

.reset-copy h1 {
  margin: 0;
}

.reset-subtitle {
  margin: 1rem 0 1.8rem;
  color: var(--muted);
}

.reset-form input {
  min-height: 3.6rem;
}
</style>
