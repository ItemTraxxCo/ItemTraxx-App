<template>
  <div class="page">
    <h1>404 Not Found</h1>
    <p>The page you requested does not exist. Please check the url, go back to the previous page, or contact support by clicking the menu button in the top right corner and selecting contact support.</p>
    <div class="card">
      <h2>Extra info</h2>
      <h3> Please attach a screenshot of this page to your support request.</h3>
      <p class="muted">Path: {{ route.fullPath }}</p>
      <p class="muted">Signed in: {{ auth.isAuthenticated ? "Yes" : "No" }}</p>
      <p class="muted">Tenant ID: {{ auth.tenantContextId || "-" }}</p>
      <p class="muted">Role: {{ auth.role || "-" }}</p>
      <p class="muted">User: {{ auth.email || "-" }}</p>
      <p class="muted">Local time: {{ now }}</p>
      <p class="muted">Session age: {{ sessionAge }}</p>
      <div class="admin-actions">
        <button type="button" class="link" @click="goBack">Go back</button>
        <button type="button" class="link" @click="goCheckout">Return to checkout</button>
        <button
          v-if="auth.isAuthenticated"
          type="button"
          class="link"
          @click="goAdmin"
        >
          Open admin login
        </button>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, ref } from "vue";
import { useRoute, useRouter } from "vue-router";
import { getAuthState } from "../store/authState";

const auth = getAuthState();
const route = useRoute();
const router = useRouter();
const now = ref("");

const refreshNow = () => {
  now.value = new Date().toLocaleString();
};

const sessionAge = computed(() => {
  if (!auth.signedInAt) return "-";
  const diffMs = Date.now() - new Date(auth.signedInAt).getTime();
  if (Number.isNaN(diffMs)) return "-";
  const minutes = Math.floor(diffMs / 60000);
  if (minutes < 1) return "Just now";
  if (minutes < 60) return `${minutes} min`;
  const hours = Math.floor(minutes / 60);
  return `${hours} hr`;
});

const goBack = () => {
  router.back();
};

const goCheckout = () => {
  router.push("/tenant/checkout");
};

const goAdmin = () => {
  router.push("/tenant/admin-login");
};

onMounted(refreshNow);
</script>
