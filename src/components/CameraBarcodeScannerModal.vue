<template>
  <Teleport to="body">
    <div
      v-if="modelValue"
      class="scanner-modal-backdrop"
      :class="{
        'scanner-modal-backdrop-lab': labPreview,
        'scanner-theme-light': themeMode === 'light',
        'scanner-theme-dark': themeMode === 'dark',
      }"
      @click.self="handleClose"
    >
      <div class="scanner-modal-card" role="dialog" aria-modal="true" :aria-label="title">
        <div class="scanner-modal-header">
          <div>
            <p class="scanner-modal-eyebrow">Camera barcode scanner</p>
            <h2>{{ title }}</h2>
          </div>
          <button type="button" class="scanner-icon-button" @click="handleClose">×</button>
        </div>

        <div class="scanner-preview-shell">
          <div class="scanner-preview-frame">
            <div class="scanner-preview-visuals">
              <video ref="videoRef" class="scanner-video" playsinline muted autoplay></video>
              <div class="scanner-crosshair" aria-hidden="true"></div>
              <svg v-if="previewBox" class="scanner-detection-layer" aria-hidden="true" viewBox="0 0 100 100" preserveAspectRatio="none">
                <rect
                  class="scanner-detection-box"
                  :class="`scanner-detection-${currentStatus}`"
                  :x="previewBox.x"
                  :y="previewBox.y"
                  :width="previewBox.width"
                  :height="previewBox.height"
                  rx="14"
                  ry="14"
                />
              </svg>
            </div>
            <div v-if="isStarting" class="scanner-overlay-message">Starting camera...</div>
            <div v-else-if="errorMessage" class="scanner-overlay-message scanner-overlay-error">
              {{ errorMessage }}
            </div>
            <div
              v-if="props.mode === 'borrower' && currentDetection"
              class="scanner-inline-detection"
            >
              <strong>Scanned borrower ID</strong>
              <span>{{ currentDetection.value }}</span>
            </div>
          </div>

          <div class="scanner-controls">
            <button type="button" class="button-primary scanner-close-button" @click="handleClose">Close camera</button>
            <button
              type="button"
              class="button-secondary"
              :disabled="!capabilities.flashlightSupported"
              @click="toggleTorch"
            >
              {{ torchEnabled ? "Turn off flashlight" : "Turn on flashlight" }}
            </button>
            <button
              type="button"
              class="button-secondary"
              :disabled="!capabilities.canFlipCamera"
              @click="flipCamera"
            >
              Flip camera
            </button>
            <button
              v-if="!props.autoAcceptOnScan"
              type="button"
              class="button-primary"
              :disabled="!hasActiveCandidate"
              @click="manualConfirm"
            >
              Scan
            </button>
          </div>
        </div>

        <div class="scanner-status-row">
          <div class="scanner-status-block">
            <div class="scanner-status-pill" :class="`scanner-status-${currentStatus}`">
              <span class="scanner-status-dot" aria-hidden="true"></span>
              <span>{{ statusLabel }}</span>
            </div>
            <p class="scanner-status-copy">{{ statusMessageText }}</p>
          </div>
          <span class="scanner-helper-text">
            Make sure the barcode is clearly visible, there are no glares, and well lit.
          </span>
        </div>

        <div v-if="props.mode !== 'borrower' && currentDetection" class="scanner-detected-card">
          <strong>Current barcode</strong>
          <span>{{ currentDetection.value }}</span>
        </div>

        <div v-if="scanHistoryItems.length" class="scanner-history-card">
          <p class="checkout-subheading">Items</p>
          <ul class="checkout-inline-list">
            <li v-for="item in scanHistoryItems" :key="item.id" class="checkout-item-row">
              {{ item.label }}
              <span class="muted">({{ item.value }})</span>
              <span v-if="item.tagLabel" class="tag" :class="item.tagClass">
                {{ item.tagLabel }}
              </span>
              <button
                v-if="item.removable"
                type="button"
                class="chip-button"
                @click="emit('removeHistoryItem', item.id)"
              >
                Remove
              </button>
            </li>
          </ul>
        </div>
      </div>
    </div>
  </Teleport>
</template>

<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref, watch } from "vue";
import { useCameraBarcodeScanner } from "../composables/useCameraBarcodeScanner";
import type { ScannerHistoryItem, ScannerMode, ScannerScanEvent, ScannerStatus, ScannerStatusEvent } from "../types/cameraScanner";

const props = withDefaults(defineProps<{
  modelValue: boolean;
  mode: ScannerMode;
  title: string;
  autoCloseOnScan?: boolean;
  autoAcceptOnScan?: boolean;
  labPreview?: boolean;
  scanHistoryItems?: ScannerHistoryItem[];
}>(), {
  autoCloseOnScan: true,
  autoAcceptOnScan: true,
  labPreview: false,
  scanHistoryItems: () => [],
});

const emit = defineEmits<{
  "update:modelValue": [value: boolean];
  scanned: [event: ScannerScanEvent];
  status: [event: ScannerStatusEvent];
  removeHistoryItem: [id: string];
}>();

const {
  open,
  close,
  videoRef,
  isStarting,
  errorMessage,
  previewBox,
  currentDetection,
  status,
  statusMessageText,
  torchEnabled,
  capabilities,
  hasActiveCandidate,
  toggleTorch,
  flipCamera,
  manualConfirm,
} = useCameraBarcodeScanner({
  mode: () => props.mode,
  autoAccept: () => props.autoAcceptOnScan,
  onScanned: (event) => {
    emit("scanned", event);
    if (props.autoCloseOnScan) {
      clearCloseTimer();
      closeTimer = window.setTimeout(() => {
        closeTimer = null;
        emit("update:modelValue", false);
      }, AUTO_CLOSE_DELAY_MS);
    }
  },
  onStatus: (event) => {
    emit("status", event);
  },
});
void videoRef;

const AUTO_CLOSE_DELAY_MS = 520;
let closeTimer: number | null = null;

const clearCloseTimer = () => {
  if (closeTimer !== null) {
    window.clearTimeout(closeTimer);
    closeTimer = null;
  }
};

const handleClose = () => {
  clearCloseTimer();
  emit("update:modelValue", false);
};

const scanHistoryItems = computed(() => {
  if (props.mode === "borrower") return [];
  return props.scanHistoryItems ?? [];
});

const themeMode = ref<"light" | "dark">("dark");
let themeObserver: MutationObserver | null = null;

const syncTheme = () => {
  if (typeof document === "undefined") return;
  themeMode.value = document.documentElement.getAttribute("data-theme") === "light" ? "light" : "dark";
};

watch(
  () => props.modelValue,
  (next) => {
    if (next) {
      clearCloseTimer();
      void open();
    } else {
      clearCloseTimer();
      close();
    }
  },
  { immediate: true }
);

const currentStatus = computed<ScannerStatus>(() => currentDetection.value?.status ?? status.value);

const statusLabel = computed(() => {
  switch (currentStatus.value) {
    case "success":
      return "Successful scan";
    case "low_light":
      return "Too little light";
    case "glare":
      return "Glare detected";
    case "blurry":
      return "Blurry barcode";
    default:
      return "Barcode not readable";
  }
});

onMounted(() => {
  syncTheme();
  if (typeof document !== "undefined") {
    themeObserver = new MutationObserver(syncTheme);
    themeObserver.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ["data-theme"],
    });
  }
});

onUnmounted(() => {
  clearCloseTimer();
  themeObserver?.disconnect();
  themeObserver = null;
});

</script>

<style scoped>
.scanner-modal-backdrop {
  --scanner-backdrop: rgba(10, 10, 10, 0.72);
  --scanner-card-bg: #151515;
  --scanner-card-text: #f3f3f0;
  --scanner-card-border: #2f2f2c;
  --scanner-muted: #a7a7a0;
  --scanner-panel-bg: #20201d;
  --scanner-panel-border: #2f2f2c;
  --scanner-icon-bg: #20201d;
  --scanner-icon-border: #3a3a35;
  --scanner-eyebrow: #a7a7a0;
  --scanner-frame-bg: #0b0b0b;
  --scanner-frame-border: #2f2f2c;
  --scanner-status-bg: #20201d;
  --scanner-status-border: #2f2f2c;
  --scanner-overlay-bg: rgba(16, 16, 16, 0.88);
  --scanner-overlay-error-bg: rgba(127, 29, 29, 0.92);
  position: fixed;
  inset: 0;
  z-index: 2200;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 1rem;
  background: var(--scanner-backdrop);
}

.scanner-modal-backdrop.scanner-theme-light {
  --scanner-backdrop: rgba(247, 247, 245, 0.78);
  --scanner-card-bg: #ffffff;
  --scanner-card-text: #171717;
  --scanner-card-border: #d8d8d3;
  --scanner-muted: #5f6368;
  --scanner-panel-bg: #f1f1ee;
  --scanner-panel-border: #d8d8d3;
  --scanner-icon-bg: #f1f1ee;
  --scanner-icon-border: #d8d8d3;
  --scanner-eyebrow: #6f736f;
  --scanner-frame-bg: #101010;
  --scanner-frame-border: #d8d8d3;
  --scanner-status-bg: #f7f7f5;
  --scanner-status-border: #d8d8d3;
  --scanner-overlay-bg: rgba(255, 255, 255, 0.9);
  --scanner-overlay-error-bg: rgba(127, 29, 29, 0.9);
}

@media (min-width: 1100px) {
  .scanner-modal-backdrop-lab {
    background: var(--scanner-backdrop);
  }
}

.scanner-modal-card {
  width: min(820px, calc(100vw - 2rem));
  border-radius: 24px;
  border: 1px solid var(--scanner-card-border);
  background: var(--scanner-card-bg);
  color: var(--scanner-card-text);
  padding: 1.25rem;
}

.scanner-modal-header {
  display: flex;
  justify-content: space-between;
  gap: 1rem;
  align-items: flex-start;
}

.scanner-modal-eyebrow {
  margin: 0 0 0.35rem;
  text-transform: uppercase;
  letter-spacing: 0.16em;
  font-size: 0.72rem;
  font-weight: 700;
  color: var(--scanner-eyebrow);
}

.scanner-modal-header h2 {
  margin: 0;
  font-size: clamp(1.35rem, 2.5vw, 1.9rem);
}

.scanner-icon-button {
  width: 2.4rem;
  height: 2.4rem;
  border-radius: 999px;
  border: 1px solid var(--scanner-icon-border);
  background: var(--scanner-icon-bg);
  color: inherit;
  font-size: 1.35rem;
}

.scanner-preview-shell {
  display: grid;
  gap: 1rem;
  margin-top: 1rem;
}

.scanner-preview-frame {
  position: relative;
  overflow: hidden;
  border-radius: 22px;
  border: 1px solid var(--scanner-frame-border);
  background: var(--scanner-frame-bg);
  min-height: min(52vh, 420px);
}

.scanner-preview-visuals {
  position: absolute;
  inset: 0;
  transform: scaleX(-1);
}

.scanner-video {
  width: 100%;
  height: min(52vh, 420px);
  display: block;
  object-fit: cover;
}

.scanner-crosshair {
  position: absolute;
  inset: 50% auto auto 50%;
  width: 42px;
  height: 42px;
  transform: translate(-50%, -50%);
  pointer-events: none;
}

.scanner-crosshair::before,
.scanner-crosshair::after {
  content: "";
  position: absolute;
  background: rgba(230, 239, 248, 0.28);
  border-radius: 999px;
}

.scanner-crosshair::before {
  width: 2px;
  height: 42px;
  left: 20px;
  top: 0;
}

.scanner-crosshair::after {
  width: 42px;
  height: 2px;
  left: 0;
  top: 20px;
}

.scanner-detection-layer {
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
  pointer-events: none;
}

.scanner-detection-box {
  border: 3px solid #34a853;
  border-radius: 14px;
  background: rgba(255, 255, 255, 0.02);
  box-shadow: 0 0 0 9999px rgba(6, 10, 16, 0.18);
  transition:
    left 120ms ease,
    top 120ms ease,
    width 120ms ease,
    height 120ms ease,
    border-color 120ms ease,
    box-shadow 120ms ease;
}

.scanner-detection-success {
  border-color: #34a853;
  box-shadow: 0 0 0 9999px rgba(6, 10, 16, 0.18);
}

.scanner-detection-low_light,
.scanner-detection-glare,
.scanner-detection-blurry {
  border-color: #b7791f;
  box-shadow: 0 0 0 9999px rgba(6, 10, 16, 0.18);
}

.scanner-detection-unscannable {
  border-color: #b91c1c;
  box-shadow: 0 0 0 9999px rgba(6, 10, 16, 0.18);
}

.scanner-overlay-message {
  position: absolute;
  inset: auto 1rem 1rem 1rem;
  border-radius: 12px;
  padding: 0.7rem 0.9rem;
  background: var(--scanner-overlay-bg);
  color: var(--scanner-card-text);
  font-weight: 600;
}

.scanner-overlay-error {
  background: var(--scanner-overlay-error-bg);
}

.scanner-controls {
  display: flex;
  flex-wrap: wrap;
  gap: 0.8rem;
}

.scanner-controls .button-primary,
.scanner-controls .button-secondary {
  min-height: 2.55rem;
}

.scanner-controls .button-secondary {
  color: var(--scanner-card-text);
  background: var(--scanner-panel-bg);
  border-color: var(--scanner-panel-border);
}

.scanner-controls button:disabled {
  cursor: not-allowed;
  opacity: 1;
}

.scanner-controls .button-secondary:disabled,
.scanner-controls .button-primary:disabled {
  color: color-mix(in srgb, var(--scanner-card-text) 38%, transparent 62%);
  background: var(--scanner-panel-bg);
  border-color: color-mix(in srgb, var(--scanner-panel-border) 56%, transparent 44%);
  filter: saturate(0.45);
}


.scanner-status-row {
  display: flex;
  justify-content: space-between;
  gap: 1rem;
  align-items: flex-start;
  margin-top: 1rem;
}

.scanner-status-block {
  display: grid;
  gap: 0.45rem;
}

.scanner-status-pill {
  display: inline-flex;
  align-items: center;
  gap: 0.55rem;
  border-radius: 999px;
  padding: 0.55rem 0.85rem;
  font-weight: 700;
  background: var(--scanner-status-bg);
  border: 1px solid var(--scanner-status-border);
}

.scanner-status-dot {
  width: 0.65rem;
  height: 0.65rem;
  border-radius: 999px;
  background: currentColor;
}

.scanner-status-copy {
  margin: 0;
  color: var(--scanner-muted);
  font-size: 0.92rem;
  line-height: 1.45;
}

.scanner-status-success {
  color: #34a853;
}

.scanner-status-low_light,
.scanner-status-glare,
.scanner-status-blurry {
  color: #b7791f;
}

.scanner-status-unscannable {
  color: #b91c1c;
}

.scanner-helper-text {
  color: var(--scanner-muted);
  font-size: 0.92rem;
  line-height: 1.5;
}

@media (max-width: 760px) {
  .scanner-status-row {
    flex-direction: column;
    align-items: flex-start;
  }

  .scanner-preview-frame,
  .scanner-video {
    height: min(44vh, 360px);
  }
}

.scanner-detected-card,
.scanner-history-card {
  margin-top: 1rem;
  border-radius: 18px;
  border: 1px solid var(--scanner-panel-border);
  background: var(--scanner-panel-bg);
  padding: 0.9rem 1rem;
}

.scanner-detected-card strong,
.scanner-history-card strong {
  display: block;
  margin-bottom: 0.45rem;
  font-size: 0.85rem;
  color: color-mix(in srgb, var(--scanner-card-text) 82%, transparent 18%);
}

.scanner-detected-card span {
  display: block;
  font-family: ui-monospace, SFMono-Regular, SFMono-Regular, Consolas, monospace;
  font-size: 1rem;
  word-break: break-word;
}


</style>
