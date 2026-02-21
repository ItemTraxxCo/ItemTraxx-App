<template>
  <div class="page">
    <div class="page-nav-left">
      <RouterLink class="button-link" to="/tenant/admin">Return to Admin Panel</RouterLink>
      <RouterLink class="button-link" to="/tenant/checkout">Return to Checkout</RouterLink>
    </div>

    <h1>Bulk Barcode PDF Generator</h1>
    <p v-if="!featureEnabled" class="error">Barcode generator is disabled for this tenant.</p>
    <p v-else>Enter one barcode per line, add a message, then generate and download.</p>

    <div v-if="featureEnabled" class="card">
      <form class="form" @submit.prevent="generateBarcodes">
        <label>
          Barcodes (one per line)
          <textarea
            v-model="barcodeInput"
            rows="10"
            placeholder="EXAMPLE-001&#10;EXAMPLE-002&#10;EXAMPLE-003"
          />
        </label>

        <label>
          Message shown below each barcode
          <input
            v-model="messageInput"
            type="text"
            maxlength="120"
            placeholder="Property of ItemTraxx. Return to equipment room."
          />
        </label>

        <div class="form-actions">
          <button type="submit" class="button-primary">Generate</button>
          <button type="button" :disabled="!generatedBarcodes.length" @click="downloadPdf">
            Download PDF
          </button>
        </div>
      </form>

      <p v-if="error" class="error">{{ error }}</p>
      <p v-else-if="generatedBarcodes.length" class="muted">
        Ready to download: {{ generatedBarcodes.length }} barcode(s).
      </p>
    </div>
  </div>
</template>

<script setup lang="ts">
import { onMounted, ref } from "vue";
import { RouterLink } from "vue-router";
import { downloadBarcodePdf } from "../../../services/barcodePdfService";
import { fetchTenantSettings } from "../../../services/adminOpsService";

const barcodeInput = ref("");
const messageInput = ref("");
const generatedBarcodes = ref<string[]>([]);
const error = ref("");
const featureEnabled = ref(true);

const normalizeBarcodes = (raw: string) => {
  const lines = raw
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
  return Array.from(new Set(lines));
};

const generateBarcodes = () => {
  const parsed = normalizeBarcodes(barcodeInput.value);
  if (!parsed.length) {
    error.value = "Enter at least one barcode.";
    generatedBarcodes.value = [];
    return;
  }
  error.value = "";
  generatedBarcodes.value = parsed;
};

const downloadPdf = () => {
  try {
    downloadBarcodePdf(generatedBarcodes.value, messageInput.value);
  } catch (err) {
    error.value = err instanceof Error ? err.message : "Unable to generate PDF.";
  }
};

onMounted(async () => {
  try {
    const settings = await fetchTenantSettings();
    featureEnabled.value = settings.feature_flags.enable_barcode_generator;
  } catch {
    featureEnabled.value = true;
  }
});
</script>
