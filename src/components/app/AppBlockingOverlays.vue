<template>
  <div
    v-if="killSwitchVisible"
    class="kill-switch-fullscreen"
    role="alertdialog"
    aria-live="assertive"
    aria-modal="true"
  >
    <a class="kill-switch-logo-link" href="/unavailable" aria-label="ItemTraxx unavailable">
      <img
        v-if="brandLogoUrl"
        class="kill-switch-logo"
        :src="brandLogoUrl"
        alt="ItemTraxx Co"
      />
    </a>
    <button
      class="kill-switch-theme-toggle"
      type="button"
      :aria-label="theme === 'dark' ? 'Switch to light mode' : 'Switch to dark mode'"
      @click="emit('toggleTheme')"
    >
      <span class="kill-switch-theme-icon" aria-hidden="true">{{ theme === "dark" ? "☀" : "☾" }}</span>
      <span>{{ theme === "dark" ? "Light" : "Dark" }}</span>
    </button>
    <div class="kill-switch-fullscreen-card">
      <p class="kill-switch-status">Service unavailable</p>
      <h2>ItemTraxx is currently unavailable. We're sorry for the inconvenience.</h2>
      <p>{{ killSwitchMessage }}</p>
      <div class="kill-switch-fullscreen-actions">
        <a
          class="kill-switch-action kill-switch-action-primary"
          href="https://status.itemtraxx.com/ref=killswitch"
          target="_blank"
          rel="noreferrer"
        >
          View status page
        </a>
        <a class="kill-switch-action" href="mailto:support@itemtraxx.com">
          Email support
        </a>
        <button type="button" class="kill-switch-action" @click="emit('reload')">Refresh</button>
      </div>
    </div>
  </div>
  <div v-else-if="maintenanceVisible" class="maintenance-fullscreen" role="alertdialog" aria-live="assertive">
    <div class="maintenance-fullscreen-card">
      <h2>Maintenance currently in Progress</h2>
      <p>
        ItemTraxx is currently unavailable while we apply updates and complete maintenance.
      </p>
      <p>
        Please try again shortly. Your data is safe and we will restore access as soon as
        maintenance is complete. Please check the ItemTraxx status page for updates. 
      </p>
      <div class="maintenance-fullscreen-actions">
        <a
          class="button-link"
          href="https://status.itemtraxx.com/?ref=maintscreen"
          target="_blank"
          rel="noreferrer"
        >
          View Live Status
        </a>
        <button type="button" class="button-primary" @click="emit('reload')">Refresh</button>
      </div>
    </div>
  </div>
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
defineProps<{
  killSwitchVisible: boolean;
  killSwitchMessage: string;
  brandLogoUrl: string;
  theme: "light" | "dark";
  maintenanceVisible: boolean;
  versionVisible: boolean;
  currentVersion: string;
  latestVersion: string | null;
  sessionVisible: boolean;
  sessionTitle: string;
  sessionMessage: string;
}>();

const emit = defineEmits<{
  reload: [];
  toggleTheme: [];
  signInAgain: [];
}>();
</script>
