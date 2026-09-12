<template>
  <div class="sa-shell">
    <div class="sa-side" :class="{ collapsed }" @mouseenter="hovering = true" @mouseleave="hovering = false">
      <RouterLink :to="{ name: 'super-admin-home' }" class="sa-brand">
        <SuperAdminIcon name="shield" />
        <span v-if="!collapsed">ItemTraxx Admin</span>
      </RouterLink>
      <SuperAdminSidebar :collapsed="collapsed" />
      <SuperAdminProfileMenu :collapsed="collapsed" />
    </div>
    <div class="sa-content">
      <router-view />
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, ref } from "vue";
import { RouterLink } from "vue-router";
import SuperAdminIcon from "./SuperAdminIcon.vue";
import SuperAdminSidebar from "./SuperAdminSidebar.vue";
import SuperAdminProfileMenu from "./SuperAdminProfileMenu.vue";
import "../../styles/superadmin-ui.css";

// Hover-driven: the sidebar sits collapsed (icon rail) by default and expands
// as a floating overlay while the pointer is over it, collapsing again on
// mouseleave. No persisted state — it's a momentary UI affordance, not a
// user preference.
const hovering = ref(false);
const collapsed = computed(() => !hovering.value);
</script>

<style scoped>
.sa-shell {
  display: flex;
  height: 100vh;
  height: 100dvh;
  background: var(--page-bg);
  color: var(--text);
}

.sa-side {
  position: fixed;
  top: 0;
  left: 0;
  z-index: 30;
  display: flex;
  flex-direction: column;
  width: 240px;
  height: 100%;
  background: var(--surface);
  border-right: 1px solid var(--border);
  box-shadow: 4px 0 16px rgba(0, 0, 0, 0.12);
  transition: width 0.15s ease;
}

.sa-side.collapsed {
  width: 64px;
  align-items: center;
  box-shadow: none;
}

.sa-brand {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  padding: 1rem;
  font-weight: 700;
  color: var(--text);
  text-decoration: none;
  border-bottom: 1px solid var(--border);
  white-space: nowrap;
  width: 100%;
  box-sizing: border-box;
}

.sa-side.collapsed .sa-brand {
  padding: 1rem 0;
  justify-content: center;
}

.sa-brand:hover {
  text-decoration: none;
}

.sa-content {
  flex: 1;
  min-width: 0;
  height: 100%;
  overflow-y: auto;
  padding: 2rem;
  margin-left: 64px;
  box-sizing: border-box;
}
</style>
