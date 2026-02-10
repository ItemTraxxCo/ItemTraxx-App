<template>
  <div class="page">
    <h1>Super Admin Verification</h1>
    <p>Secondary authentication required.</p>
    <div class="card">
      <form class="form" @submit.prevent="handleSuperAdminLogin">
        <label>
          Email
          <input v-model="email" type="email" placeholder="Enter email" />
        </label>
        <label>
          Password
          <input v-model="password" type="password" placeholder="Enter password" />
        </label>
        <button type="submit" :disabled="isLoading">Verify</button>
      </form>
      <p v-if="error" class="error">{{ error }}</p>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref } from "vue";
import { useRouter } from "vue-router";
import { superAdminLogin } from "../../services/authService";

const router = useRouter();
const email = ref("");
const password = ref("");
const error = ref("");
const isLoading = ref(false);

const handleSuperAdminLogin = async () => {
  error.value = "";
  isLoading.value = true;
  try {
    await superAdminLogin(email.value.trim(), password.value);
    await router.push("/super-admin");
  } catch (err) {
    error.value = err instanceof Error ? err.message : "Sign in failed.";
  } finally {
    isLoading.value = false;
  }
};
</script>
