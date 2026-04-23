<template>
  <main class="unavailable-page" aria-labelledby="unavailable-title">
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
import { onMounted, ref } from "vue";
import { fetchSystemStatus } from "../services/systemStatusService";

const DEFAULT_KILL_SWITCH_MESSAGE =
  "Unfortunately ItemTraxx is currently unavailable. We apologize for any inconvenience and are working to restore access as soon as possible. Please see the status page (https://status.itemtraxx.com/) for more information.";

const message = ref(DEFAULT_KILL_SWITCH_MESSAGE);

const refreshPage = () => {
  window.location.reload();
};

onMounted(async () => {
  const response = await fetchSystemStatus({ force: true, staleWhileRevalidate: false });
  const killSwitchMessage = response?.payload.kill_switch?.message;
  if (typeof killSwitchMessage === "string" && killSwitchMessage.trim()) {
    message.value = killSwitchMessage.trim();
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
  color: var(--unavailable-text);
  display: flex;
  justify-content: center;
  min-height: 100vh;
  padding: 32px 18px;
}

:global(html[data-theme="dark"]) .unavailable-page {
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
  background: var(--unavailable-panel-bg);
  border: 1px solid var(--unavailable-border);
  border-radius: 14px;
  max-width: 640px;
  padding: 36px;
  width: min(100%, 640px);
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
  .unavailable-panel {
    padding: 26px 20px;
  }

  .unavailable-action {
    width: 100%;
  }
}
</style>
