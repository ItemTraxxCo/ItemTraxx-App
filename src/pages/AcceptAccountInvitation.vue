<template>
  <main class="flow-shell">
    <section class="flow-panel">
      <p class="flow-kicker">Workspace Invitation</p>
      <h1>Set up your ItemTraxx account</h1>
      <form v-if="!success" @submit.prevent="accept">
        <label>
          New password
          <input
            v-model="password"
            type="password"
            autocomplete="new-password"
            data-session-replay-mask
            aria-describedby="password-requirements"
            required
          />
        </label>
        <small id="password-requirements">Use at least 12 characters with lowercase, uppercase, a number, and a symbol.</small>
        <label>
          Confirm password
          <input v-model="confirmPassword" type="password" autocomplete="new-password" data-session-replay-mask required />
        </label>
        <button type="submit" class="button-primary" :disabled="isLoading || !token">
          {{ isLoading ? "Creating account…" : "Accept invitation" }}
        </button>
      </form>
      <p v-if="error" class="error" role="alert" v-app-toast-error>{{ error }}</p>
      <p v-if="success" class="success" role="status">
        Your account is ready. Sign in to continue.
      </p>
      <RouterLink v-if="success || !token" class="button-primary" to="/login">Go to Login</RouterLink>
    </section>
  </main>
</template>

<script setup lang="ts">
import { onMounted, ref } from "vue";
import { RouterLink } from "vue-router";
import { takeWorkspaceInvitationToken } from "../services/accountFlowToken";
import { acceptWorkspaceInvitation } from "../services/workspaceInvitationService";

const token = ref("");
const password = ref("");
const confirmPassword = ref("");
const error = ref("");
const isLoading = ref(false);
const success = ref(false);

const meetsPasswordPolicy = (value: string) =>
  value.length >= 12 && /[a-z]/.test(value) && /[A-Z]/.test(value) &&
  /[0-9]/.test(value) && /[^A-Za-z0-9]/.test(value);

const accept = async () => {
  error.value = "";
  if (!meetsPasswordPolicy(password.value)) {
    error.value = "Password must be at least 12 characters and include lowercase, uppercase, a number, and a symbol.";
    return;
  }
  if (password.value !== confirmPassword.value) {
    error.value = "Passwords do not match.";
    return;
  }
  isLoading.value = true;
  try {
    await acceptWorkspaceInvitation(token.value, password.value);
    success.value = true;
    token.value = "";
    password.value = "";
    confirmPassword.value = "";
  } catch (cause) {
    error.value = cause instanceof Error
      ? cause.message
      : "This invitation cannot be accepted. Request a new invitation or contact the workspace admin.";
  } finally {
    isLoading.value = false;
  }
};

onMounted(() => {
  const rawToken = takeWorkspaceInvitationToken();
  window.history.replaceState(window.history.state, document.title, "/accept-invitation");
  if (/^[0-9a-f]{64}$/.test(rawToken)) token.value = rawToken;
  else error.value = "This invitation cannot be accepted. Request a new invitation or contact the workspace admin.";
});
</script>

<style scoped>
.flow-shell{min-height:100vh;display:grid;place-items:center;padding:2rem;background:var(--page-bg,#101010);color:var(--text,#f3f3f0)}.flow-panel{width:min(100%,34rem);padding:1.8rem}.flow-kicker{font-size:.82rem;letter-spacing:.14em;text-transform:uppercase;color:var(--muted,#a7a7a0)}form{display:grid;gap:1rem}label{display:grid;gap:.35rem}input{min-height:3rem}small{color:var(--muted,#a7a7a0)}.error{color:var(--danger,#b42318)}.success{color:var(--success,#16803c)}.button-primary{display:inline-block;margin-top:1rem}
</style>
