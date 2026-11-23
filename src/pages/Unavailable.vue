<template>
  <DowntimeScreen
    :message="message"
    :status-page-url="STATUS_PAGE_URL"
    :brand-logo-url="brandLogoUrl"
    :theme="themeMode"
    @reload="refreshPage"
    @toggle-theme="toggleTheme"
  />
</template>

<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref } from "vue";
import DowntimeScreen from "../components/app/DowntimeScreen.vue";
import { fetchSystemStatus } from "../services/systemStatusService";
import { STATUS_PAGE_URL } from "../utils/statusPageMessage";

const DEFAULT_KILL_SWITCH_MESSAGE =
  "Unfortunately ItemTraxx is currently unavailable. We apologize for any inconvenience and are working to restore access as soon as possible. Please see the status page for more information";

const message = ref(DEFAULT_KILL_SWITCH_MESSAGE);
const lightBrandLogoUrl = import.meta.env.VITE_BRAND_LOGO_LIGHT_URL as string | undefined;
const darkBrandLogoUrl = import.meta.env.VITE_BRAND_LOGO_DARK_URL as string | undefined;
const themeMode = ref<"light" | "dark">(document.documentElement.getAttribute("data-theme") === "light" ? "light" : "dark");
const brandLogoUrl = computed(() =>
  themeMode.value === "light"
    ? lightBrandLogoUrl || darkBrandLogoUrl || ""
    : darkBrandLogoUrl || lightBrandLogoUrl || ""
);
let themeObserver: MutationObserver | null = null;

const refreshPage = () => {
  window.location.assign(`${window.location.origin}/`);
};

const applyTheme = (next: "light" | "dark") => {
  themeMode.value = next;
  document.documentElement.setAttribute("data-theme", next);
  localStorage.setItem("itemtraxx-theme", next);
};

const toggleTheme = () => {
  applyTheme(themeMode.value === "dark" ? "light" : "dark");
};

onMounted(async () => {
  const syncTheme = () => {
    themeMode.value = document.documentElement.getAttribute("data-theme") === "dark" ? "dark" : "light";
  };

  syncTheme();
  themeObserver = new MutationObserver(syncTheme);
  themeObserver.observe(document.documentElement, {
    attributes: true,
    attributeFilter: ["data-theme"],
  });

  const response = await fetchSystemStatus({ force: true, staleWhileRevalidate: false });
  const killSwitchMessage = response?.payload.kill_switch?.message;
  const maintenanceMessage = response?.payload.maintenance?.message;
  const messageFromStatus = response?.payload.status === "maintenance"
    ? maintenanceMessage || response?.payload.incident_summary
    : killSwitchMessage;
  if (typeof messageFromStatus === "string" && messageFromStatus.trim()) {
    message.value = messageFromStatus.trim();
  }
});

onUnmounted(() => {
  if (themeObserver) {
    themeObserver.disconnect();
    themeObserver = null;
  }
});
</script>
