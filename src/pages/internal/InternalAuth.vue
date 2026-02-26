<template>
  <div class="internal-auth-shell">
    <div class="page internal-auth-page">
      <h1>ItemTraxx Internal Access</h1>
      <p class="muted">
        Sign in with your existing super admin account to access internal operations.
      </p>

      <div class="card internal-auth-card">
        <form class="form" @submit.prevent="handleInternalLogin">
          <label>
            Email
            <input v-model="email" type="email" placeholder="Enter email" />
          </label>
          <label>
            Password
            <input v-model="password" type="password" placeholder="Enter password" />
          </label>
          <label v-if="turnstileSiteKey">
            Security Check
            <div :ref="setTurnstileContainerRef"></div>
            <p class="muted turnstile-help">Complete security check to continue.</p>
          </label>
          <div class="form-actions">
            <button type="submit" class="button-primary" :disabled="!canSubmit">
              Enter Internal Console
            </button>
          </div>
        </form>
        <p v-if="error" class="error">{{ error }}</p>
      </div>
    </div>

    <div v-if="toastMessage" class="toast">
      <div class="toast-title">{{ toastTitle }}</div>
      <div class="toast-body">{{ toastMessage }}</div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, onUnmounted, ref } from "vue";
import { useRouter } from "vue-router";
import { superAdminLogin } from "../../services/authService";
import { useTurnstile } from "../../composables/useTurnstile";

const router = useRouter();
const email = ref("");
const password = ref("");
const error = ref("");
const isLoading = ref(false);
const toastTitle = ref("");
const toastMessage = ref("");
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

const canSubmit = computed(() => {
  if (isLoading.value) return false;
  if (!email.value.trim() || !password.value.trim()) return false;
  if (turnstileSiteKey && !turnstileToken.value) return false;
  return true;
});

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

const handleInternalLogin = async () => {
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
    await superAdminLogin(email.value.trim(), password.value);
    await router.push("/");
  } catch (err) {
    const message = err instanceof Error ? err.message : "Sign in failed.";
    if (message === "Invalid credentials.") {
      error.value = "Invalid super admin credentials.";
      showToast("Sign in failed", "Invalid super admin credentials.");
    } else if (message === "Access denied.") {
      error.value = "Access denied.";
      showToast("Access denied", "This account cannot access internal operations.");
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
        console.error("Failed to reset internal auth Turnstile widget:", turnstileError);
      }
    }
  }
};

onUnmounted(() => {
  if (toastTimer) {
    window.clearTimeout(toastTimer);
    toastTimer = null;
  }
});
</script>

<style scoped>
.internal-auth-shell {
  min-height: 100vh;
  margin: -2.5rem -2rem -3rem;
  padding: 2.4rem 0 3rem;
  background: transparent;
}

.internal-auth-page {
  max-width: 720px;
}

.internal-auth-card {
  background: rgba(255, 255, 255, 0.14);
  border: 1px solid rgba(255, 255, 255, 0.32);
  backdrop-filter: blur(6px);
}

.turnstile-help {
  margin-top: 0.35rem;
  font-size: 0.78rem;
}

@media (max-width: 900px) {
  .internal-auth-shell {
    margin: -2rem -1.2rem -2.4rem;
  }
}
</style>
