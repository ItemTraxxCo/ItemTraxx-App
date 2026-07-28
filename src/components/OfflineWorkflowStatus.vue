<template>
  <section v-if="isOffline" class="offline-workflow-status" aria-label="Offline checkout status">
    <div>
      <strong>{{ statusTitle }}</strong>
      <span>{{ statusDetail }}</span>
    </div>
  </section>
  <div v-if="message" class="toast" :class="{ 'toast-persist': messageKind === 'error' }" role="status" aria-live="polite">
    <div class="toast-title">{{ messageTitle }}</div>
    <div class="toast-body">{{ message }}</div>
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, onScopeDispose, ref } from "vue";
import {
  getOfflineWorkflowSummary,
  OFFLINE_PACK_REFRESH_INTERVAL_MS,
  refreshOfflineCheckoutPackIfNeeded,
} from "../services/offlineCheckoutWorkflow";
import { markItemTraxxServerUnreachable, readOfflineConnectionState } from "../services/offlineConnectionState";
import { toUserFacingErrorMessage } from "../services/appErrors";

type Summary = Awaited<ReturnType<typeof getOfflineWorkflowSummary>>;
const summary = ref<Summary>({ pack: null, packExpired: false, pendingCount: 0, reviewCount: 0 });
const connection = ref(readOfflineConnectionState());
const message = ref("");
const messageKind = ref<"success" | "error" | "info">("success");
let pollTimer: number | null = null;
let refreshTimer: number | null = null;
let toastTimer: number | null = null;
let offlineSafetyNoticeShown = false;
let preparationNoticeShown = false;

const formatTime = (value: string | null | undefined) => {
  if (!value) return "never";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "unknown" : date.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
};

const statusTitle = computed(() => {
  if (connection.value.unreachable_since) return "Offline checkout active";
  if (!summary.value.pack) return "Preparing offline checkout";
  if (summary.value.packExpired) return "Offline pack expired";
  return "Ready for offline use";
});

const isOffline = computed(() => !!connection.value.unreachable_since);
const messageTitle = computed(() => {
  if (messageKind.value === "error") return "Offline setup needs attention";
  if (messageKind.value === "info") return "Offline checkout active";
  return message.value.startsWith("Preparing") ? "Preparing for offline use" : "Offline pack ready";
});

const statusDetail = computed(() => {
  const pending = summary.value.pendingCount;
  const review = summary.value.reviewCount;
  const counts = `${pending} pending${review ? ` · ${review} need${review === 1 ? "s" : ""} review` : ""}`;
  if (connection.value.unreachable_since) return `Last connected ${formatTime(connection.value.last_confirmed_at)} · ${counts}`;
  if (!summary.value.pack) return "Setting up this device for an outage.";
  return `Updated ${formatTime(summary.value.pack.prepared_at)} · ${counts}`;
});

const refresh = async () => {
  summary.value = await getOfflineWorkflowSummary();
  connection.value = readOfflineConnectionState();
};

const automaticallyRefreshPack = async () => {
  if (!navigator.onLine) return;
  try {
    if (!summary.value.pack && !preparationNoticeShown) {
      preparationNoticeShown = true;
      messageKind.value = "info";
      message.value = "Preparing this device for offline use.";
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
};

const handleBrowserOffline = () => {
  markItemTraxxServerUnreachable();
  handleChange();
};
onMounted(() => {
  void refresh();
  void automaticallyRefreshPack();
  pollTimer = window.setInterval(() => void refresh(), 10_000);
  refreshTimer = window.setInterval(() => void automaticallyRefreshPack(), OFFLINE_PACK_REFRESH_INTERVAL_MS);
  window.addEventListener("online", handleChange);
  window.addEventListener("offline", handleBrowserOffline);
  window.addEventListener("itemtraxx:offline-workflow-changed", handleChange);
  window.addEventListener("itemtraxx:offline-connection-changed", handleChange);
});
onScopeDispose(() => {
  if (pollTimer) window.clearInterval(pollTimer);
  if (refreshTimer) window.clearInterval(refreshTimer);
  if (toastTimer) window.clearTimeout(toastTimer);
  window.removeEventListener("online", handleChange);
  window.removeEventListener("offline", handleBrowserOffline);
  window.removeEventListener("itemtraxx:offline-workflow-changed", handleChange);
  window.removeEventListener("itemtraxx:offline-connection-changed", handleChange);
});
</script>

<style scoped>
.offline-workflow-status {
  position: relative;
  display: grid;
  grid-template-columns: minmax(0, 1fr);
  align-items: center;
  gap: 0.55rem 1rem;
  padding: 0.78rem 0.9rem;
  border: 1px solid var(--border);
  border-radius: 14px;
  background: var(--surface);
}
.offline-workflow-status div { display: grid; gap: 0.15rem; }
.offline-workflow-status strong { font-size: 0.9rem; }
.offline-workflow-status span { color: var(--muted); font-size: 0.8rem; }
@media (max-width: 640px) {
  .offline-workflow-status { grid-template-columns: 1fr; }
}
</style>
