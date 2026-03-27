<template>
  <div class="page admin-shell">
    <div class="admin-hero">
      <div class="page-nav-left">
        <RouterLink class="button-link" to="/tenant/admin">Return to admin panel</RouterLink>
      </div>
      <h1>Item Logs</h1>
      <p class="admin-hero-copy">Filter checkout and return activity, then export the current view to PDF and CSV.</p>
    </div>

    <div class="card admin-section-card">
      <div class="admin-section-header">
        <div>
          <h2>History</h2>
          <p class="admin-section-copy">Search by action, borrower, item, or date range.</p>
        </div>
        <div class="admin-toolbar-actions">
          <button type="button" @click="exportCsv">Export CSV</button>
          <button type="button" @click="exportPdf">Export PDF</button>
        </div>
      </div>
      <div class="form-grid-2">
        <label>
          Search logs
          <input
            v-model="searchQuery"
            type="text"
            placeholder="Search by action, borrower, item name, or barcode"
          />
        </label>
        <label>
          Action
          <select v-model="actionFilter">
            <option value="all">all actions</option>
            <option value="checkout">checkout</option>
            <option value="return">return</option>
            <option value="admin_return">admin_return</option>
          </select>
        </label>
        <label>
          From
          <input v-model="dateFrom" type="date" />
        </label>
        <label>
          To
          <input v-model="dateTo" type="date" />
        </label>
      </div>
      <p class="muted">Showing {{ filteredLogs.length }} of {{ logs.length }} log entries.</p>
      <p v-if="isLoading" class="muted">Loading logs...</p>
      <div v-else class="table-wrap">
      <table class="table">
        <thead>
          <tr>
            <th>Time</th>
            <th>Action</th>
            <th>Borrower</th>
            <th>Item</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="log in filteredLogs" :key="log.id">
            <td>{{ formatTime(log.action_time) }}</td>
            <td>{{ log.action_type }}</td>
            <td>
              <span v-if="log.student">
                {{ log.student.username }} ({{ log.student.student_id }})
              </span>
              <span v-else class="muted">-</span>
            </td>
            <td>
              <span v-if="log.gear">
                {{ log.gear.name }} ({{ log.gear.barcode }})
              </span>
              <span v-else class="muted">-</span>
            </td>
          </tr>
          <tr v-if="!filteredLogs.length">
            <td colspan="4" class="muted">No logs match your search. If you believe this is an error, please contact support.</td>
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
import { fetchGearLogs, type GearLog } from "../../../services/gearService";
import { exportRowsToCsv, exportRowsToPdf } from "../../../services/exportService";

const logs = ref<GearLog[]>([]);
const isLoading = ref(false);
const error = ref("");
const searchQuery = ref("");
const actionFilter = ref("all");
const dateFrom = ref("");
const dateTo = ref("");

const filteredLogs = computed(() => {
  const query = searchQuery.value.trim().toLowerCase();
  if (!query) {
    return logs.value;
  }

  return logs.value.filter((log) => {
    if (actionFilter.value !== "all" && log.action_type !== actionFilter.value) {
      return false;
    }

    const timestamp = Date.parse(log.action_time);
    if (dateFrom.value) {
      const fromTs = Date.parse(`${dateFrom.value}T00:00:00`);
      if (!Number.isNaN(timestamp) && !Number.isNaN(fromTs) && timestamp < fromTs) {
        return false;
      }
    }
    if (dateTo.value) {
      const toTs = Date.parse(`${dateTo.value}T23:59:59`);
      if (!Number.isNaN(timestamp) && !Number.isNaN(toTs) && timestamp > toTs) {
        return false;
      }
    }

    const action = (log.action_type || "").toLowerCase();
    const student = log.student
      ? `${log.student.username} ${log.student.student_id}`.toLowerCase()
      : "";
    const gear = log.gear ? `${log.gear.name} ${log.gear.barcode}`.toLowerCase() : "";
    return action.includes(query) || student.includes(query) || gear.includes(query);
  });
});

const loadLogs = async () => {
  isLoading.value = true;
  error.value = "";
  try {
    logs.value = await fetchGearLogs();
  } catch (err) {
    error.value = err instanceof Error ? err.message : "Unable to load logs. Please sign out completeley and sign back in.";
  } finally {
    isLoading.value = false;
  }
};

const exportRows = computed(() =>
  filteredLogs.value.map((log) => ({
    action_time: formatTime(log.action_time),
    action_type: log.action_type,
    student: log.student
      ? `${log.student.username} (${log.student.student_id})`
      : "",
    item: log.gear ? `${log.gear.name} (${log.gear.barcode})` : "",
  }))
);

const exportCsv = () => {
  exportRowsToCsv(
    `item-logs-${new Date().toISOString().slice(0, 10)}.csv`,
    ["action_time", "action_type", "student", "item"],
    exportRows.value
  );
};

const exportPdf = async () => {
  await exportRowsToPdf(
    `item-logs-${new Date().toISOString().slice(0, 10)}.pdf`,
    "Item Logs Export",
    ["action_time", "action_type", "student", "item"],
    exportRows.value
  );
};

const formatTime = (value: string) => {
  const date = new Date(value);
  return date.toLocaleString();
};

onMounted(loadLogs);
</script>
