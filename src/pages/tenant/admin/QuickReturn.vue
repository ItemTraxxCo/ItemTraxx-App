<template>
  <div class="page admin-shell">
    <div class="admin-hero">
      <div class="page-nav-left">
        <RouterLink class="button-link" to="/tenant/admin">Return to admin panel</RouterLink>
      </div>
      <h1>Quick Return</h1>
      <p class="admin-hero-copy">Return items by barcode without needing a borrower ID.</p>
      <div class="admin-summary-grid">
        <div class="admin-summary-card">
          <strong>{{ barcodes.length }}</strong>
          <span>Queued items</span>
        </div>
      </div>
    </div>

    <div class="card admin-section-card">
      <div class="admin-section-header">
        <div>
          <h2>Return Queue</h2>
          <p class="admin-section-copy">Scan or enter barcodes, review the queue, then complete the return.</p>
        </div>
      </div>
      <label>
        Item barcode
        <div class="input-row">
          <input
            ref="barcodeField"
            v-model="barcodeInput"
            type="text"
            placeholder="Scan or enter barcode"
            @keyup.enter="addBarcode"
          />
          <button type="button" class="link" :disabled="isBarcodeLoading" @click="addBarcode">
            Add item
          </button>
        </div>
        <button
          type="button"
          class="button-secondary quick-return-camera-button"
          :disabled="isBarcodeLoading"
          @click="scannerOpen = true"
        >
          Use device camera to scan barcode
        </button>
      </label>
      <p class="muted">Press Enter or click “Add item” to add.</p>
      <div v-if="barcodes.length" class="list">
        <p class="checkout-subheading">Items</p>
        <ul>
          <li v-for="item in barcodes" :key="item.barcode">
            {{ item.name }}
            <span class="muted">({{ item.barcode }})</span>
            <button type="button" class="link" @click="removeBarcode(item.barcode)">
              Remove
            </button>
          </li>
        </ul>
      </div>
      <div class="actions">
        <button type="button" class="button-primary" :disabled="isSubmitting" @click="submitReturn">
          Complete Quick Return
        </button>
      </div>

      <p v-if="error" class="error">{{ error }}</p>
      <p v-if="success" class="success">{{ success }}</p>
      <div v-if="lastSummary" class="muted">
        {{ lastSummary }}
      </div>
    </div>

    <CameraBarcodeScannerModal
      v-model="scannerOpen"
      mode="admin_quick_return"
      title="Scan item barcode"
      :auto-close-on-scan="false"
      :scan-history-items="scannerHistory"
      @scanned="handleScannerScan"
    />

  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, ref } from "vue";
import { RouterLink } from "vue-router";
import CameraBarcodeScannerModal from "../../../components/CameraBarcodeScannerModal.vue";
import { fetchGearByBarcode, submitCheckoutReturn, type GearSummary } from "../../../services/checkoutService";
import { logAdminAction } from "../../../services/auditLogService";
import { sanitizeInput } from "../../../utils/inputSanitizer";
import { toUserFacingErrorMessage } from "../../../services/appErrors";
import type { ScannerHistoryItem, ScannerScanEvent } from "../../../types/cameraScanner";

const barcodeInput = ref("");
const barcodes = ref<GearSummary[]>([]);
const barcodeField = ref<HTMLInputElement | null>(null);

const isBarcodeLoading = ref(false);
const isSubmitting = ref(false);
const error = ref("");
const success = ref("");
const lastSummary = ref("");
const scannerOpen = ref(false);

const scannerHistory = computed<ScannerHistoryItem[]>(() =>
  barcodes.value.map((item) => ({
    id: item.barcode,
    label: item.name,
    value: item.barcode,
  }))
);

const addBarcode = async () => {
  const sanitized = sanitizeInput(barcodeInput.value, { maxLen: 64 });
  barcodeInput.value = sanitized.value;
  if (sanitized.error) {
    error.value = sanitized.error;
    return;
  }
  const value = barcodeInput.value.trim();
  if (!value) return;
  if (barcodes.value.some((item) => item.barcode === value)) {
    barcodeInput.value = "";
    return;
  }
  error.value = "";
  isBarcodeLoading.value = true;
  try {
    const gear = await fetchGearByBarcode(value);
    barcodes.value = [...barcodes.value, gear];
    barcodeInput.value = "";
  } catch (err) {
    error.value = toUserFacingErrorMessage(err, "Invalid barcode. Please check it and try again.");
  } finally {
    isBarcodeLoading.value = false;
  }
};

const removeBarcode = (code: string) => {
  barcodes.value = barcodes.value.filter((item) => item.barcode !== code);
};

const handleScannerScan = async (event: ScannerScanEvent) => {
  barcodeInput.value = event.value;
  await addBarcode();
};

const submitReturn = async () => {
  error.value = "";
  success.value = "";
  if (barcodeInput.value.trim()) {
    await addBarcode();
  }
  if (barcodes.value.length === 0) {
    error.value = "Enter at least one barcode.";
    return;
  }

  isSubmitting.value = true;
  try {
    const submitResult = await submitCheckoutReturn({
      student_id: "",
      gear_barcodes: barcodes.value.map((item) => item.barcode),
      action_type: "admin_return",
    });
    if (submitResult.buffered) {
      success.value = "";
      lastSummary.value = "";
      error.value = `No connection. Return request buffered for auto-sync. Buffered: ${submitResult.queuedCount}`;
      barcodes.value = [];
      barcodeInput.value = "";
      return;
    }
    await logAdminAction({
      action_type: "quick_return",
      metadata: {
        count: barcodes.value.length,
        barcodes: barcodes.value.map((item) => item.barcode),
      },
    });
    success.value = "Quick return completed.";
    lastSummary.value = `Processed ${barcodes.value.length} item(s).`;
    barcodes.value = [];
    barcodeInput.value = "";
  } catch (err) {
    error.value = toUserFacingErrorMessage(err, "Request failed. Please try again.");
  } finally {
    isSubmitting.value = false;
  }
};

onMounted(() => {
  barcodeField.value?.focus();
});
</script>

<style scoped>
.quick-return-camera-button {
  margin-top: 0.7rem;
}
</style>
