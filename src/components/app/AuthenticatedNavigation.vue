<template>
  <div v-if="visible" class="top-menu">
    <div class="menu-button-wrap">
      <div v-if="showNotificationBell" class="menu-notification">
        <NotificationBell />
      </div>
      <span v-if="isOutdated" class="menu-alert" aria-hidden="true">!</span>
      <button
        type="button"
        class="menu-button"
        @click="emit('toggleMenu')"
        aria-label="Open menu"
        aria-haspopup="menu"
        :aria-expanded="menuOpen"
        aria-controls="top-menu-dropdown"
      >
        <svg class="menu-icon" viewBox="0 0 24 24" aria-hidden="true">
          <path d="M5 7.5h14M5 12h14M5 16.5h14" />
        </svg>
      </button>
    </div>
    <div v-if="menuOpen" id="top-menu-dropdown" class="menu-dropdown" role="menu">
      <button type="button" class="menu-item" role="menuitem" @click="emit('toggleTheme')">
        {{ themeLabel }}
      </button>
      <button type="button" class="menu-item" role="menuitem" @click="emit('openAdminPanel')">
        Open Admin Panel
      </button>
      <button
        v-if="canReplayOnboarding"
        type="button"
        class="menu-item"
        role="menuitem"
        @click="emit('openOnboarding')"
      >
        Take tour again
      </button>
      <button
        v-if="showLogoutUserAction"
        type="button"
        class="menu-item danger"
        role="menuitem"
        @click="emit('logout')"
      >
        Log Out User
      </button>
      <a class="menu-item muted" role="menuitem" href="/changelog" @click="emit('closeMenu')">
        Version: <strong>{{ appVersion }}</strong>
      </a>
      <div v-if="isOutdated" class="menu-item status-warning" role="menuitem">
        Version outdated, refresh to update.
      </div>
      <RouterLink class="menu-item" role="menuitem" to="/contact-support" @click="emit('closeMenu')">
        Contact Support
      </RouterLink>
      <div class="menu-item muted menu-offline-queue" role="menuitem" :title="offlineQueueTooltip">
        Offline Queue: {{ offlineQueueCount }}
      </div>
      <a
        class="menu-item muted menu-status"
        role="menuitem"
        href="https://status.itemtraxx.com/?ref=trmenu"
        target="_blank"
        rel="noreferrer"
      >
        <span class="status-dot" :class="statusClass" aria-hidden="true"></span>
        System Status: {{ statusLabel }}
      </a>
    </div>
  </div>
</template>

<script setup lang="ts">
import { defineAsyncComponent } from "vue";

const NotificationBell = defineAsyncComponent(async () => {
  const module = await import("../NotificationBell.vue");
  return module.default;
});

defineProps<{
  visible: boolean;
  showNotificationBell: boolean;
  isOutdated: boolean;
  menuOpen: boolean;
  themeLabel: string;
  canReplayOnboarding: boolean;
  showLogoutUserAction: boolean;
  appVersion: string;
  offlineQueueCount: number;
  offlineQueueTooltip: string;
  statusClass: string;
  statusLabel: string;
}>();

const emit = defineEmits<{
  toggleMenu: [];
  toggleTheme: [];
  openAdminPanel: [];
  openOnboarding: [];
  logout: [];
  closeMenu: [];
}>();
</script>
