<template>
  <div class="page">
    <h1>Gear Logs</h1>
    <p>View checkout and return history.</p>
        <p3> Ability to export logs data to PDF and CSV coming soon.</p3>

    <div class="card">
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
          <tr v-for="log in logs" :key="log.id">
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
import { fetchGearLogs, type GearLog } from "../../../services/gearService";

const logs = ref<GearLog[]>([]);
const isLoading = ref(false);
const error = ref("");

const loadLogs = async () => {
  isLoading.value = true;
  error.value = "";
  try {
    logs.value = await fetchGearLogs();
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

onMounted(loadLogs);
</script>
