<template>
  <div class="notif-wrap">
    <button type="button" class="notif-button" @click="toggleOpen" aria-label="Notifications">
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
      <span v-if="unreadCount > 0" class="notif-badge">{{ unreadCount > 9 ? "9+" : unreadCount }}</span>
    </button>

    <div v-if="isOpen" class="notif-dropdown">
      <div class="notif-header">Notifications</div>
      <p v-if="isLoading" class="muted">Loading notifications...</p>
      <p v-else-if="error" class="error">{{ error }}</p>
      <template v-else>
        <ul class="notif-list">
          <li v-if="maintenanceEnabled" class="notif-item notif-critical">
            Maintenance mode is enabled.
          </li>
          <li v-if="overdueCount > 0" class="notif-item notif-warn">
            {{ overdueCount }} overdue item{{ overdueCount === 1 ? "" : "s" }} (limit {{ dueHours }}h).
          </li>
          <li v-if="flaggedCount > 0" class="notif-item notif-warn">
            {{ flaggedCount }} item{{ flaggedCount === 1 ? "" : "s" }} need status follow-up.
          </li>
          <li
            v-for="event in recentEvents"
            :key="event.id"
            class="notif-item"
          >
            {{ event.gear?.name || "Item" }} marked {{ event.status }}.
          </li>
          <li v-if="unreadCount === 0" class="notif-item muted">No new notifications.</li>
        </ul>
      </template>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref } from "vue";
import { fetchTenantNotifications, type StatusHistoryItem } from "../services/adminOpsService";

const isOpen = ref(false);
const isLoading = ref(false);
const error = ref("");
const overdueCount = ref(0);
const flaggedCount = ref(0);
const dueHours = ref(72);
const maintenanceEnabled = ref(false);
const recentEvents = ref<StatusHistoryItem[]>([]);
let pollTimer: number | null = null;

const unreadCount = computed(
  () => overdueCount.value + flaggedCount.value + (maintenanceEnabled.value ? 1 : 0)
);

const loadNotifications = async () => {
  isLoading.value = true;
  error.value = "";
  try {
    const payload = await fetchTenantNotifications();
    overdueCount.value = payload.overdue_count;
    flaggedCount.value = payload.flagged_count;
    dueHours.value = payload.due_hours;
    maintenanceEnabled.value = payload.maintenance?.enabled === true;
    recentEvents.value = payload.recent_status_events.slice(0, 4);
  } catch (err) {
    error.value = err instanceof Error ? err.message : "Unable to load notifications.";
  } finally {
    isLoading.value = false;
  }
};

const toggleOpen = () => {
  isOpen.value = !isOpen.value;
  if (isOpen.value) {
    void loadNotifications();
  }
};

onMounted(() => {
  void loadNotifications();
  pollTimer = window.setInterval(() => {
    void loadNotifications();
  }, 60_000);
});

onUnmounted(() => {
  if (pollTimer) {
    window.clearInterval(pollTimer);
    pollTimer = null;
  }
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
  box-shadow: 0 12px 30px rgba(0, 0, 0, 0.15);
  padding: 0.75rem;
  z-index: 30;
}

.notif-header {
  font-weight: 700;
  margin-bottom: 0.5rem;
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

.notif-warn {
  border: 1px solid rgba(245, 158, 11, 0.5);
}

.notif-critical {
  border: 1px solid rgba(220, 38, 38, 0.6);
}
</style>
