<template>
  <div v-if="warningHours" class="version-update-fullscreen offline-warning-overlay" role="alertdialog" aria-modal="true" aria-live="assertive">
    <div class="version-update-card offline-warning-card">
      <p class="version-update-eyebrow">Offline for {{ warningHours }}+ hours</p>
      <h2>Still working offline</h2>
      <p>ItemTraxx has not connected to its servers for over {{ warningHours }} hours. You can continue using this device's downloaded offline pack.</p>
      <ul>
        <li>Item availability may be out of date if another device is also offline.</li>
        <li>Transactions are pending until they sync successfully.</li>
        <li>Do not log out or clear browser data until pending transactions have synced to ItemTraxx servers.</li>
        <li>If you refresh or close this tab, you may need to reconnect before your signed-in session can be restored.</li>
      </ul>
      <p v-if="warningError" class="error">{{ warningError }}</p>
      <div class="offline-overlay-actions">
        <button type="button" class="button-primary" @click="continueOffline">Continue offline</button>
        <button type="button" class="button-secondary" :disabled="retrying" @click="tryReconnect">
          {{ retrying ? "Trying…" : "Try to reconnect" }}
        </button>
      </div>
    </div>
  </div>

  <div v-else-if="reviewEntries.length" class="version-update-fullscreen offline-review-overlay" role="dialog" aria-modal="true" aria-labelledby="offline-review-title">
    <div class="version-update-card offline-review-card">
      <p class="version-update-eyebrow">Offline Sync Review</p>
      <h2 id="offline-review-title">{{ reviewEntries.length }} transaction{{ reviewEntries.length === 1 ? "" : "s" }} need review</h2>
      <p>Choose which state ItemTraxx should keep for every unresolved transaction.</p>
      <div class="offline-review-list">
        <article v-for="entry in reviewEntries" :key="`modern-${entry.id}`" class="offline-review-entry">
          <button type="button" class="offline-review-row" :aria-expanded="expandedId === entry.id" @click="expandedId = expandedId === entry.id ? null : entry.id">
            <span class="offline-review-chevron" aria-hidden="true">›</span>
            <span>
              <strong>{{ entry.items[0]?.intent === "checkout" ? "Checkout" : "Return" }} · {{ entry.items[0]?.borrower_username || entry.items[0]?.borrower_display_id || "Quick Return" }} · {{ entry.items.length }} item{{ entry.items.length === 1 ? "" : "s" }}</strong>
              <small>Needs review — {{ entry.last_error || "server state changed" }}</small>
            </span>
          </button>
          <div v-if="expandedId === entry.id" class="offline-review-detail">
            <div class="offline-review-comparison">
              <button
                type="button"
                class="offline-state-tile"
                :class="{ selected: selectedResolution[entry.id] === 'apply_offline' }"
                :aria-pressed="selectedResolution[entry.id] === 'apply_offline'"
                @click="selectResolution(entry.id, 'apply_offline')"
              >
                <span>Your offline transaction</span>
                <strong>{{ offlineTransactionLabel(entry) }}</strong>
                <small>Borrower: {{ offlineBorrowerLabel(entry) }}</small>
                <small>Recorded: {{ formatTime(entry.created_at) }}</small>
              </button>
              <button
                type="button"
                class="offline-state-tile"
                :class="{ selected: selectedResolution[entry.id] === 'keep_server' }"
                :aria-pressed="selectedResolution[entry.id] === 'keep_server'"
                @click="selectResolution(entry.id, 'keep_server')"
              >
                <span>Current server state</span>
                <strong>{{ serverStateLabel(entry.items[0]?.server_state) }}</strong>
                <small>Borrower: {{ serverBorrowerLabel(entry.items[0]?.server_state) }}</small>
                <small>Tenant account: {{ serverTenantAccountLabel(entry.items[0]?.server_state) }}</small>
                <small>Server update: {{ serverStateTimeLabel(entry.items[0]?.server_state) }}</small>
              </button>
            </div>
            <p v-if="entryError[entry.id]" class="error">{{ entryError[entry.id] }}</p>
            <div class="offline-overlay-actions">
              <button
                type="button"
                class="button-primary"
                :disabled="resolvingId === entry.id || !selectedResolution[entry.id]"
                @click="confirmResolution(entry.id)"
              >
                {{ resolvingId === entry.id ? "Confirming…" : selectedResolution[entry.id] === "keep_server" ? "Confirm server state" : "Confirm offline transaction" }}
              </button>
            </div>
          </div>
        </article>
      </div>
    </div>
  </div>

  <div v-else-if="legacyReviewItems.length" class="version-update-fullscreen offline-review-overlay" role="dialog" aria-modal="true" aria-labelledby="legacy-offline-review-title">
    <div class="version-update-card offline-review-card offline-legacy-review-card">
      <p class="version-update-eyebrow">Legacy Offline Transactions</p>
      <h2 id="legacy-offline-review-title">{{ legacyReviewItems.length }} transaction{{ legacyReviewItems.length === 1 ? "" : "s" }} need review</h2>
      <p>These older records are not bound to an account and cannot be replayed safely under the current session. Discard each record; if the work is still needed, start a new transaction manually.</p>
      <div class="offline-review-list">
        <article v-for="item in legacyReviewItems" :key="`legacy-${item.id}`" class="offline-review-entry">
          <div class="offline-review-row offline-legacy-review-row">
            <span class="offline-review-chevron" aria-hidden="true">•</span>
            <span>
              <strong>{{ legacyActionLabel(item.action_type) }} · {{ item.item_count }} item{{ item.item_count === 1 ? "" : "s" }}</strong>
              <small>Legacy record requires manual review{{ item.created_at ? ` · Recorded ${formatTime(item.created_at)}` : "" }}</small>
            </span>
          </div>
          <p v-if="legacyEntryError[item.id]" class="error">{{ legacyEntryError[item.id] }}</p>
          <div class="offline-overlay-actions offline-legacy-review-actions">
            <button
              type="button"
              class="button-primary"
              :disabled="legacyResolvingId === item.id"
              @click="discardLegacy(item, true)"
            >
              {{ legacyResolvingId === item.id ? "Discarding…" : "Discard and start a new transaction" }}
            </button>
            <button
              type="button"
              class="button-secondary"
              :disabled="legacyResolvingId === item.id"
              @click="discardLegacy(item, false)"
            >
              Discard transaction
            </button>
          </div>
        </article>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, onScopeDispose, ref, watch } from "vue";
import { useRouter } from "vue-router";
import {
  getOfflineWorkflowSummary,
  listOfflineReviewEntries,
  resolveOfflineCheckoutConflict,
  syncOfflineCheckoutLedger,
  type OfflineLedgerEntry,
} from "../services/offlineCheckoutWorkflow";
import {
  discardOfflineQueueReviewItem,
  listOfflineQueueReviewItems,
  type OfflineQueueReviewAction,
  type OfflineQueueReviewItem,
} from "../services/offlineCheckoutQueue";
import { acknowledgeOfflineWarning, getOfflineWarningThreshold } from "../services/offlineConnectionState";
import { toUserFacingErrorMessage } from "../services/appErrors";
import { getAuthState } from "../store/authState";
import { getOrCreateDeviceSession } from "../utils/deviceSession";

const props = defineProps<{ enabled: boolean }>();

const warningHours = ref<3 | 8 | null>(null);
const warningError = ref("");
const retrying = ref(false);
const reviewEntries = ref<OfflineLedgerEntry[]>([]);
const expandedId = ref<string | null>(null);
const resolvingId = ref<string | null>(null);
const entryError = ref<Record<string, string>>({});
const selectedResolution = ref<Record<string, "keep_server" | "apply_offline">>({});
const legacyReviewItems = ref<OfflineQueueReviewItem[]>([]);
const legacyResolvingId = ref<string | null>(null);
const legacyEntryError = ref<Record<string, string>>({});
const auth = getAuthState();
const router = useRouter();
let pollTimer: number | null = null;

const legacyReviewEnabled = computed(() =>
  props.enabled &&
  auth.isAuthenticated &&
  !!auth.workspaceContextId &&
  (auth.role === "tenant_account" || auth.role === "workspace_admin"),
);

const authScopeKey = () => {
  let deviceId = "";
  try {
    deviceId = getOrCreateDeviceSession().deviceId;
  } catch {
    // Storage/device availability is handled by the queue API; keep stale UI out
    // of scope transitions even when the device identifier cannot be read here.
  }
  return `${auth.isAuthenticated}:${auth.userId ?? ""}:${auth.workspaceContextId ?? ""}:${auth.role ?? ""}:${deviceId}`;
};

const refresh = async () => {
  if (!props.enabled) {
    warningHours.value = null;
    reviewEntries.value = [];
    legacyReviewItems.value = [];
    return;
  }
  const scopeAtStart = authScopeKey();
  const [summary, modernEntries, legacyEntries] = await Promise.all([
    getOfflineWorkflowSummary(),
    listOfflineReviewEntries(),
    legacyReviewEnabled.value ? listOfflineQueueReviewItems() : Promise.resolve([]),
  ]);
  if (scopeAtStart !== authScopeKey()) {
    reviewEntries.value = [];
    legacyReviewItems.value = [];
    return;
  }
  warningHours.value = summary.pack ? getOfflineWarningThreshold() : null;
  reviewEntries.value = modernEntries;
  legacyReviewItems.value = legacyEntries;
  if (!expandedId.value && reviewEntries.value[0]) expandedId.value = reviewEntries.value[0].id;
};

const continueOffline = () => {
  if (warningHours.value) acknowledgeOfflineWarning(warningHours.value);
  warningHours.value = null;
};

const tryReconnect = async () => {
  retrying.value = true;
  warningError.value = "";
  try {
    const result = await syncOfflineCheckoutLedger();
    if (result.failed > 0) throw new Error("ItemTraxx servers are still unreachable. Your pending transactions remain safely stored.");
    await refresh();
  } catch (error) {
    warningError.value = toUserFacingErrorMessage(error, "ItemTraxx servers are still unreachable.");
  } finally {
    retrying.value = false;
  }
};

const resolve = async (id: string, resolution: "keep_server" | "apply_offline") => {
  resolvingId.value = id;
  entryError.value = { ...entryError.value, [id]: "" };
  try {
    await resolveOfflineCheckoutConflict(id, resolution);
    await refresh();
  } catch (error) {
    entryError.value = { ...entryError.value, [id]: toUserFacingErrorMessage(error, "Unable to resolve this transaction.") };
  } finally {
    resolvingId.value = null;
  }
};

const selectResolution = (id: string, resolution: "keep_server" | "apply_offline") => {
  selectedResolution.value = { ...selectedResolution.value, [id]: resolution };
};

const confirmResolution = async (id: string) => {
  const resolution = selectedResolution.value[id];
  if (resolution) await resolve(id, resolution);
};

const legacyActionLabel = (action: OfflineQueueReviewAction) => {
  if (action === "checkout") return "Checkout";
  if (action === "return") return "Return";
  if (action === "quick_return") return "Quick return";
  if (action === "automatic") return "Automatic transaction";
  return "Offline transaction";
};

const discardLegacy = async (item: OfflineQueueReviewItem, startNewTransaction: boolean) => {
  if (!window.confirm("This legacy transaction cannot be replayed safely. Discard it from this device?")) return;
  legacyResolvingId.value = item.id;
  legacyEntryError.value = { ...legacyEntryError.value, [item.id]: "" };
  try {
    await discardOfflineQueueReviewItem(item.id);
    await refresh();
    if (startNewTransaction) await router.push("/checkout");
  } catch (error) {
    legacyEntryError.value = {
      ...legacyEntryError.value,
      [item.id]: toUserFacingErrorMessage(error, "Unable to discard this legacy transaction."),
    };
  } finally {
    legacyResolvingId.value = null;
  }
};

const formatTime = (value: string | null | undefined) => {
  if (!value) return "Not available";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "Not available" : date.toLocaleString([], { dateStyle: "medium", timeStyle: "short" });
};

const offlineTransactionLabel = (entry: OfflineLedgerEntry) =>
  entry.items.map((item) => `${item.intent === "checkout" ? "Check out" : "Return"} ${item.name} (${item.barcode})`).join(" · ");

const offlineBorrowerLabel = (entry: OfflineLedgerEntry) =>
  entry.items[0]?.borrower_username || entry.items[0]?.borrower_display_id || "Quick Return";

const serverStateLabel = (value: unknown) => {
  if (!value || typeof value !== "object") return "Current state could not be summarized.";
  const state = value as { status?: string; borrower_id?: string | null; checked_out_by?: string | null };
  if (state.status === "checked_out") return `Checked out${state.borrower_id || state.checked_out_by ? ` to ${state.borrower_id || state.checked_out_by}` : ""}`;
  return state.status ? state.status.replaceAll("_", " ") : "Current state available from the server.";
};

const serverStateDetails = (value: unknown) =>
  value && typeof value === "object" ? value as Record<string, unknown> : {};

const serverBorrowerLabel = (value: unknown) => {
  const state = serverStateDetails(value);
  return String(state.borrower_username || state.borrower_id || state.checked_out_by || "Not available");
};

const serverTenantAccountLabel = (value: unknown) => {
  const state = serverStateDetails(value);
  return String(state.performed_by_email || state.tenant_account_email || "Not available");
};

const serverStateTimeLabel = (value: unknown) => {
  const state = serverStateDetails(value);
  return formatTime(typeof state.action_time === "string" ? state.action_time : typeof state.updated_at === "string" ? state.updated_at : null);
};

const handleChange = () => void refresh();
watch(() => props.enabled, () => void refresh());
watch(authScopeKey, (next, previous) => {
  if (next === previous) return;
  reviewEntries.value = [];
  legacyReviewItems.value = [];
  expandedId.value = null;
  void refresh();
});
onMounted(() => {
  void refresh();
  pollTimer = window.setInterval(() => void refresh(), 30_000);
  window.addEventListener("online", handleChange);
  window.addEventListener("itemtraxx:offline-queue-changed", handleChange);
  window.addEventListener("itemtraxx:offline-workflow-changed", handleChange);
  window.addEventListener("itemtraxx:offline-connection-changed", handleChange);
});
onScopeDispose(() => {
  if (pollTimer) window.clearInterval(pollTimer);
  window.removeEventListener("online", handleChange);
  window.removeEventListener("itemtraxx:offline-queue-changed", handleChange);
  window.removeEventListener("itemtraxx:offline-workflow-changed", handleChange);
  window.removeEventListener("itemtraxx:offline-connection-changed", handleChange);
});
</script>

<style scoped>
.offline-warning-overlay, .offline-review-overlay { z-index: 1238; }
.offline-warning-card ul { margin: 0.85rem 0 0; padding-left: 1.2rem; color: var(--muted); line-height: 1.5; }
.offline-warning-card li + li { margin-top: 0.35rem; }
.offline-overlay-actions { display: flex; flex-wrap: wrap; gap: 0.65rem; margin-top: 1rem; }
.offline-overlay-actions button { flex: 1 1 12rem; min-height: 44px; }
.offline-review-card { width: min(760px, 100%); max-height: min(760px, calc(100vh - 2rem)); overflow: auto; }
.offline-review-list { display: grid; gap: 0.65rem; margin-top: 1rem; }
.offline-review-entry { overflow: hidden; border: 1px solid var(--border); border-radius: 14px; background: var(--surface); }
.offline-review-row { width: 100%; display: grid; grid-template-columns: auto 1fr; gap: 0.7rem; align-items: start; padding: 0.85rem; border: 0; background: transparent; color: inherit; text-align: left; cursor: pointer; }
.offline-legacy-review-row { cursor: default; }
.offline-legacy-review-row .offline-review-chevron { font-size: 1rem; line-height: 1.4; }
.offline-legacy-review-actions { padding: 0 0.85rem 0.85rem 2.9rem; }
.offline-legacy-review-actions button { flex: 1 1 14rem; }
.offline-legacy-review-card > p:not(.version-update-eyebrow) { max-width: 62rem; }
.offline-review-row span:nth-child(2) { display: grid; gap: 0.2rem; }
.offline-review-row small, .offline-review-comparison span, .offline-review-comparison small { color: var(--muted); }
.offline-review-chevron { font-size: 1.5rem; line-height: 1; transform: rotate(0deg); transition: transform 150ms ease; }
.offline-review-row[aria-expanded="true"] .offline-review-chevron { transform: rotate(90deg); }
.offline-review-detail { padding: 0 0.85rem 0.85rem 2.9rem; }
.offline-review-comparison { display: grid; grid-template-columns: 1fr 1fr; gap: 0.65rem; }
.offline-state-tile { display: grid; gap: 0.3rem; padding: 0.85rem; border: 1px solid var(--border); border-radius: 12px; background: var(--surface-2); color: inherit; font: inherit; text-align: left; cursor: pointer; }
.offline-state-tile:hover, .offline-state-tile.selected { border-color: var(--text); box-shadow: inset 0 0 0 1px var(--text); }
.offline-state-tile.selected { background: var(--surface); }
@media (max-width: 640px) {
  .offline-review-comparison { grid-template-columns: 1fr; }
  .offline-review-detail { padding-left: 0.85rem; }
}
</style>
