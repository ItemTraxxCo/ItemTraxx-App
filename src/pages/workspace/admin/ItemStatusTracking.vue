<template>
  <div class="page admin-shell">
    <div class="admin-hero">
      <div class="page-nav-left">
        <RouterLink class="button-link" :to="managerRoot">Back</RouterLink>
      </div>
      <h1>Item Status Tracking</h1>
      <p v-if="!featureEnabled" class="error">Item status tracking is disabled.</p>
      <p v-else class="admin-hero-copy">Track damaged, lost, repair and retired inventory states.</p>
    </div>

    <div v-if="featureEnabled" class="card admin-section-card">
      <div class="admin-section-header">
        <div>
          <h2>Current Flagged Items</h2>
          <p class="admin-section-copy">Filter by status, date range, and free-text search.</p>
        </div>
        <div class="admin-toolbar-actions">
          <button v-if="loadError" type="button" :disabled="isLoading" @click="loadStatusTracking">Retry</button>
          <button type="button" :disabled="isLoading || Boolean(loadError)" @click="exportFlaggedCsv">Export CSV</button>
          <button type="button" :disabled="isLoading || Boolean(loadError)" @click="exportFlaggedPdf">Export PDF</button>
        </div>
      </div>
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
            <option value="all">All statuses</option>
            <option v-for="status in statusOptions" :key="status" :value="status">
              {{ formatItemStatus(status) }}
            </option>
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
      <p
        v-if="focusedItemId && !isLoading && !loadError"
        class="focus-note"
        :class="{ 'is-fading': isHighlightFading }"
        role="status"
      >
        <span v-if="focusedItemName">Showing <strong>{{ focusedItemName }}</strong>.</span>
        <span v-else>The selected item no longer has status activity to show.</span>
        <RouterLink :to="{ path: route.path }">Show all items</RouterLink>
      </p>
      <p v-if="isLoading" class="muted">Loading status tracking...</p>
      <div v-else class="table-wrap">
      <table class="table">
        <thead>
          <tr>
            <th>Name</th>
            <th>Barcode</th>
            <th>Status</th>
            <th>Last status change</th>
            <th>Notes</th>
          </tr>
        </thead>
        <tbody>
          <tr
            v-for="item in filteredFlaggedItems"
            :key="item.id"
            :class="{ 'row-focused': item.id === focusedItemId, 'row-fading': isHighlightFading }"
            :data-focus-row="item.id === focusedItemId ? 'true' : undefined"
          >
            <td>{{ item.name }}</td>
            <td>{{ item.barcode }}</td>
            <td>{{ formatItemStatus(item.status) }}</td>
            <td :title="latestStatusChangeAt.has(item.id) ? undefined : 'No status history is recorded; showing the item record update date.'">
              {{ formatDate(statusTimestampFor(item)) }}
            </td>
            <td data-session-replay-mask>{{ item.notes || "-" }}</td>
          </tr>
          <tr v-if="!isLoading && !loadError && filteredFlaggedItems.length === 0">
            <td colspan="5" class="muted">No flagged items.</td>
          </tr>
          <tr v-if="!isLoading && loadError">
            <td colspan="5" class="error">{{ loadError }}</td>
          </tr>
        </tbody>
      </table>
      </div>
    </div>

    <div v-if="featureEnabled" class="card admin-section-card">
      <div class="admin-section-header">
        <div>
          <h2>Status History</h2>
          <p class="admin-section-copy">Review chronological status changes for inventory.</p>
        </div>
        <div class="admin-toolbar-actions">
          <button type="button" :disabled="isLoading || Boolean(loadError)" @click="exportHistoryCsv">Export CSV</button>
          <button type="button" :disabled="isLoading || Boolean(loadError)" @click="exportHistoryPdf">Export PDF</button>
        </div>
      </div>
      <div class="table-wrap">
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
          <tr v-if="isLoading">
            <td colspan="4" class="muted" role="status">Loading status history...</td>
          </tr>
          <tr
            v-for="event in filteredHistory"
            :key="event.id"
            :class="{ 'row-focused': event.item_id === focusedItemId, 'row-fading': isHighlightFading }"
            :data-focus-row="event.item_id === focusedItemId ? 'true' : undefined"
          >
            <td>{{ formatDate(event.changed_at) }}</td>
            <td>{{ event.item?.name || "-" }} ({{ event.item?.barcode || "-" }})</td>
            <td>{{ formatItemStatus(event.status) }}</td>
            <td data-session-replay-mask>{{ event.note || "-" }}</td>
          </tr>
          <tr v-if="!isLoading && !loadError && filteredHistory.length === 0">
            <td colspan="4" class="muted">No status history found.</td>
          </tr>
          <tr v-if="!isLoading && loadError">
            <td colspan="4" class="error">{{ loadError }}</td>
          </tr>
        </tbody>
      </table>
      </div>
    </div>

    <div v-if="toastMessage" class="toast">
      <div class="toast-title">{{ toastTitle }}</div>
      <div class="toast-body">{{ toastMessage }}</div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, nextTick, onMounted, onUnmounted, ref, watch } from "vue";
import { RouterLink, useRoute, useRouter } from "vue-router";
import {
  fetchWorkspaceSettings,
  fetchStatusTracking,
  type StatusHistoryItem,
  type StatusTrackedItem,
} from "../../../services/adminOpsService";
import { exportRowsToCsv, exportRowsToPdf } from "../../../services/exportService";
import { toUserFacingErrorMessage } from "../../../services/appErrors";
import { useManagerContext } from "../../../composables/useManagerContext";
import { formatItemStatus, ITEM_STATUS_OPTIONS } from "../../../utils/itemStatus";

const { managerRoot } = useManagerContext();
const route = useRoute();
const router = useRouter();

const flaggedItems = ref<StatusTrackedItem[]>([]);
const history = ref<StatusHistoryItem[]>([]);
const isLoading = ref(true);
const loadError = ref("");
const toastTitle = ref("");
const toastMessage = ref("");
const searchQuery = ref("");
const statusFilter = ref("all");
const statusOptions = ITEM_STATUS_OPTIONS.filter((status) => status !== "available" && status !== "checked_out");
const dateFrom = ref("");
const dateTo = ref("");
const featureEnabled = ref(true);
let toastTimer: number | null = null;

// Notification links deep-link here with ?item=<id>; that item's rows are
// highlighted and scrolled into view.
const focusedItemId = computed(() =>
  typeof route.query.item === "string" && route.query.item ? route.query.item : null
);

const focusedItemName = computed(() => {
  const id = focusedItemId.value;
  if (!id) return "";
  const flagged = flaggedItems.value.find((item) => item.id === id);
  if (flagged) return flagged.name;
  return history.value.find((event) => event.item_id === id)?.item?.name ?? "";
});

// The deep-link highlight stays for HIGHLIGHT_VISIBLE_MS, fades out over
// HIGHLIGHT_FADE_MS, then ?item= is dropped so a reload doesn't bring it back.
const HIGHLIGHT_VISIBLE_MS = 4000;
const HIGHLIGHT_FADE_MS = 600;
const isHighlightFading = ref(false);
let highlightFadeTimer: number | null = null;
let highlightClearTimer: number | null = null;

const clearHighlightTimers = () => {
  if (highlightFadeTimer) window.clearTimeout(highlightFadeTimer);
  if (highlightClearTimer) window.clearTimeout(highlightClearTimer);
  highlightFadeTimer = null;
  highlightClearTimer = null;
};

const scheduleHighlightFade = () => {
  clearHighlightTimers();
  isHighlightFading.value = false;
  if (!focusedItemId.value) return;
  highlightFadeTimer = window.setTimeout(() => {
    highlightFadeTimer = null;
    isHighlightFading.value = true;
    highlightClearTimer = window.setTimeout(() => {
      highlightClearTimer = null;
      const { item: _item, ...rest } = route.query;
      void router.replace({ path: route.path, query: rest, hash: route.hash });
    }, HIGHLIGHT_FADE_MS);
  }, HIGHLIGHT_VISIBLE_MS);
};

const scrollToFocusedRow = async () => {
  if (!focusedItemId.value) return;
  scheduleHighlightFade();
  await nextTick();
  const row = document.querySelector<HTMLElement>('[data-focus-row="true"]');
  row?.scrollIntoView({ block: "center", behavior: "smooth" });
};

const latestStatusChangeAt = computed(() => {
  const latestByItem = new Map<string, string>();
  for (const event of history.value) {
    const current = latestByItem.get(event.item_id);
    if (!current || Date.parse(event.changed_at) > Date.parse(current)) {
      latestByItem.set(event.item_id, event.changed_at);
    }
  }
  return latestByItem;
});

const statusTimestampFor = (item: StatusTrackedItem) =>
  latestStatusChangeAt.value.get(item.id) ?? item.updated_at;

const withinDateRange = (value: string) => {
  const timestamp = Date.parse(value);
  if (Number.isNaN(timestamp)) return true;
  if (dateFrom.value) {
    const fromTs = Date.parse(`${dateFrom.value}T00:00:00`);
    if (!Number.isNaN(fromTs) && timestamp < fromTs) return false;
  }
  if (dateTo.value) {
    const toTs = Date.parse(`${dateTo.value}T00:00:00`);
    if (!Number.isNaN(toTs)) {
      const endExclusive = new Date(toTs);
      endExclusive.setDate(endExclusive.getDate() + 1);
      if (timestamp >= endExclusive.getTime()) return false;
    }
  }
  return true;
};

const filteredFlaggedItems = computed(() => {
  const query = searchQuery.value.trim().toLowerCase();
  return flaggedItems.value.filter((item) => {
    if (statusFilter.value !== "all" && item.status !== statusFilter.value) return false;
    if (!withinDateRange(statusTimestampFor(item))) return false;
    if (!query) return true;
    const haystack = [
      item.name,
      item.barcode,
      item.status,
      formatItemStatus(item.status),
      item.notes ?? "",
    ]
      .join(" ")
      .toLowerCase();
    return haystack.includes(query);
  });
});

const filteredHistory = computed(() => {
  const query = searchQuery.value.trim().toLowerCase();
  return history.value.filter((event) => {
    if (statusFilter.value !== "all" && event.status !== statusFilter.value) return false;
    if (!withinDateRange(event.changed_at)) return false;
    if (!query) return true;
    const haystack = [
      event.item?.name ?? "",
      event.item?.barcode ?? "",
      event.status,
      formatItemStatus(event.status),
      event.note ?? "",
    ]
      .join(" ")
      .toLowerCase();
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
  loadError.value = "";
  try {
    const payload = await fetchStatusTracking();
    flaggedItems.value = payload.flagged_items;
    history.value = payload.history;
    void scrollToFocusedRow();
  } catch (err) {
    loadError.value = toUserFacingErrorMessage(err, "Unable to load status tracking.");
    showToast("Load failed", loadError.value);
  } finally {
    isLoading.value = false;
  }
};

const exportFlaggedCsv = () => {
  exportRowsToCsv(
    `item-status-${new Date().toISOString().slice(0, 10)}.csv`,
    ["Name", "Barcode", "Status", "Last status change", "Notes"],
    filteredFlaggedItems.value.map((item) => ({
      Name: item.name,
      Barcode: item.barcode,
      Status: formatItemStatus(item.status),
      "Last status change": statusTimestampFor(item),
      Notes: item.notes,
    }))
  );
};

const exportFlaggedPdf = async () => {
  await exportRowsToPdf(
    `item-status-${new Date().toISOString().slice(0, 10)}.pdf`,
    "Item Status Tracking",
    ["Name", "Barcode", "Status", "Last status change", "Notes"],
    filteredFlaggedItems.value.map((item) => ({
      Name: item.name,
      Barcode: item.barcode,
      Status: formatItemStatus(item.status),
      "Last status change": statusTimestampFor(item),
      Notes: item.notes,
    }))
  );
};

const exportHistoryCsv = () => {
  exportRowsToCsv(
    `item-status-history-${new Date().toISOString().slice(0, 10)}.csv`,
    ["changed_at", "item", "barcode", "status", "note"],
    filteredHistory.value.map((event) => ({
      changed_at: formatDate(event.changed_at),
      item: event.item?.name || "",
      barcode: event.item?.barcode || "",
      status: formatItemStatus(event.status),
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
      item: event.item?.name || "",
      barcode: event.item?.barcode || "",
      status: formatItemStatus(event.status),
      note: event.note || "",
    }))
  );
};

onMounted(() => {
  void (async () => {
    try {
      const settings = await fetchWorkspaceSettings();
      featureEnabled.value = settings.feature_flags.enable_status_tracking;
    } catch {
      featureEnabled.value = true;
    }
    if (featureEnabled.value) {
      await loadStatusTracking();
    } else {
      isLoading.value = false;
    }
  })();
});

watch(focusedItemId, (itemId) => {
  if (!itemId) {
    clearHighlightTimers();
    isHighlightFading.value = false;
    return;
  }
  // Clear filters so a stale search can't hide the item the user asked for.
  searchQuery.value = "";
  statusFilter.value = "all";
  dateFrom.value = "";
  dateTo.value = "";
  if (!isLoading.value) void scrollToFocusedRow();
});

onUnmounted(() => {
  clearHighlightTimers();
  if (toastTimer) {
    window.clearTimeout(toastTimer);
    toastTimer = null;
  }
});
</script>

<style scoped>
.focus-note {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 0.5rem;
  margin: 0 0 0.75rem;
  font-size: 0.9rem;
}

.focus-note {
  transition: opacity 600ms ease;
}

.focus-note.is-fading {
  opacity: 0;
}

.row-focused td {
  background-color: rgba(245, 158, 11, 0.14);
  transition: background-color 600ms ease;
}

.row-focused.row-fading td {
  background-color: rgba(245, 158, 11, 0);
}

@media (prefers-reduced-motion: reduce) {
  .focus-note,
  .row-focused td {
    transition: none;
  }
}
</style>
