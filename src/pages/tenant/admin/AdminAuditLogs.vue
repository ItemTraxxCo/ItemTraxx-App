<template>
  <div class="page">
    <h1>Admin Audit Logs</h1>
    <p>Track admin actions.</p>
        <p3> Ability to export admin audit logs data to PDF and CSV coming soon.</p3>

    <div class="card">
      <p v-if="isLoading" class="muted">Loading logs...</p>
      <table v-else class="table">
        <thead>
          <tr>
            <th>Time</th>
            <th>Admin</th>
            <th>Action</th>
            <th>Entity</th>
            <th>Details</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="log in logs" :key="log.id">
            <td>{{ formatTime(log.created_at) }}</td>
            <td>{{ log.actor_profile?.auth_email || log.actor_id }}</td>
            <td>{{ log.action_type }}</td>
            <td>
              <span v-if="log.entity_type">{{ log.entity_type }}</span>
              <span v-else class="muted">-</span>
            </td>
            <td>
              <span v-if="log.metadata">{{ formatMetadata(log.metadata) }}</span>
              <span v-else class="muted">-</span>
            </td>
          </tr>
        </tbody>
      </table>
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
import { fetchAdminAuditLogs, type AdminAuditLog } from "../../../services/adminAuditService";

const logs = ref<AdminAuditLog[]>([]);
const isLoading = ref(false);
const error = ref("");

const loadLogs = async () => {
  isLoading.value = true;
  error.value = "";
  try {
    logs.value = await fetchAdminAuditLogs();
  } catch (err) {
    error.value = err instanceof Error ? err.message : "Unable to load logs.";
  } finally {
    isLoading.value = false;
  }
};

const formatTime = (value: string) => {
  const date = new Date(value);
  return date.toLocaleString();
};

const formatMetadata = (value: Record<string, unknown>) => {
  try {
    return JSON.stringify(value);
  } catch {
    return "[metadata]";
  }
};

onMounted(loadLogs);
</script>
