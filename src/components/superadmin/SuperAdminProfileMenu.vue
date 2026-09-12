<template>
  <div class="sa-profile" :class="{ collapsed }">
    <button
      type="button"
      class="sa-profile-trigger"
      aria-haspopup="menu"
      :aria-expanded="open"
      @click="open = !open"
    >
      <span class="sa-avatar">{{ initials }}</span>
      <span v-if="!collapsed" class="sa-profile-meta">
        <span class="sa-profile-name">{{ auth.email || "Super Admin" }}</span>
        <span class="sa-profile-role">Super Admin</span>
      </span>
      <SuperAdminIcon v-if="!collapsed" name="chevronDown" />
    </button>
    <Transition name="sa-popover">
      <div v-if="open" class="sa-popover" role="menu">
        <button type="button" class="sa-popover-item" role="menuitem" @click="handleToggleTheme">
          <SuperAdminIcon name="theme" />
          {{ themeLabel }}
        </button>
        <div class="sa-popover-divider"></div>
        <button type="button" class="sa-popover-item danger" role="menuitem" @click="handleLogout">
          <SuperAdminIcon name="logout" />
          Sign out
        </button>
      </div>
    </Transition>
  </div>
</template>

<script setup lang="ts">
import { computed, ref } from "vue";
import SuperAdminIcon from "./SuperAdminIcon.vue";
import { useTheme } from "../../composables/useTheme";
import { useLogout } from "../../composables/useLogout";
import { getAuthState } from "../../store/authState";

defineProps<{ collapsed: boolean }>();

const auth = getAuthState();
const { themeLabel, toggleTheme } = useTheme();
const { logout } = useLogout();
const open = ref(false);

const initials = computed(() => (auth.email || "SA").slice(0, 2).toUpperCase());

const handleToggleTheme = () => {
  toggleTheme();
  open.value = false;
};

const handleLogout = async () => {
  if (await logout()) open.value = false;
};
</script>

<style scoped>
.sa-profile {
  position: relative;
  border-top: 1px solid var(--border);
  padding: 0.6rem;
  width: 100%;
}

.sa-profile.collapsed {
  display: flex;
  justify-content: center;
}

.sa-profile-trigger {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  width: 100%;
  background: transparent;
  border: none;
  padding: 0.3rem;
  border-radius: 8px;
  cursor: pointer;
  color: var(--text);
  font: inherit;
  text-align: left;
}

.sa-profile.collapsed .sa-profile-trigger {
  width: auto;
}

.sa-profile-trigger:hover {
  background: var(--surface-2);
}

.sa-avatar {
  width: 28px;
  height: 28px;
  border-radius: 50%;
  background: var(--surface-3);
  color: var(--text);
  display: flex;
  align-items: center;
  justify-content: center;
  font-weight: 700;
  font-size: 0.7rem;
  flex-shrink: 0;
}

.sa-profile-meta {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
}

.sa-profile-name {
  font-weight: 600;
  font-size: 0.8rem;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.sa-profile-role {
  font-size: 0.7rem;
  color: var(--muted);
}

.sa-popover {
  position: absolute;
  bottom: calc(100% + 0.4rem);
  left: 0.6rem;
  right: 0.6rem;
  background: var(--surface);
  border: 1px solid var(--border);
  border-radius: 10px;
  padding: 0.35rem;
  box-shadow: 0 8px 24px rgba(0, 0, 0, 0.18);
  z-index: 20;
}

.sa-profile.collapsed .sa-popover {
  left: 0.6rem;
  right: auto;
  width: 180px;
}

.sa-popover-item {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  width: 100%;
  background: transparent;
  border: none;
  padding: 0.5rem 0.6rem;
  border-radius: 6px;
  color: var(--text);
  font: inherit;
  text-align: left;
  cursor: pointer;
}

.sa-popover-item:hover {
  background: var(--surface-2);
}

.sa-popover-item.danger {
  color: var(--danger);
}

.sa-popover-divider {
  height: 1px;
  background: var(--border);
  margin: 0.3rem 0.2rem;
}

.sa-popover-enter-active,
.sa-popover-leave-active {
  transition: opacity 0.12s ease, transform 0.12s ease;
}

.sa-popover-enter-from,
.sa-popover-leave-to {
  opacity: 0;
  transform: translateY(4px);
}
</style>
