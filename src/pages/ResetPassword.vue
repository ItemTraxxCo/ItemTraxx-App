<template>
  <div class="page">
    <h1>Reset Password</h1>
    <p>Set a new password for your account.</p>

    <div class="card">
      <form class="form" @submit.prevent="handleReset">
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
        Password updated successfully. You can now sign in.
      </p>
      <RouterLink class="link" to="/login">Back to login</RouterLink>
    </div>
  </div>
</template>

<script setup lang="ts">
import { onMounted, ref } from "vue";
import { RouterLink, useRouter } from "vue-router";
import { supabase } from "../services/supabaseClient";

const router = useRouter();
const newPassword = ref("");
const confirmPassword = ref("");
const error = ref("");
const isLoading = ref(false);
const isReady = ref(false);
const success = ref(false);

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
    await supabase.auth.signOut();
    window.setTimeout(() => {
      void router.push("/login");
    }, 900);
  } finally {
    isLoading.value = false;
  }
};

onMounted(async () => {
  await checkRecoverySession();
  if (!isReady.value) {
    error.value = "Invalid or expired reset link. Request a new reset email.";
  }
});
</script>
