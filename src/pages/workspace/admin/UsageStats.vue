<template>
  <div class="page admin-shell">
    <div class="admin-hero">
      <div class="page-nav-left">
        <RouterLink class="button-link" to="/admin">Return to admin panel</RouterLink>
      </div>
      <h1>Usage Statistics</h1>
      <p class="admin-hero-copy">Review recent activity and access totals across the workspace.</p>
    </div>

    <div class="card admin-section-card">
      <div class="admin-section-header">
        <div>
          <h2>Tenant Account access</h2>
          <p class="admin-section-copy">Shared items and borrowers intentionally count once for every account that can use them.</p>
        </div>
      </div>
      <div class="table-wrap">
        <table class="table">
          <thead><tr><th>Tenant Account</th><th>Items</th><th>Borrowers</th><th>Active checkouts</th><th>Overdue</th></tr></thead>
          <tbody>
            <tr v-for="account in accountStats" :key="account.profile_id">
              <td>{{ account.auth_email }}</td><td>{{ account.item_count }}</td><td>{{ account.borrower_count }}</td><td>{{ account.active_checkouts }}</td><td>{{ account.overdue_count }}</td>
            </tr>
            <tr v-if="accountStats.length === 0"><td colspan="5" class="muted">No active Tenant Accounts.</td></tr>
          </tbody>
        </table>
      </div>
    </div>

    <div class="card admin-section-card">
      <div class="admin-section-header">
        <div>
          <h2>Overview</h2>
          <p class="admin-section-copy">PDF and CSV export can be added later without changing this layout.</p>
        </div>
      </div>
      <p v-if="isLoading" class="muted">Loading statistics...</p>
      <div v-else class="stats-grid">
        <div class="stat-card">
          <h3>Total items</h3>
          <p class="stat-value">{{ stats?.totalGear ?? 0 }}</p>
        </div>
        <div class="stat-card">
          <h3>Total borrowers</h3>
          <p class="stat-value">{{ stats?.totalStudents ?? 0 }}</p>
        </div>
        <div class="stat-card">
          <h3>Currently checked out</h3>
          <p class="stat-value">{{ stats?.currentlyCheckedOut ?? 0 }}</p>
        </div>
        <div class="stat-card">
          <h3>Checkouts (7d)</h3>
          <p class="stat-value">{{ stats?.checkouts7d ?? 0 }}</p>
        </div>
        <div class="stat-card">
          <h3>Returns (7d)</h3>
          <p class="stat-value">{{ stats?.returns7d ?? 0 }}</p>
        </div>
        <div class="stat-card">
          <h3>Checkouts (30d)</h3>
          <p class="stat-value">{{ stats?.checkouts30d ?? 0 }}</p>
        </div>
        <div class="stat-card">
          <h3>Returns (30d)</h3>
          <p class="stat-value">{{ stats?.returns30d ?? 0 }}</p>
        </div>
      </div>
      <p v-if="error" class="error">{{ error }}</p>
    </div>

  </div>
</template>

<script setup lang="ts">
import { onMounted, ref } from "vue";
import { RouterLink } from "vue-router";
import { fetchUsageStats, type UsageStats } from "../../../services/statsService";
import { fetchWorkspaceAccountDashboard, type WorkspaceAccountDashboardRow } from "../../../services/adminOpsService";
import { toUserFacingErrorMessage } from "../../../services/appErrors";

const stats = ref<UsageStats | null>(null);
const accountStats = ref<WorkspaceAccountDashboardRow[]>([]);
const isLoading = ref(false);
const error = ref("");

const loadStats = async () => {
  isLoading.value = true;
  error.value = "";
  try {
    [stats.value, accountStats.value] = await Promise.all([
      fetchUsageStats(),
      fetchWorkspaceAccountDashboard(),
    ]);
  } catch (err) {
    error.value = toUserFacingErrorMessage(err, "Unable to load stats.");
  } finally {
    isLoading.value = false;
  }
};

onMounted(loadStats);
</script>

<style scoped>
.stats-grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(180px, 1fr));
  gap: 1rem;
  margin-top: 1rem;
}
</style>
