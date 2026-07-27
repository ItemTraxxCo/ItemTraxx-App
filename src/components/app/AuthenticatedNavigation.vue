<template>
  <div v-if="visible" class="top-menu">
    <div class="menu-button-wrap">
      <div v-if="showNotificationBell" class="menu-notification">
        <NotificationBell />
      </div>
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
    <Transition name="menu-dropdown">
      <div v-if="menuOpen" id="top-menu-dropdown" class="menu-dropdown" role="menu">
        <button type="button" class="menu-item" role="menuitem" @click="emit('toggleTheme')">
          <svg class="menu-item-icon" viewBox="0 0 24 24" aria-hidden="true">
            <circle cx="12" cy="12" r="4" />
            <path
              d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"
            />
          </svg>
          {{ themeLabel }}
        </button>
        <RouterLink
          v-if="showAccountPanel"
          class="menu-item"
          role="menuitem"
          to="/account"
          @click="emit('closeMenu')"
        >
          <svg class="menu-item-icon" viewBox="0 0 24 24" aria-hidden="true">
            <circle cx="12" cy="8" r="4" />
            <path d="M4 21c0-4.4 3.6-7 8-7s8 2.6 8 7" />
          </svg>
          My Account
        </RouterLink>
        <div v-if="showLogoutUserAction" class="menu-divider"></div>
        <button
          v-if="showLogoutUserAction"
          type="button"
          class="menu-item danger"
          role="menuitem"
          @click="emit('logout')"
        >
          <svg class="menu-item-icon" viewBox="0 0 24 24" aria-hidden="true">
            <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" />
            <path d="M16 17l5-5-5-5" />
            <path d="M21 12H9" />
          </svg>
          Sign out
        </button>
      </div>
    </Transition>
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
