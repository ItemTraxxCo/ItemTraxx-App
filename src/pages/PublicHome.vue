<template>
  <div class="page">
    <h1 class="brand-title">
      <img
        class="brand-logo"
        src="https://mlaspkufocikfcbjgpof.supabase.co/storage/v1/object/public/assets/ItemTraxx_m_Logo.png"
        alt="ItemTraxx logo"
      />
      ItemTraxx
    </h1>
    <h3>Sign in</h3>
    <div class="card">
      <form class="form" @submit.prevent="handleTenantLogin">
        <label>
          Access Code
          <input v-model="accessCode" type="text" placeholder="Enter access code" />
        </label>
        <label>
          Password
          <input v-model="password" type="password" placeholder="Enter password" />
        </label>
        <p class="muted support-note">
          Trouble signing in? Contact support at, support@itemtraxx.com.
        </p>
        <div class="form-actions">
          <button type="submit" :disabled="isLoading">Sign in</button>
        </div>
      </form>

      <p v-if="error" class="error">{{ error }}</p>
    </div>
    <div v-if="isLoading" class="toast toast-persist">
      <div class="toast-title">Loading...</div>
      <div class="toast-body">Signing you in.</div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref } from "vue";
import { useRouter } from "vue-router";
import { tenantLogin } from "../services/authService";

const router = useRouter();
const accessCode = ref("");
const password = ref("");
const error = ref("");
const isLoading = ref(false);
const superAdminAccessCode = import.meta.env
  .VITE_SUPER_ADMIN_ACCESS_CODE as string | undefined;

const handleTenantLogin = async () => {
  error.value = "";
  isLoading.value = true;
  try {
    if (
      superAdminAccessCode &&
      accessCode.value.trim() === superAdminAccessCode
    ) {
      await router.push("/super-auth");
      return;
    }
    await tenantLogin(accessCode.value.trim(), password.value);
    await router.push("/tenant/checkout");
  } catch (err) {
    error.value = err instanceof Error ? err.message : "Sign in failed.";
  } finally {
    isLoading.value = false;
  }
};
</script>
