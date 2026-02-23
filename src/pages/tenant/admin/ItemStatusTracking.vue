<template>
  <div class="page">
    <div class="page-nav-left">
      <RouterLink class="button-link" to="/tenant/admin">Return to admin panel</RouterLink>
    </div>

    <h1>Item Status Tracking</h1>
    <p v-if="!featureEnabled" class="error">Item status tracking is disabled for this tenant.</p>
    <p v-else>Track statuses other than available and checked_out.</p>

    <div v-if="featureEnabled" class="card">
      <h2>Current flagged items</h2>
      <div class="form-grid-2">
        <label>
          Search
          <input
            v-model="searchQuery"
            type="text"
            placeholder="Search by item name, barcode, status, or note"
          />
        </label>
        <label>
          Status
          <select v-model="statusFilter">
            <option value="all">all statuses</option>
            <option value="damaged">damaged</option>
            <option value="lost">lost</option>
            <option value="in_repair">in_repair</option>
            <option value="retired">retired</option>
            <option value="in_studio_only">in_studio_only</option>
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
          <tr v-for="item in filteredFlaggedItems" :key="item.id">
            <td>{{ item.name }}</td>
            <td>{{ item.barcode }}</td>
            <td>{{ item.status }}</td>
            <td>{{ formatDate(item.updated_at) }}</td>
            <td>{{ item.notes || "-" }}</td>
          </tr>
          <tr v-if="filteredFlaggedItems.length === 0">
            <td colspan="5" class="muted">No flagged items.</td>
          </tr>
        </tbody>
      </table>
      <div class="form-actions">
        <button type="button" @click="exportFlaggedCsv">Export CSV</button>
        <button type="button" @click="exportFlaggedPdf">Export PDF</button>
      </div>
    </div>

    <div v-if="featureEnabled" class="card">
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
          <tr v-for="event in filteredHistory" :key="event.id">
            <td>{{ formatDate(event.changed_at) }}</td>
            <td>{{ event.gear?.name || "-" }} ({{ event.gear?.barcode || "-" }})</td>
            <td>{{ event.status }}</td>
            <td>{{ event.note || "-" }}</td>
          </tr>
          <tr v-if="filteredHistory.length === 0">
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
import { computed, onMounted, onUnmounted, ref } from "vue";
import { RouterLink } from "vue-router";
import {
  fetchTenantSettings,
  fetchStatusTracking,
  type StatusHistoryItem,
  type StatusTrackedItem,
} from "../../../services/adminOpsService";
import { exportRowsToCsv, exportRowsToPdf } from "../../../services/exportService";

const flaggedItems = ref<StatusTrackedItem[]>([]);
const history = ref<StatusHistoryItem[]>([]);
const isLoading = ref(false);
const toastTitle = ref("");
const toastMessage = ref("");
const searchQuery = ref("");
const statusFilter = ref("all");
const dateFrom = ref("");
const dateTo = ref("");
const featureEnabled = ref(true);
let toastTimer: number | null = null;

const withinDateRange = (value: string) => {
  const timestamp = Date.parse(value);
  if (Number.isNaN(timestamp)) return true;
  if (dateFrom.value) {
    const fromTs = Date.parse(`${dateFrom.value}T00:00:00`);
    if (!Number.isNaN(fromTs) && timestamp < fromTs) return false;
  }
  if (dateTo.value) {
    const toTs = Date.parse(`${dateTo.value}T23:59:59`);
    if (!Number.isNaN(toTs) && timestamp > toTs) return false;
  }
  return true;
};

const filteredFlaggedItems = computed(() => {
  const query = searchQuery.value.trim().toLowerCase();
  return flaggedItems.value.filter((item) => {
    if (statusFilter.value !== "all" && item.status !== statusFilter.value) return false;
    if (!withinDateRange(item.updated_at)) return false;
    if (!query) return true;
    const haystack = `${item.name} ${item.barcode} ${item.status} ${item.notes ?? ""}`.toLowerCase();
    return haystack.includes(query);
  });
});

const filteredHistory = computed(() => {
  const query = searchQuery.value.trim().toLowerCase();
  return history.value.filter((event) => {
    if (statusFilter.value !== "all" && event.status !== statusFilter.value) return false;
    if (!withinDateRange(event.changed_at)) return false;
    if (!query) return true;
    const haystack = `${event.gear?.name ?? ""} ${event.gear?.barcode ?? ""} ${event.status} ${event.note ?? ""}`.toLowerCase();
    return haystack.includes(query);
  });
});

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
    flaggedItems.value = payload.flagged_items;
    history.value = payload.history;
  } catch (err) {
    showToast("Load failed", err instanceof Error ? err.message : "Unable to load status tracking.");
  } finally {
    isLoading.value = false;
  }
};

const exportFlaggedCsv = () => {
  exportRowsToCsv(
    `item-status-${new Date().toISOString().slice(0, 10)}.csv`,
    ["name", "barcode", "status", "updated_at", "notes"],
    filteredFlaggedItems.value
  );
};

const exportFlaggedPdf = async () => {
  await exportRowsToPdf(
    `item-status-${new Date().toISOString().slice(0, 10)}.pdf`,
    "Item Status Tracking",
    ["name", "barcode", "status", "updated_at", "notes"],
    filteredFlaggedItems.value
  );
};

const exportHistoryCsv = () => {
  exportRowsToCsv(
    `item-status-history-${new Date().toISOString().slice(0, 10)}.csv`,
    ["changed_at", "item", "barcode", "status", "note"],
    filteredHistory.value.map((event) => ({
      changed_at: formatDate(event.changed_at),
      item: event.gear?.name || "",
      barcode: event.gear?.barcode || "",
      status: event.status,
      note: event.note || "",
    }))
  );
};

const exportHistoryPdf = async () => {
  await exportRowsToPdf(
    `item-status-history-${new Date().toISOString().slice(0, 10)}.pdf`,
    "Item Status History",
    ["changed_at", "item", "barcode", "status", "note"],
    filteredHistory.value.map((event) => ({
      changed_at: formatDate(event.changed_at),
      item: event.gear?.name || "",
      barcode: event.gear?.barcode || "",
      status: event.status,
      note: event.note || "",
    }))
  );
};

onMounted(() => {
  void (async () => {
    try {
      const settings = await fetchTenantSettings();
      featureEnabled.value = settings.feature_flags.enable_status_tracking;
    } catch {
      featureEnabled.value = true;
    }
    if (featureEnabled.value) {
      await loadStatusTracking();
    }
  })();
});

onUnmounted(() => {
  if (toastTimer) {
    window.clearTimeout(toastTimer);
    toastTimer = null;
  }
});
</script>
