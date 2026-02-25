<template>
  <div class="app-shell" :class="{ 'with-top-banners': hasTopBanners }" :style="appShellStyle">
    <div v-if="isRouteNavigating" class="route-progress" aria-hidden="true"></div>
    <div
      v-if="showMaintenanceBanner"
      ref="maintenanceBannerRef"
      class="maintenance-top-banner"
      role="alert"
      aria-live="assertive"
    >
      <strong>Maintenance Mode</strong>
      <span>{{ maintenanceMessage }}</span>
    </div>
    <div v-if="showMaintenanceOverlay" class="maintenance-fullscreen" role="alertdialog" aria-live="assertive">
      <div class="maintenance-fullscreen-card">
        <h2>Maintenance in Progress</h2>
        <p>
          ItemTraxx is temporarily unavailable while we apply updates and stability improvements.
        </p>
        <p>
          Please try again shortly. Your data is safe and we will restore full access as soon as
          maintenance is complete.
        </p>
        <div class="maintenance-fullscreen-actions">
          <a
            class="button-link"
            href="https://status.itemtraxx.com/"
            target="_blank"
            rel="noreferrer"
          >
            View Live Status
          </a>
          <button type="button" class="button-primary" @click="reloadApp">Refresh</button>
        </div>
      </div>
    </div>
    <div
      v-if="activeBroadcast && showBroadcast"
      ref="broadcastBannerRef"
      class="broadcast-top-banner"
      role="status"
      aria-live="polite"
      :style="broadcastBannerStyle"
    >
      <div class="broadcast-content">
        <strong class="broadcast-title">Broadcast</strong>
        <span class="broadcast-message">{{ activeBroadcast.message }}</span>
      </div>
      <button
        type="button"
        class="broadcast-dismiss"
        aria-label="Dismiss broadcast"
        @click="dismissBroadcast"
      >
        ×
      </button>
    </div>
    <div
      v-if="incidentBanner && showIncidentBanner"
      class="broadcast-banner incident-banner"
      :class="incidentBanner.level === 'down' ? 'broadcast-critical' : 'broadcast-warning'"
      :style="incidentBannerStyle"
      role="status"
      aria-live="polite"
    >
      <div class="broadcast-content">
        <strong class="broadcast-title">{{ incidentBannerTitle }}</strong>
        <span class="broadcast-message">{{ incidentBanner.message }}</span>
        <span class="broadcast-meta">{{ incidentSlaLine }}</span>
      </div>
      <a
        class="broadcast-link"
        href="https://status.itemtraxx.com/"
        target="_blank"
        rel="noreferrer"
      >
        View status
      </a>
      <button type="button" class="broadcast-dismiss" @click="dismissIncidentBanner">
        x
      </button>
    </div>
    <div v-if="showTopMenu" class="top-menu" :style="topMenuStyle">
      <div class="menu-button-wrap">
        <div v-if="showNotificationBell" class="menu-notification">
          <NotificationBell />
        </div>
        <span v-if="isOutdated" class="menu-alert" aria-hidden="true">!</span>
        <button
          type="button"
          class="menu-button"
          @click="toggleMenu"
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
        <button type="button" class="menu-item" role="menuitem" @click="toggleTheme">
          {{ themeLabel }}
        </button>
        <button type="button" class="menu-item" role="menuitem" @click="openAdminPanel">
          Open Admin Panel
        </button>
        <button type="button" class="menu-item danger" role="menuitem" @click="logoutTenant">
          Log Out User
        </button>
        <a
          class="menu-item muted" role="menuitem"
          href="https://github.com/ItemTraxxCo/ItemTraxx-App"
          target="_blank"
          rel="noreferrer"
        >
          Version: <strong>{{ appVersion }}</strong>
        </a>
        <div v-if="isOutdated" class="menu-item status-warning" role="menuitem">
          Version outdated, refresh to update.
        </div>
        <a class="menu-item" role="menuitem" href="mailto:support@itemtraxx.com">
          Contact Support
        </a>
        <a
          class="menu-item muted menu-status" role="menuitem"
          href="https://status.itemtraxx.com/"
          target="_blank"
          rel="noreferrer"
        >
          <span class="status-dot" :class="statusClass" aria-hidden="true"></span>
          System Status: {{ statusLabel }}
        </a>
      </div>
    </div>
    <div v-if="!auth.isInitialized" class="page">
      <h1>bye bye 👋</h1>
      <p>Please press Cmd+shift+R (macOS), or Ctrl+Shift+R (Windows) to finish signing out.</p>
      <button type="button" class="button-primary" @click="reloadApp">Reload</button>
    </div>
    <router-view v-else />
    <Analytics v-if="showTelemetry" />
    <SpeedInsights v-if="showTelemetry" />
  </div>
</template>

<script setup lang="ts">
import { computed, defineAsyncComponent, nextTick, onMounted, onUnmounted, ref, watch } from "vue";
import { useRoute, useRouter } from "vue-router";
import { signOut } from "./services/authService";
import { fetchSystemStatus } from "./services/systemStatusService";
import { clearAdminVerification, getAuthState } from "./store/authState";
import NotificationBell from "./components/NotificationBell.vue";

const Analytics = defineAsyncComponent(async () => {
  const module = await import("@vercel/analytics/vue");
  return module.Analytics;
});

const SpeedInsights = defineAsyncComponent(async () => {
  const module = await import("@vercel/speed-insights/vue");
  return module.SpeedInsights;
});

const auth = getAuthState();
const router = useRouter();
const route = useRoute();
const menuOpen = ref(false);
const theme = ref<"light" | "dark">("light");
const appVersion = import.meta.env.VITE_GIT_COMMIT || "n/a";
type BroadcastLevel = "info" | "warning" | "critical";
type BroadcastPayload = {
  id: string;
  message: string;
  level: BroadcastLevel;
};
type IncidentBanner = {
  id: string;
  message: string;
  level: "degraded" | "down";
  checkedAt?: string;
};
const activeBroadcast = ref<BroadcastPayload | null>(null);
const dismissedBroadcastId = ref(localStorage.getItem("itemtraxx-broadcast-dismissed") || "");
const incidentBanner = ref<IncidentBanner | null>(null);
const dismissedIncidentId = ref(localStorage.getItem("itemtraxx-incident-dismissed") || "");
const maintenanceBannerRef = ref<HTMLElement | null>(null);
const broadcastBannerRef = ref<HTMLElement | null>(null);
const maintenanceBannerHeight = ref(0);
const broadcastBannerHeight = ref(0);
const maintenanceEnabled = ref(false);
const maintenanceMessage = ref("Maintenance in progress.");
const statusLabel = ref("Unknown");
const statusClass = ref<"status-ok" | "status-warn" | "status-down" | "status-unknown">(
  "status-unknown"
);
const isOutdated = ref(false);
const latestVersion = ref<string | null>(null);
const showTelemetry = ref(false);
const isRouteNavigating = ref(false);
let statusTimer: number | null = null;
let versionTimer: number | null = null;
let adminIdleTimer: number | null = null;
let deferredStatusTimer: number | null = null;
let deferredVersionTimer: number | null = null;
let deferredTelemetryTimer: number | null = null;
let routeProgressTimer: number | null = null;
const isIdleLogoutRunning = ref(false);

const ADMIN_IDLE_TIMEOUT_MINUTES = Number(import.meta.env.VITE_ADMIN_IDLE_TIMEOUT_MINUTES || 20);
const ADMIN_IDLE_TIMEOUT_MS =
  Number.isFinite(ADMIN_IDLE_TIMEOUT_MINUTES) && ADMIN_IDLE_TIMEOUT_MINUTES > 0
    ? ADMIN_IDLE_TIMEOUT_MINUTES * 60 * 1000
    : 20 * 60 * 1000;

const GITHUB_HEAD_COMMIT_API =
  "https://api.github.com/repos/ItemTraxxCo/ItemTraxx-App/commits/main";

const themeLabel = computed(() =>
  theme.value === "dark" ? "Light Mode" : "Dark Mode"
);
const showTopMenu = computed(() => route.name !== "public-home");
const isLocalDevMaintenanceBypass = computed(() => {
  if (import.meta.env.DEV !== true) return false;
  if ((import.meta.env.VITE_DEV_MAINTENANCE_BYPASS ?? "true") !== "true") return false;
  const host = window.location.hostname.toLowerCase();
  if (host === "localhost" || host === "127.0.0.1" || host === "0.0.0.0") {
    return true;
  }
  if (host.startsWith("192.168.") || host.startsWith("10.")) {
    return true;
  }
  const match172 = host.match(/^172\.(\d{1,3})\./);
  if (match172) {
    const secondOctet = Number(match172[1]);
    return Number.isFinite(secondOctet) && secondOctet >= 16 && secondOctet <= 31;
  }
  return false;
});
const isTenantAdminArea = computed(() => {
  if (route.path === "/tenant/admin-login") return false;
  return route.path.startsWith("/tenant/admin");
});
const showNotificationBell = computed(() => {
  if (!auth.isAuthenticated) return false;
  if (auth.role !== "tenant_user" && auth.role !== "tenant_admin") return false;
  return route.path.startsWith("/tenant");
});
const showBroadcast = computed(() => {
  if (!activeBroadcast.value) return false;
  return dismissedBroadcastId.value !== activeBroadcast.value.id;
});
const showIncidentBanner = computed(() => {
  if (!auth.isAuthenticated) return false;
  if (!incidentBanner.value) return false;
  return dismissedIncidentId.value !== incidentBanner.value.id;
});
const showMaintenanceBanner = computed(
  () => maintenanceEnabled.value && !isLocalDevMaintenanceBypass.value
);
const showMaintenanceOverlay = computed(() => {
  if (isLocalDevMaintenanceBypass.value) return false;
  if (!maintenanceEnabled.value) return false;
  const routeName = String(route.name || "");
  if (routeName === "public-home" || routeName === "not-found" || routeName === "super-auth") {
    return false;
  }
  return !routeName.startsWith("super-admin-");
});
const incidentBannerTitle = computed(() => {
  if (!incidentBanner.value) return "System Notice";
  return incidentBanner.value.level === "down" ? "System Outage" : "System Degraded";
});
const incidentSlaLine = computed(() => {
  if (!incidentBanner.value) return "";
  const slaTarget =
    incidentBanner.value.level === "down"
      ? "SLA target: status update within 6 hours on status page."
      : "SLA target: status update within 6 hours on status page.";
  if (!incidentBanner.value.checkedAt) return slaTarget;
  const checked = new Date(incidentBanner.value.checkedAt);
  if (Number.isNaN(checked.getTime())) return slaTarget;
  return `${slaTarget} Last checked ${checked.toLocaleTimeString()}.`;
});
const hasTopBanners = computed(() => showMaintenanceBanner.value || (showBroadcast.value && !!activeBroadcast.value));
const topOffsetPx = computed(() => {
  const total = maintenanceBannerHeight.value + broadcastBannerHeight.value;
  if (total <= 0) return "0px";
  return `${total}px`;
});
const appShellStyle = computed(() => ({
  "--top-banner-offset": topOffsetPx.value,
}) as Record<string, string>);
const topMenuStyle = computed(() => ({
  top: `calc(1rem + ${topOffsetPx.value})`,
}));
const incidentBannerStyle = computed(() => ({
  top: `calc(1rem + ${topOffsetPx.value})`,
}));
const broadcastBannerStyle = computed(() => ({
  top: showMaintenanceBanner.value ? `${maintenanceBannerHeight.value}px` : "0px",
}));

const measureTopBanners = () => {
  maintenanceBannerHeight.value = showMaintenanceBanner.value
    ? (maintenanceBannerRef.value?.offsetHeight ?? 0)
    : 0;
  broadcastBannerHeight.value = showBroadcast.value && activeBroadcast.value
    ? (broadcastBannerRef.value?.offsetHeight ?? 0)
    : 0;
};

const applyTheme = (next: "light" | "dark") => {
  theme.value = next;
  document.documentElement.setAttribute("data-theme", next);
  localStorage.setItem("itemtraxx-theme", next);
};

const toggleTheme = () => {
  applyTheme(theme.value === "dark" ? "light" : "dark");
  menuOpen.value = false;
};

const toggleMenu = () => {
  menuOpen.value = !menuOpen.value;
};

const openAdminPanel = async () => {
  menuOpen.value = false;
  await router.push("/tenant/admin-login");
};

const logoutTenant = async () => {
  const confirmed = window.confirm("Are you sure you want to log out?");
  if (!confirmed) {
    return;
  }
  menuOpen.value = false;
  await signOut();
  await router.push("/");
};

const reloadApp = () => {
  window.location.reload();
};

const clearAdminIdleTimer = () => {
  if (adminIdleTimer) {
    window.clearTimeout(adminIdleTimer);
    adminIdleTimer = null;
  }
};

const runIdleLogout = async () => {
  if (isIdleLogoutRunning.value) return;
  if (!auth.isAuthenticated || auth.role !== "tenant_admin" || !isTenantAdminArea.value) {
    return;
  }
  isIdleLogoutRunning.value = true;
  try {
    clearAdminVerification();
    await router.replace("/tenant/checkout");
  } finally {
    isIdleLogoutRunning.value = false;
  }
};

const resetAdminIdleTimer = () => {
  clearAdminIdleTimer();
  if (!auth.isAuthenticated || auth.role !== "tenant_admin" || !isTenantAdminArea.value) {
    return;
  }
  adminIdleTimer = window.setTimeout(() => {
    void runIdleLogout();
  }, ADMIN_IDLE_TIMEOUT_MS);
};

const adminActivityEvents: Array<keyof WindowEventMap> = [
  "mousemove",
  "mousedown",
  "keydown",
  "touchstart",
  "scroll",
];

const handleAdminActivity = () => {
  resetAdminIdleTimer();
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

const refreshSystemStatus = async () => {
  const response = await fetchSystemStatus();
  if (!response) {
    statusLabel.value = "Unknown";
    statusClass.value = "status-unknown";
    return;
  }

  const payload = response.payload;
  const broadcast = payload.broadcast;
  if (broadcast?.enabled && typeof broadcast.message === "string" && broadcast.message.trim()) {
    const level: BroadcastLevel =
      broadcast.level === "warning" || broadcast.level === "critical"
        ? broadcast.level
        : "info";
    const broadcastId = typeof broadcast.updated_at === "string" && broadcast.updated_at
      ? broadcast.updated_at
      : broadcast.message.trim();
    activeBroadcast.value = {
      id: broadcastId,
      message: broadcast.message.trim(),
      level,
    };
  } else {
    activeBroadcast.value = null;
  }

  if (payload.maintenance?.enabled) {
    maintenanceEnabled.value = true;
    maintenanceMessage.value =
      typeof payload.maintenance.message === "string" && payload.maintenance.message.trim()
        ? payload.maintenance.message.trim()
        : "Maintenance in progress.";
  } else {
    maintenanceEnabled.value = false;
  }

  if (response.ok && payload.status === "operational") {
    statusLabel.value = "Running";
    statusClass.value = "status-ok";
    incidentBanner.value = null;
    return;
  }

  if (response.status >= 500 || payload.status === "down") {
    statusLabel.value = "Down";
    statusClass.value = "status-down";
    const incidentId =
      (payload.checked_at && String(payload.checked_at)) ||
      `${payload.status}-${payload.incident_summary || "down"}`;
    incidentBanner.value = {
      id: incidentId,
      message:
        typeof payload.incident_summary === "string" && payload.incident_summary
          ? payload.incident_summary
          : "A system outage has been detected.",
      level: "down",
      checkedAt: payload.checked_at,
    };
    return;
  }

  statusLabel.value = "Degraded";
  statusClass.value = "status-warn";
  const incidentId =
    (payload.checked_at && String(payload.checked_at)) ||
    `${payload.status}-${payload.incident_summary || "degraded"}`;
  incidentBanner.value = {
    id: incidentId,
    message:
      typeof payload.incident_summary === "string" && payload.incident_summary
        ? payload.incident_summary
        : "A system incident or maintenance event is active.",
    level: "degraded",
    checkedAt: payload.checked_at,
  };
};

const refreshVersionStatus = async () => {
  if (!auth.isAuthenticated) {
    isOutdated.value = false;
    latestVersion.value = null;
    return;
  }
  if (!appVersion || appVersion === "n/a") {
    isOutdated.value = false;
    return;
  }

  const controller = new AbortController();
  const timeoutId = window.setTimeout(() => controller.abort(), 4000);
  try {
    const response = await fetch(GITHUB_HEAD_COMMIT_API, {
      method: "GET",
      signal: controller.signal,
    });
    if (!response.ok) {
      return;
    }

    const payload = (await response.json().catch(() => ({}))) as {
      sha?: string;
    };
    const latestSha = typeof payload.sha === "string" ? payload.sha : "";
    if (latestSha.length < 7) {
      return;
    }

    latestVersion.value = latestSha.slice(0, 7);
    isOutdated.value = latestVersion.value !== appVersion;
  } catch {
    // Keep current state on network/API errors.
  } finally {
    window.clearTimeout(timeoutId);
  }
};

const scheduleLowPriorityTask = (task: () => void, delayMs = 300) =>
  window.setTimeout(task, delayMs);

const startStatusPolling = () => {
  if (statusTimer || document.visibilityState === "hidden") return;
  statusTimer = window.setInterval(() => {
    void refreshSystemStatus();
  }, 60_000);
};

const stopStatusPolling = () => {
  if (!statusTimer) return;
  window.clearInterval(statusTimer);
  statusTimer = null;
};

const startVersionPolling = () => {
  if (!auth.isAuthenticated || versionTimer) return;
  versionTimer = window.setInterval(() => {
    void refreshVersionStatus();
  }, 120_000);
};

const stopVersionPolling = () => {
  if (!versionTimer) return;
  window.clearInterval(versionTimer);
  versionTimer = null;
};

const handlePageVisibilityChange = () => {
  if (document.visibilityState === "hidden") {
    stopStatusPolling();
    stopVersionPolling();
    return;
  }
  void refreshSystemStatus();
  startStatusPolling();
  if (auth.isAuthenticated) {
    void refreshVersionStatus();
    startVersionPolling();
  }
};

onMounted(() => {
  const saved = localStorage.getItem("itemtraxx-theme");
  if (saved === "light" || saved === "dark") {
    applyTheme(saved);
  } else {
    applyTheme("light");
  }
  deferredStatusTimer = scheduleLowPriorityTask(() => {
    void refreshSystemStatus();
    startStatusPolling();
  }, 250);
  deferredVersionTimer = scheduleLowPriorityTask(() => {
    void refreshVersionStatus();
    startVersionPolling();
  }, 750);
  deferredTelemetryTimer = scheduleLowPriorityTask(() => {
    showTelemetry.value = true;
  }, 1800);
  for (const eventName of adminActivityEvents) {
    window.addEventListener(eventName, handleAdminActivity, { passive: true });
  }
  window.addEventListener("resize", measureTopBanners);
  document.addEventListener("visibilitychange", handlePageVisibilityChange);
  resetAdminIdleTimer();
  void nextTick(() => {
    measureTopBanners();
  });
});

watch(
  () => route.fullPath,
  () => {
    isRouteNavigating.value = true;
    if (routeProgressTimer) {
      window.clearTimeout(routeProgressTimer);
    }
    routeProgressTimer = window.setTimeout(() => {
      isRouteNavigating.value = false;
      routeProgressTimer = null;
    }, 280);
  }
);

watch(
  () => [route.path, auth.isAuthenticated, auth.role] as const,
  () => {
    resetAdminIdleTimer();
  }
);

watch(
  () => auth.isAuthenticated,
  () => {
    if (auth.isAuthenticated) {
      void refreshVersionStatus();
      startVersionPolling();
      return;
    }
    stopVersionPolling();
    isOutdated.value = false;
    latestVersion.value = null;
  }
);

watch(
  () => [showMaintenanceBanner.value, showBroadcast.value, activeBroadcast.value?.message] as const,
  () => {
    void nextTick(() => {
      measureTopBanners();
    });
  }
);

onUnmounted(() => {
  clearAdminIdleTimer();
  for (const eventName of adminActivityEvents) {
    window.removeEventListener(eventName, handleAdminActivity);
  }
  if (statusTimer) {
    stopStatusPolling();
  }
  stopVersionPolling();
  if (deferredStatusTimer) {
    window.clearTimeout(deferredStatusTimer);
    deferredStatusTimer = null;
  }
  if (deferredVersionTimer) {
    window.clearTimeout(deferredVersionTimer);
    deferredVersionTimer = null;
  }
  if (deferredTelemetryTimer) {
    window.clearTimeout(deferredTelemetryTimer);
    deferredTelemetryTimer = null;
  }
  if (routeProgressTimer) {
    window.clearTimeout(routeProgressTimer);
    routeProgressTimer = null;
  }
  document.removeEventListener("visibilitychange", handlePageVisibilityChange);
  window.removeEventListener("resize", measureTopBanners);
});
</script>
