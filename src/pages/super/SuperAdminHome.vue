<template>
  <div class="page">
    <h1>Super Admin</h1>
    <p>Platform management</p>
    <div class="admin-grid">
      <div class="stat-card">
        <h3>Total tenants</h3>
        <p class="stat-value">{{ dashboard?.total_tenants ?? "-" }}</p>
      </div>
      <div class="stat-card">
        <h3>Active tenants</h3>
        <p class="stat-value">{{ dashboard?.active_tenants ?? "-" }}</p>
      </div>
      <div class="stat-card">
        <h3>Suspended tenants</h3>
        <p class="stat-value">{{ dashboard?.suspended_tenants ?? "-" }}</p>
      </div>
      <div class="stat-card">
        <h3>Tenant admins</h3>
        <p class="stat-value">{{ dashboard?.tenant_admins_count ?? "-" }}</p>
      </div>
    </div>

    <nav class="page-nav-left">
      <RouterLink class="button-link" to="/super-admin/tenants">Tenants</RouterLink>
      <RouterLink class="button-link" to="/super-admin/admins">Tenant Admins</RouterLink>
      <RouterLink class="button-link" to="/super-admin/gear">All Gear</RouterLink>
      <RouterLink class="button-link" to="/super-admin/students">All Students</RouterLink>
      <RouterLink class="button-link" to="/super-admin/logs">All Logs</RouterLink>
    </nav>

    <div class="card">
      <h2>Recent privileged actions</h2>
      <p v-if="isLoading" class="muted">Loading dashboard...</p>
      <p v-else-if="error" class="error">{{ error }}</p>
      <table v-else class="table">
        <thead>
          <tr>
            <th>When</th>
            <th>Action</th>
            <th>Actor</th>
            <th>Target</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="item in dashboard?.recent_actions ?? []" :key="item.id">
            <td>{{ formatDateTime(item.created_at) }}</td>
            <td>{{ item.action_type }}</td>
            <td>{{ item.actor_email || item.actor_id }}</td>
            <td>{{ item.target_type || "-" }} {{ item.target_id || "" }}</td>
          </tr>
          <tr v-if="(dashboard?.recent_actions?.length ?? 0) === 0">
            <td colspan="4" class="muted">No recent actions.</td>
          </tr>
        </tbody>
      </table>
    </div>

    <button type="button" class="link" @click="handleSignOut">Sign out</button>
  </div>
</template>

<script setup lang="ts">
import { onMounted, ref } from "vue";
import { RouterLink, useRouter } from "vue-router";
import { signOut } from "../../services/authService";
import { fetchSuperDashboard, type SuperDashboard } from "../../services/superAuditService";

const router = useRouter();
const dashboard = ref<SuperDashboard | null>(null);
const isLoading = ref(false);
const error = ref("");

const formatDateTime = (value: string) => {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString();
};

const loadDashboard = async () => {
  isLoading.value = true;
  error.value = "";
  try {
    dashboard.value = await fetchSuperDashboard();
  } catch (err) {
    error.value = err instanceof Error ? err.message : "Unable to load dashboard.";
  } finally {
    isLoading.value = false;
  }
};

const handleSignOut = async () => {
  await signOut();
  await router.push("/");
};

onMounted(() => {
  void loadDashboard();
});
</script>
