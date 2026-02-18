<template>
  <div class="page">
    <div class="page-nav-left">
      <RouterLink class="button-link" to="/tenant/admin">Return to admin panel</RouterLink>
    </div>
    <h1>Item Logs</h1>
    <p>View checkout and return history.</p>
    <p class="muted">Export filtered logs to CSV or PDF.</p>

    <div class="card">
      <label>
        Search logs
        <input
          v-model="searchQuery"
          type="text"
          placeholder="Search by action, student, item name, or barcode"
        />
      </label>
      <div class="form-actions">
        <button type="button" @click="exportCsv">Export CSV</button>
        <button type="button" @click="exportPdf">Export PDF</button>
      </div>
      <p class="muted">Showing {{ filteredLogs.length }} of {{ logs.length }} log entries.</p>
      <p v-if="isLoading" class="muted">Loading logs...</p>
      <table v-else class="table">
        <thead>
          <tr>
            <th>Time</th>
            <th>Action</th>
            <th>Student</th>
            <th>Item</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="log in filteredLogs" :key="log.id">
            <td>{{ formatTime(log.action_time) }}</td>
            <td>{{ log.action_type }}</td>
            <td>
              <span v-if="log.student">
                {{ log.student.last_name }}, {{ log.student.first_name }}
                ({{ log.student.student_id }})
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
            <td colspan="4" class="muted">No logs match your search.</td>
          </tr>
        </tbody>
      </table>
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

const filteredLogs = computed(() => {
  const query = searchQuery.value.trim().toLowerCase();
  if (!query) {
    return logs.value;
  }

  return logs.value.filter((log) => {
    const action = (log.action_type || "").toLowerCase();
    const student = log.student
      ? `${log.student.first_name} ${log.student.last_name} ${log.student.student_id}`.toLowerCase()
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
      ? `${log.student.last_name}, ${log.student.first_name} (${log.student.student_id})`
      : "",
    item: log.gear ? `${log.gear.name} (${log.gear.barcode})` : "",
  }))
);

const exportCsv = () => {
  exportRowsToCsv(
    `gear-logs-${new Date().toISOString().slice(0, 10)}.csv`,
    ["action_time", "action_type", "student", "item"],
    exportRows.value
  );
};

const exportPdf = () => {
  exportRowsToPdf(
    `gear-logs-${new Date().toISOString().slice(0, 10)}.pdf`,
    "Gear Logs Export",
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
