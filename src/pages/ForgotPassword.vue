<template>
  <div class="page">
    <h1>Forgot Password</h1>
    <p>Enter your account email and we'll send a reset link. If your account is registered to the email you enter, you will receive an email with a link to reset your password shortly. The link will expire in 60 minutes and is only valid for one use.</p>

    <div class="card">
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
          <button type="submit" class="button-primary" :disabled="isLoading">
            {{ isLoading ? "Sending..." : "Send reset link" }}
          </button>
        </div>
      </form>

      <p v-if="error" class="error">{{ error }}</p>
      <p v-if="success" class="muted">
        Password reset link sent. Check your inbox and follow the link to continue. The link will expire in 60 minutes. If you don't receive the email, check your spam folder or try again.
      </p>

      <RouterLink class="link back-link" to="/login">Back to login</RouterLink>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref } from "vue";
import { RouterLink } from "vue-router";
import { supabase } from "../services/supabaseClient";

const email = ref("");
const error = ref("");
const success = ref(false);
const isLoading = ref(false);

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
      error.value = resetError.message || "Unable to send reset link.";
      return;
    }

    success.value = true;
  } catch (requestError) {
    error.value = requestError instanceof Error ? requestError.message : "Unable to send reset link.";
  } finally {
    isLoading.value = false;
  }
};
</script>

<style scoped>
.back-link {
  display: inline-block;
  margin-top: 1rem;
}
</style>
