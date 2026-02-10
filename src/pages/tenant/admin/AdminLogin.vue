<template>
  <div class="page">
    <h1>Admin Sign In</h1>
    <p>Enter admin credentials.</p>

    <div class="card">
      <form class="form" @submit.prevent="handleAdminLogin">
        <label>
          Email
          <input v-model="email" type="email" placeholder="Enter email" />
        </label>
        <label>
          Password
          <input v-model="password" type="password" placeholder="Enter password" />
        </label>
        <div class="form-actions">
          <button type="submit" class="button-primary" :disabled="isLoading">Sign in</button>
        </div>
      </form>
      <p v-if="error" class="error">{{ error }}</p>
    </div>

    <RouterLink class="link" to="/tenant/checkout">Back to checkout</RouterLink>
  </div>
</template>

<script setup lang="ts">
import { ref } from "vue";
import { RouterLink, useRouter } from "vue-router";
import { adminLogin } from "../../../services/authService";
import { logAdminAction } from "../../../services/auditLogService";

const router = useRouter();
const email = ref("");
const password = ref("");
const error = ref("");
const isLoading = ref(false);

const handleAdminLogin = async () => {
  error.value = "";
  isLoading.value = true;
  try {
    await adminLogin(email.value.trim(), password.value);
    await logAdminAction({
      action_type: "admin_login",
      metadata: { email: email.value.trim() },
    });
    await router.push("/tenant/admin");
  } catch (err) {
    error.value = err instanceof Error ? err.message : "Sign in failed.";
  } finally {
    isLoading.value = false;
  }
};
</script>
