<template>
    <div class="page">
      <div class="page-nav-left">
        <button type="button" class="button-link" @click="returnToCheckout">
          Return to checkout
        </button>
      </div>
      <h1>Admin Panel</h1>
      <p>Welcome, {{ adminEmail }}</p>
    <div class="admin-grid">
      <RouterLink class="admin-card" to="/tenant/admin/gear">
        <h2>Item Management</h2>
        <p>Manage items, barcodes, and status.</p>
      </RouterLink>
      <RouterLink class="admin-card" to="/tenant/admin/students">
        <h2>Student Management</h2>
        <p>Manage students and view checkout history.</p>
      </RouterLink>
      <RouterLink class="admin-card" to="/tenant/admin/logs">
        <h2>Gear Logs</h2>
        <p>View checkout and return activity.</p>
      </RouterLink>
      <RouterLink class="admin-card" to="/tenant/admin/return">
        <h2>Quick Return</h2>
        <p>Quick return items without student a id.</p>
      </RouterLink>
      <RouterLink class="admin-card" to="/tenant/admin/stats">
        <h2>Usage Stats</h2>
        <p>View recent usage and inventory activity.</p>
      </RouterLink>
      <RouterLink class="admin-card" to="/tenant/admin/audit-logs">
        <h2>Admin Audit Logs</h2>
        <p>Track admin actions.</p>
      </RouterLink>
      <RouterLink class="admin-card" to="/tenant/admin/admins">
        <h2>Admin management</h2>
        <p>Create and manage admin accounts for this user.</p>
      </RouterLink>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed } from "vue";
import { RouterLink, useRouter } from "vue-router";
import {
  clearAdminVerification,
  getAuthState,
} from "../../../store/authState";

const adminEmail = computed(() => {
  const auth = getAuthState();
  return auth.email ?? "Admin";
});

const router = useRouter();

const returnToCheckout = async () => {
  clearAdminVerification();
  await router.replace("/tenant/checkout");
};
</script>
