<template>
  <div class="page">
    <div class="page-nav-left">
      <RouterLink class="button-link" to="/super-admin">Return to Super Admin</RouterLink>
      <RouterLink class="button-link" to="/super-admin/tenants">Tenants</RouterLink>
      <RouterLink class="button-link" to="/super-admin/gear">All Gear</RouterLink>
      <RouterLink class="button-link" to="/super-admin/students">All Students</RouterLink>
      <RouterLink class="button-link" to="/super-admin/broadcasts">Broadcasts</RouterLink>
    </div>

    <h1>All Logs</h1>
    <p>Read-only, immutable cross-tenant logs.</p>

    <div class="card">
      <div class="input-row">
        <select v-model="tenantFilter"><option value="all">all tenants</option><option v-for="t in tenants" :key="t.id" :value="t.id">{{ t.name }}</option></select>
        <select v-model="actionFilter"><option value="all">all actions</option><option value="checkout">checkout</option><option value="return">return</option><option value="admin_return">admin_return</option></select>
        <input v-model="startAt" type="datetime-local" />
        <input v-model="endAt" type="datetime-local" />
        <input v-model="search" type="text" placeholder="Search logs" />
        <button type="button" @click="loadLogs">Search</button>
        <button type="button" @click="exportCsv">Export CSV</button>
        <button type="button" @click="exportPdf">Export PDF</button>
      </div>

      <p v-if="isLoading" class="muted">Loading logs...</p>
      <p v-else-if="error" class="error">{{ error }}</p>
      <table v-else class="table">
        <thead><tr><th>Time</th><th>Tenant</th><th>Action</th><th>Gear</th><th>Student</th></tr></thead>
        <tbody>
          <tr v-for="row in rows" :key="row.id">
            <td>{{ formatDateTime(row.action_time) }}</td>
            <td>{{ row.tenant?.name || row.tenant_id }}</td>
            <td>{{ row.action_type }}</td>
            <td>{{ row.gear?.name || "-" }} ({{ row.gear?.barcode || "-" }})</td>
            <td>{{ row.student ? `${row.student.first_name} ${row.student.last_name} (${row.student.student_id})` : "-" }}</td>
          </tr>
        </tbody>
      </table>
      <div class="form-actions">
        <button type="button" @click="prevPage" :disabled="page <= 1 || isLoading">Prev</button>
        <span class="muted">Page {{ page }}</span>
        <button type="button" @click="nextPage" :disabled="isLoading">Next</button>
      </div>
    </div>

    <div v-if="toastMessage" class="toast"><div class="toast-title">{{ toastTitle }}</div><div class="toast-body">{{ toastMessage }}</div></div>
  </div>
</template>

<script setup lang="ts">
import { onMounted, ref } from "vue";
import { RouterLink } from "vue-router";
import { listSuperLogs, type SuperLogEntry } from "../../services/superLogsService";
import { listTenants, type SuperTenant } from "../../services/superTenantService";
import { exportRowsToCsv, exportRowsToPdf } from "../../services/exportService";

const tenants = ref<SuperTenant[]>([]);
const rows = ref<SuperLogEntry[]>([]);
const tenantFilter = ref("all");
const actionFilter = ref("all");
const search = ref("");
const page = ref(1);
const pageSize = ref(50);
const startAt = ref("");
const endAt = ref("");
const isLoading = ref(false);
const error = ref("");
const toastTitle = ref("");
const toastMessage = ref("");
let toastTimer: number | null = null;

const showToast = (title: string, message: string) => {
  toastTitle.value = title;
  toastMessage.value = message;
  if (toastTimer) window.clearTimeout(toastTimer);
  toastTimer = window.setTimeout(() => {
    toastTitle.value = "";
    toastMessage.value = "";
    toastTimer = null;
  }, 4000);
};

const formatDateTime = (value: string) => {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString();
};

const loadTenants = async () => {
  tenants.value = await listTenants("", "all");
};

const loadLogs = async () => {
  isLoading.value = true;
  error.value = "";
  try {
    const result = await listSuperLogs({
      tenant_id: tenantFilter.value,
      action_type: actionFilter.value,
      search: search.value.trim(),
      start_at: startAt.value ? new Date(startAt.value).toISOString() : undefined,
      end_at: endAt.value ? new Date(endAt.value).toISOString() : undefined,
      page: page.value,
      page_size: pageSize.value,
    });
    rows.value = result.rows;
  } catch (err) {
    error.value = err instanceof Error ? err.message : "Unable to load logs.";
  } finally {
    isLoading.value = false;
  }
};

const nextPage = async () => {
  page.value += 1;
  await loadLogs();
};

const prevPage = async () => {
  if (page.value <= 1) return;
  page.value -= 1;
  await loadLogs();
};

const exportCsv = () => {
  if (!rows.value.length) {
    showToast("Export", "No rows to export.");
    return;
  }
  exportRowsToCsv(`super-logs-page-${page.value}.csv`, ["time", "tenant", "action", "gear_name", "gear_barcode", "student"], rows.value.map((row) => ({
    time: formatDateTime(row.action_time),
    tenant: row.tenant?.name ?? row.tenant_id,
    action: row.action_type,
    gear_name: row.gear?.name ?? "",
    gear_barcode: row.gear?.barcode ?? "",
    student: row.student ? `${row.student.first_name} ${row.student.last_name} (${row.student.student_id})` : "",
  })));
};

const exportPdf = () => {
  if (!rows.value.length) {
    showToast("Export", "No rows to export.");
    return;
  }
  exportRowsToPdf(`super-logs-page-${page.value}.pdf`, "Super Logs Export", ["time", "tenant", "action", "gear_name", "gear_barcode", "student"], rows.value.map((row) => ({
    time: formatDateTime(row.action_time),
    tenant: row.tenant?.name ?? row.tenant_id,
    action: row.action_type,
    gear_name: row.gear?.name ?? "",
    gear_barcode: row.gear?.barcode ?? "",
    student: row.student ? `${row.student.first_name} ${row.student.last_name} (${row.student.student_id})` : "",
  })));
};

onMounted(async () => {
  await loadTenants();
  await loadLogs();
});
</script>
