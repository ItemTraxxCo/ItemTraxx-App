<template>
  <main class="flow-shell">
    <section class="flow-panel">
      <p class="flow-kicker">Account Security</p>
      <h1>Email address change</h1>
      <p v-if="message" class="success" role="status" v-app-toast-message>{{ message }}</p>
      <p v-if="error" class="error" role="alert" v-app-toast-error>{{ error }}</p>
      <template v-if="pendingFlow && !message">
        <p v-if="pendingFlow.step === 'approve'" class="muted">
          Approve this request only if you asked to change your sign-in email. We’ll send a separate verification link to the new address.
        </p>
        <p v-else class="muted">
          Confirm the new address to finish changing your sign-in email. Your existing session will remain active.
        </p>
        <button
          type="button"
          class="button-primary"
          :disabled="isLoading"
          @click="confirmEmailChange"
        >
          {{ isLoading ? "Confirming…" : pendingFlow.step === 'approve' ? "Approve email change" : "Confirm new email" }}
        </button>
      </template>
      <RouterLink v-if="message || !pendingFlow || error" class="button-primary" to="/login">Go to Login</RouterLink>
    </section>
  </main>
</template>

<script setup lang="ts">
import { onMounted, ref } from "vue";
import { RouterLink } from "vue-router";
import { takeAccountEmailChangeToken } from "../services/accountFlowToken";
import { completeAccountEmailChangeStep } from "../services/accountEmailChangeService";

const message = ref("");
const error = ref("");
const isLoading = ref(false);
const pendingFlow = ref<{ step: "approve" | "verify"; token: string } | null>(null);

onMounted(() => {
  const flow = takeAccountEmailChangeToken();
  // Remove the bearer token from browser history and any later referrer before
  // making the verification request.
  window.history.replaceState(window.history.state, document.title, "/account/email-change");
  if (!flow || !/^[0-9a-f]{64}$/.test(flow.token)) {
    error.value = "This email change could not be completed. Request a new change from Account Security.";
    return;
  }
  pendingFlow.value = flow;
});

const confirmEmailChange = async () => {
  const flow = pendingFlow.value;
  if (!flow || isLoading.value) return;
  isLoading.value = true;
  try {
    const result = await completeAccountEmailChangeStep(flow.step, flow.token);
    message.value = result?.message ?? (flow.step === "approve"
      ? "Approval confirmed. Check the new email address to finish the change."
      : "Your sign-in email has been updated. Your current session remains active.");
    pendingFlow.value = null;
  } catch (cause) {
    error.value = cause instanceof Error
      ? cause.message
      : "This email change could not be completed. Request a new change from Account Security.";
  } finally {
    isLoading.value = false;
  }
};
</script>

<style scoped>
.flow-shell{min-height:100vh;display:grid;place-items:center;padding:2rem;background:var(--page-bg,#101010);color:var(--text,#f3f3f0)}.flow-panel{width:min(100%,34rem);padding:1.8rem}.flow-kicker{font-size:.82rem;letter-spacing:.14em;text-transform:uppercase;color:var(--muted,#a7a7a0)}.success{color:var(--success,#16803c)}.error{color:var(--danger,#b42318)}.button-primary{display:inline-block;margin-top:1rem}
</style>
