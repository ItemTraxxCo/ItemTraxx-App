<template>
  <div class="app-shell" :class="{ 'with-top-banners': topBannerRowCount > 0 }" :style="appShellStyle">
    <div
      v-if="showMaintenanceBanner"
      class="maintenance-top-banner"
      role="alert"
      aria-live="assertive"
    >
      <strong>Maintenance Mode</strong>
      <span>{{ maintenanceMessage }}</span>
    </div>
    <div
      v-if="activeBroadcast && showBroadcast"
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
        <strong class="broadcast-title">System Notice</strong>
        <span class="broadcast-message">{{ incidentBanner.message }}</span>
      </div>
      <button type="button" class="broadcast-dismiss" @click="dismissIncidentBanner">
        Dismiss
      </button>
    </div>
    <div v-if="showTopMenu" class="top-menu" :style="topMenuStyle">
      <div class="menu-button-wrap">
        <div v-if="showNotificationBell" class="menu-notification">
          <NotificationBell />
        </div>
        <span v-if="isOutdated" class="menu-alert" aria-hidden="true">!</span>
        <button type="button" class="menu-button" @click="toggleMenu" aria-label="Open menu">
          <svg class="menu-icon" viewBox="0 0 24 24" aria-hidden="true">
            <path d="M5 7.5h14M5 12h14M5 16.5h14" />
          </svg>
        </button>
      </div>
      <div v-if="menuOpen" class="menu-dropdown">
        <button type="button" class="menu-item" @click="toggleTheme">
          {{ themeLabel }}
        </button>
        <button type="button" class="menu-item" @click="openAdminPanel">
          Open Admin Panel
        </button>
        <button type="button" class="menu-item danger" @click="logoutTenant">
          Log Out User
        </button>
        <a
          class="menu-item muted"
          href="https://github.com/ItemTraxxCo/ItemTraxx-App"
          target="_blank"
          rel="noreferrer"
        >
          Version: <strong>{{ appVersion }}</strong>
        </a>
        <div v-if="isOutdated" class="menu-item status-warning">
          Version outdated, refresh to update.
        </div>
        <a class="menu-item" href="mailto:suport@itemtraxx.com">
          Contact Support
        </a>
        <a
          class="menu-item muted menu-status"
          href="https://statuspage.incident.io/itemtraxx-status"
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
    <Analytics />
    <SpeedInsights />
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref } from "vue";
import { useRoute, useRouter } from "vue-router";
import { Analytics } from "@vercel/analytics/vue";
import { SpeedInsights } from "@vercel/speed-insights/vue";
import { signOut } from "./services/authService";
import { getEdgeFunctionsBaseUrl } from "./services/edgeFunctionClient";
import { getAuthState } from "./store/authState";
import NotificationBell from "./components/NotificationBell.vue";

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
};
const activeBroadcast = ref<BroadcastPayload | null>(null);
const dismissedBroadcastId = ref(localStorage.getItem("itemtraxx-broadcast-dismissed") || "");
const incidentBanner = ref<IncidentBanner | null>(null);
const dismissedIncidentId = ref(localStorage.getItem("itemtraxx-incident-dismissed") || "");
const maintenanceEnabled = ref(false);
const maintenanceMessage = ref("Maintenance in progress.");
const statusLabel = ref("Unknown");
const statusClass = ref<"status-ok" | "status-warn" | "status-down" | "status-unknown">(
  "status-unknown"
);
const isOutdated = ref(false);
const latestVersion = ref<string | null>(null);
const statusFunctionName = import.meta.env.VITE_STATUS_FUNCTION || "system-status";
let statusTimer: number | null = null;
let versionTimer: number | null = null;

const GITHUB_HEAD_COMMIT_API =
  "https://api.github.com/repos/ItemTraxxCo/ItemTraxx-App/commits/main";

const themeLabel = computed(() =>
  theme.value === "dark" ? "Light Mode" : "Dark Mode"
);
const showTopMenu = computed(() => route.name !== "public-home");
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
const showMaintenanceBanner = computed(() => maintenanceEnabled.value);
const topBannerRowCount = computed(() => {
  let rows = 0;
  if (showMaintenanceBanner.value) rows += 1;
  if (showBroadcast.value && activeBroadcast.value) rows += 1;
  return rows;
});
const topOffsetPx = computed(() => {
  if (topBannerRowCount.value === 0) return "0px";
  return `${topBannerRowCount.value * 56 + 18}px`;
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
  top: showMaintenanceBanner.value ? "56px" : "0",
}));

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
  const functionsBaseUrl = getEdgeFunctionsBaseUrl();
  if (!functionsBaseUrl) {
    statusLabel.value = "Unknown";
    statusClass.value = "status-unknown";
    return;
  }

  const controller = new AbortController();
  const timeoutId = window.setTimeout(() => controller.abort(), 3500);
  try {
    const response = await fetch(
      `${functionsBaseUrl}/${statusFunctionName}`,
      {
        method: "GET",
        signal: controller.signal,
      }
    );

    const payload = (await response.json().catch(() => ({}))) as {
      status?: string;
      broadcast?: {
        enabled?: boolean;
        message?: string;
        level?: string;
        updated_at?: string;
      };
      maintenance?: {
        enabled?: boolean;
        message?: string;
        updated_at?: string;
      };
      incident_summary?: string;
      checked_at?: string;
    };

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
    };
  } catch {
    statusLabel.value = "Unknown";
    statusClass.value = "status-unknown";
  } finally {
    window.clearTimeout(timeoutId);
  }
};

const refreshVersionStatus = async () => {
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

onMounted(() => {
  const saved = localStorage.getItem("itemtraxx-theme");
  if (saved === "light" || saved === "dark") {
    applyTheme(saved);
  } else {
    applyTheme("light");
  }
  void refreshSystemStatus();
  void refreshVersionStatus();
  statusTimer = window.setInterval(() => {
    void refreshSystemStatus();
  }, 60_000);
  versionTimer = window.setInterval(() => {
    void refreshVersionStatus();
  }, 120_000);
});

onUnmounted(() => {
  if (statusTimer) {
    window.clearInterval(statusTimer);
    statusTimer = null;
  }
  if (versionTimer) {
    window.clearInterval(versionTimer);
    versionTimer = null;
  }
});
</script>
