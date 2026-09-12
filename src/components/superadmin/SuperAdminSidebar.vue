<template>
  <nav class="sa-nav" :class="{ collapsed }" aria-label="Super admin navigation">
    <template v-for="group in NAV_GROUPS" :key="group.name ?? '_ungrouped'">
      <div v-if="group.name && !collapsed" class="sa-group-label">{{ group.name }}</div>
      <RouterLink
        v-for="item in group.items"
        :key="item.routeName"
        :to="{ name: item.routeName }"
        class="sa-item"
        :class="{ active: route.name === item.routeName }"
        :title="collapsed ? item.label : undefined"
        :aria-current="route.name === item.routeName ? 'page' : undefined"
      >
        <SuperAdminIcon :name="item.icon" />
        <span class="sa-item-label">{{ item.label }}</span>
      </RouterLink>
    </template>
  </nav>
</template>

<script setup lang="ts">
import { useRoute, RouterLink } from "vue-router";
import SuperAdminIcon from "./SuperAdminIcon.vue";
import type { IconName } from "./icons";

defineProps<{ collapsed: boolean }>();

type NavItem = { icon: IconName; label: string; routeName: string };
type NavGroup = { name: string | null; items: NavItem[] };

const NAV_GROUPS: NavGroup[] = [
  { name: null, items: [{ icon: "home", label: "Home", routeName: "super-admin-home" }] },
  {
    name: "Organizations",
    items: [
      { icon: "building", label: "Workspaces", routeName: "super-admin-workspaces" },
      { icon: "user", label: "Workspace Admins", routeName: "super-admin-admins" },
      { icon: "idCard", label: "Tenant Accounts", routeName: "super-admin-tenant-accounts" },
      { icon: "shield", label: "Super Admins", routeName: "super-admin-super-admins" },
    ],
  },
  {
    name: "Inventory Data",
    items: [
      { icon: "package", label: "Items", routeName: "super-admin-items" },
      { icon: "graduationCap", label: "Borrowers", routeName: "super-admin-borrowers" },
      { icon: "megaphone", label: "Broadcasts", routeName: "super-admin-broadcasts" },
    ],
  },
  {
    name: "Monitoring",
    items: [
      { icon: "fileText", label: "Logs", routeName: "super-admin-logs" },
      { icon: "wrench", label: "Internal Ops", routeName: "internal-ops" },
    ],
  },
  {
    name: "Customers",
    items: [
      { icon: "lifeBuoy", label: "Support Requests", routeName: "super-admin-support-requests" },
      { icon: "trendingUp", label: "Sales Leads", routeName: "super-admin-sales-leads" },
      { icon: "users", label: "Customers", routeName: "super-admin-customers" },
    ],
  },
  {
    name: "Platform",
    items: [{ icon: "settings", label: "Settings", routeName: "super-admin-settings" }],
  },
];

const route = useRoute();
</script>

<style scoped>
.sa-nav {
  flex: 1;
  min-height: 0;
  overflow-y: auto;
  padding: 0.6rem 0.5rem;
  display: flex;
  flex-direction: column;
}

.sa-nav.collapsed {
  padding: 0.6rem 0;
  align-items: center;
}

.sa-group-label {
  font-size: 0.68rem;
  letter-spacing: 0.06em;
  text-transform: uppercase;
  color: var(--muted);
  padding: 0.85rem 0.6rem 0.35rem;
}

.sa-item {
  display: flex;
  align-items: center;
  gap: 0.6rem;
  padding: 0.45rem 0.6rem;
  border-radius: 8px;
  color: var(--text);
  text-decoration: none;
  white-space: nowrap;
}

.sa-nav.collapsed .sa-item {
  justify-content: center;
  width: 2.25rem;
  padding: 0.5rem;
}

.sa-nav.collapsed .sa-item-label {
  display: none;
}

.sa-item:hover {
  background: var(--surface-2);
  text-decoration: none;
}

.sa-item.active {
  background: var(--surface-3);
  font-weight: 600;
  position: relative;
}

.sa-item.active::before {
  content: "";
  position: absolute;
  left: -0.5rem;
  top: 0.35rem;
  bottom: 0.35rem;
  width: 3px;
  border-radius: 2px;
  background: var(--accent);
}

.sa-nav.collapsed .sa-item.active::before {
  left: 0;
}
</style>
