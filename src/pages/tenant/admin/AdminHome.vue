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
        <h2>Item Logs</h2>
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
      <RouterLink v-if="featureFlags.enable_status_tracking" class="admin-card" to="/tenant/admin/item-status">
        <h2>Item Status Tracking</h2>
        <p>Track lost, damaged, and repair statuses.</p>
      </RouterLink>
      <RouterLink v-if="featureFlags.enable_bulk_item_import" class="admin-card" to="/tenant/admin/gear-import">
        <h2>Bulk Item Import</h2>
        <p>Import items in bulk from CSV with preview and validation.</p>
      </RouterLink>
      <RouterLink v-if="featureFlags.enable_barcode_generator" class="admin-card" to="/tenant/admin/barcodes">
        <h2>Bulk Barcode Generator</h2>
        <p>Generate and download barcode label PDFs with custom messages.</p>
      </RouterLink>
      <RouterLink class="admin-card" to="/tenant/admin/settings">
        <h2>Tenant Settings</h2>
        <p>Manage checkout policy defaults and review tenant feature flags.</p>
      </RouterLink>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, reactive } from "vue";
import { RouterLink, useRouter } from "vue-router";
import {
  clearAdminVerification,
  getAuthState,
} from "../../../store/authState";
import { fetchTenantSettings } from "../../../services/adminOpsService";

const adminEmail = computed(() => {
  const auth = getAuthState();
  return auth.email ?? "Admin";
});
const featureFlags = reactive({
  enable_notifications: true,
  enable_bulk_item_import: true,
  enable_bulk_student_tools: true,
  enable_status_tracking: true,
  enable_barcode_generator: true,
});

const router = useRouter();

const returnToCheckout = async () => {
  clearAdminVerification();
  await router.replace("/tenant/checkout");
};

onMounted(async () => {
  try {
    const settings = await fetchTenantSettings();
    Object.assign(featureFlags, settings.feature_flags);
  } catch {
    // Keep defaults if tenant settings cannot be loaded.
  }
});
</script>
