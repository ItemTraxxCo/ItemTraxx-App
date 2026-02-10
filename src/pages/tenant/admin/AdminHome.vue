<template>
    <div class="page">
      <h1>Admin Panel</h1>
      <p>Welcome, {{ adminEmail }}</p>
    <div class="admin-grid">
      <RouterLink class="admin-card" to="/tenant/admin/gear">
        <h2>Gear Management</h2>
        <p>Manage inventory, barcodes, and status.</p>
      </RouterLink>
      <RouterLink class="admin-card" to="/tenant/admin/students">
        <h2>Student Management</h2>
        <p>Manage students and view checkout history.</p>
      </RouterLink>
      <RouterLink class="admin-card" to="/tenant/admin/logs">
        <h2>Gear Logs</h2>
        <p>Audit checkout and return activity.</p>
      </RouterLink>
      <RouterLink class="admin-card" to="/tenant/admin/return">
        <h2>Quick Return</h2>
        <p>Quick return items without student a barcode.</p>
      </RouterLink>
      <RouterLink class="admin-card" to="/tenant/admin/stats">
        <h2>Usage Stats</h2>
        <p>View recent usage and inventory activity.</p>
      </RouterLink>
      <RouterLink class="admin-card" to="/tenant/admin/audit-logs">
        <h2>Admin Audit Logs</h2>
        <p>Track admin actions for this user.</p>
      </RouterLink>
      <RouterLink class="admin-card" to="/tenant/admin/admins">
        <h2>Admin management</h2>
        <p>Create and manage admin accounts for this user.</p>
      </RouterLink>
    </div>
    <div class="admin-actions">
      <RouterLink class="link" to="/tenant/checkout">Return to checkout</RouterLink>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed } from "vue";
import { RouterLink } from "vue-router";
import { getAuthState } from "../../../store/authState";

const adminEmail = computed(() => {
  const auth = getAuthState();
  return auth.email ?? "Admin";
});
</script>
