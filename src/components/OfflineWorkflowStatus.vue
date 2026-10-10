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

  <div
    v-if="pendingDownloadPrompt && isOfflineWorkflowRoute"
    class="toast toast-persist offline-pack-prompt"
    role="alertdialog"
    aria-live="polite"
    aria-label="Download offline pack?"
  >
    <div class="toast-title">Prepare this device for offline use?</div>
    <div class="toast-body">
      Download the items and borrowers visible to this account? If you do not choose, the pack will not download.
    </div>
    <div class="offline-pack-prompt-actions">
      <button type="button" class="button-primary" @click="acceptDownloadPrompt">Download</button>
      <button type="button" class="button-secondary" @click="dismissDownloadPrompt">Not now</button>
    </div>
  </div>

  <div
    v-if="packReadyToastDetail && isOfflineWorkflowRoute"
    class="toast toast-persist offline-pack-ready-toast"
    role="status"
    aria-live="polite"
    aria-atomic="true"
  >
    <div class="toast-title">Offline pack ready</div>
    <div class="toast-body">{{ packReadyToastDetail }}</div>
    <div class="toast-actions">
      <button
        type="button"
        class="toast-action-button"
        aria-label="Dismiss offline pack ready notification"
        @click="dismissPackReadyToast"
      >
        Dismiss
      </button>
    </div>
  </div>

  <div v-if="message && isOfflineWorkflowRoute" class="toast" :class="{ 'toast-persist': messageKind === 'error' }" role="status" aria-live="polite">
    <div class="toast-title">{{ messageTitle }}</div>
    <div class="toast-body">{{ message }}</div>
  </div>

  <div
    v-if="largePackWarning"
    class="version-update-fullscreen offline-pack-large-overlay"
    role="alertdialog"
    aria-modal="true"
    aria-labelledby="offline-pack-large-title"
    aria-describedby="offline-pack-large-description"
  >
    <div class="version-update-card">
      <p class="version-update-eyebrow">Large Offline Pack</p>
      <h2 id="offline-pack-large-title">Your inventory and borrower list are large.</h2>
      <p id="offline-pack-large-description">
        This pack contains {{ largePackWarning.totalRecords.toLocaleString() }} records
        ({{ largePackWarning.itemCount.toLocaleString() }} items and
        {{ largePackWarning.borrowerCount.toLocaleString() }} borrowers). Downloading it can take several minutes,
        use significant data, and slow down this device while it is prepared.
      </p>
      <p>The server allows up to {{ (largePackWarning.maxBytes / (1024 * 1024)).toLocaleString() }} MiB per pack.</p>
      <p>You can change automatic offline downloads in Account Settings.</p>
      <div class="offline-pack-large-actions">
        <button type="button" class="button-primary" @click="resolveLargeWarning(true)">Continue download</button>
        <button type="button" class="button-secondary" @click="resolveLargeWarning(false)">Cancel</button>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, nextTick, onMounted, onScopeDispose, ref, watch } from "vue";
import { useRoute } from "vue-router";
import { syncCheckoutQueues, type CheckoutQueueSyncResult } from "../services/checkoutService";
import {
  getOfflineWorkflowSummary,
  isOfflineSessionInitializingError,
  OFFLINE_PACK_LARGE_WARNING_RECORDS,
  OFFLINE_PACK_MAX_BYTES,
  OFFLINE_PACK_REFRESH_INTERVAL_MS,
  OfflinePackDownloadCancelledError,
  refreshOfflineCheckoutPackIfNeeded,
  type OfflinePackPreparationProgress,
} from "../services/offlineCheckoutWorkflow";
import { getOfflineQueueSummary } from "../services/offlineCheckoutQueue";
import { markItemTraxxServerUnreachable, readOfflineConnectionState } from "../services/offlineConnectionState";
import { toUserFacingErrorMessage } from "../services/appErrors";
import {
  approveOfflinePackForSignIn,
  getOfflinePackDownloadPreference,
  getOfflinePackSignInKey,
  hasOfflinePackPromptedForSignIn,
  isOfflinePackAutomaticDownloadAllowed,
  markOfflinePackPromptedForSignIn,
} from "../services/offlineCheckoutPreferences";
import {
  OFFLINE_PACK_LARGE_WARNING_EVENT,
  OFFLINE_PACK_LARGE_WARNING_TIMEOUT_MS,
  resolveLargeOfflinePackConfirmation,
  type OfflinePackSize,
} from "../services/offlinePackConfirmation";
import { getAuthState } from "../store/authState";

type Summary = Awaited<ReturnType<typeof getOfflineWorkflowSummary>>;
const summary = ref<Summary>({ pack: null, packExpired: false, pendingCount: 0, syncingCount: 0, reviewCount: 0 });
const connection = ref(readOfflineConnectionState());
const message = ref("");
const messageKind = ref<"success" | "error" | "info">("success");
const packReadyToastDetail = ref("");
const syncInFlight = ref(false);
const pendingDownloadPrompt = ref(false);
const largePackWarning = ref<OfflinePackSize | null>(null);
const auth = getAuthState();
const route = useRoute();
let pollTimer: number | null = null;
let refreshTimer: number | null = null;
let syncTimer: number | null = null;
let toastTimer: number | null = null;
let largeWarningTimer: number | null = null;
let offlineSafetyNoticeShown = false;
let initialSummaryLoaded = false;
let sessionInitializationRetryTimer: number | null = null;
let sessionInitializationRetryUsed = false;
let activeSignInKey: string | null = null;
let automaticPackAttemptedForSignIn: string | null = null;
let backgroundRefreshError = "";

const isOfflineWorkflowRoute = computed(() => ["/checkout", "/admin/return", "/account/return"].includes(route.path));

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
  isOfflineWorkflowRoute.value && (
    !!connection.value.unreachable_since ||
    summary.value.pendingCount > 0 ||
    summary.value.syncingCount > 0 ||
    summary.value.reviewCount > 0
  ),
);

const messageTitle = computed(() => {
  if (messageKind.value === "error") return "Offline setup needs attention";
  if (message.value.startsWith("Downloading") || message.value.startsWith("Checking")) return "Preparing for offline use";
  if (messageKind.value === "info") return "Offline checkout active";
  return "Offline queue synced";
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

const clearToastTimer = () => {
  if (toastTimer !== null) window.clearTimeout(toastTimer);
  toastTimer = null;
};

const dismissPackReadyToast = () => {
  packReadyToastDetail.value = "";
};

const showPackReadyToast = (detail: string, preferDetail = false) => {
  clearToastTimer();
  message.value = "";
  if (preferDetail || !packReadyToastDetail.value) {
    packReadyToastDetail.value = detail;
  }
};

watch(message, (nextMessage) => {
  if (nextMessage) dismissPackReadyToast();
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

const refreshInBackground = () => {
  void refresh().then(() => {
    if (backgroundRefreshError && message.value === backgroundRefreshError) {
      message.value = "";
      messageKind.value = "success";
    }
    backgroundRefreshError = "";
  }).catch((error) => {
    backgroundRefreshError = toUserFacingErrorMessage(error, "Unable to refresh offline checkout status.");
    messageKind.value = "error";
    message.value = backgroundRefreshError;
  });
};

const setSyncMessage = (result: CheckoutQueueSyncResult) => {
  const attentionCount = result.remaining + result.review;
  if (result.serverReachable === false) {
    messageKind.value = "error";
    message.value = "ItemTraxx servers are still unreachable. Pending transactions remain safely stored on your device.";
  } else if (result.remaining > 0 || result.review > 0) {
    messageKind.value = "info";
    message.value = `Connected to ItemTraxx servers, but ${attentionCount} offline transaction${attentionCount === 1 ? "" : "s"} still need attention.`;
  } else {
    messageKind.value = "success";
    message.value = "Connected to ItemTraxx servers. Offline queue is synced.";
  }
  clearToastTimer();
  toastTimer = window.setTimeout(() => { message.value = ""; }, result.serverReachable === false ? 12_000 : 6_000);
};

const syncNow = async (manual = false) => {
  if (syncInFlight.value || (!manual && (!navigator.onLine || !isOfflineWorkflowRoute.value))) return;
  syncInFlight.value = true;
  try {
    const result = await syncCheckoutQueues({ force: manual });
    await refresh();
    if (manual) setSyncMessage(result);
  } catch (error) {
    if (manual) {
      messageKind.value = "error";
      message.value = toUserFacingErrorMessage(error, "Unable to sync offline transactions.");
      clearToastTimer();
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
  if (!isOfflineWorkflowRoute.value || !navigator.onLine || !isOfflinePackAutomaticDownloadAllowed(getAuthState())) return;
  try {
    if (!initialSummaryLoaded) await refresh();
    const result = await refreshOfflineCheckoutPackIfNeeded();
    if (result.skippedReason === "download_preference") return;
    if (result.refreshed && result.firstPreparation) {
      showPackReadyToast("This device is ready for offline use.");
    }
    await refresh();
  } catch (error) {
    if (error instanceof OfflinePackDownloadCancelledError) return;
    if (isOfflineSessionInitializingError(error) && retryAfterSessionInitialization()) return;
    messageKind.value = "error";
    message.value = toUserFacingErrorMessage(error, "Unable to prepare offline checkout.");
  }
};

const dismissDownloadPrompt = () => {
  pendingDownloadPrompt.value = false;
  clearToastTimer();
};

const acceptDownloadPrompt = () => {
  const signInKey = activeSignInKey;
  dismissDownloadPrompt();
  if (signInKey) {
    approveOfflinePackForSignIn(signInKey);
    automaticPackAttemptedForSignIn = signInKey;
  }
  void automaticallyRefreshPack();
};

const promptForAutomaticDownload = () => {
  if (!isOfflineWorkflowRoute.value) return;
  const signInKey = getOfflinePackSignInKey(getAuthState());
  if (!signInKey || hasOfflinePackPromptedForSignIn(signInKey)) return;
  markOfflinePackPromptedForSignIn(signInKey);
  pendingDownloadPrompt.value = true;
  message.value = "";
  clearToastTimer();
  toastTimer = window.setTimeout(() => {
    pendingDownloadPrompt.value = false;
    toastTimer = null;
  }, 12_000);
};

const handleSignedInScope = async () => {
  const currentAuth = getAuthState();
  const signInKey = currentAuth.isAuthenticated ? getOfflinePackSignInKey(currentAuth) : null;
  if (!signInKey) {
    activeSignInKey = null;
    automaticPackAttemptedForSignIn = null;
    dismissPackReadyToast();
    dismissDownloadPrompt();
    initialSummaryLoaded = false;
    return;
  }
  const isNewSignIn = signInKey !== activeSignInKey;
  if (isNewSignIn) {
    activeSignInKey = signInKey;
    automaticPackAttemptedForSignIn = null;
    sessionInitializationRetryUsed = false;
    dismissPackReadyToast();
    dismissDownloadPrompt();
  }
  if (!isOfflineWorkflowRoute.value) return;
  if (isNewSignIn) await refresh().catch(() => undefined);
  const latestAuth = getAuthState();
  if (
    !isOfflineWorkflowRoute.value ||
    !latestAuth.isAuthenticated ||
    getOfflinePackSignInKey(latestAuth) !== signInKey ||
    !latestAuth.workspaceContextId ||
    !latestAuth.userId
  ) return;
  const preference = getOfflinePackDownloadPreference({
    workspaceId: latestAuth.workspaceContextId,
    profileId: latestAuth.userId,
  });
  if (
    preference === "always" &&
    navigator.onLine &&
    automaticPackAttemptedForSignIn !== signInKey
  ) {
    automaticPackAttemptedForSignIn = signInKey;
    void automaticallyRefreshPack();
  } else if (preference === "ask") promptForAutomaticDownload();
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
  clearToastTimer();
  toastTimer = window.setTimeout(() => { message.value = ""; }, 12_000);
};

const handleChange = () => {
  showOfflineSafetyNoticeIfNeeded();
  refreshInBackground();
  void syncNow();
};

const handlePackStateChange = () => {
  handleChange();
  void automaticallyRefreshPack();
};

const handleOnline = () => {
  handleChange();
  void automaticallyRefreshPack();
};

const handleBrowserOffline = () => {
  markItemTraxxServerUnreachable();
  handleChange();
};

const handlePackProgress = (event: Event) => {
  const progress = (event as CustomEvent<OfflinePackPreparationProgress>).detail;
  if (!progress || !isOfflineWorkflowRoute.value) return;
  clearToastTimer();
  if (progress.stage === "complete") {
    showPackReadyToast(
      `${progress.downloadedRecords.toLocaleString()} records downloaded for offline use on this device.`,
      true,
    );
    return;
  }
  messageKind.value = "info";
  if (progress.stage === "starting" && progress.totalRecords === 0) {
    message.value = "Checking the size of the offline pack…";
  } else {
    message.value = `Downloading offline pack: ${progress.downloadedRecords.toLocaleString()} of ${progress.totalRecords.toLocaleString()} records (chunk ${progress.chunkNumber}).`;
  }
};

const handleLargePackWarning = (event: Event) => {
  const size = (event as CustomEvent<OfflinePackSize>).detail;
  if (!size || size.totalRecords <= OFFLINE_PACK_LARGE_WARNING_RECORDS || size.maxBytes > OFFLINE_PACK_MAX_BYTES) return;
  largePackWarning.value = size;
  if (largeWarningTimer !== null) window.clearTimeout(largeWarningTimer);
  largeWarningTimer = window.setTimeout(() => resolveLargeWarning(false), OFFLINE_PACK_LARGE_WARNING_TIMEOUT_MS);
};

const resolveLargeWarning = (confirmed: boolean) => {
  largePackWarning.value = null;
  if (largeWarningTimer !== null) window.clearTimeout(largeWarningTimer);
  largeWarningTimer = null;
  resolveLargeOfflinePackConfirmation(confirmed);
};

const handlePreferenceChange = (event: Event) => {
  const detail = (event as CustomEvent<{ workspaceId: string; profileId: string }>).detail;
  const currentAuth = getAuthState();
  if (!detail || detail.workspaceId !== currentAuth.workspaceContextId || detail.profileId !== currentAuth.userId) return;
  const preference = getOfflinePackDownloadPreference(detail);
  if (preference === "always") {
    const signInKey = getOfflinePackSignInKey(currentAuth);
    if (isOfflineWorkflowRoute.value && navigator.onLine && signInKey) {
      automaticPackAttemptedForSignIn = signInKey;
    }
    void automaticallyRefreshPack();
  } else if (preference === "ask") promptForAutomaticDownload();
  else dismissDownloadPrompt();
};

watch(
  () => [auth.isAuthenticated, auth.workspaceContextId, auth.userId, auth.signedInAt, route.path] as const,
  () => {
    if (isOfflineWorkflowRoute.value) {
      void nextTick().then(() => handleSignedInScope());
    } else {
      dismissPackReadyToast();
      if (pendingDownloadPrompt.value) dismissDownloadPrompt();
    }
  },
  { flush: "post" },
);

onMounted(() => {
  window.addEventListener("online", handleOnline);
  window.addEventListener("offline", handleBrowserOffline);
  window.addEventListener("itemtraxx:offline-queue-changed", handlePackStateChange);
  window.addEventListener("itemtraxx:offline-workflow-changed", handlePackStateChange);
  window.addEventListener("itemtraxx:offline-connection-changed", handleChange);
  window.addEventListener("itemtraxx:offline-pack-progress", handlePackProgress);
  window.addEventListener(OFFLINE_PACK_LARGE_WARNING_EVENT, handleLargePackWarning);
  window.addEventListener("itemtraxx:offline-pack-preference-changed", handlePreferenceChange);

  if (isOfflineWorkflowRoute.value) void nextTick().then(() => handleSignedInScope());
  pollTimer = window.setInterval(refreshInBackground, 10_000);
  refreshTimer = window.setInterval(() => void automaticallyRefreshPack(), OFFLINE_PACK_REFRESH_INTERVAL_MS);
  syncTimer = window.setInterval(() => void syncNow(), 15_000);
});

onScopeDispose(() => {
  if (pollTimer) window.clearInterval(pollTimer);
  if (refreshTimer) window.clearInterval(refreshTimer);
  if (syncTimer) window.clearInterval(syncTimer);
  if (toastTimer) window.clearTimeout(toastTimer);
  if (largeWarningTimer) window.clearTimeout(largeWarningTimer);
  if (sessionInitializationRetryTimer) window.clearTimeout(sessionInitializationRetryTimer);
  resolveLargeOfflinePackConfirmation(false);
  window.removeEventListener("online", handleOnline);
  window.removeEventListener("offline", handleBrowserOffline);
  window.removeEventListener("itemtraxx:offline-queue-changed", handlePackStateChange);
  window.removeEventListener("itemtraxx:offline-workflow-changed", handlePackStateChange);
  window.removeEventListener("itemtraxx:offline-connection-changed", handleChange);
  window.removeEventListener("itemtraxx:offline-pack-progress", handlePackProgress);
  window.removeEventListener(OFFLINE_PACK_LARGE_WARNING_EVENT, handleLargePackWarning);
  window.removeEventListener("itemtraxx:offline-pack-preference-changed", handlePreferenceChange);
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
.offline-sync-button { min-height: 2rem; padding: 0.3rem 0.72rem; white-space: nowrap; }
.offline-pack-ready-toast {
  box-sizing: border-box;
  width: min(390px, calc(100vw - 3rem));
  min-width: min(240px, calc(100vw - 2rem));
}
.offline-pack-ready-toast .toast-body { line-height: 1.45; }
.offline-pack-ready-toast .toast-actions { justify-content: flex-end; }
.offline-pack-prompt-actions,
.offline-pack-large-actions { display: flex; flex-wrap: wrap; gap: 0.55rem; margin-top: 0.8rem; }
.offline-pack-large-overlay { z-index: 1400; }
@media (max-width: 640px) {
  .offline-workflow-status { align-items: flex-start; }
  .offline-sync-button { flex-shrink: 0; }
  .offline-pack-ready-toast { right: 1rem; width: calc(100vw - 2rem); }
}
</style>
