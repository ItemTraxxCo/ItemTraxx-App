<template>
  <div v-if="notificationsEnabled" ref="wrapRef" class="notif-wrap">
    <button
      ref="buttonRef"
      type="button"
      class="notif-button"
      @click="toggleOpen"
      :aria-label="badgeCount > 0 ? `Notifications, ${badgeCount} new` : 'Notifications'"
      aria-haspopup="dialog"
      :aria-expanded="isOpen"
      aria-controls="workspace-notifications-panel"
    >
      <svg class="notif-icon" viewBox="0 0 24 24" aria-hidden="true">
        <path
          d="M12 3a4 4 0 0 0-4 4v1.2c0 1.2-.4 2.3-1.2 3.2L5 13.5V16h14v-2.5l-1.8-2.1A4.8 4.8 0 0 1 16 8.2V7a4 4 0 0 0-4-4Z"
          fill="none"
          stroke="currentColor"
          stroke-linecap="round"
          stroke-linejoin="round"
          stroke-width="1.8"
        />
        <path
          d="M9.5 16.5a2.5 2.5 0 0 0 5 0"
          fill="none"
          stroke="currentColor"
          stroke-linecap="round"
          stroke-width="1.8"
        />
      </svg>
      <span v-if="badgeCount > 0" class="notif-badge" aria-hidden="true">{{ badgeCount > 9 ? "9+" : badgeCount }}</span>
    </button>

    <div
      v-if="isOpen"
      id="workspace-notifications-panel"
      ref="panelRef"
      class="notif-dropdown"
      role="dialog"
      aria-label="Workspace notifications"
      tabindex="-1"
    >
      <div class="notif-header">Notifications</div>
      <p v-if="isLoading && !hasLoaded && !error" class="muted">Loading notifications...</p>
      <div v-else-if="error && !hasLoaded" class="notif-error" role="alert">
        <p class="error">{{ error }}</p>
        <button type="button" class="notif-retry" :disabled="isLoading" @click="retry">
          <svg class="notif-retry-icon" :class="{ spinning: isLoading }" viewBox="0 0 24 24" aria-hidden="true">
            <path
              d="M20 12a8 8 0 1 1-2.34-5.66M20 4v4.5h-4.5"
              fill="none"
              stroke="currentColor"
              stroke-linecap="round"
              stroke-linejoin="round"
              stroke-width="2"
            />
          </svg>
          {{ isLoading ? "Retrying" : "Retry" }}
        </button>
      </div>
      <template v-else>
        <div v-if="error" class="notif-stale" role="status">
          <span class="muted">Couldn't refresh. Showing last known notifications.</span>
          <button type="button" class="notif-retry" :disabled="isLoading" @click="retry">
            <svg class="notif-retry-icon" :class="{ spinning: isLoading }" viewBox="0 0 24 24" aria-hidden="true">
              <path
                d="M20 12a8 8 0 1 1-2.34-5.66M20 4v4.5h-4.5"
                fill="none"
                stroke="currentColor"
                stroke-linecap="round"
                stroke-linejoin="round"
                stroke-width="2"
              />
            </svg>
            {{ isLoading ? "Retrying" : "Retry" }}
          </button>
        </div>
        <ul class="notif-list">
          <li v-if="overdueCount > 0" class="notif-item notif-warn">
            {{ overdueCount }} overdue checkout{{ overdueCount === 1 ? "" : "s" }} (limit:
            {{ checkoutDueHours }}h).
          </li>
          <li
            v-for="update in updates"
            :key="update.id"
            class="notif-item"
            :class="update.level === 'critical' ? 'notif-critical' : update.level === 'warning' ? 'notif-warn' : ''"
          >
            <strong>{{ update.title }}:</strong> {{ update.message }}
            <a
              v-if="isSafeExternalLink(update.link_url)"
              class="notif-link"
              :href="update.link_url"
              target="_blank"
              rel="noopener noreferrer"
            >Learn more</a>
          </li>
          <li v-if="flaggedCount > 0" class="notif-item notif-warn" :class="{ 'notif-clickable': statusTrackingEnabled }">
            <RouterLink v-if="statusTrackingEnabled" class="notif-row-link" :to="{ path: STATUS_TRACKING_PATH }">
              {{ flaggedCount }} item{{ flaggedCount === 1 ? "" : "s" }} need status follow-up.
            </RouterLink>
            <template v-else>
              {{ flaggedCount }} item{{ flaggedCount === 1 ? "" : "s" }} need status follow-up.
            </template>
          </li>
          <li
            v-for="event in recentEvents"
            :key="event.id"
            class="notif-item"
            :class="{ 'notif-clickable': statusTrackingEnabled && !!event.item_id }"
          >
            <RouterLink
              v-if="statusTrackingEnabled && event.item_id"
              class="notif-row-link"
              :to="{ path: STATUS_TRACKING_PATH, query: { item: event.item_id } }"
            >
              {{ event.item?.name || "Item" }} marked {{ formatItemStatus(event.status).toLowerCase() }}.
            </RouterLink>
            <template v-else>
              {{ event.item?.name || "Item" }} marked {{ formatItemStatus(event.status).toLowerCase() }}.
            </template>
          </li>
          <li v-if="!hasAnyRows" class="notif-item muted">No new notifications.</li>
        </ul>
      </template>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, nextTick, onMounted, onUnmounted, ref, watch } from "vue";
import { RouterLink, useRoute } from "vue-router";
import { fetchWorkspaceNotifications, type StatusHistoryItem } from "../services/adminOpsService";
import { getAuthState } from "../store/authState";
import { formatItemStatus } from "../utils/itemStatus";
import {
  EMPTY_SEEN_STATE,
  LEGACY_DISMISSED_KEY,
  countUnseen,
  isSafeExternalLink,
  markAllSeen,
  parseSeenState,
  reconcileSeenState,
  seenStateStorageKey,
  seenStatesEqual,
  type NotificationSeenState,
  type NotificationSnapshot,
} from "../utils/notificationSeenState";

const emit = defineEmits<{ opened: [] }>();

const STATUS_TRACKING_PATH = "/admin/item-status";

const route = useRoute();
const wrapRef = ref<HTMLElement | null>(null);
const buttonRef = ref<HTMLButtonElement | null>(null);
const panelRef = ref<HTMLElement | null>(null);

const isOpen = ref(false);
const isLoading = ref(false);
const hasLoaded = ref(false);
const notificationsEnabled = ref(true);
const statusTrackingEnabled = ref(true);
const error = ref("");
const flaggedCount = ref(0);
const overdueCount = ref(0);
const checkoutDueHours = ref(72);
const updates = ref<
  Array<{
    id: string;
    title: string;
    message: string;
    level: "info" | "warning" | "critical";
    link_url: string | null;
  }>
>([]);
const recentEvents = ref<StatusHistoryItem[]>([]);
const seenState = ref<NotificationSeenState>({ ...EMPTY_SEEN_STATE });
let pollTimer: number | null = null;
let loadSequence = 0;

// Read state is scoped per user and workspace so a shared device or a second
// workspace never inherits another account's dismissals.
const storageKey = () => {
  const auth = getAuthState();
  return seenStateStorageKey(auth.userId, auth.workspaceContextId ?? auth.sessionWorkspaceId);
};

const snapshot = computed<NotificationSnapshot>(() => ({
  overdueCount: overdueCount.value,
  flaggedCount: flaggedCount.value,
  updateIds: updates.value.map((item) => item.id),
  eventIds: recentEvents.value.map((item) => item.id),
}));

const hasAnyRows = computed(
  () =>
    overdueCount.value > 0 ||
    flaggedCount.value > 0 ||
    updates.value.length > 0 ||
    recentEvents.value.length > 0
);

const badgeCount = computed(() =>
  hasLoaded.value ? countUnseen(snapshot.value, seenState.value) : 0
);

const loadSeenState = () => {
  try {
    window.localStorage.removeItem(LEGACY_DISMISSED_KEY);
    seenState.value = parseSeenState(window.localStorage.getItem(storageKey()));
  } catch {
    seenState.value = { ...EMPTY_SEEN_STATE };
  }
};

const persistSeenState = (next: NotificationSeenState) => {
  if (seenStatesEqual(next, seenState.value)) return;
  seenState.value = next;
  try {
    window.localStorage.setItem(storageKey(), JSON.stringify(next));
  } catch {
    // Ignore storage failures; read state still applies for this page view.
  }
};

const markCurrentSeen = () => {
  if (!hasLoaded.value) return;
  persistSeenState(markAllSeen(snapshot.value));
};

const loadNotifications = async () => {
  if (document.visibilityState === "hidden") return;
  const sequence = ++loadSequence;
  isLoading.value = true;
  try {
    const payload = await fetchWorkspaceNotifications();
    if (sequence !== loadSequence) return;
    error.value = "";
    if (payload.feature_flags?.enable_notifications === false) {
      notificationsEnabled.value = false;
      isOpen.value = false;
      flaggedCount.value = 0;
      overdueCount.value = 0;
      updates.value = [];
      recentEvents.value = [];
    } else {
      notificationsEnabled.value = true;
      statusTrackingEnabled.value = payload.feature_flags?.enable_status_tracking !== false;
      flaggedCount.value = payload.flagged_count;
      overdueCount.value = payload.overdue_count;
      checkoutDueHours.value = payload.checkout_due_hours;
      updates.value = payload.updates.slice(0, 3);
      recentEvents.value = payload.recent_status_events.slice(0, 4);
    }
    hasLoaded.value = true;
    persistSeenState(reconcileSeenState(snapshot.value, seenState.value));
    // Anything that arrives while the panel is open is being looked at.
    if (isOpen.value) markCurrentSeen();
  } catch (err) {
    if (sequence !== loadSequence) return;
    error.value = err instanceof Error ? err.message : "Unable to load notifications.";
  } finally {
    if (sequence === loadSequence) {
      isLoading.value = false;
    }
  }
};

const startPolling = () => {
  if (pollTimer) return;
  pollTimer = window.setInterval(() => {
    void loadNotifications();
  }, 90_000);
};

const stopPolling = () => {
  if (!pollTimer) return;
  window.clearInterval(pollTimer);
  pollTimer = null;
};

const handleVisibilityChange = () => {
  if (document.visibilityState === "hidden") {
    stopPolling();
    return;
  }
  void loadNotifications();
  startPolling();
};

const retry = () => {
  if (isLoading.value) return;
  void loadNotifications();
};

const close = (restoreFocus = false) => {
  if (!isOpen.value) return;
  isOpen.value = false;
  if (restoreFocus) buttonRef.value?.focus();
};

const toggleOpen = () => {
  if (isOpen.value) {
    close();
    return;
  }
  isOpen.value = true;
  emit("opened");
  markCurrentSeen();
  void loadNotifications();
  void nextTick(() => panelRef.value?.focus());
};

const handleDocumentPointerDown = (event: PointerEvent) => {
  if (!isOpen.value) return;
  const target = event.target as Node | null;
  if (target && wrapRef.value?.contains(target)) return;
  close();
};

const handleDocumentKeydown = (event: KeyboardEvent) => {
  if (event.key === "Escape" && isOpen.value) close(true);
};

watch(
  () => route.fullPath,
  () => close()
);

onMounted(() => {
  loadSeenState();
  void loadNotifications();
  startPolling();
  document.addEventListener("visibilitychange", handleVisibilityChange);
  document.addEventListener("pointerdown", handleDocumentPointerDown);
  document.addEventListener("keydown", handleDocumentKeydown);
});

onUnmounted(() => {
  stopPolling();
  document.removeEventListener("visibilitychange", handleVisibilityChange);
  document.removeEventListener("pointerdown", handleDocumentPointerDown);
  document.removeEventListener("keydown", handleDocumentKeydown);
});
</script>

<style scoped>
.notif-wrap {
  position: relative;
}

.notif-button {
  position: relative;
  min-width: 42px;
  height: 38px;
  border-radius: 10px;
  border: 1px solid var(--border);
  background: var(--surface);
}

.notif-icon {
  width: 18px;
  height: 18px;
}

.notif-badge {
  position: absolute;
  top: -6px;
  right: -6px;
  min-width: 18px;
  height: 18px;
  border-radius: 999px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  background: #c81e1e;
  color: #fff;
  font-size: 0.72rem;
  font-weight: 700;
  padding: 0 4px;
}

.notif-dropdown {
  position: absolute;
  right: 0;
  top: calc(100% + 0.5rem);
  width: 300px;
  max-height: 360px;
  overflow: auto;
  border: 1px solid var(--border);
  border-radius: 12px;
  background: var(--surface);
  padding: 0.75rem;
  z-index: 30;
}

.notif-dropdown:focus {
  outline: none;
}

.notif-header {
  font-weight: 700;
  margin-bottom: 0.5rem;
}

.notif-stale {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 0.5rem;
  font-size: 0.8rem;
  margin: 0 0 0.5rem;
}

.notif-error {
  display: grid;
  justify-items: start;
  gap: 0.5rem;
}

.notif-error .error {
  margin: 0;
}

.notif-retry {
  display: inline-flex;
  align-items: center;
  gap: 0.35rem;
  flex-shrink: 0;
  padding: 0.3rem 0.6rem;
  font-size: 0.8rem;
  border-radius: 8px;
  border: 1px solid var(--border);
  background: var(--surface-2);
  color: var(--text);
  cursor: pointer;
}

.notif-retry:disabled {
  cursor: progress;
  opacity: 0.75;
}

.notif-retry-icon {
  width: 14px;
  height: 14px;
}

.notif-retry-icon.spinning {
  animation: notif-spin 0.8s linear infinite;
}

@keyframes notif-spin {
  to {
    transform: rotate(360deg);
  }
}

@media (prefers-reduced-motion: reduce) {
  .notif-retry-icon.spinning {
    animation: none;
  }
}

.notif-clickable {
  padding: 0;
}

.notif-row-link {
  display: block;
  padding: 0.4rem 0.45rem;
  border-radius: 8px;
  color: inherit;
  text-decoration: none;
}

.notif-row-link:hover,
.notif-row-link:focus-visible {
  background: var(--surface);
  text-decoration: underline;
}

.notif-list {
  margin: 0;
  padding: 0;
  list-style: none;
  display: grid;
  gap: 0.45rem;
}

.notif-item {
  font-size: 0.86rem;
  padding: 0.4rem 0.45rem;
  border-radius: 8px;
  background: var(--surface-2);
}

.notif-link {
  margin-left: 0.25rem;
  white-space: nowrap;
}

.notif-warn {
  border: 1px solid rgba(245, 158, 11, 0.5);
}

.notif-critical {
  border: 1px solid rgba(220, 38, 38, 0.6);
}
</style>
