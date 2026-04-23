import { createRouter, createWebHistory } from "vue-router";
import type { RouteRecordRaw } from "vue-router";
import { getAuthState } from "../store/authState";
import { getDistrictState } from "../store/districtState";

const ADMIN_VERIFICATION_TTL_MS = 15 * 60 * 1000;
const SUPER_VERIFICATION_TTL_MS = 15 * 60 * 1000;
const isInternalHostRuntime = () =>
  typeof window !== "undefined" &&
  window.location.hostname === "internal.itemtraxx.com";

const routes: RouteRecordRaw[] = [
  {
    path: "/",
    name: "public-home",
    component: () =>
      isInternalHostRuntime()
        ? import("../pages/internal/InternalOps.vue")
        : import("../pages/LandingPageNew.vue"),
    meta: { public: true, title: "ItemTraxx Inventory Tracking" },
  },
  {
    path: "/landing-old",
    name: "public-home-old",
    component: () => import("../pages/PublicHome.vue"),
    meta: { public: true, title: "Legacy Landing | ItemTraxx" },
  },
  {
    path: "/login",
    name: "public-login",
    component: () => import("../pages/Login.vue"),
    meta: { public: true, title: "Login | ItemTraxx" },
  },
  {
    path: "/landing-new",
    name: "public-home-new",
    component: () => import("../pages/LandingPageNew.vue"),
    meta: { public: true, title: "ItemTraxx Inventory Tracking" },
  },
  {
    path: "/reset-password",
    name: "public-reset-password",
    component: () => import("../pages/ResetPassword.vue"),
    meta: { public: true, title: "Reset Password | ItemTraxx" },
  },
  {
    path: "/forgot-password",
    name: "public-forgot-password",
    component: () => import("../pages/ForgotPassword.vue"),
    meta: { public: true, title: "Forgot Password | ItemTraxx" },
  },
  {
    path: "/legal",
    name: "public-legal",
    component: () => import("../pages/Legal.vue"),
    meta: { public: true, title: "Legal | ItemTraxx" },
  },
  {
    path: "/privacy",
    name: "public-privacy",
    component: () => import("../pages/PrivacyPage.vue"),
    meta: { public: true, title: "Privacy | ItemTraxx" },
  },
  {
    path: "/cookies",
    name: "public-cookies",
    component: () => import("../pages/CookiesPage.vue"),
    meta: { public: true, title: "Cookies | ItemTraxx" },
  },
  {
    path: "/pricing",
    name: "public-pricing",
    component: () => import("../pages/Pricing.vue"),
    meta: { public: true, title: "Pricing | ItemTraxx" },
  },
  {
    path: "/contact-sales",
    name: "public-contact-sales",
    component: () => import("../pages/ContactSales.vue"),
    meta: { public: true, title: "Contact Sales | ItemTraxx" },
  },
  {
    path: "/request-demo",
    name: "public-request-demo",
    component: () => import("../pages/RequestDemoPage.vue"),
    meta: { public: true, title: "Request Demo | ItemTraxx" },
  },
  {
    path: "/contact-support",
    name: "public-contact-support",
    component: () => import("../pages/ContactSupport.vue"),
    meta: { public: true, title: "Contact Support | ItemTraxx" },
  },
  {
    path: "/contact",
    name: "public-contact",
    component: () => import("../pages/ContactPage.vue"),
    meta: { public: true, title: "Contact | ItemTraxx" },
  },
  {
    path: "/submitconfirmation",
    name: "public-submit-confirmation",
    component: () => import("../pages/SubmitConfirmation.vue"),
    meta: { public: true, title: "Submission Received | ItemTraxx" },
  },
  {
    path: "/status/:pathMatch(.*)*",
    name: "public-status-redirect",
    component: { template: "<div></div>" },
    beforeEnter: () => {
      if (typeof window !== "undefined") {
        window.location.replace("https://status.itemtraxx.com/");
      }
      return false;
    },
    meta: { public: true, title: "Redirecting to ItemTraxx Statuspage | ItemTraxx" },
  },
  {
    path: "/unavailable",
    name: "public-unavailable",
    component: () => import("../pages/Unavailable.vue"),
    meta: { public: true, title: "ItemTraxx Unavailable | ItemTraxx" },
  },
  {
    path: "/about",
    name: "public-about",
    component: () => import("../pages/About.vue"),
    meta: { public: true, title: "About | ItemTraxx" },
  },
  {
    path: "/security",
    name: "public-security",
    component: () => import("../pages/SecurityPage.vue"),
    meta: { public: true, title: "Security | ItemTraxx" },
  },
  {
    path: "/report-security-issue",
    name: "public-report-security-issue",
    component: () => import("../pages/ReportSecurityIssuePage.vue"),
    meta: { public: true, title: "Report Security Issue | ItemTraxx" },
  },
  {
    path: "/changelog",
    name: "public-changelog",
    component: () => import("../pages/ChangelogPage.vue"),
    meta: { public: true, title: "Changelog | ItemTraxx" },
  },
  {
    path: "/trust",
    name: "public-trust",
    component: () => import("../pages/TrustPage.vue"),
    meta: { public: true, title: "Trust | ItemTraxx" },
  },
  {
    path: "/faq",
    name: "public-faq",
    component: () => import("../pages/FaqPage.vue"),
    meta: { public: true, title: "FAQ | ItemTraxx" },
  },
  {
    path: "/getting-started",
    name: "public-getting-started",
    component: () => import("../pages/GettingStartedPage.vue"),
    meta: { public: true, title: "Getting Started | ItemTraxx" },
  },
  {
    path: "/itemscanner",
    name: "public-itemscanner",
    component: () => import("../pages/ItemScannerPage.vue"),
    meta: { public: true, title: "Item Scanner Lab | ItemTraxx" },
  },
  {
    path: "/accessibility",
    name: "public-accessibility",
    component: () => import("../pages/AccessibilityPage.vue"),
    meta: { public: true, title: "Accessibility | ItemTraxx" },
  },
  {
    path: "/tenant",
    name: "tenant-home",
    redirect: "/tenant/checkout",
    meta: { requiresSession: true, requiresTenant: true, title: "Tenant | ItemTraxx" },
  },
  {
    path: "/tenant/checkout",
    name: "tenant-checkout",
    component: () => import("../pages/tenant/Checkout.vue"),
    meta: { requiresSession: true, requiresTenant: true, title: "Checkout | ItemTraxx" },
  },
  {
    path: "/tenant/admin-login",
    name: "tenant-admin-login",
    component: () => import("../pages/tenant/admin/AdminLogin.vue"),
    meta: { public: true, title: "Admin | ItemTraxx" },
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
    
      title: "Admin | ItemTraxx",
    },
  },
  {
    path: "/district",
    name: "district-admin-home",
    component: () => import("../pages/district/DistrictAdminHome.vue"),
    meta: {
      requiresSession: true,
      requiresRole: "district_admin",
    
      title: "District Admin | ItemTraxx",
    },
  },
  {
    path: "/tenant/admin/students",
    redirect: "/tenant/admin/borrowers",
  },
  {
    path: "/tenant/admin/borrowers",
    name: "tenant-admin-students",
    component: () => import("../pages/tenant/admin/Students.vue"),
    meta: {
      requiresSession: true,
      requiresTenant: true,
      requiresRole: "tenant_admin",
      requiresTenantMatch: true,
    
      title: "Borrower Management | ItemTraxx",
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
    
      title: "Admin Gear | ItemTraxx",
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
    
      title: "Admin Logs | ItemTraxx",
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
    
      title: "Quick Return | ItemTraxx",
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
    
      title: "Usage Stats | ItemTraxx",
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
    
      title: "Audit Logs | ItemTraxx",
    },
  },
  {
    path: "/tenant/admin/item-status",
    name: "tenant-admin-item-status",
    component: () => import("../pages/tenant/admin/ItemStatusTracking.vue"),
    meta: {
      requiresSession: true,
      requiresTenant: true,
      requiresRole: "tenant_admin",
      requiresTenantMatch: true,
    
      title: "Item Status | ItemTraxx",
    },
  },
  {
    path: "/tenant/admin/barcodes",
    name: "tenant-admin-barcodes",
    component: () => import("../pages/tenant/admin/BarcodeGenerator.vue"),
    meta: {
      requiresSession: true,
      requiresTenant: true,
      requiresRole: "tenant_admin",
      requiresTenantMatch: true,
    
      title: "Barcode Generator | ItemTraxx",
    },
  },
  {
    path: "/tenant/admin/settings",
    name: "tenant-admin-settings",
    component: () => import("../pages/tenant/admin/Settings.vue"),
    meta: {
      requiresSession: true,
      requiresTenant: true,
      requiresRole: "tenant_admin",
      requiresTenantMatch: true,
    
      title: "Admin Settings | ItemTraxx",
    },
  },
  {
    path: "/tenant/admin/admins",
    name: "tenant-admin-admins",
    component: () => import("../pages/tenant/admin/Admins.vue"),
    meta: {
      requiresSession: true,
      requiresTenant: true,
      requiresRole: "tenant_admin",
      requiresTenantMatch: true,

      title: "Admin Access | ItemTraxx",
    },
  },
  {
    path: "/tenant/admin/gear-import",
    name: "tenant-admin-gear-import",
    component: () => import("../pages/tenant/admin/GearImport.vue"),
    meta: {
      requiresSession: true,
      requiresTenant: true,
      requiresRole: "tenant_admin",
      requiresTenantMatch: true,
    
      title: "Gear Import | ItemTraxx",
    },
  },

  {
    path: "/super-auth",
    name: "super-auth",
    component: () => import("../pages/super/SuperAuth.vue"),
    meta: { public: true, title: "Super Admin Login | ItemTraxx" },
  },
  {
    path: "/auth",
    name: "internal-auth",
    alias: ["/internal/auth"],
    component: () => import("../pages/internal/InternalAuth.vue"),
    meta: { public: true, title: "Internal Login | ItemTraxx" },
  },
  {
    path: "/internal",
    name: "internal-ops",
    component: () => import("../pages/internal/InternalOps.vue"),
    meta: {
      requiresSession: true,
      requiresRole: "super_admin",
      requiresSuperAuth: true,
    
      title: "Internal Ops | ItemTraxx",
    },
  },
  {
    path: "/super-admin",
    name: "super-admin-home",
    component: () => import("../pages/super/SuperAdminHome.vue"),
    meta: {
      requiresSession: true,
      requiresRole: "super_admin",
      requiresSuperAuth: true,
    
      title: "Super Admin | ItemTraxx",
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
    
      title: "Super Admin Tenants | ItemTraxx",
    },
  },
  {
    path: "/super-admin/districts",
    name: "super-admin-districts",
    component: () => import("../pages/super/Districts.vue"),
    meta: {
      requiresSession: true,
      requiresRole: "super_admin",
      requiresSuperAuth: true,
    
      title: "Super Admin Districts | ItemTraxx",
    },
  },
  {
    path: "/super-admin/districts/:id",
    name: "super-admin-district-detail",
    component: () => import("../pages/super/DistrictDetail.vue"),
    meta: {
      requiresSession: true,
      requiresRole: "super_admin",
      requiresSuperAuth: true,
    
      title: "District Detail | ItemTraxx",
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
    
      title: "Super Admin Admins | ItemTraxx",
    },
  },
  {
    path: "/super-admin/super-admins",
    name: "super-admin-super-admins",
    component: () => import("../pages/super/SuperAdmins.vue"),
    meta: {
      requiresSession: true,
      requiresRole: "super_admin",
      requiresSuperAuth: true,
      title: "Super Admins | ItemTraxx",
    },
  },
  {
    path: "/super-admin/gear",
    name: "super-admin-gear",
    component: () => import("../pages/super/SuperGear.vue"),
    meta: {
      requiresSession: true,
      requiresRole: "super_admin",
      requiresSuperAuth: true,
    
      title: "Super Admin Gear | ItemTraxx",
    },
  },
  {
    path: "/super-admin/borrowers",
    name: "super-admin-students",
    component: () => import("../pages/super/SuperStudents.vue"),
    meta: {
      requiresSession: true,
      requiresRole: "super_admin",
      requiresSuperAuth: true,
    
      title: "Super Admin Borrowers | ItemTraxx",
    },
  },
  {
    path: "/super-admin/students",
    redirect: "/super-admin/borrowers",
  },
  {
    path: "/super-admin/logs",
    name: "super-admin-logs",
    component: () => import("../pages/super/SuperLogs.vue"),
    meta: {
      requiresSession: true,
      requiresRole: "super_admin",
      requiresSuperAuth: true,
    
      title: "Super Admin Logs | ItemTraxx",
    },
  },
  {
    path: "/super-admin/broadcasts",
    name: "super-admin-broadcasts",
    component: () => import("../pages/super/Broadcasts.vue"),
    meta: {
      requiresSession: true,
      requiresRole: "super_admin",
      requiresSuperAuth: true,
    
      title: "Broadcasts | ItemTraxx",
    },
  },
  {
    path: "/super-admin/sales-leads",
    name: "super-admin-sales-leads",
    component: () => import("../pages/super/SalesLeads.vue"),
    meta: {
      requiresSession: true,
      requiresRole: "super_admin",
      requiresSuperAuth: true,
    
      title: "Sales Leads | ItemTraxx",
    },
  },
  {
    path: "/super-admin/customers",
    name: "super-admin-customers",
    component: () => import("../pages/super/Customers.vue"),
    meta: {
      requiresSession: true,
      requiresRole: "super_admin",
      requiresSuperAuth: true,
    
      title: "Customers | ItemTraxx",
    },
  },
  {
    path: "/super-admin/support-requests",
    name: "super-admin-support-requests",
    component: () => import("../pages/super/SupportRequests.vue"),
    meta: {
      requiresSession: true,
      requiresRole: "super_admin",
      requiresSuperAuth: true,
      title: "Support Requests | ItemTraxx",
    },
  },
  {
    path: "/:pathMatch(.*)*",
    name: "not-found",
    component: () => import("../pages/NotFound.vue"),
    meta: { public: true, title: "Not Found | ItemTraxx" },
  },
];

const router = createRouter({
  history: createWebHistory(),
  routes,
  scrollBehavior(to, _from, savedPosition) {
    if (savedPosition) {
      return savedPosition;
    }
    if (to.hash) {
      return {
        el: to.hash,
        top: 88,
        behavior: "smooth",
      };
    }
    return { top: 0, left: 0 };
  },
});

const hasFreshAdminVerification = (adminVerifiedAt: string | null) => {
  if (!adminVerifiedAt) {
    return false;
  }
  const verifiedAtMs = Date.parse(adminVerifiedAt);
  if (Number.isNaN(verifiedAtMs)) {
    return false;
  }
  return Date.now() - verifiedAtMs <= ADMIN_VERIFICATION_TTL_MS;
};

const hasFreshSuperVerification = (superVerifiedAt: string | null) => {
  if (!superVerifiedAt) {
    return false;
  }
  const verifiedAtMs = Date.parse(superVerifiedAt);
  if (Number.isNaN(verifiedAtMs)) {
    return false;
  }
  return Date.now() - verifiedAtMs <= SUPER_VERIFICATION_TTL_MS;
};

router.beforeEach((to) => {
  const meta = to.meta as {
    public?: boolean;
    requiresSession?: boolean;
    requiresTenant?: boolean;
    requiresRole?: string;
    requiresTenantMatch?: boolean;
    requiresSuperAuth?: boolean;
    title?: string;
  };

  const isInternalHost = isInternalHostRuntime();

  if (isInternalHost && to.name === "public-home") {
    const auth = getAuthState();
    if (!auth.isInitialized) {
      return false;
    }
    if (!auth.isAuthenticated || auth.role !== "super_admin") {
      return { name: "internal-auth" };
    }
    if (!auth.hasSecondaryAuth || !hasFreshSuperVerification(auth.superVerifiedAt)) {
      return { name: "internal-auth" };
    }
    return true;
  }

  const district = getDistrictState();
  if (district.isDistrictHost && !district.districtId && to.name !== "not-found") {
    return { name: "not-found" };
  }

  const auth = getAuthState();

  // Redirect authenticated users away from home page to their appropriate dashboard
  // Note: We only redirect from public-home, not public-login, so users can still
  // access the login page to switch accounts if needed
  if (
    auth.isInitialized &&
    auth.isAuthenticated &&
    to.name === "public-home"
  ) {
    // For district hosts, verify user belongs to this district before redirecting
    if (
      district.isDistrictHost &&
      district.districtId &&
      auth.districtContextId &&
      auth.districtContextId !== district.districtId
    ) {
      // User is logged in but belongs to a different district - let them see public page
      // They may want to log out and log in with a different account
      if (meta?.public) return true;
    }

    // Redirect based on role
    if (auth.role === "super_admin") {
      if (auth.hasSecondaryAuth && hasFreshSuperVerification(auth.superVerifiedAt)) {
        return { name: "super-admin-home" };
      }
      return { name: "super-auth" };
    }

    if (auth.role === "district_admin") {
      if (hasFreshAdminVerification(auth.adminVerifiedAt)) {
        return { name: "district-admin-home" };
      }
      return { name: "tenant-admin-login" };
    }

    if (auth.role === "tenant_admin" && auth.tenantContextId) {
      return { name: "tenant-checkout" };
    }

    if (auth.role === "tenant_user" && auth.tenantContextId) {
      return { name: "tenant-checkout" };
    }
  }

  if (meta?.public) return true;

  if (!auth.isInitialized) {
    return true;
  }

  if (meta?.requiresSession && !auth.isAuthenticated) {
    return { name: "public-home" };
  }

  if (meta?.requiresTenant && !auth.tenantContextId) {
    return { name: "public-home" };
  }

  if (district.isDistrictHost && meta?.requiresSession && !district.districtId) {
    return { name: "public-home" };
  }

  if (meta?.requiresRole && auth.role !== meta.requiresRole) {
    return { name: "public-home" };
  }

  if (
    meta?.requiresRole === "tenant_admin" &&
    !hasFreshAdminVerification(auth.adminVerifiedAt)
  ) {
    return { name: "tenant-admin-login" };
  }

  if (
    meta?.requiresRole === "district_admin" &&
    !hasFreshAdminVerification(auth.adminVerifiedAt)
  ) {
    return { name: "tenant-admin-login" };
  }

  if (
    meta?.requiresTenantMatch &&
    auth.sessionTenantId &&
    auth.tenantContextId &&
    auth.sessionTenantId !== auth.tenantContextId
  ) {
    return { name: "public-home" };
  }

  if (
    district.isDistrictHost &&
    district.districtId &&
    auth.isAuthenticated &&
    auth.districtContextId &&
    auth.districtContextId !== district.districtId
  ) {
    return { name: "public-home" };
  }

  if (meta?.requiresSuperAuth && !auth.hasSecondaryAuth) {
    return to.path.startsWith("/internal")
      ? { name: "internal-auth" }
      : { name: "super-auth" };
  }

  if (
    meta?.requiresSuperAuth &&
    !hasFreshSuperVerification(auth.superVerifiedAt)
  ) {
    return to.path.startsWith("/internal")
      ? { name: "internal-auth" }
      : { name: "super-auth" };
  }

  return true;
});

router.afterEach((to) => {
  const title = typeof to.meta.title === "string" ? to.meta.title : "ItemTraxx";
  if (typeof document !== "undefined") {
    document.title = title;
  }
});

export default router;
