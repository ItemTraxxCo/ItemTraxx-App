<template>
  <div class="sa-shell">
    <div class="sa-side" :class="{ collapsed }">
      <RouterLink :to="{ name: 'super-admin-home' }" class="sa-brand">
        <SuperAdminIcon name="shield" />
        <span v-if="!collapsed">ItemTraxx Admin</span>
      </RouterLink>
      <button
        type="button"
        class="sa-toggle"
        :aria-label="collapsed ? 'Expand sidebar' : 'Collapse sidebar'"
        @click="toggleCollapsed"
      >
        <SuperAdminIcon :name="collapsed ? 'chevronRight' : 'chevronLeft'" />
      </button>
      <SuperAdminSidebar :collapsed="collapsed" />
      <SuperAdminProfileMenu :collapsed="collapsed" />
    </div>
    <div class="sa-content">
      <router-view />
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref } from "vue";
import { RouterLink } from "vue-router";
import SuperAdminIcon from "./SuperAdminIcon.vue";
import SuperAdminSidebar from "./SuperAdminSidebar.vue";
import SuperAdminProfileMenu from "./SuperAdminProfileMenu.vue";

const STORAGE_KEY = "super-admin-sidebar-collapsed";

const readStoredCollapsed = () => {
  try {
    return localStorage.getItem(STORAGE_KEY) === "true";
  } catch {
    return false;
  }
};

const collapsed = ref(readStoredCollapsed());

const toggleCollapsed = () => {
  collapsed.value = !collapsed.value;
  try {
    localStorage.setItem(STORAGE_KEY, String(collapsed.value));
  } catch {
    /* best effort only */
  }
};
</script>

<style scoped>
.sa-shell {
  display: flex;
  min-height: 100vh;
  background: var(--page-bg);
  color: var(--text);
}

.sa-side {
  display: flex;
  flex-direction: column;
  width: 240px;
  flex-shrink: 0;
  background: var(--surface);
  border-right: 1px solid var(--border);
}

.sa-side.collapsed {
  width: 64px;
  align-items: center;
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

.sa-toggle {
  align-self: flex-end;
  margin: 0.5rem 0.75rem 0;
  width: 28px;
  height: 28px;
  border-radius: 8px;
  border: 1px solid var(--border);
  background: var(--surface-2);
  color: var(--muted);
  display: flex;
  align-items: center;
  justify-content: center;
  cursor: pointer;
}

.sa-side.collapsed .sa-toggle {
  align-self: center;
  margin: 0.5rem 0 0;
}

.sa-content {
  flex: 1;
  min-width: 0;
  padding: 2rem;
}
</style>
