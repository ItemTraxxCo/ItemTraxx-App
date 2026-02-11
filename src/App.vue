<template>
  <div class="app-shell">
    <div class="top-menu">
      <div class="menu-button-wrap">
        <span v-if="isOutdated" class="menu-alert" aria-hidden="true">!</span>
        <button type="button" class="menu-button" @click="toggleMenu" aria-label="Open menu">
        <span class="menu-icon" aria-hidden="true">
          <span></span>
          <span></span>
          <span></span>
        </span>
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
        <div class="menu-item muted menu-status">
          <span class="status-dot" :class="statusClass" aria-hidden="true"></span>
          System Status: {{ statusLabel }}
        </div>
      </div>
    </div>
    <div v-if="!auth.isInitialized" class="page">
      <h1>bye bye 👋</h1>
      <p>Please press Cmd+shift+R (macOS), or Ctrl+Shift+R (Windows) to finish signing out.</p>
    </div>
    <router-view v-else />
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref } from "vue";
import { useRouter } from "vue-router";
import { signOut } from "./services/authService";
import { getAuthState } from "./store/authState";

const auth = getAuthState();
const router = useRouter();
const menuOpen = ref(false);
const theme = ref<"light" | "dark">("light");
const appVersion = import.meta.env.VITE_GIT_COMMIT || "n/a";
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
  menuOpen.value = false;
  await signOut();
  await router.push("/");
};

const refreshSystemStatus = async () => {
  const supabaseUrl = import.meta.env.VITE_SUPABASE_URL as string | undefined;
  if (!supabaseUrl) {
    statusLabel.value = "Unknown";
    statusClass.value = "status-unknown";
    return;
  }

  const controller = new AbortController();
  const timeoutId = window.setTimeout(() => controller.abort(), 3500);
  try {
    const response = await fetch(
      `${supabaseUrl}/functions/v1/${statusFunctionName}`,
      {
        method: "GET",
        signal: controller.signal,
      }
    );

    const payload = (await response.json().catch(() => ({}))) as {
      status?: string;
    };

    if (response.ok && payload.status === "operational") {
      statusLabel.value = "Operational";
      statusClass.value = "status-ok";
      return;
    }

    if (response.status >= 500 || payload.status === "down") {
      statusLabel.value = "Down";
      statusClass.value = "status-down";
      return;
    }

    statusLabel.value = "Degraded";
    statusClass.value = "status-warn";
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
