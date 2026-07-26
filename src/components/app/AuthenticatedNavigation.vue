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
      <RouterLink
        v-if="showAccountPanel"
        class="menu-item"
        role="menuitem"
        to="/account"
        @click="emit('closeMenu')"
      >
        My Account
      </RouterLink>
      <button
        v-if="showLogoutUserAction"
        type="button"
        class="menu-item danger"
        role="menuitem"
        @click="emit('logout')"
      >
        Log Out User
      </button>
    </div>
  </div>
</template>

<script setup lang="ts">
import { defineAsyncComponent } from "vue";
import { RouterLink } from "vue-router";

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
  showAccountPanel: boolean;
  showLogoutUserAction: boolean;
}>();

const emit = defineEmits<{
  toggleMenu: [];
  toggleTheme: [];
  logout: [];
  closeMenu: [];
}>();
</script>
