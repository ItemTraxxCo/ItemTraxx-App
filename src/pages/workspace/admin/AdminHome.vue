<template>
    <div class="page admin-shell">
      <div class="admin-hero">
        <div class="admin-toolbar">
            <div class="muted">Signed in as <span data-session-replay-mask>{{ adminEmail }}</span></div>
        </div>
      <h1>{{ isIndividualAccount ? "My Inventory" : "Workspace Overview" }}</h1>
        <p class="admin-hero-copy">
          {{ isIndividualAccount ? "Manage your items, borrowers, checkouts, returns, and account settings." : "Manage inventory, borrowers, returns, reporting, and account controls from one workspace." }}
        </p>
      </div>

    <div class="admin-grid">
      <RouterLink class="admin-card" :to="managerPath('/items')">
        <h2>Item Management</h2>
        <p>Manage items, barcodes, and status.</p>
      </RouterLink>
      <RouterLink class="admin-card" :to="managerPath('/borrowers')">
        <h2>Borrower Management</h2>
        <p>Manage borrowers and view checkout history.</p>
      </RouterLink>
      <RouterLink class="admin-card" :to="managerPath('/logs')">
        <h2>Item Logs</h2>
        <p>View checkout and return activity.</p>
      </RouterLink>
      <RouterLink v-if="!isIndividualAccount" class="admin-card" to="/admin/accounts">
        <h2>Tenant Accounts</h2>
        <p>Create, suspend, restore, and remove accounts.</p>
      </RouterLink>
      <RouterLink v-if="!isIndividualAccount" class="admin-card" to="/admin/admins">
        <h2>Admin Access</h2>
        <p>Manage Workspace Admin accounts and password resets.</p>
      </RouterLink>
      <RouterLink class="admin-card" :to="managerPath('/return')">
        <h2>Quick Return</h2>
        <p>Quick return items without a borrower ID.</p>
      </RouterLink>
      <RouterLink v-if="featureFlags.enable_status_tracking" class="admin-card" :to="managerPath('/item-status')">
        <h2>Item Status Tracking</h2>
        <p>Track lost, damaged, and repair statuses on items.</p>
      </RouterLink>
      <RouterLink v-if="featureFlags.enable_bulk_item_import" class="admin-card" :to="managerPath('/item-import')">
        <h2>Bulk Item Import</h2>
        <p>Import items in bulk from CSV with preview and validation.</p>
      </RouterLink>
      <RouterLink v-if="featureFlags.enable_barcode_generator" class="admin-card" :to="managerPath('/barcodes')">
        <h2>Bulk Barcode Generator</h2>
        <p>Generate and download barcode labels with custom messages.</p>
      </RouterLink>
      <RouterLink v-if="isIndividualAccount" class="admin-card" :to="managerPath('/checkout')">
        <h2>Checkout & Return</h2>
        <p>Check items out to borrowers or process returns.</p>
      </RouterLink>
      <RouterLink v-if="!isIndividualAccount" class="admin-card" to="/settings/organization">
        <h2>Workspace Settings</h2>
        <p>Manage workspace details and checkout defaults.</p>
      </RouterLink>
      <RouterLink v-if="!isIndividualAccount" class="admin-card" to="/settings/account">
        <h2>Account Settings</h2>
        <p>Manage account security and signed in devices.</p>
      </RouterLink>
      <RouterLink v-if="isIndividualAccount" class="admin-card" :to="managerPath('/settings')">
        <h2>Settings</h2>
        <p>Manage your account settings and signed in devices.</p>
      </RouterLink>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, reactive } from "vue";
import { RouterLink } from "vue-router";
import { getAuthState } from "../../../store/authState";
import { fetchWorkspaceSettings } from "../../../services/adminOpsService";
import { useManagerContext } from "../../../composables/useManagerContext";

const { isIndividualAccount, managerPath } = useManagerContext();

const adminEmail = computed(() => {
  const auth = getAuthState();
  return auth.email ?? "Admin";
});
const featureFlags = reactive({
  enable_notifications: true,
  enable_bulk_item_import: true,
  enable_bulk_borrower_tools: true,
  enable_status_tracking: true,
  enable_barcode_generator: true,
});
onMounted(async () => {
  try {
    const settings = await fetchWorkspaceSettings();
    Object.assign(featureFlags, settings.feature_flags);
  } catch {
    // Keep defaults if tenant settings cannot be loaded.
  }
});
</script>

<style scoped>
.admin-card {
  display: block;
  border: 1px solid var(--border);
  border-radius: 14px;
  padding: 1.2rem 1.3rem;
  background: var(--surface-2);
  transition: transform 0.2s ease, border-color 0.2s ease;
}

.admin-card h2 {
  margin: 0 0 0.5rem;
  font-size: 1.2rem;
}

.admin-card p {
  margin: 0;
  color: var(--muted);
}

.admin-card:hover {
  border-color: var(--accent);
  transform: translateY(-2px);
}
</style>
