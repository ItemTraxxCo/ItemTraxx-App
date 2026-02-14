<template>
  <div class="page">
    <div class="page-nav-left">
      <RouterLink class="button-link" to="/tenant/admin">Return to admin panel</RouterLink>
    </div>
    <h1>Quick Return</h1>
    <p>Return items by barcode.</p>

    <div class="card">
      <label>
        Gear barcode
        <div class="input-row">
          <input
            ref="barcodeField"
            v-model="barcodeInput"
            type="text"
            placeholder="Scan or enter barcode"
            @keyup.enter="addBarcode"
          />
          <button type="button" class="link" :disabled="isBarcodeLoading" @click="addBarcode">
            Add barcode
          </button>
        </div>
      </label>
      <p class="muted">Press Enter or click “Add barcode” to add.</p>
      <div v-if="barcodes.length" class="list">
        <p>Items</p>
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
          Complete Return
        </button>
      </div>

      <p v-if="error" class="error">{{ error }}</p>
      <p v-if="success" class="success">{{ success }}</p>
      <div v-if="lastSummary" class="muted">
        {{ lastSummary }}
      </div>
    </div>

  </div>
</template>

<script setup lang="ts">
import { onMounted, ref } from "vue";
import { RouterLink } from "vue-router";
import { fetchGearByBarcode, submitCheckoutReturn, type GearSummary } from "../../../services/checkoutService";
import { logAdminAction } from "../../../services/auditLogService";
import { sanitizeInput } from "../../../utils/inputSanitizer";

const barcodeInput = ref("");
const barcodes = ref<GearSummary[]>([]);
const barcodeField = ref<HTMLInputElement | null>(null);

const isBarcodeLoading = ref(false);
const isSubmitting = ref(false);
const error = ref("");
const success = ref("");
const lastSummary = ref("");

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
    error.value = err instanceof Error ? err.message : "Invalid barcode.";
  } finally {
    isBarcodeLoading.value = false;
  }
};

const removeBarcode = (code: string) => {
  barcodes.value = barcodes.value.filter((item) => item.barcode !== code);
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
    await submitCheckoutReturn({
      student_id: "",
      gear_barcodes: barcodes.value.map((item) => item.barcode),
      action_type: "admin_return",
    });
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
    error.value = err instanceof Error ? err.message : "Request failed. Please try again.";
  } finally {
    isSubmitting.value = false;
  }
};

onMounted(() => {
  barcodeField.value?.focus();
});
</script>
