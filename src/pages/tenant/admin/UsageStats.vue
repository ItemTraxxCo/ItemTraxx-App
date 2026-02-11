<template>
  <div class="page">
    <h1>Usage Statistics</h1>
    <p>Recent activity and inventory summary.</p>
    <p class="muted">Ability to export usage data to PDF and CSV coming soon.</p>

    <div class="card">
      <p v-if="isLoading" class="muted">Loading statistics...</p>
      <div v-else class="stats-grid">
        <div class="stat-card">
          <h3>Total gear</h3>
          <p class="stat-value">{{ stats?.totalGear ?? 0 }}</p>
        </div>
        <div class="stat-card">
          <h3>Total students</h3>
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

    <div class="admin-actions">
      <RouterLink class="link" to="/tenant/admin">Back to admin panel home</RouterLink>
      <RouterLink class="link" to="/tenant/checkout">Return to checkout</RouterLink>
    </div>
  </div>
</template>

<script setup lang="ts">
import { onMounted, ref } from "vue";
import { RouterLink } from "vue-router";
import { fetchUsageStats, type UsageStats } from "../../../services/statsService";

const stats = ref<UsageStats | null>(null);
const isLoading = ref(false);
const error = ref("");

const loadStats = async () => {
  isLoading.value = true;
  error.value = "";
  try {
    stats.value = await fetchUsageStats();
  } catch (err) {
    error.value = err instanceof Error ? err.message : "Unable to load stats.";
  } finally {
    isLoading.value = false;
  }
};

onMounted(loadStats);
</script>
