import { createRouter, createWebHistory } from "vue-router";
import type { RouteRecordRaw } from "vue-router";
import { getAuthState } from "../store/authState";

const routes: RouteRecordRaw[] = [
  {
    path: "/",
    name: "public-home",
    component: () => import("../pages/PublicHome.vue"),
    meta: { public: true },
  },
  {
    path: "/tenant",
    name: "tenant-home",
    redirect: "/tenant/checkout",
    meta: { requiresSession: true, requiresTenant: true },
  },
  {
    path: "/tenant/checkout",
    name: "tenant-checkout",
    component: () => import("../pages/tenant/Checkout.vue"),
    meta: { requiresSession: true, requiresTenant: true },
  },
  {
    path: "/tenant/admin-login",
    name: "tenant-admin-login",
    component: () => import("../pages/tenant/admin/AdminLogin.vue"),
    meta: { requiresSession: true, requiresTenant: true },
  },
  {
    path: "/tenant/admin",
    name: "tenant-admin-home",
    component: () => import("../pages/tenant/admin/AdminHome.vue"),
    meta: {
      requiresSession: true,
      requiresTenant: true,
      requiresRole: "tenant_admin",
      requiresTenantMatch: true,
    },
  },
  {
    path: "/tenant/admin/students",
    name: "tenant-admin-students",
    component: () => import("../pages/tenant/admin/Students.vue"),
    meta: {
      requiresSession: true,
      requiresTenant: true,
      requiresRole: "tenant_admin",
      requiresTenantMatch: true,
    },
  },
  {
    path: "/tenant/admin/gear",
    name: "tenant-admin-gear",
    component: () => import("../pages/tenant/admin/Gear.vue"),
    meta: {
      requiresSession: true,
      requiresTenant: true,
      requiresRole: "tenant_admin",
      requiresTenantMatch: true,
    },
  },
  {
    path: "/tenant/admin/logs",
    name: "tenant-admin-logs",
    component: () => import("../pages/tenant/admin/Logs.vue"),
    meta: {
      requiresSession: true,
      requiresTenant: true,
      requiresRole: "tenant_admin",
      requiresTenantMatch: true,
    },
  },
  {
    path: "/tenant/admin/return",
    name: "tenant-admin-return",
    component: () => import("../pages/tenant/admin/QuickReturn.vue"),
    meta: {
      requiresSession: true,
      requiresTenant: true,
      requiresRole: "tenant_admin",
      requiresTenantMatch: true,
    },
  },
  {
    path: "/tenant/admin/stats",
    name: "tenant-admin-stats",
    component: () => import("../pages/tenant/admin/UsageStats.vue"),
    meta: {
      requiresSession: true,
      requiresTenant: true,
      requiresRole: "tenant_admin",
      requiresTenantMatch: true,
    },
  },
  {
    path: "/tenant/admin/audit-logs",
    name: "tenant-admin-audit-logs",
    component: () => import("../pages/tenant/admin/AdminAuditLogs.vue"),
    meta: {
      requiresSession: true,
      requiresTenant: true,
      requiresRole: "tenant_admin",
      requiresTenantMatch: true,
    },
  },
  {
    path: "/tenant/admin/admins",
    name: "tenant-admin-admins",
    component: () => import("../pages/tenant/admin/TenantAdmins.vue"),
    meta: {
      requiresSession: true,
      requiresTenant: true,
      requiresRole: "tenant_admin",
      requiresTenantMatch: true,
    },
  },
  {
    path: "/super-auth",
    name: "super-auth",
    component: () => import("../pages/super/SuperAuth.vue"),
    meta: { public: true },
  },
  {
    path: "/super-admin",
    name: "super-admin-home",
    component: () => import("../pages/super/SuperAdminHome.vue"),
    meta: {
      requiresSession: true,
      requiresRole: "super_admin",
      requiresSuperAuth: true,
    },
  },
  {
    path: "/super-admin/tenants",
    name: "super-admin-tenants",
    component: () => import("../pages/super/Tenants.vue"),
    meta: {
      requiresSession: true,
      requiresRole: "super_admin",
      requiresSuperAuth: true,
    },
  },
  {
    path: "/super-admin/admins",
    name: "super-admin-admins",
    component: () => import("../pages/super/Admins.vue"),
    meta: {
      requiresSession: true,
      requiresRole: "super_admin",
      requiresSuperAuth: true,
    },
  },
  {
    path: "/:pathMatch(.*)*",
    name: "not-found",
    component: () => import("../pages/NotFound.vue"),
    meta: { public: true },
  },
];

const router = createRouter({
  history: createWebHistory(),
  routes,
});

router.beforeEach((to) => {
  const meta = to.meta as {
    public?: boolean;
    requiresSession?: boolean;
    requiresTenant?: boolean;
    requiresRole?: string;
    requiresTenantMatch?: boolean;
    requiresSuperAuth?: boolean;
  };

  if (meta?.public) return true;

  const auth = getAuthState();
  if (!auth.isInitialized) {
    return false;
  }

  if (meta?.requiresSession && !auth.isAuthenticated) {
    return { name: "public-home" };
  }

  if (meta?.requiresTenant && !auth.tenantContextId) {
    return { name: "public-home" };
  }

  if (meta?.requiresRole && auth.role !== meta.requiresRole) {
    return { name: "public-home" };
  }

  if (
    meta?.requiresTenantMatch &&
    auth.sessionTenantId &&
    auth.tenantContextId &&
    auth.sessionTenantId !== auth.tenantContextId
  ) {
    return { name: "public-home" };
  }

  if (meta?.requiresSuperAuth && !auth.hasSecondaryAuth) {
    return { name: "super-auth" };
  }

  return true;
});

export default router;
