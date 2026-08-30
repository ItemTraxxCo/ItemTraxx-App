<template>
  <section v-if="showStatus" class="offline-workflow-status" aria-label="Offline checkout status">
    <div class="offline-workflow-status-content">
      <strong>{{ statusTitle }}</strong>
      <span>{{ statusDetail }}</span>
    </div>
    <button
      type="button"
      class="button-secondary offline-sync-button"
      :disabled="syncInFlight"
      @click="syncNow(true)"
    >
      {{ syncInFlight ? "Syncing…" : "Sync now" }}
    </button>
  </section>
  <div v-if="message" class="toast" :class="{ 'toast-persist': messageKind === 'error' }" role="status" aria-live="polite">
    <div class="toast-title">{{ messageTitle }}</div>
    <div class="toast-body">{{ message }}</div>
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, onScopeDispose, ref } from "vue";
import { syncCheckoutQueues, type CheckoutQueueSyncResult } from "../services/checkoutService";
import {
  getOfflineWorkflowSummary,
  isOfflineSessionInitializingError,
  OFFLINE_PACK_REFRESH_INTERVAL_MS,
  refreshOfflineCheckoutPackIfNeeded,
} from "../services/offlineCheckoutWorkflow";
import { getOfflineQueueSummary } from "../services/offlineCheckoutQueue";
import { markItemTraxxServerUnreachable, readOfflineConnectionState } from "../services/offlineConnectionState";
import { toUserFacingErrorMessage } from "../services/appErrors";

type Summary = Awaited<ReturnType<typeof getOfflineWorkflowSummary>>;
const summary = ref<Summary>({ pack: null, packExpired: false, pendingCount: 0, syncingCount: 0, reviewCount: 0 });
const connection = ref(readOfflineConnectionState());
const message = ref("");
const messageKind = ref<"success" | "error" | "info">("success");
const syncInFlight = ref(false);
let pollTimer: number | null = null;
let refreshTimer: number | null = null;
let syncTimer: number | null = null;
let toastTimer: number | null = null;
let offlineSafetyNoticeShown = false;
let preparationNoticeShown = false;
let initialSummaryLoaded = false;
let sessionInitializationRetryTimer: number | null = null;
let sessionInitializationRetryUsed = false;

const formatTime = (value: string | null | undefined) => {
  if (!value) return "never";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "unknown" : date.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
};

const statusTitle = computed(() => {
  if (connection.value.unreachable_since) return "Offline checkout active";
  if (summary.value.syncingCount > 0) return "Syncing offline transactions";
  if (summary.value.pendingCount > 0) return "Offline transactions pending";
  if (summary.value.reviewCount > 0) return "Offline sync needs review";
  if (!summary.value.pack) return "Preparing offline checkout";
  if (summary.value.packExpired) return "Offline pack expired";
  return "Ready for offline use";
});

const showStatus = computed(() =>
  !!connection.value.unreachable_since ||
  summary.value.pendingCount > 0 ||
  summary.value.syncingCount > 0 ||
  summary.value.reviewCount > 0,
);
const messageTitle = computed(() => {
  if (messageKind.value === "error") return "Offline setup needs attention";
  if (message.value.startsWith("Preparing")) return "Preparing for offline use";
  if (messageKind.value === "info") return "Offline checkout active";
  return "Offline pack ready";
});

const statusDetail = computed(() => {
  const pending = summary.value.pendingCount;
  const review = summary.value.reviewCount;
  const counts = `${pending} pending${review ? ` · ${review} need${review === 1 ? "s" : ""} review` : ""}`;
  if (connection.value.unreachable_since) return `Last connected ${formatTime(connection.value.last_confirmed_at)} · ${counts}`;
  if (summary.value.syncingCount > 0) return `Connected · syncing ${summary.value.syncingCount} transaction${summary.value.syncingCount === 1 ? "" : "s"}`;
  if (pending > 0 || review > 0) return `Connected · ${counts}`;
  if (!summary.value.pack) return "Setting up this device for an outage.";
  return `Updated ${formatTime(summary.value.pack.prepared_at)} · ${counts}`;
});

const refresh = async () => {
  const [workflow, legacy] = await Promise.all([
    getOfflineWorkflowSummary(),
    getOfflineQueueSummary().catch(() => ({ totalCount: 0, pendingCount: 0, reviewCount: 0 })),
  ]);
  summary.value = {
    ...workflow,
    pendingCount: workflow.pendingCount + legacy.pendingCount,
    reviewCount: workflow.reviewCount + legacy.reviewCount,
  };
  connection.value = readOfflineConnectionState();
  initialSummaryLoaded = true;
};

const setSyncMessage = (result: CheckoutQueueSyncResult) => {
  const attentionCount = result.remaining + result.review;
  if (result.serverReachable === false) {
    messageKind.value = "error";
    message.value = "ItemTraxx servers are still unreachable. Pending transactions remain safely stored.";
  } else if (result.remaining > 0 || result.review > 0) {
    messageKind.value = "info";
    message.value = `Connected to ItemTraxx servers, but ${attentionCount} offline transaction${attentionCount === 1 ? "" : "s"} still need attention.`;
  } else {
    messageKind.value = "success";
    message.value = "Connected to ItemTraxx servers. Offline queue is synced.";
  }
  if (toastTimer) window.clearTimeout(toastTimer);
  toastTimer = window.setTimeout(() => { message.value = ""; }, result.serverReachable === false ? 12_000 : 6_000);
};

const syncNow = async (manual = false) => {
  if (syncInFlight.value || (!manual && !navigator.onLine)) return;
  syncInFlight.value = true;
  try {
    const result = await syncCheckoutQueues({ force: manual });
    await refresh();
    if (manual) setSyncMessage(result);
  } catch (error) {
    if (manual) {
      messageKind.value = "error";
      message.value = toUserFacingErrorMessage(error, "Unable to sync offline transactions.");
      if (toastTimer) window.clearTimeout(toastTimer);
      toastTimer = window.setTimeout(() => { message.value = ""; }, 12_000);
    }
  } finally {
    syncInFlight.value = false;
  }
};

const retryAfterSessionInitialization = () => {
  if (sessionInitializationRetryUsed || sessionInitializationRetryTimer) return false;
  sessionInitializationRetryUsed = true;
  sessionInitializationRetryTimer = window.setTimeout(() => {
    sessionInitializationRetryTimer = null;
    void automaticallyRefreshPack();
  }, 1_000);
  return true;
};

const automaticallyRefreshPack = async () => {
  if (!navigator.onLine) return;
  try {
    if (!initialSummaryLoaded) await refresh();
    if (!summary.value.pack && !preparationNoticeShown) {
      preparationNoticeShown = true;
      messageKind.value = "info";
      message.value = "Preparing this device for offline use in the case of an outage.";
    }
    const result = await refreshOfflineCheckoutPackIfNeeded();
    if (result.refreshed && result.firstPreparation) {
      messageKind.value = "success";
      message.value = "Ready for offline use in the case of an outage.";
      if (toastTimer) window.clearTimeout(toastTimer);
      toastTimer = window.setTimeout(() => { message.value = ""; }, 6_000);
    }
    await refresh();
  } catch (error) {
    if (isOfflineSessionInitializingError(error) && retryAfterSessionInitialization()) return;
    messageKind.value = "error";
    message.value = toUserFacingErrorMessage(error, "Unable to prepare offline checkout.");
  }
};

const showOfflineSafetyNoticeIfNeeded = () => {
  if (!readOfflineConnectionState().unreachable_since) {
    offlineSafetyNoticeShown = false;
    return;
  }
  if (offlineSafetyNoticeShown) return;
  offlineSafetyNoticeShown = true;
  messageKind.value = "info";
  message.value = "You're offline. Keep this tab open—do not refresh, close it, log out, or clear browser data until you reconnect.";
  if (toastTimer) window.clearTimeout(toastTimer);
  toastTimer = window.setTimeout(() => { message.value = ""; }, 12_000);
};

const handleChange = () => {
  showOfflineSafetyNoticeIfNeeded();
  void refresh();
  void automaticallyRefreshPack();
  void syncNow();
};

const handleBrowserOffline = () => {
  markItemTraxxServerUnreachable();
  handleChange();
};
onMounted(() => {
  void (async () => {
    await refresh();
    await automaticallyRefreshPack();
    await refresh();
    await syncNow();
  })();
  pollTimer = window.setInterval(() => void refresh(), 10_000);
  refreshTimer = window.setInterval(() => void automaticallyRefreshPack(), OFFLINE_PACK_REFRESH_INTERVAL_MS);
  syncTimer = window.setInterval(() => void syncNow(), 15_000);
  window.addEventListener("online", handleChange);
  window.addEventListener("offline", handleBrowserOffline);
  window.addEventListener("itemtraxx:offline-queue-changed", handleChange);
  window.addEventListener("itemtraxx:offline-workflow-changed", handleChange);
  window.addEventListener("itemtraxx:offline-connection-changed", handleChange);
});
onScopeDispose(() => {
  if (pollTimer) window.clearInterval(pollTimer);
  if (refreshTimer) window.clearInterval(refreshTimer);
  if (syncTimer) window.clearInterval(syncTimer);
  if (toastTimer) window.clearTimeout(toastTimer);
  if (sessionInitializationRetryTimer) window.clearTimeout(sessionInitializationRetryTimer);
  window.removeEventListener("online", handleChange);
  window.removeEventListener("offline", handleBrowserOffline);
  window.removeEventListener("itemtraxx:offline-queue-changed", handleChange);
  window.removeEventListener("itemtraxx:offline-workflow-changed", handleChange);
  window.removeEventListener("itemtraxx:offline-connection-changed", handleChange);
});
</script>

<style scoped>
.offline-workflow-status {
  position: relative;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 0.55rem 1rem;
  padding: 0.78rem 0.9rem;
  border: 1px solid var(--border);
  border-radius: 14px;
  background: var(--surface);
}
.offline-workflow-status-content { display: grid; gap: 0.15rem; min-width: 0; }
.offline-workflow-status strong { font-size: 0.9rem; }
.offline-workflow-status span { color: var(--muted); font-size: 0.8rem; }
.offline-sync-button { min-height: 2.2rem; padding: 0.35rem 0.8rem; white-space: nowrap; }
@media (max-width: 640px) {
  .offline-workflow-status { align-items: flex-start; }
  .offline-sync-button { flex-shrink: 0; }
}
</style>
