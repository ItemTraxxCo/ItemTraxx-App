import { createRouter, createWebHistory } from "vue-router";
import type { RouteRecordRaw } from "vue-router";
import { getAuthState } from "../store/authState";
import { getWorkspaceState } from "../store/workspaceState";
import { buildWorkspaceAppUrl, lookupWorkspaceById } from "../services/workspaceService";

const ADMIN_VERIFICATION_TTL_MS = 15 * 60 * 1000;
const SUPER_VERIFICATION_TTL_MS = 15 * 60 * 1000;
const isInternalHostRuntime = () =>
  typeof window !== "undefined" &&
  window.location.hostname === "internal.itemtraxx.com";

let authenticatedStylesPromise: Promise<unknown> | null = null;
const loadAuthenticatedStyles = () => {
  authenticatedStylesPromise ??= import("../styles/authenticated.css");
  return authenticatedStylesPromise;
};

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
    path: "/landing-new2",
    name: "public-home-new2",
    component: () => import("../pages/LandingPageNew2.vue"),
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
    path: "/legal/student-privacy",
    name: "public-student-privacy",
    component: () => import("../pages/LegalDocumentPage.vue"),
    meta: { public: true, title: "Student Privacy Notice | ItemTraxx" },
  },
  {
    path: "/legal/dpa",
    name: "public-dpa",
    component: () => import("../pages/LegalDocumentPage.vue"),
    meta: { public: true, title: "Data Processing Addendum | ItemTraxx" },
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
    path: "/privacy-request",
    name: "public-privacy-request",
    component: () => import("../pages/ContactSupport.vue"),
    meta: { public: true, title: "Privacy Request | ItemTraxx" },
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
    path: "/compliance",
    name: "public-compliance",
    component: () => import("../pages/CompliancePage.vue"),
    meta: { public: true, title: "Compliance | ItemTraxx" },
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
    path: "/checkout",
    name: "workspace-checkout",
    component: () => import("../pages/workspace/Checkout.vue"),
    meta: { requiresSession: true, requiresWorkspace: true, title: "Checkout | ItemTraxx" },
  },
  {
    path: "/admin/login",
    name: "workspace-admin-login",
    component: () => import("../pages/workspace/admin/AdminLogin.vue"),
    meta: { public: true, title: "Admin | ItemTraxx" },
  },
  {
    path: "/admin",
    name: "workspace-admin-home",
    component: () => import("../pages/workspace/admin/AdminHome.vue"),
    meta: {
      requiresSession: true,
      requiresWorkspace: true,
      requiresRole: "workspace_admin",
      requiresWorkspaceMatch: true,
    
      title: "Admin | ItemTraxx",
    },
  },
  { path: "/items", name: "workspace-items", component: () => import("../pages/workspace/Items.vue"), meta: { requiresSession: true, requiresWorkspace: true, requiresRole: "tenant_account", title: "Items | ItemTraxx" } },
  { path: "/borrowers", name: "workspace-borrowers", component: () => import("../pages/workspace/Borrowers.vue"), meta: { requiresSession: true, requiresWorkspace: true, requiresRole: "tenant_account", title: "Borrowers | ItemTraxx" } },
  { path: "/settings", name: "workspace-settings", component: () => import("../pages/workspace/Settings.vue"), meta: { requiresSession: true, requiresWorkspace: true, requiresRole: "tenant_account", title: "Settings | ItemTraxx" } },
  { path: "/account", name: "workspace-account", component: () => import("../pages/workspace/Account.vue"), meta: { requiresSession: true, requiresWorkspace: true, requiresRole: "tenant_account", title: "My Account | ItemTraxx" } },
  {
    path: "/admin/students",
    redirect: "/admin/borrowers",
  },
  {
    path: "/admin/borrowers",
    name: "workspace-admin-borrowers",
    component: () => import("../pages/workspace/admin/Borrowers.vue"),
    meta: {
      requiresSession: true,
      requiresWorkspace: true,
      requiresRole: "workspace_admin",
      requiresWorkspaceMatch: true,
    
      title: "Borrower Management | ItemTraxx",
    },
  },
  {
    path: "/admin/gear",
    redirect: "/admin/items",
  },
  {
    path: "/admin/items",
    name: "workspace-admin-items",
    component: () => import("../pages/workspace/admin/Items.vue"),
    meta: {
      requiresSession: true,
      requiresWorkspace: true,
      requiresRole: "workspace_admin",
      requiresWorkspaceMatch: true,
    
      title: "Admin Item | ItemTraxx",
    },
  },
  {
    path: "/admin/logs",
    name: "workspace-admin-logs",
    component: () => import("../pages/workspace/admin/Logs.vue"),
    meta: {
      requiresSession: true,
      requiresWorkspace: true,
      requiresRole: "workspace_admin",
      requiresWorkspaceMatch: true,
    
      title: "Admin Logs | ItemTraxx",
    },
  },
  {
    path: "/admin/return",
    name: "workspace-admin-return",
    component: () => import("../pages/workspace/admin/QuickReturn.vue"),
    meta: {
      requiresSession: true,
      requiresWorkspace: true,
      requiresRole: "workspace_admin",
      requiresWorkspaceMatch: true,
    
      title: "Quick Return | ItemTraxx",
    },
  },
  {
    path: "/admin/item-status",
    name: "workspace-admin-item-status",
    component: () => import("../pages/workspace/admin/ItemStatusTracking.vue"),
    meta: {
      requiresSession: true,
      requiresWorkspace: true,
      requiresRole: "workspace_admin",
      requiresWorkspaceMatch: true,
    
      title: "Item Status | ItemTraxx",
    },
  },
  {
    path: "/admin/barcodes",
    name: "workspace-admin-barcodes",
    component: () => import("../pages/workspace/admin/BarcodeGenerator.vue"),
    meta: {
      requiresSession: true,
      requiresWorkspace: true,
      requiresRole: "workspace_admin",
      requiresWorkspaceMatch: true,
    
      title: "Barcode Generator | ItemTraxx",
    },
  },
  {
    path: "/admin/settings",
    name: "workspace-admin-settings",
    component: () => import("../pages/workspace/admin/Settings.vue"),
    meta: {
      requiresSession: true,
      requiresWorkspace: true,
      requiresRole: "workspace_admin",
      requiresWorkspaceMatch: true,
    
      title: "Admin Settings | ItemTraxx",
    },
  },
  {
    path: "/admin/admins",
    name: "workspace-admin-admins",
    component: () => import("../pages/workspace/admin/Admins.vue"),
    meta: {
      requiresSession: true,
      requiresWorkspace: true,
      requiresRole: "workspace_admin",
      requiresWorkspaceMatch: true,

      title: "Admin Access | ItemTraxx",
    },
  },
  { path: "/admin/accounts", name: "workspace-admin-accounts", component: () => import("../pages/workspace/admin/Accounts.vue"), meta: { requiresSession: true, requiresWorkspace: true, requiresRole: "workspace_admin", requiresWorkspaceMatch: true, title: "Tenant Accounts | ItemTraxx" } },
  {
    path: "/admin/item-import",
    name: "workspace-admin-item-import",
    component: () => import("../pages/workspace/admin/ItemImport.vue"),
    meta: {
      requiresSession: true,
      requiresWorkspace: true,
      requiresRole: "workspace_admin",
      requiresWorkspaceMatch: true,
    
      title: "Item Import | ItemTraxx",
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
    path: "/super-admin/settings",
    name: "super-admin-settings",
    component: () => import("../pages/super/Settings.vue"),
    meta: {
      requiresSession: true,
      requiresRole: "super_admin",
      requiresSuperAuth: true,
      title: "Super Admin Settings | ItemTraxx",
    },
  },
  {
    path: "/super-admin/workspaces",
    name: "super-admin-workspaces",
    component: () => import("../pages/super/Workspaces.vue"),
    meta: {
      requiresSession: true,
      requiresRole: "super_admin",
      requiresSuperAuth: true,
    
      title: "Super Admin Workspaces | ItemTraxx",
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
    path: "/super-admin/tenant-accounts",
    name: "super-admin-tenant-accounts",
    component: () => import("../pages/super/TenantAccounts.vue"),
    meta: {
      requiresSession: true,
      requiresRole: "super_admin",
      title: "Tenant Accounts | ItemTraxx",
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
    redirect: "/super-admin/items",
  },
  {
    path: "/super-admin/items",
    name: "super-admin-items",
    component: () => import("../pages/super/SuperItems.vue"),
    meta: {
      requiresSession: true,
      requiresRole: "super_admin",
      requiresSuperAuth: true,
    
      title: "Super Admin Item | ItemTraxx",
    },
  },
  {
    path: "/super-admin/borrowers",
    name: "super-admin-borrowers",
    component: () => import("../pages/super/SuperBorrowers.vue"),
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

const notFoundFor = (path: string) => ({
  name: "not-found",
  params: {
    pathMatch: path.replace(/^\/+/, "").split("/").filter(Boolean),
  },
});

router.beforeEach(async (to) => {
  const meta = to.meta as {
    public?: boolean;
    requiresSession?: boolean;
    requiresWorkspace?: boolean;
    requiresRole?: string;
    requiresWorkspaceMatch?: boolean;
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
    await loadAuthenticatedStyles();
    return true;
  }

  const workspace = getWorkspaceState();
  const auth = getAuthState();

  if (
    workspace.isWorkspaceHost && workspace.workspaceId && auth.isInitialized &&
    auth.isAuthenticated && auth.workspaceContextId &&
    auth.workspaceContextId !== workspace.workspaceId
  ) {
    const ownWorkspace = await lookupWorkspaceById(auth.workspaceContextId);
    if (ownWorkspace?.slug) {
      const destination = auth.role === "workspace_admin" ? "/admin" : "/checkout";
      window.location.replace(buildWorkspaceAppUrl(ownWorkspace.slug, destination));
      return false;
    }
    return { name: "public-login", query: { reason: "workspace-mismatch" } };
  }

  if (workspace.isWorkspaceHost && to.name !== "not-found") {
    if (!workspace.workspaceId) {
      return notFoundFor(to.path);
    }
    if (!auth.isInitialized) {
      return false;
    }
    if (!meta.public && (!auth.isAuthenticated || auth.workspaceContextId !== workspace.workspaceId)) {
      return notFoundFor(to.path);
    }
  }

  // Redirect authenticated users away from home page to their appropriate dashboard
  // Note: We only redirect from public-home, not public-login, so users can still
  // access the login page to switch accounts if needed
  if (
    auth.isInitialized &&
    auth.isAuthenticated &&
    to.name === "public-home"
  ) {
    // Redirect based on role
    if (auth.role === "super_admin") {
      if (auth.hasSecondaryAuth && hasFreshSuperVerification(auth.superVerifiedAt)) {
        return { name: "super-admin-home" };
      }
      return { name: "super-auth" };
    }

    if (auth.role === "workspace_admin") {
      if (hasFreshAdminVerification(auth.adminVerifiedAt)) {
        return { name: "workspace-admin-home" };
      }
      return { name: "workspace-admin-login" };
    }

    if (auth.role === "tenant_account" && auth.workspaceContextId) {
      return { name: "workspace-checkout" };
    }
  }

  if (meta?.public) return true;

  if (!auth.isInitialized) {
    return true;
  }

  if (meta?.requiresSession && !auth.isAuthenticated) {
    return { name: "public-home" };
  }

  if (meta?.requiresWorkspace && !auth.workspaceContextId) {
    return { name: "public-home" };
  }

  if (workspace.isWorkspaceHost && meta?.requiresSession && !workspace.workspaceId) {
    return notFoundFor(to.path);
  }

  if (meta?.requiresRole && auth.role !== meta.requiresRole) {
    return { name: "public-home" };
  }

  if (
    meta?.requiresRole === "workspace_admin" &&
    !hasFreshAdminVerification(auth.adminVerifiedAt)
  ) {
    return { name: "workspace-admin-login" };
  }

  if (
    meta?.requiresWorkspaceMatch &&
    auth.sessionWorkspaceId &&
    auth.workspaceContextId &&
    auth.sessionWorkspaceId !== auth.workspaceContextId
  ) {
    return { name: "public-home" };
  }

  if (
    workspace.isWorkspaceHost &&
    workspace.workspaceId &&
    auth.isAuthenticated &&
    auth.workspaceContextId !== workspace.workspaceId
  ) {
    return notFoundFor(to.path);
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

  if (meta?.requiresSession) {
    await loadAuthenticatedStyles();
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
