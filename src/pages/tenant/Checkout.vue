<template>
  <div class="page">
    <div class="page-header">
      <h1 class="brand-title">
        <img
          v-if="logoUrl"
          class="brand-logo"
          :src="logoUrl"
          alt="ItemTraxx logo"
        />
        ItemTraxx
      </h1>
    </div>
    <p>Student checkout and return</p>
    <div class="card">
      <label>
        Student ID
        <div class="input-row">
          <input
            v-model="studentId"
            type="text"
            placeholder="Enter student ID"
            @keyup.enter="loadStudent"
          />
          <button
            type="button"
            class="link"
            :disabled="isStudentLoading"
            @click="loadStudent"
          >
            Load student
          </button>
        </div>
      </label>
      <p v-if="isStudentLoading" class="muted">Loading student...</p>
      <div v-if="student" class="panel">
        <p>
          <strong>{{ student.username }}</strong>
          <span class="muted"> ID: {{ student.student_id }}</span>
        </p>
        <div v-if="checkedOutGear.length">
          <p>Currently checked out</p>
          <ul>
            <li v-for="item in checkedOutGear" :key="item.id">
              {{ item.name }}
            </li>
          </ul>
        </div>
        <p v-else class="muted">No items currently checked out.</p>
      </div>
      <div v-if="student">
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
            <button
              type="button"
              class="link"
              :disabled="isBarcodeLoading"
              @click="addBarcode"
            >
              Add barcode
            </button>
          </div>
        </label>
        <p class="muted">Press Enter or click “Add barcode” to add.</p>
        <div v-if="barcodes.length" class="list">
          <p>Items</p>
          <ul>
            <li v-for="item in barcodes" :key="item.barcode" class="checkout-item-row">
              {{ item.name }}
              <span class="muted">({{ item.barcode }})</span>
              <span class="tag" :class="getActionClass(item.barcode)">
                {{ getActionLabel(item.barcode) }}
              </span>
              <button
                type="button"
                class="chip-button"
                @click="removeBarcode(item.barcode)"
              >
                Remove
              </button>
            </li>
          </ul>
        </div>
        <div class="actions">
          <button type="button" class="button-primary" :disabled="isSubmitting" @click="submit">
            Complete Transaction
          </button>
        </div>
      </div>
      <p v-else class="muted">Enter a student ID to begin.</p>
      <p v-if="error" class="error">{{ error }}</p>
      <p v-if="success" class="success">{{ success }}</p>
      <div v-if="toastMessage" class="toast" :class="{ 'toast-persist': toastStatus === 'Processing' }">
        <div class="toast-title">{{ toastTitle }}</div>
        <div class="toast-body">{{ toastMessage }}</div>
        <div v-if="toastStatus === 'Success' && receipt" class="toast-actions">
          <button type="button" class="toast-action-button" @click="downloadReceiptPdf">
            Download transaction receipt
          </button>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { nextTick, ref } from "vue";
import {
  fetchCheckedOutGear,
  fetchGearByBarcode,
  fetchStudentByStudentId,
  submitCheckoutReturn,
  type GearSummary,
  type StudentSummary,
} from "../../services/checkoutService";
import { enforceTenantLookupRateLimit } from "../../services/rateLimitService";
import { sanitizeInput } from "../../utils/inputSanitizer";
import { getAuthState } from "../../store/authState";

const isStudentLoading = ref(false);
const isBarcodeLoading = ref(false);
const isSubmitting = ref(false);
const error = ref("");
const success = ref("");
const studentId = ref("");
const barcodeInput = ref("");
const barcodes = ref<GearSummary[]>([]);
const student = ref<StudentSummary | null>(null);
const checkedOutGear = ref<GearSummary[]>([]);
const lastSummary = ref("");
const toastMessage = ref("");
const toastStatus = ref<"Success" | "Failed" | "Processing">("Success");
const barcodeField = ref<HTMLInputElement | null>(null);
const logoUrl = import.meta.env.VITE_LOGO_URL as string | undefined;
const toastTitle = ref("");
const receipt = ref<{
  timestamp: string;
  studentUsername: string;
  studentId: string;
  tenantId: string | null;
  operatorEmail: string;
  checkouts: number;
  returns: number;
  items: Array<{ name: string; barcode: string; action: "checkout" | "return" }>;
} | null>(null);

const downloadReceiptPdf = async () => {
  if (!receipt.value) return;
  const [{ downloadTransactionReceiptPdf }] = await Promise.all([
    import("../../services/receiptPdfService"),
  ]);
  await downloadTransactionReceiptPdf(receipt.value);
};


const loadStudent = async () => {
  error.value = "";
  success.value = "";
  const studentSanitized = sanitizeInput(studentId.value, { maxLen: 32 });
  studentId.value = studentSanitized.value;
  if (studentSanitized.error) {
    error.value = studentSanitized.error;
    return;
  }
  if (!studentId.value.trim()) {
    error.value = "Enter a student ID.";
    return;
  }
  isStudentLoading.value = true;
  try {
    await enforceTenantLookupRateLimit();
    const studentRow = await fetchStudentByStudentId(studentId.value.trim());
    student.value = studentRow;
    checkedOutGear.value = await fetchCheckedOutGear(studentRow.id);
    await nextTick();
    barcodeField.value?.focus();
  } catch (err) {
    student.value = null;
    checkedOutGear.value = [];
    error.value = err instanceof Error ? err.message : "Student not found. Please check the student ID and try again.";
  } finally {
    isStudentLoading.value = false;
  }
};

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
    error.value = err instanceof Error ? err.message : "Invalid barcode. Please check the barcode and try again.";
  } finally {
    isBarcodeLoading.value = false;
  }
};

const removeBarcode = (code: string) => {
  barcodes.value = barcodes.value.filter((item) => item.barcode !== code);
};

const getActionLabel = (barcode: string) => {
  const checkedOut = checkedOutGear.value.some(
    (item) => item.barcode === barcode
  );
  return checkedOut ? "Return" : "Checkout";
};

const getActionClass = (barcode: string) => {
  const checkedOut = checkedOutGear.value.some(
    (item) => item.barcode === barcode
  );
  return checkedOut ? "tag-return" : "tag-checkout";
};

const submit = async () => {
  if (isSubmitting.value) {
    return;
  }

  error.value = "";
  success.value = "";
  isSubmitting.value = true;

  try {
    toastStatus.value = "Processing";
    toastTitle.value = "Transaction processing...";
    toastMessage.value = "Please wait while your transaction is processed.";

    if (barcodeInput.value.trim()) {
      await addBarcode();
    }
    if (!studentId.value.trim() || barcodes.value.length === 0) {
      error.value = "Enter a student ID and at least one barcode.";
      toastStatus.value = "Failed";
      toastTitle.value = "Transaction failed. Please try again.";
      toastMessage.value = error.value;
      return;
    }

    if (!student.value) {
      await loadStudent();
      if (!student.value) {
        toastStatus.value = "Failed";
        toastTitle.value = "Transaction failed.";
        toastMessage.value = error.value || "Unable to load student. Please sign out completeley and sign back in.";
        return;
      }
    }

    let checkoutCount = 0;
    let returnCount = 0;
    for (const item of barcodes.value) {
      const isReturn = checkedOutGear.value.some(
        (checkedOutItem) => checkedOutItem.barcode === item.barcode
      );
      if (isReturn) {
        returnCount += 1;
      } else {
        checkoutCount += 1;
      }
    }

    await submitCheckoutReturn({
      student_id: studentId.value.trim(),
      gear_barcodes: barcodes.value.map((item) => item.barcode),
      action_type: "auto",
    });
    const studentSnapshot = student.value;
    const itemsSnapshot = barcodes.value.map((item) => {
      const wasReturn = checkedOutGear.value.some(
        (checkedOutItem) => checkedOutItem.barcode === item.barcode
      );
      return {
        name: item.name,
        barcode: item.barcode,
        action: wasReturn ? "return" : "checkout",
      } as { name: string; barcode: string; action: "checkout" | "return" };
    });
    const auth = getAuthState();
    receipt.value = {
      timestamp: new Date().toISOString(),
      studentUsername: studentSnapshot?.username ?? "Unknown",
      studentId: studentSnapshot?.student_id ?? studentId.value.trim(),
      tenantId: auth.tenantContextId,
      operatorEmail: auth.email ?? "Unknown",
      checkouts: checkoutCount,
      returns: returnCount,
      items: itemsSnapshot,
    };
    success.value = " ";
    lastSummary.value = `processed:\n${checkoutCount} checkout(s)\n${returnCount} return(s)`;
    toastStatus.value = "Success";
    toastTitle.value = "Transaction complete (Success).";
    toastMessage.value = lastSummary.value;
    barcodes.value = [];
    barcodeInput.value = "";
    studentId.value = "";
    student.value = null;
    checkedOutGear.value = [];
    window.setTimeout(() => {
      lastSummary.value = "";
      toastTitle.value = "";
      toastMessage.value = "";
    }, 9000);
  } catch (err) {
    error.value = err instanceof Error ? err.message : "Request failed.";
    toastStatus.value = "Failed";
    toastTitle.value = "Transaction complete (Failed). Please sign out completeley and sign back in.";
    toastMessage.value = error.value;
    window.setTimeout(() => {
      toastTitle.value = "";
      toastMessage.value = "";
    }, 4000);
  } finally {
    isSubmitting.value = false;
  }
};
</script>
