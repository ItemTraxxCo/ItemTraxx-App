<template>
  <div class="itemscanner-page">
    <main class="itemscanner-container">
      <div class="page-nav-left itemscanner-top-nav">
        <RouterLink class="itemscanner-back-link" to="/" aria-label="Return to home">
          <svg viewBox="0 0 24 24" aria-hidden="true">
            <path d="M15 5 8 12l7 7" />
          </svg>
        </RouterLink>
        <span class="itemscanner-breadcrumb">Item Scanner Lab</span>
      </div>

      <section class="itemscanner-grid">
        <article class="itemscanner-card itemscanner-controls-card">
          <p class="itemscanner-section-label">Test harness</p>
          <h1>Camera barcode scanner preview.</h1>
          <p class="itemscanner-lead">
            This page is isolated from auth and database flows. Use it to tune the popup UX,
            detection status, and scan logging before wiring production behavior further.
          </p>

          <label class="itemscanner-field">
            Context
            <select v-model="selectedMode">
              <option v-for="option in modeOptions" :key="option.value" :value="option.value">
                {{ option.label }}
              </option>
            </select>
          </label>

          <div class="itemscanner-actions">
            <button type="button" class="button-primary" @click="scannerOpen = true">
              Open camera scanner
            </button>
          </div>

          <div class="itemscanner-notes">
            <div>
              <strong>Current mode</strong>
              <span>{{ currentMode.label }}</span>
            </div>
            <div>
              <strong>Popup behavior</strong>
              <span>Test route keeps the popup open after scans.</span>
            </div>
            <div>
              <strong>Manual scan</strong>
              <span>Manual scan confirms the currently detected barcode candidate.</span>
            </div>
          </div>
        </article>

        <article class="itemscanner-card itemscanner-terminal-card">
          <div class="itemscanner-terminal-header">
            <p class="itemscanner-section-label">Scanner terminal</p>
            <span class="itemscanner-terminal-label">live events</span>
          </div>
          <div class="itemscanner-terminal-window">
            <p v-if="logs.length === 0" class="itemscanner-terminal-empty">
              Waiting for scanner events...
            </p>
            <div v-for="entry in orderedLogs" :key="entry.id" class="itemscanner-terminal-line">
              <span class="itemscanner-terminal-time">{{ entry.time }}</span>
              <span class="itemscanner-terminal-level" :class="`itemscanner-terminal-${entry.kind}`">
                {{ entry.kind.toUpperCase() }}
              </span>
              <span>{{ entry.message }}</span>
            </div>
          </div>
        </article>
      </section>

      <CameraBarcodeScannerModal
        v-model="scannerOpen"
        :mode="selectedMode"
        :title="currentMode.title"
        :auto-close-on-scan="false"
        :lab-preview="true"
        @scanned="handleScanned"
        @status="handleStatus"
      />
    </main>
  </div>
</template>

<script setup lang="ts">
import { computed, ref } from "vue";
import { RouterLink } from "vue-router";
import CameraBarcodeScannerModal from "../components/CameraBarcodeScannerModal.vue";
import type { ScannerMode, ScannerScanEvent, ScannerStatusEvent } from "../types/cameraScanner";

type TerminalEntry = {
  id: string;
  time: string;
  kind: "success" | "warning" | "error";
  message: string;
};

const scannerOpen = ref(false);
const selectedMode = ref<ScannerMode>("borrower");
const logs = ref<TerminalEntry[]>([]);
const lastDetectionLogKey = ref("");

const modeOptions: Array<{ value: ScannerMode; label: string; title: string }> = [
  { value: "borrower", label: "Borrower scan", title: "Scan borrower barcode" },
  { value: "checkout_item", label: "Checkout item scan", title: "Scan checkout item barcode" },
  { value: "admin_quick_return", label: "Admin quick return", title: "Scan quick return barcode" },
  { value: "admin_item_create", label: "Admin item create", title: "Scan item barcode for creation" },
  { value: "admin_item_edit", label: "Admin item edit", title: "Scan item barcode for edit" },
];

const currentMode = computed(() =>
  modeOptions.find((option) => option.value === selectedMode.value) ?? modeOptions[0]
);

const orderedLogs = computed(() => logs.value);

const pushLog = (kind: TerminalEntry["kind"], message: string, timestamp: string) => {
  const time = new Date(timestamp).toLocaleTimeString([], {
    hour: "numeric",
    minute: "2-digit",
    second: "2-digit",
  });
  logs.value.unshift({
    id: `${timestamp}-${kind}-${logs.value.length}`,
    time,
    kind,
    message,
  });
  if (logs.value.length > 80) {
    logs.value = logs.value.slice(0, 80);
  }
};

const handleScanned = (event: ScannerScanEvent) => {
  pushLog("success", `successful barcode scan "${event.value}"`, event.timestamp);
};

const handleStatus = (event: ScannerStatusEvent) => {
  if (event.status === "success") {
    if (!event.value) return;
    const key = `${event.status}:${event.value}`;
    if (lastDetectionLogKey.value === key) return;
    lastDetectionLogKey.value = key;
    pushLog("success", `barcode detected and ready: "${event.value}"`, event.timestamp);
    return;
  }
  lastDetectionLogKey.value = "";
  const kind = event.status === "unscannable" ? "error" : "warning";
  pushLog(kind, event.message, event.timestamp);
};
</script>

<style scoped>
.itemscanner-page {
  position: relative;
  min-height: 100vh;
  min-height: 100dvh;
  background: var(--page-bg);
  color: var(--text);
  overflow-x: clip;
}

.itemscanner-container {
  position: relative;
  z-index: 1;
  width: min(1240px, calc(100vw - 2rem));
  margin: 0 auto;
  padding: calc(1.4rem + env(safe-area-inset-top, 0px)) 0 3.5rem;
}

.itemscanner-top-nav {
  margin-bottom: 1.5rem;
}

.itemscanner-back-link {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 2.75rem;
  height: 2.75rem;
  border-radius: 999px;
  border: 1px solid var(--border);
  background: var(--surface);
  color: inherit;
}

.itemscanner-back-link svg {
  width: 1.25rem;
  height: 1.25rem;
  fill: none;
  stroke: currentColor;
  stroke-width: 1.8;
  stroke-linecap: round;
  stroke-linejoin: round;
}

.itemscanner-breadcrumb {
  margin-left: 0.8rem;
  font-size: 0.9rem;
  color: var(--muted);
}

.itemscanner-grid {
  display: grid;
  grid-template-columns: minmax(0, 0.95fr) minmax(0, 1.05fr);
  gap: 1.25rem;
}

.itemscanner-card {
  border-radius: 28px;
  border: 1px solid var(--border);
  background: var(--surface);
  padding: 1.6rem;
}

.itemscanner-section-label {
  margin: 0 0 0.75rem;
  font-size: 0.78rem;
  font-weight: 700;
  letter-spacing: 0.16em;
  text-transform: uppercase;
  color: var(--muted);
}

.itemscanner-controls-card h1 {
  margin: 0;
  font-size: clamp(2rem, 4vw, 3.2rem);
  line-height: 0.98;
  letter-spacing: -0.04em;
}

.itemscanner-lead {
  margin: 1rem 0 0;
  color: var(--muted);
  line-height: 1.72;
}

.itemscanner-field {
  display: grid;
  gap: 0.4rem;
  margin-top: 1.35rem;
}

.itemscanner-actions {
  margin-top: 1rem;
}

.itemscanner-notes {
  display: grid;
  gap: 0.85rem;
  margin-top: 1.2rem;
}

.itemscanner-notes div {
  display: grid;
  gap: 0.2rem;
}

.itemscanner-notes span {
  color: var(--muted);
}

.itemscanner-terminal-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 1rem;
}

.itemscanner-terminal-label {
  color: var(--muted);
  font-size: 0.82rem;
  text-transform: uppercase;
  letter-spacing: 0.14em;
}

.itemscanner-terminal-window {
  min-height: 580px;
  margin-top: 1rem;
  border-radius: 22px;
  border: 1px solid var(--border);
  background: var(--surface-2);
  padding: 1rem;
  font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
  font-size: 0.92rem;
  line-height: 1.6;
  overflow: auto;
}

.itemscanner-terminal-empty {
  margin: 0;
  color: var(--muted);
}

.itemscanner-terminal-line {
  display: grid;
  grid-template-columns: auto auto 1fr;
  gap: 0.75rem;
  padding: 0.25rem 0;
}

.itemscanner-terminal-time {
  color: var(--muted);
}

.itemscanner-terminal-level {
  font-weight: 700;
}

.itemscanner-terminal-success {
  color: var(--success);
}

.itemscanner-terminal-warning {
  color: var(--warning);
}

.itemscanner-terminal-error {
  color: var(--danger);
}

@media (max-width: 980px) {
  .itemscanner-grid {
    grid-template-columns: 1fr;
  }

  .itemscanner-terminal-window {
    min-height: 360px;
  }
}

@media (max-width: 640px) {
  .itemscanner-container {
    width: min(100vw - 1.2rem, 1240px);
    padding-top: calc(1.2rem + env(safe-area-inset-top, 0px));
    padding-bottom: 3rem;
  }

  .itemscanner-card {
    padding: 1.2rem;
    border-radius: 22px;
  }
}
</style>
