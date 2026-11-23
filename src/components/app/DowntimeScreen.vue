<template>
  <main
    class="downtime-screen"
    :class="{ 'downtime-screen-dark': theme === 'dark' }"
    role="alertdialog"
    aria-live="assertive"
    aria-modal="true"
    aria-labelledby="downtime-screen-title"
  >
    <a
      v-if="brandLogoUrl"
      class="downtime-screen-logo-link"
      href="/unavailable"
      aria-label="ItemTraxx unavailable"
    >
      <img class="downtime-screen-logo" :src="brandLogoUrl" alt="ItemTraxx Co" />
    </a>
    <button
      class="downtime-screen-theme-toggle"
      type="button"
      :aria-label="theme === 'dark' ? 'Switch to light mode' : 'Switch to dark mode'"
      @click="emit('toggleTheme')"
    >
      <span aria-hidden="true">{{ theme === "dark" ? "☀" : "☾" }}</span>
      <span>{{ theme === "dark" ? "Light" : "Dark" }}</span>
    </button>

    <section class="downtime-screen-panel">
      <h1 id="downtime-screen-title">We’ll be back soon</h1>
      <p class="downtime-screen-message">
        <template v-for="(part, index) in splitStatusPageMessage(message)" :key="index">
          <a
            v-if="part.isLink"
            class="downtime-screen-status-link"
            :href="statusPageUrl"
            target="_blank"
            rel="noreferrer"
          >{{ part.text }}</a>
          <template v-else>{{ part.text }}</template>
        </template>
      </p>
      <div class="downtime-screen-actions">
        <a
          class="downtime-screen-action downtime-screen-action-primary"
          :href="statusPageUrl"
          target="_blank"
          rel="noreferrer"
        >
          View Live Status
        </a>
        <button
          class="downtime-screen-action downtime-screen-action-support"
          type="button"
          @click="openSupportChat"
        >
          Open Support Chat
        </button>
        <button
          class="downtime-screen-action"
          type="button"
          @click="emit('reload')"
        >
          Refresh
        </button>
      </div>
    </section>
  </main>
</template>

<script setup lang="ts">
import { requestSupportMessenger } from "../../services/supportMessengerEvent";
import { splitStatusPageMessage, STATUS_PAGE_URL } from "../../utils/statusPageMessage";

withDefaults(defineProps<{
  message: string;
  statusPageUrl?: string;
  brandLogoUrl?: string;
  theme: "light" | "dark";
}>(), {
  statusPageUrl: STATUS_PAGE_URL,
  brandLogoUrl: "",
});

const emit = defineEmits<{
  reload: [];
  toggleTheme: [];
}>();

const openSupportChat = () => {
  requestSupportMessenger({ allowAnonymousFallback: true });
};
</script>

<style scoped>
.downtime-screen {
  --downtime-bg: #f7f7f5;
  --downtime-text: #171717;
  --downtime-muted: #5f6368;
  --downtime-border: #d8d8d3;
  --downtime-action-bg: #ffffff;
  --downtime-action-hover: #f1f1ee;
  --downtime-primary-bg: #171717;
  --downtime-primary-text: #ffffff;

  align-items: center;
  background: var(--downtime-bg);
  box-sizing: border-box;
  color: var(--downtime-text);
  display: grid;
  inset: 0;
  justify-items: center;
  min-height: 100vh;
  overflow: auto;
  padding: 92px 24px 48px;
  position: fixed;
  width: 100%;
  z-index: 1250;
}

.downtime-screen-dark {
  --downtime-bg: #101010;
  --downtime-text: #f3f3f0;
  --downtime-muted: #a7a7a0;
  --downtime-border: #2f2f2c;
  --downtime-action-bg: #151515;
  --downtime-action-hover: #20201d;
  --downtime-primary-bg: #f3f3f0;
  --downtime-primary-text: #101010;
}

.downtime-screen-logo-link {
  display: inline-flex;
  left: max(24px, env(safe-area-inset-left, 0px));
  position: absolute;
  text-decoration: none;
  top: max(24px, env(safe-area-inset-top, 0px));
}

.downtime-screen-logo {
  display: block;
  height: 58px;
  object-fit: contain;
  width: auto;
}

.downtime-screen-theme-toggle {
  align-items: center;
  background: var(--downtime-action-bg);
  border: 1px solid var(--downtime-border);
  border-radius: 999px;
  color: var(--downtime-text);
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

.downtime-screen-theme-toggle:hover,
.downtime-screen-theme-toggle:focus-visible {
  background: var(--downtime-action-hover);
}

.downtime-screen-panel {
  margin-inline: auto;
  max-width: 640px;
  text-align: center;
  width: min(100%, 640px);
}

.downtime-screen-panel h1 {
  color: var(--downtime-text);
  font-size: clamp(2rem, 5vw, 3rem);
  line-height: 1.05;
  margin: 0;
}

.downtime-screen-message {
  color: var(--downtime-muted);
  font-size: 1rem;
  line-height: 1.65;
  margin: 20px 0 0;
}

.downtime-screen-status-link {
  color: inherit;
  text-decoration: underline;
  text-underline-offset: 3px;
}

.downtime-screen-actions {
  align-items: stretch;
  display: flex;
  flex-wrap: wrap;
  gap: 12px;
  justify-content: center;
  margin-top: 28px;
}

.downtime-screen-action {
  align-items: center;
  background: var(--downtime-action-bg);
  border: 1px solid var(--downtime-border);
  border-radius: 999px;
  box-sizing: border-box;
  color: var(--downtime-text);
  cursor: pointer;
  display: inline-flex;
  font: inherit;
  font-size: 0.95rem;
  font-weight: 700;
  justify-content: center;
  min-height: 48px;
  padding: 0 20px;
  text-decoration: none;
  white-space: normal;
}

.downtime-screen-action:hover,
.downtime-screen-action:focus-visible {
  background: var(--downtime-action-hover);
  text-decoration: none;
}

.downtime-screen-action-primary {
  background: var(--downtime-primary-bg);
  border-color: var(--downtime-primary-bg);
  color: var(--downtime-primary-text);
}

.downtime-screen-action-primary:hover,
.downtime-screen-action-primary:focus-visible {
  background: var(--downtime-primary-bg);
}

@media (max-width: 640px) {
  .downtime-screen {
    padding: 92px 20px 36px;
  }

  .downtime-screen-logo {
    height: 52px;
  }

  .downtime-screen-theme-toggle {
    min-height: 36px;
    padding: 0 12px;
    right: max(20px, env(safe-area-inset-right, 0px));
  }

  .downtime-screen-actions {
    flex-direction: column;
  }

  .downtime-screen-action {
    width: 100%;
  }
}
</style>
