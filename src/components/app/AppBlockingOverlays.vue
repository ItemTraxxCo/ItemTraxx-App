<template>
  <DowntimeScreen
    v-if="killSwitchVisible"
    :message="killSwitchMessage"
    :status-page-url="statusPageUrl"
    :brand-logo-url="brandLogoUrl"
    :theme="theme"
    @reload="emit('reload')"
    @toggle-theme="emit('toggleTheme')"
  />
  <DowntimeScreen
    v-else-if="maintenanceVisible"
    :message="maintenanceMessage"
    :status-page-url="statusPageUrl"
    :brand-logo-url="brandLogoUrl"
    :theme="theme"
    @reload="emit('reload')"
    @toggle-theme="emit('toggleTheme')"
  />
  <div
    v-if="versionVisible"
    class="version-update-fullscreen"
    role="alertdialog"
    aria-live="assertive"
    aria-modal="true"
  >
    <div class="version-update-card">
      <p class="version-update-eyebrow">Update Available</p>
      <h2>A new version of ItemTraxx is available.</h2>
      <p>
        A newer release is available. Please click the update button to load the latest version.
      </p>
      <div class="version-update-meta">
        <span>Current: {{ currentVersion }}</span>
        <span v-if="latestVersion">Latest: {{ latestVersion }}</span>
      </div>
      <button type="button" class="button-primary version-update-button" @click="emit('reload')">
        Update
      </button>
    </div>
  </div>
  <div
    v-if="sessionVisible"
    class="version-update-fullscreen"
    role="alertdialog"
    aria-live="assertive"
    aria-modal="true"
  >
    <div class="version-update-card">
      <p class="version-update-eyebrow">Session Ended</p>
      <h2>{{ sessionTitle }}</h2>
      <p>{{ sessionMessage }}</p>
      <button type="button" class="button-primary version-update-button" @click="emit('signInAgain')">
        Sign in again
      </button>
    </div>
  </div>
</template>

<script setup lang="ts">
import DowntimeScreen from "./DowntimeScreen.vue";
import { STATUS_PAGE_URL } from "../../utils/statusPageMessage";

withDefaults(defineProps<{
  killSwitchVisible: boolean;
  killSwitchMessage: string;
  statusPageUrl?: string;
  brandLogoUrl: string;
  theme: "light" | "dark";
  maintenanceVisible: boolean;
  maintenanceMessage: string;
  versionVisible: boolean;
  currentVersion: string;
  latestVersion: string | null;
  sessionVisible: boolean;
  sessionTitle: string;
  sessionMessage: string;
}>(), {
  statusPageUrl: STATUS_PAGE_URL,
});

const emit = defineEmits<{
  reload: [];
  toggleTheme: [];
  signInAgain: [];
}>();
</script>
