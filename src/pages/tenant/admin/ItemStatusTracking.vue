<template>
  <div class="page">
    <div class="page-nav-left">
      <RouterLink class="button-link" to="/tenant/admin">Return to admin panel</RouterLink>
      <button type="button" class="button-link" :disabled="isSaving" @click="saveDueLimit">
        Save Due Limit
      </button>
      <button type="button" class="button-link" :disabled="isSaving" @click="sendRemindersNow">
        Send Overdue Email Reminders
      </button>
    </div>

    <h1>Item Status Tracking</h1>
    <p>Track statuses other than available and checked_out.</p>

    <div class="card">
      <h2>Overdue reminder settings</h2>
      <label>
        Checkout due time limit (hours)
        <input v-model.number="dueHours" type="number" min="1" max="720" />
      </label>
      <p class="muted">Reminders are sent for checked_out items older than this limit.</p>
    </div>

    <div class="card">
      <h2>Current flagged items</h2>
      <p v-if="isLoading" class="muted">Loading status tracking...</p>
      <table v-else class="table">
        <thead>
          <tr>
            <th>Name</th>
            <th>Barcode</th>
            <th>Status</th>
            <th>Updated</th>
            <th>Notes</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="item in flaggedItems" :key="item.id">
            <td>{{ item.name }}</td>
            <td>{{ item.barcode }}</td>
            <td>{{ item.status }}</td>
            <td>{{ formatDate(item.updated_at) }}</td>
            <td>{{ item.notes || "-" }}</td>
          </tr>
          <tr v-if="flaggedItems.length === 0">
            <td colspan="5" class="muted">No flagged items.</td>
          </tr>
        </tbody>
      </table>
      <div class="form-actions">
        <button type="button" @click="exportFlaggedCsv">Export CSV</button>
        <button type="button" @click="exportFlaggedPdf">Export PDF</button>
      </div>
    </div>

    <div class="card">
      <h2>Status history</h2>
      <table class="table">
        <thead>
          <tr>
            <th>Time</th>
            <th>Item</th>
            <th>Status</th>
            <th>Note</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="event in history" :key="event.id">
            <td>{{ formatDate(event.changed_at) }}</td>
            <td>{{ event.gear?.name || "-" }} ({{ event.gear?.barcode || "-" }})</td>
            <td>{{ event.status }}</td>
            <td>{{ event.note || "-" }}</td>
          </tr>
          <tr v-if="history.length === 0">
            <td colspan="4" class="muted">No status history found.</td>
          </tr>
        </tbody>
      </table>
      <div class="form-actions">
        <button type="button" @click="exportHistoryCsv">Export CSV</button>
        <button type="button" @click="exportHistoryPdf">Export PDF</button>
      </div>
    </div>

    <div v-if="toastMessage" class="toast">
      <div class="toast-title">{{ toastTitle }}</div>
      <div class="toast-body">{{ toastMessage }}</div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { onMounted, onUnmounted, ref } from "vue";
import { RouterLink } from "vue-router";
import {
  fetchStatusTracking,
  saveDuePolicy,
  sendOverdueReminders,
  type StatusHistoryItem,
  type StatusTrackedItem,
} from "../../../services/adminOpsService";
import { exportRowsToCsv, exportRowsToPdf } from "../../../services/exportService";

const dueHours = ref(72);
const flaggedItems = ref<StatusTrackedItem[]>([]);
const history = ref<StatusHistoryItem[]>([]);
const isLoading = ref(false);
const isSaving = ref(false);
const toastTitle = ref("");
const toastMessage = ref("");
let toastTimer: number | null = null;

const showToast = (title: string, message: string) => {
  toastTitle.value = title;
  toastMessage.value = message;
  if (toastTimer) {
    window.clearTimeout(toastTimer);
  }
  toastTimer = window.setTimeout(() => {
    toastTitle.value = "";
    toastMessage.value = "";
    toastTimer = null;
  }, 4000);
};

const formatDate = (value: string) => {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString();
};

const loadStatusTracking = async () => {
  isLoading.value = true;
  try {
    const payload = await fetchStatusTracking();
    dueHours.value = payload.due_hours;
    flaggedItems.value = payload.flagged_items;
    history.value = payload.history;
  } catch (err) {
    showToast("Load failed", err instanceof Error ? err.message : "Unable to load status tracking.");
  } finally {
    isLoading.value = false;
  }
};

const saveDueLimit = async () => {
  isSaving.value = true;
  try {
    await saveDuePolicy(dueHours.value);
    showToast("Saved", "Due time limit updated.");
  } catch (err) {
    showToast("Save failed", err instanceof Error ? err.message : "Unable to save due time limit.");
  } finally {
    isSaving.value = false;
  }
};

const sendRemindersNow = async () => {
  isSaving.value = true;
  try {
    const result = await sendOverdueReminders();
    showToast("Reminders sent", `Sent ${result.sent}/${result.recipients} reminder emails.`);
  } catch (err) {
    showToast("Reminder failed", err instanceof Error ? err.message : "Unable to send reminders.");
  } finally {
    isSaving.value = false;
  }
};

const exportFlaggedCsv = () => {
  exportRowsToCsv(
    `item-status-${new Date().toISOString().slice(0, 10)}.csv`,
    ["name", "barcode", "status", "updated_at", "notes"],
    flaggedItems.value
  );
};

const exportFlaggedPdf = () => {
  exportRowsToPdf(
    `item-status-${new Date().toISOString().slice(0, 10)}.pdf`,
    "Item Status Tracking",
    ["name", "barcode", "status", "updated_at", "notes"],
    flaggedItems.value
  );
};

const exportHistoryCsv = () => {
  exportRowsToCsv(
    `item-status-history-${new Date().toISOString().slice(0, 10)}.csv`,
    ["changed_at", "item", "barcode", "status", "note"],
    history.value.map((event) => ({
      changed_at: formatDate(event.changed_at),
      item: event.gear?.name || "",
      barcode: event.gear?.barcode || "",
      status: event.status,
      note: event.note || "",
    }))
  );
};

const exportHistoryPdf = () => {
  exportRowsToPdf(
    `item-status-history-${new Date().toISOString().slice(0, 10)}.pdf`,
    "Item Status History",
    ["changed_at", "item", "barcode", "status", "note"],
    history.value.map((event) => ({
      changed_at: formatDate(event.changed_at),
      item: event.gear?.name || "",
      barcode: event.gear?.barcode || "",
      status: event.status,
      note: event.note || "",
    }))
  );
};

onMounted(() => {
  void loadStatusTracking();
});

onUnmounted(() => {
  if (toastTimer) {
    window.clearTimeout(toastTimer);
    toastTimer = null;
  }
});
</script>
