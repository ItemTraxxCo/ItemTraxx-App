<template>
  <div class="page admin-shell">
    <div class="admin-hero">
      <div class="page-nav-left">
        <RouterLink class="button-link" to="/tenant/admin">Return to admin panel</RouterLink>
      </div>
      <h1>Admin Audit Logs</h1>
      <p class="admin-hero-copy">Review admin actions and search the tenant audit trail.</p>
    </div>

    <div class="card admin-section-card">
      <div class="admin-section-header">
        <div>
          <h2>Audit Trail</h2>
          <p class="admin-section-copy">Search by admin, action, entity, or metadata.</p>
        </div>
      </div>
      <label>
        Search logs
        <input
          v-model="searchQuery"
          type="text"
          placeholder="Search by admin, action, entity, or details"
        />
      </label>
      <p class="muted">Showing {{ filteredLogs.length }} of {{ logs.length }} log entries.</p>
      <p v-if="isLoading" class="muted">Loading logs...</p>
      <div v-else class="table-wrap">
      <table class="table">
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
          <tr v-for="log in filteredLogs" :key="log.id">
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
          <tr v-if="!filteredLogs.length">
            <td colspan="5" class="muted">No logs match your search.</td>
          </tr>
        </tbody>
      </table>
      </div>
      <p v-if="error" class="error">{{ error }}</p>
    </div>

  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, ref } from "vue";
import { RouterLink } from "vue-router";
import { fetchAdminAuditLogs, type AdminAuditLog } from "../../../services/adminAuditService";

const logs = ref<AdminAuditLog[]>([]);
const isLoading = ref(false);
const error = ref("");
const searchQuery = ref("");

const filteredLogs = computed(() => {
  const query = searchQuery.value.trim().toLowerCase();
  if (!query) {
    return logs.value;
  }

  return logs.value.filter((log) => {
    const actor = (log.actor_profile?.auth_email || log.actor_id || "").toLowerCase();
    const action = (log.action_type || "").toLowerCase();
    const entity = (log.entity_type || "").toLowerCase();
    const metadata = log.metadata ? JSON.stringify(log.metadata).toLowerCase() : "";
    return (
      actor.includes(query) ||
      action.includes(query) ||
      entity.includes(query) ||
      metadata.includes(query)
    );
  });
});

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
