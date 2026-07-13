<template>
  <div
    class="app-shell"
    :class="{
      'with-top-banners': hasTopBanners,
      'route-shell-auth': isFullBleedRoute,
      'route-shell-marketing': isMarketingFullBleedRoute,
      'route-shell-confirmation': isSubmitConfirmationRoute,
      'route-shell-unavailable': isUnavailableRoute,
      'route-shell-banner-bleed': isBannerBleedRoute,
    }"
    :style="appShellStyle"
  >
    <div v-if="isRouteNavigating" class="route-progress" aria-hidden="true"></div>
    <div
      v-if="showPageLoading"
      class="page-loading-overlay"
      role="status"
      aria-live="polite"
      aria-label="Loading page"
    >
      <div class="page-loading-mark" aria-hidden="true"></div>
      <div class="page-loading-copy">
        <strong>Loading...</strong>
        <span>Hold tight, we're preparing your tracking experience.</span>
      </div>
    </div>
    <AppTopBanners
      :maintenance-visible="showMaintenanceBanner"
      :maintenance-message="maintenanceMessage"
      :broadcast="activeBroadcast"
      :broadcast-visible="showBroadcast"
      :incident="incidentBanner"
      :incident-visible="showIncidentBanner"
      :incident-title="incidentBannerTitle"
      :incident-sla-line="incidentSlaLine"
      @dismiss-broadcast="dismissBroadcast"
      @dismiss-incident="dismissIncidentBanner"
      @elements="setTopBannerElements"
    >
      <AppBlockingOverlays
        :kill-switch-visible="showKillSwitchOverlay"
        :kill-switch-message="killSwitchMessage"
        :brand-logo-url="brandLogoUrl"
        :theme="theme"
        :maintenance-visible="showMaintenanceOverlay"
        :version-visible="showVersionOverlay && !showMaintenanceOverlay && !isUnavailableRoute"
        :current-version="appVersion"
        :latest-version="latestVersion"
        :session-visible="sessionTermination.visible && !showMaintenanceOverlay && !showKillSwitchOverlay && !isUnavailableRoute"
        :session-title="sessionTermination.title"
        :session-message="sessionTermination.message"
        @reload="reloadApp"
        @toggle-theme="toggleTheme"
        @sign-in-again="signInAgain"
      />
    </AppTopBanners>
    <AuthenticatedNavigation
      :visible="showTopMenu"
      :show-notification-bell="showNotificationBell"
      :is-outdated="isOutdated"
      :menu-open="menuOpen"
      :theme-label="themeLabel"
      :can-replay-onboarding="onboarding.canReplay.value"
      :show-logout-user-action="showLogoutUserAction"
      :app-version="appVersion"
      :offline-queue-count="offlineQueue.count.value"
      :offline-queue-tooltip="offlineQueue.tooltip.value"
      :status-class="statusClass"
      :status-label="statusLabel"
      @toggle-menu="toggleMenu"
      @toggle-theme="toggleTheme"
      @open-admin-panel="openAdminPanel"
      @open-onboarding="openOnboardingTour"
      @logout="logoutTenant"
      @close-menu="menuOpen = false"
    />
    <div v-if="!auth.isInitialized" class="page auth-loading-page">
      <div class="auth-loading-card">
        <h1>Loading ItemTraxx</h1>
        <p>Loading your session. Please wait...</p>
      </div>
    </div>
    <router-view v-else />
    <OnboardingModal
      v-if="onboarding.visible.value"
      :visible="onboarding.visible.value"
      :variant="onboarding.variant.value"
      @close="onboarding.complete"
      @complete="onboarding.complete"
    />
    <CookieConsentBanner
      v-if="consent.showCookieConsentBanner.value && !showMaintenanceOverlay && !showKillSwitchOverlay && !isUnavailableRoute"
      @essential-only="consent.acceptEssentialOnly"
      @accept-all="consent.acceptAll"
      @save-preferences="consent.savePreferences"
    />
    <FatalErrorToast v-if="fatalErrorToast.visible" />
    <Analytics v-if="consent.showTelemetry.value" />
    <SpeedInsights v-if="consent.showTelemetry.value" />
  </div>
</template>

<script setup lang="ts">
import { computed, defineAsyncComponent, onMounted, onScopeDispose, ref, watch, watchEffect } from "vue";
import { useRoute, useRouter } from "vue-router";
import AppBlockingOverlays from "./components/app/AppBlockingOverlays.vue";
import AppTopBanners from "./components/app/AppTopBanners.vue";
import AuthenticatedNavigation from "./components/app/AuthenticatedNavigation.vue";
import CookieConsentBanner from "./components/CookieConsentBanner.vue";
import { useAdminSessionLifecycle } from "./composables/useAdminSessionLifecycle";
import { useAppVersionStatus } from "./composables/useAppVersionStatus";
import { useCookieConsentTelemetry } from "./composables/useCookieConsentTelemetry";
import { useOfflineQueueCount } from "./composables/useOfflineQueueCount";
import { useOnboarding } from "./composables/useOnboarding";
import { useSystemStatus } from "./composables/useSystemStatus";
import { useTopBannerLayout } from "./composables/useTopBannerLayout";
import { buildDistrictAppUrl, lookupDistrictById, resolveDistrictHost } from "./services/districtService";
import { getAuthState } from "./store/authState";
import { getDistrictState } from "./store/districtState";
import { getFatalErrorToastState } from "./store/fatalErrorToast";
import { getRouteLoadingState } from "./store/routeLoading";
import { getSessionTerminationState } from "./store/sessionTermination";

const OnboardingModal = defineAsyncComponent(() => import("./components/OnboardingModal.vue"));
const Analytics = defineAsyncComponent(async () => (await import("@vercel/analytics/vue")).Analytics);
const FatalErrorToast = defineAsyncComponent(async () => (await import("./components/FatalErrorToast.vue")).default);
const SpeedInsights = defineAsyncComponent(async () => (await import("@vercel/speed-insights/vue")).SpeedInsights);

const auth = getAuthState();
const district = getDistrictState();
const routeLoading = getRouteLoadingState();
const fatalErrorToast = getFatalErrorToastState();
const sessionTermination = getSessionTerminationState();
const { state: systemStatus, statusLabel, statusClass } = useSystemStatus();
const router = useRouter();
const route = useRoute();
const menuOpen = ref(false);
const theme = ref<"light" | "dark">("light");
const appVersion = import.meta.env.VITE_GIT_COMMIT || "n/a";
const appBranch = (import.meta.env.VITE_GIT_BRANCH || "n/a").trim();
const isNonMainBuild = appBranch !== "" && appBranch !== "n/a" && appBranch !== "main";
const lightBrandLogoUrl = import.meta.env.VITE_BRAND_LOGO_LIGHT_URL as string | undefined;
const darkBrandLogoUrl = import.meta.env.VITE_BRAND_LOGO_DARK_URL as string | undefined;
type BroadcastPayload = { id: string; message: string; level: "info" | "warning" | "critical" };
type IncidentBanner = { id: string; message: string; level: "degraded" | "down"; checkedAt?: string };
const activeBroadcast = ref<BroadcastPayload | null>(null);
const incidentBanner = ref<IncidentBanner | null>(null);
const dismissedBroadcastId = ref(localStorage.getItem("itemtraxx-broadcast-dismissed") || "");
const dismissedIncidentId = ref(localStorage.getItem("itemtraxx-incident-dismissed") || "");
const maintenanceEnabled = ref(false);
const maintenanceMessage = ref("Maintenance currentlyin progress.");
const killSwitchEnabled = ref(false);
const killSwitchMessage = ref("Unfortunately ItemTraxx is currently unavailable. We apologize for any inconvenience and are working to restore access as soon as possible. Please see the status page (https://status.itemtraxx.com/ref=killswitch) for more information.");
const backendUnavailable = ref(false);
const showPageLoading = ref(false);
let pageLoadingTimer: number | null = null;
const MAINTENANCE_CACHE_KEY = "itemtraxx-maintenance-state";
type CachedMaintenanceState = { enabled: boolean; message: string; updatedAt: string };

const readCachedMaintenanceState = (): CachedMaintenanceState | null => {
  try {
    const parsed = JSON.parse(localStorage.getItem(MAINTENANCE_CACHE_KEY) || "null") as Partial<CachedMaintenanceState> | null;
    if (!parsed || typeof parsed.enabled !== "boolean" || typeof parsed.message !== "string" || typeof parsed.updatedAt !== "string") return null;
    return { enabled: parsed.enabled, message: parsed.message.trim() || "Maintenance currently in progress.", updatedAt: parsed.updatedAt };
  } catch { return null; }
};
const writeCachedMaintenanceState = (state: CachedMaintenanceState | null) => {
  try {
    if (state) localStorage.setItem(MAINTENANCE_CACHE_KEY, JSON.stringify(state));
    else localStorage.removeItem(MAINTENANCE_CACHE_KEY);
  } catch { /* Best effort only. */ }
};
const cachedMaintenanceState = readCachedMaintenanceState();
if (cachedMaintenanceState?.enabled) {
  maintenanceEnabled.value = true;
  maintenanceMessage.value = cachedMaintenanceState.message;
}

const isDevSubdomainHost = computed(() => {
  const hostname = window.location.hostname.toLowerCase();
  if (hostname === "dev.itemtraxx.com" || hostname.endsWith(".dev.itemtraxx.com")) return true;
  if (["localhost", "127.0.0.1", "0.0.0.0"].includes(hostname) || hostname.endsWith(".localhost")) return true;
  if (hostname.startsWith("192.168.") || hostname.startsWith("10.")) return true;
  const match172 = hostname.match(/^172\.(\d{1,3})\./);
  const secondOctet = Number(match172?.[1]);
  return !!match172 && Number.isFinite(secondOctet) && secondOctet >= 16 && secondOctet <= 31;
});
const isFullBleedRoute = computed(() => ["/login", "/tenant/admin-login", "/super-auth", "/internal-auth", "/reset-password"].includes(route.path));
const isMarketingFullBleedRoute = computed(() => ["/", "/landing-new", "/changelog", "/itemscanner"].includes(route.path));
const isSubmitConfirmationRoute = computed(() => route.path === "/submitconfirmation");
const isBannerBleedRoute = computed(() => ["/legal", "/security", "/trust", "/compliance", "/faq", "/contact", "/privacy", "/cookies", "/accessibility", "/about", "/pricing", "/forgot-password", "/contact-sales", "/request-demo", "/contact-support", "/report-security-issue", "/getting-started"].includes(route.path));
const isDarkChromeRoute = computed(() => ["/", "/landing-new", "/pricing", "/changelog", "/itemscanner"].includes(route.path));
const isUnavailableRoute = computed(() => route.path === "/unavailable" || route.name === "public-unavailable");
const isKillSwitchAllowedRoute = computed(() => route.path === "/" || isUnavailableRoute.value);
const hiddenMenuRoutes = new Set(["public-home", "public-unavailable", "public-pricing", "public-about", "public-security", "public-report-security-issue", "public-changelog", "public-compliance", "public-privacy", "public-cookies", "public-contact", "public-trust", "public-faq", "public-accessibility", "public-getting-started", "public-itemscanner", "public-legal", "public-forgot-password", "public-reset-password", "public-home-new2", "public-request-demo", "public-contact-sales", "public-contact-support", "public-submit-confirmation"]);
const showTopMenu = computed(() => !hiddenMenuRoutes.has(String(route.name)));
const showLogoutUserAction = computed(() => auth.isAuthenticated && !Boolean(route.meta.public) && route.path !== "/login");
const isTenantScopedRoute = computed(() => auth.isAuthenticated && !!auth.tenantContextId && route.path.startsWith("/tenant"));
const isTenantAdminArea = computed(() => route.path !== "/tenant/admin-login" && route.path.startsWith("/tenant/admin"));
const shouldTrackTenantAdminSession = computed(() => auth.isAuthenticated && auth.role === "tenant_admin" && isTenantAdminArea.value);
const showNotificationBell = computed(() => auth.isAuthenticated && auth.role === "tenant_admin" && route.path !== "/tenant/admin-login" && (route.path.startsWith("/tenant/admin") || route.path.startsWith("/district")));
const isLocalDevMaintenanceBypass = computed(() => {
  if (!import.meta.env.DEV || (import.meta.env.VITE_DEV_MAINTENANCE_BYPASS ?? "true") !== "true") return false;
  const host = window.location.hostname.toLowerCase();
  if (["localhost", "127.0.0.1", "0.0.0.0"].includes(host) || host.startsWith("192.168.") || host.startsWith("10.")) return true;
  const secondOctet = Number(host.match(/^172\.(\d{1,3})\./)?.[1]);
  return Number.isFinite(secondOctet) && secondOctet >= 16 && secondOctet <= 31;
});

const showBroadcast = computed(() => !!activeBroadcast.value && dismissedBroadcastId.value !== activeBroadcast.value.id);
const showIncidentBanner = computed(() => auth.isAuthenticated && !!incidentBanner.value && dismissedIncidentId.value !== incidentBanner.value.id);
const showMaintenanceBanner = computed(() => maintenanceEnabled.value && !isLocalDevMaintenanceBypass.value && !isUnavailableRoute.value);
const showMaintenanceOverlay = computed(() => {
  if (isLocalDevMaintenanceBypass.value || !maintenanceEnabled.value) return false;
  const name = String(route.name || "");
  if (["public-unavailable", "not-found", "super-auth", "internal-auth"].includes(name) || name.startsWith("internal-")) return false;
  return !name.startsWith("super-admin-");
});
const showKillSwitchOverlay = computed(() => !isLocalDevMaintenanceBypass.value && !isKillSwitchAllowedRoute.value && killSwitchEnabled.value);
const hasTopBanners = computed(() => showMaintenanceBanner.value || showBroadcast.value || showIncidentBanner.value);
const incidentBannerTitle = computed(() => incidentBanner.value?.level === "down" ? "System Outage" : "System Degraded");
const incidentSlaLine = computed(() => {
  if (!incidentBanner.value) return "";
  const target = "SLA target: status update within 6 hours on status page.";
  if (!incidentBanner.value.checkedAt) return target;
  const checked = new Date(incidentBanner.value.checkedAt);
  return Number.isNaN(checked.getTime()) ? target : `${target} Last checked ${checked.toLocaleTimeString()}.`;
});

const consent = useCookieConsentTelemetry(auth);
const version = useAppVersionStatus({ appVersion, isDevHost: isDevSubdomainHost, isNonMainBuild });
const { isOutdated, latestVersion, forceUpdateOverlay } = version;
const showVersionOverlay = computed(() => forceUpdateOverlay.value || (!isDevSubdomainHost.value && !isNonMainBuild && isOutdated.value));
const offlineQueue = useOfflineQueueCount(isTenantScopedRoute);
const onboarding = useOnboarding(auth, route);
const { appShellStyle, setElements: setTopBannerElements } = useTopBannerLayout();
const adminSession = useAdminSessionLifecycle({ auth, route, router, sessionTermination, isDevHost: isDevSubdomainHost, isTenantAdminArea, shouldTrackTenantAdminSession, closeMenu: () => { menuOpen.value = false; } });
const { signInAgain } = adminSession;
const isRouteNavigating = computed(() => routeLoading.isLoading);
const themeLabel = computed(() => theme.value === "dark" ? "Light Mode" : "Dark Mode");
const brandLogoUrl = computed(() => theme.value === "light" ? lightBrandLogoUrl || darkBrandLogoUrl || "" : darkBrandLogoUrl || lightBrandLogoUrl || "");

const updateBrowserChromeColor = () => {
  const themeColor = document.querySelector('meta[name="theme-color"]');
  const appleStatus = document.querySelector('meta[name="apple-mobile-web-app-status-bar-style"]');
  if (!themeColor) return;
  let color = theme.value === "dark" ? "#0c1016" : "#f9f9f7";
  let appleStyle = theme.value === "dark" ? "black-translucent" : "default";
  if (isFullBleedRoute.value) color = theme.value === "dark" ? "#090c12" : "#f9f9f7";
  else if (isSubmitConfirmationRoute.value) color = theme.value === "dark" ? "#090c12" : "#eef5f8";
  else if (isUnavailableRoute.value) color = theme.value === "dark" ? "#101010" : "#f7f7f5";
  else if (isDarkChromeRoute.value) { color = "#090d14"; appleStyle = "black-translucent"; }
  themeColor.setAttribute("content", color);
  appleStatus?.setAttribute("content", appleStyle);
};
const applyTheme = (next: "light" | "dark") => {
  theme.value = next;
  document.documentElement.setAttribute("data-theme", next);
  localStorage.setItem("itemtraxx-theme", next);
  updateBrowserChromeColor();
};
const toggleTheme = () => { applyTheme(theme.value === "dark" ? "light" : "dark"); menuOpen.value = false; };
const toggleMenu = () => { menuOpen.value = !menuOpen.value; };
const reloadApp = () => window.location.assign(`${window.location.origin}/`);
const openOnboardingTour = () => { onboarding.open(); menuOpen.value = false; };
const openAdminPanel = async () => { menuOpen.value = false; await router.push("/tenant/admin-login"); };
const logoutTenant = async () => {
  if (!window.confirm("Are you sure you want to log out?")) return;
  menuOpen.value = false;
  const { getPostSignOutUrl, signOut } = await import("./services/authService");
  const nextUrl = getPostSignOutUrl();
  await signOut();
  if (nextUrl.startsWith("http")) window.location.assign(nextUrl);
  else await router.push(nextUrl);
};
const dismissBroadcast = () => {
  if (!activeBroadcast.value) return;
  dismissedBroadcastId.value = activeBroadcast.value.id;
  localStorage.setItem("itemtraxx-broadcast-dismissed", activeBroadcast.value.id);
};
const dismissIncidentBanner = () => {
  if (!incidentBanner.value) return;
  dismissedIncidentId.value = incidentBanner.value.id;
  localStorage.setItem("itemtraxx-incident-dismissed", incidentBanner.value.id);
};

const applySystemStatus = () => {
  if (!systemStatus.hasResult) { backendUnavailable.value = false; return; }
  const payload = systemStatus.payload;
  killSwitchEnabled.value = payload.kill_switch?.enabled === true;
  if (killSwitchEnabled.value) killSwitchMessage.value = typeof payload.kill_switch?.message === "string" && payload.kill_switch.message.trim() ? payload.kill_switch.message.trim() : "Unfortunately ItemTraxx is currently unavailable. We apologize for any inconvenience and are working to restore access as soon as possible. Please see the status page (https://status.itemtraxx.com/ref=killswitch) for more information.";
  const broadcast = payload.broadcast;
  activeBroadcast.value = broadcast?.enabled && typeof broadcast.message === "string" && broadcast.message.trim() ? {
    id: typeof broadcast.updated_at === "string" && broadcast.updated_at ? broadcast.updated_at : broadcast.message.trim(),
    message: broadcast.message.trim(),
    level: broadcast.level === "warning" || broadcast.level === "critical" ? broadcast.level : "info",
  } : null;
  if (payload.maintenance && typeof payload.maintenance === "object") {
    const enabled = payload.maintenance.enabled === true;
    const message = typeof payload.maintenance.message === "string" && payload.maintenance.message.trim() ? payload.maintenance.message.trim() : "Maintenance currently in progress.";
    maintenanceEnabled.value = enabled;
    maintenanceMessage.value = message;
    writeCachedMaintenanceState(enabled ? { enabled: true, message, updatedAt: typeof payload.maintenance.updated_at === "string" ? payload.maintenance.updated_at : new Date().toISOString() } : null);
  } else if (systemStatus.responseStatus >= 500 || payload.status === "down") {
    const cached = readCachedMaintenanceState();
    if (cached?.enabled) { maintenanceEnabled.value = true; maintenanceMessage.value = cached.message; }
  } else { maintenanceEnabled.value = false; writeCachedMaintenanceState(null); }
  if (systemStatus.responseOk && payload.status === "operational") { incidentBanner.value = null; backendUnavailable.value = false; return; }
  const down = systemStatus.responseStatus >= 500 || payload.status === "down";
  backendUnavailable.value = down && !maintenanceEnabled.value;
  incidentBanner.value = {
    id: payload.checked_at ? String(payload.checked_at) : `${payload.status}-${payload.incident_summary || (down ? "down" : "degraded")}`,
    message: typeof payload.incident_summary === "string" && payload.incident_summary ? payload.incident_summary : down ? "A system outage has been detected." : "A system incident or maintenance event is active.",
    level: down ? "down" : "degraded",
    checkedAt: payload.checked_at,
  };
};

const hasFreshVerification = (verifiedAt: string | null) => !!verifiedAt && !Number.isNaN(Date.parse(verifiedAt)) && Date.now() - Date.parse(verifiedAt) <= 15 * 60 * 1000;
let publicHomeRedirectInFlight = false;
const maybeRedirectAuthenticatedPublicHome = async () => {
  if (publicHomeRedirectInFlight || !["/", "/landing-new", "/about"].includes(route.path) || (killSwitchEnabled.value && route.path === "/") || !auth.isInitialized || !auth.isAuthenticated) return;
  if (district.isDistrictHost && district.districtId && auth.districtContextId && auth.districtContextId !== district.districtId) return;
  let targetPath: string | null = null;
  if (auth.role === "super_admin") targetPath = auth.hasSecondaryAuth && hasFreshVerification(auth.superVerifiedAt) ? "/super-admin" : "/super-auth";
  else if (auth.role === "district_admin") targetPath = hasFreshVerification(auth.adminVerifiedAt) ? "/district" : "/tenant/admin-login";
  else if ((auth.role === "tenant_admin" || auth.role === "tenant_user") && auth.tenantContextId) targetPath = "/tenant/checkout";
  if (!targetPath) return;
  publicHomeRedirectInFlight = true;
  try {
    const currentHost = resolveDistrictHost(window.location.hostname);
    if (!currentHost.isDistrictHost && auth.role !== "super_admin" && auth.districtContextId) {
      const districtSlug = (await lookupDistrictById(auth.districtContextId))?.slug?.trim().toLowerCase();
      if (districtSlug) window.location.replace(buildDistrictAppUrl(districtSlug, targetPath));
    }
  } finally { publicHomeRedirectInFlight = false; }
};

watchEffect(() => {
  document.documentElement.classList.toggle("auth-route-active", isFullBleedRoute.value);
  document.body.classList.toggle("auth-route-active", isFullBleedRoute.value);
  document.documentElement.classList.toggle("marketing-route-active", isDarkChromeRoute.value);
  document.body.classList.toggle("marketing-route-active", isDarkChromeRoute.value);
  document.documentElement.classList.toggle("confirmation-route-active", isSubmitConfirmationRoute.value);
  document.body.classList.toggle("confirmation-route-active", isSubmitConfirmationRoute.value);
  document.documentElement.classList.toggle("unavailable-route-active", isUnavailableRoute.value);
  document.body.classList.toggle("unavailable-route-active", isUnavailableRoute.value);
  updateBrowserChromeColor();
});
watch(() => [systemStatus.hasResult, systemStatus.responseOk, systemStatus.responseStatus, systemStatus.payload] as const, applySystemStatus, { immediate: true });
watch(() => routeLoading.isLoading, (loading) => {
  if (pageLoadingTimer) window.clearTimeout(pageLoadingTimer);
  pageLoadingTimer = null;
  if (!loading) { showPageLoading.value = false; return; }
  pageLoadingTimer = window.setTimeout(() => { showPageLoading.value = true; pageLoadingTimer = null; }, 350);
});
watch(() => [killSwitchEnabled.value, route.path] as const, ([enabled, path]) => {
  if (enabled && !isLocalDevMaintenanceBypass.value && path !== "/" && path !== "/unavailable") void router.replace("/unavailable");
});
watch(() => [backendUnavailable.value, route.path] as const, ([unavailable, path]) => {
  if (unavailable && !isLocalDevMaintenanceBypass.value && path !== "/unavailable") void router.replace("/unavailable");
});
watch(() => [route.name, auth.isInitialized, auth.isAuthenticated, auth.role, auth.districtContextId, auth.adminVerifiedAt, auth.hasSecondaryAuth, auth.superVerifiedAt, district.isDistrictHost, district.districtId] as const, () => void maybeRedirectAuthenticatedPublicHome());
onMounted(() => {
  const saved = localStorage.getItem("itemtraxx-theme");
  applyTheme(saved === "light" || saved === "dark" ? saved : "light");
  void maybeRedirectAuthenticatedPublicHome();
});
onScopeDispose(() => { if (pageLoadingTimer) window.clearTimeout(pageLoadingTimer); });
</script>
