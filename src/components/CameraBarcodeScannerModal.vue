<template>
  <Teleport to="body">
    <div
      v-if="modelValue"
      class="scanner-modal-backdrop"
      :class="{ 'scanner-modal-backdrop-lab': labPreview }"
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
            <video ref="videoRef" class="scanner-video" playsinline muted autoplay></video>
            <div class="scanner-crosshair" aria-hidden="true"></div>
            <div
              v-if="previewStyle"
              class="scanner-detection-box"
              :class="`scanner-detection-${currentStatus}`"
              :style="previewStyle"
              aria-hidden="true"
            ></div>
            <div v-if="isStarting" class="scanner-overlay-message">Starting camera...</div>
            <div v-else-if="errorMessage" class="scanner-overlay-message scanner-overlay-error">
              {{ errorMessage }}
            </div>
          </div>

          <div class="scanner-controls">
            <button type="button" class="button-secondary" @click="handleClose">Close camera</button>
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
            make sure barcode is clearly visible, there are no glares, and well lit.
          </span>
        </div>
      </div>
    </div>
  </Teleport>
</template>

<script setup lang="ts">
import { computed, watch } from "vue";
import { useCameraBarcodeScanner } from "../composables/useCameraBarcodeScanner";
import type { ScannerMode, ScannerScanEvent, ScannerStatus, ScannerStatusEvent } from "../types/cameraScanner";

const props = defineProps<{
  modelValue: boolean;
  mode: ScannerMode;
  title: string;
  autoCloseOnScan?: boolean;
  labPreview?: boolean;
}>();

const emit = defineEmits<{
  "update:modelValue": [value: boolean];
  scanned: [event: ScannerScanEvent];
  status: [event: ScannerStatusEvent];
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
  autoAccept: () => props.autoCloseOnScan !== false,
  onScanned: (event) => {
    emit("scanned", event);
    if (props.autoCloseOnScan !== false) {
      emit("update:modelValue", false);
    }
  },
  onStatus: (event) => {
    emit("status", event);
  },
});
void videoRef;

const handleClose = () => {
  emit("update:modelValue", false);
};

watch(
  () => props.modelValue,
  (next) => {
    if (next) {
      void open();
    } else {
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

const previewStyle = computed(() => {
  if (!previewBox.value) return null;
  return {
    left: `${previewBox.value.x}px`,
    top: `${previewBox.value.y}px`,
    width: `${previewBox.value.width}px`,
    height: `${previewBox.value.height}px`,
  };
});
</script>

<style scoped>
.scanner-modal-backdrop {
  position: fixed;
  inset: 0;
  z-index: 2200;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 1rem;
  background: rgba(5, 10, 18, 0.68);
  backdrop-filter: blur(16px);
}

@media (min-width: 1100px) {
  .scanner-modal-backdrop-lab {
    justify-content: flex-start;
    padding: 1.25rem calc(40vw + 1.5rem) 1.25rem 1.25rem;
    background:
      linear-gradient(90deg, rgba(5, 10, 18, 0.78) 0%, rgba(5, 10, 18, 0.7) 48%, rgba(5, 10, 18, 0.18) 74%, rgba(5, 10, 18, 0.02) 100%);
    backdrop-filter: blur(12px);
  }

  .scanner-modal-backdrop-lab .scanner-modal-card {
    width: min(760px, calc(60vw - 3rem));
    margin-left: max(0px, calc((100vw - 1240px) / 2));
  }
}

.scanner-modal-card {
  width: min(820px, calc(100vw - 2rem));
  border-radius: 24px;
  border: 1px solid rgba(118, 143, 181, 0.18);
  background: linear-gradient(180deg, rgba(15, 22, 34, 0.97) 0%, rgba(10, 15, 24, 0.99) 100%);
  color: #f4f7fb;
  box-shadow: 0 28px 80px rgba(3, 8, 18, 0.36);
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
  color: rgba(194, 206, 223, 0.72);
}

.scanner-modal-header h2 {
  margin: 0;
  font-size: clamp(1.35rem, 2.5vw, 1.9rem);
}

.scanner-icon-button {
  width: 2.4rem;
  height: 2.4rem;
  border-radius: 999px;
  border: 1px solid rgba(140, 157, 189, 0.24);
  background: rgba(9, 17, 31, 0.58);
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
  border: 1px solid rgba(118, 143, 181, 0.16);
  background: #04070d;
  min-height: min(52vh, 420px);
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

.scanner-detection-box {
  position: absolute;
  border: 3px solid #59dca3;
  border-radius: 14px;
  background: rgba(255, 255, 255, 0.02);
  box-shadow:
    0 0 0 2px rgba(7, 12, 20, 0.75),
    0 0 0 9999px rgba(6, 10, 16, 0.14),
    0 0 22px rgba(89, 220, 163, 0.45);
  transition:
    left 120ms ease,
    top 120ms ease,
    width 120ms ease,
    height 120ms ease,
    border-color 120ms ease,
    box-shadow 120ms ease;
}

.scanner-detection-success {
  border-color: #59dca3;
  box-shadow:
    0 0 0 2px rgba(7, 12, 20, 0.78),
    0 0 0 9999px rgba(6, 10, 16, 0.14),
    0 0 26px rgba(89, 220, 163, 0.55);
}

.scanner-detection-low_light,
.scanner-detection-glare,
.scanner-detection-blurry {
  border-color: #ffcc54;
  box-shadow:
    0 0 0 2px rgba(7, 12, 20, 0.78),
    0 0 0 9999px rgba(6, 10, 16, 0.14),
    0 0 24px rgba(255, 204, 84, 0.48);
}

.scanner-detection-unscannable {
  border-color: #ff6c70;
  box-shadow:
    0 0 0 2px rgba(7, 12, 20, 0.78),
    0 0 0 9999px rgba(6, 10, 16, 0.14),
    0 0 24px rgba(255, 108, 112, 0.48);
}

.scanner-overlay-message {
  position: absolute;
  inset: auto 1rem 1rem 1rem;
  border-radius: 12px;
  padding: 0.7rem 0.9rem;
  background: rgba(7, 12, 20, 0.8);
  color: #f4f7fb;
  font-weight: 600;
}

.scanner-overlay-error {
  background: rgba(59, 16, 18, 0.82);
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
  background: rgba(14, 23, 35, 0.9);
  border: 1px solid rgba(118, 143, 181, 0.14);
}

.scanner-status-dot {
  width: 0.65rem;
  height: 0.65rem;
  border-radius: 999px;
  background: currentColor;
}

.scanner-status-copy {
  margin: 0;
  color: rgba(224, 232, 242, 0.72);
  font-size: 0.92rem;
  line-height: 1.45;
}

.scanner-status-success {
  color: #6fe0af;
}

.scanner-status-low_light,
.scanner-status-glare,
.scanner-status-blurry {
  color: #ffd56b;
}

.scanner-status-unscannable {
  color: #ff8b8f;
}

.scanner-helper-text {
  color: rgba(224, 232, 242, 0.72);
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
</style>
