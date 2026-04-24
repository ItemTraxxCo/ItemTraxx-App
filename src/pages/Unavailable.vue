<template>
  <main
    class="unavailable-page"
    :class="{ 'unavailable-page-dark': themeMode === 'dark' }"
    aria-labelledby="unavailable-title"
  >
    <a class="unavailable-logo-link" href="/" aria-label="ItemTraxx home">
      <img v-if="brandLogoUrl" class="unavailable-logo" :src="brandLogoUrl" alt="ItemTraxx Co" />
    </a>
    <button
      class="unavailable-theme-toggle"
      type="button"
      :aria-label="themeMode === 'dark' ? 'Switch to light mode' : 'Switch to dark mode'"
      @click="toggleTheme"
    >
      <span class="unavailable-theme-icon" aria-hidden="true">{{ themeMode === "dark" ? "☀" : "☾" }}</span>
      <span>{{ themeMode === "dark" ? "Light" : "Dark" }}</span>
    </button>
    <section class="unavailable-panel">
      <p class="unavailable-status">Service unavailable</p>
      <h1 id="unavailable-title">ItemTraxx is currently unavailable</h1>
      <p class="unavailable-message">{{ message }}</p>
      <div class="unavailable-actions" aria-label="Unavailable page actions">
        <a
          class="unavailable-action unavailable-action-primary"
          href="https://status.itemtraxx.com/"
          target="_blank"
          rel="noreferrer"
        >
          View status page
        </a>
        <a class="unavailable-action" href="mailto:support@itemtraxx.com">Email support</a>
        <button class="unavailable-action" type="button" @click="refreshPage">Refresh</button>
      </div>
    </section>
  </main>
</template>

<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref } from "vue";
import { fetchSystemStatus } from "../services/systemStatusService";

const DEFAULT_KILL_SWITCH_MESSAGE =
  "Unfortunately ItemTraxx is currently unavailable. We apologize for any inconvenience and are working to restore access as soon as possible. Please see the status page (https://status.itemtraxx.com/) for more information.";

const message = ref(DEFAULT_KILL_SWITCH_MESSAGE);
const lightBrandLogoUrl = import.meta.env.VITE_BRAND_LOGO_LIGHT_URL as string | undefined;
const darkBrandLogoUrl = import.meta.env.VITE_BRAND_LOGO_DARK_URL as string | undefined;
const themeMode = ref<"light" | "dark">("light");
const brandLogoUrl = computed(() =>
  themeMode.value === "light"
    ? lightBrandLogoUrl || darkBrandLogoUrl || ""
    : darkBrandLogoUrl || lightBrandLogoUrl || ""
);
let themeObserver: MutationObserver | null = null;

const refreshPage = () => {
  window.location.reload();
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
  if (typeof killSwitchMessage === "string" && killSwitchMessage.trim()) {
    message.value = killSwitchMessage.trim();
  }
});

onUnmounted(() => {
  if (themeObserver) {
    themeObserver.disconnect();
    themeObserver = null;
  }
});
</script>

<style scoped>
.unavailable-page {
  --unavailable-bg: #f7f7f5;
  --unavailable-panel-bg: #ffffff;
  --unavailable-text: #171717;
  --unavailable-muted: #5f6368;
  --unavailable-border: #d8d8d3;
  --unavailable-action-bg: #ffffff;
  --unavailable-action-hover: #f1f1ee;
  --unavailable-primary-bg: #171717;
  --unavailable-primary-text: #ffffff;

  align-items: center;
  background: var(--unavailable-bg);
  box-sizing: border-box;
  color: var(--unavailable-text);
  display: flex;
  justify-content: center;
  min-height: 100vh;
  padding: 48px 24px;
  position: relative;
  width: 100vw;
}

.unavailable-page-dark {
  --unavailable-bg: #101010;
  --unavailable-panel-bg: #151515;
  --unavailable-text: #f3f3f0;
  --unavailable-muted: #a7a7a0;
  --unavailable-border: #2f2f2c;
  --unavailable-action-bg: #151515;
  --unavailable-action-hover: #20201d;
  --unavailable-primary-bg: #f3f3f0;
  --unavailable-primary-text: #101010;
}

.unavailable-panel {
  margin-inline: auto;
  max-width: 640px;
  text-align: center;
  width: min(100%, 640px);
}

.unavailable-logo-link {
  display: inline-flex;
  left: max(24px, env(safe-area-inset-left, 0px));
  position: absolute;
  text-decoration: none;
  top: max(24px, env(safe-area-inset-top, 0px));
}

.unavailable-logo {
  display: block;
  height: 72px;
  object-fit: contain;
  width: auto;
}

.unavailable-theme-toggle {
  align-items: center;
  background: var(--unavailable-action-bg);
  border: 1px solid var(--unavailable-border);
  border-radius: 999px;
  color: var(--unavailable-text);
  cursor: pointer;
  display: inline-flex;
  font: inherit;
  font-size: 0.84rem;
  font-weight: 700;
  gap: 7px;
  min-height: 38px;
  padding: 0 14px;
  position: absolute;
  right: max(24px, env(safe-area-inset-right, 0px));
  top: max(24px, env(safe-area-inset-top, 0px));
}

.unavailable-theme-toggle:hover,
.unavailable-theme-toggle:focus-visible {
  background: var(--unavailable-action-hover);
}

.unavailable-theme-icon {
  font-size: 0.95rem;
  line-height: 1;
}

.unavailable-status {
  color: var(--unavailable-muted);
  font-size: 0.78rem;
  font-weight: 700;
  letter-spacing: 0.08em;
  margin: 0 0 14px;
  text-transform: uppercase;
}

.unavailable-panel h1 {
  color: var(--unavailable-text);
  font-size: clamp(2rem, 5vw, 3rem);
  line-height: 1.05;
  margin: 0;
}

.unavailable-message {
  color: var(--unavailable-muted);
  font-size: 1rem;
  line-height: 1.65;
  margin: 20px 0 0;
}

.unavailable-actions {
  display: flex;
  flex-wrap: wrap;
  gap: 12px;
  justify-content: center;
  margin-top: 28px;
}

.unavailable-action {
  align-items: center;
  background: var(--unavailable-action-bg);
  border: 1px solid var(--unavailable-border);
  border-radius: 999px;
  color: var(--unavailable-text);
  cursor: pointer;
  display: inline-flex;
  font: inherit;
  font-size: 0.95rem;
  font-weight: 700;
  justify-content: center;
  min-height: 44px;
  padding: 0 18px;
  text-decoration: none;
}

.unavailable-action:hover,
.unavailable-action:focus-visible {
  background: var(--unavailable-action-hover);
}

.unavailable-action-primary {
  background: var(--unavailable-primary-bg);
  border-color: var(--unavailable-primary-bg);
  color: var(--unavailable-primary-text);
}

.unavailable-action-primary:hover,
.unavailable-action-primary:focus-visible {
  background: var(--unavailable-primary-bg);
}

@media (max-width: 520px) {
  .unavailable-page {
    padding: 92px 20px 36px;
  }

  .unavailable-logo {
    height: 58px;
  }

  .unavailable-theme-toggle {
    min-height: 36px;
    padding: 0 12px;
    right: max(20px, env(safe-area-inset-right, 0px));
  }

  .unavailable-action {
    width: 100%;
  }
}
</style>
