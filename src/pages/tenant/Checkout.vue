<template>
  <div class="page checkout-page">
    <div class="page-header checkout-page-header">
      <h1 class="brand-title checkout-brand-title">
        <img
          v-if="logoUrl"
          class="brand-logo"
          :src="logoUrl"
          alt="ItemTraxx logo"
        />
        ItemTraxx
      </h1>
    </div>

    <p class="checkout-page-copy">Student checkout and return</p>

    <div class="card checkout-card">
      <label>
        Student ID
        <div class="input-row checkout-input-row">
          <input
            v-model="studentId"
            type="text"
            placeholder="Enter student ID"
            :disabled="studentLookupCooldownSeconds > 0"
            @keyup.enter="loadStudent"
          />
          <button
            type="button"
            class="button-primary checkout-inline-button"
            :disabled="isStudentLoading || studentLookupCooldownSeconds > 0"
            @click="loadStudent"
          >
            Load student
          </button>
        </div>
      </label>
      <p v-if="studentLookupCooldownSeconds > 0" class="muted checkout-rate-limit-note">
        Try again in {{ studentLookupCooldownSeconds }} second{{ studentLookupCooldownSeconds === 1 ? "" : "s" }}.
      </p>
      <p v-if="isStudentLoading" class="muted checkout-status-note">Loading student...</p>

      <div v-if="student" class="checkout-student-summary">
        <p>
          <strong>{{ student.username }}</strong>
          <span class="muted"> ID: {{ student.student_id }}</span>
        </p>
        <div v-if="checkedOutGear.length">
          <p class="checkout-subheading">Currently checked out</p>
          <ul class="checkout-inline-list">
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
          <div class="input-row checkout-input-row">
            <input
              ref="barcodeField"
              v-model="barcodeInput"
              type="text"
              placeholder="Scan or enter barcode"
              @keyup.enter="addBarcode"
            />
            <button
              type="button"
              class="button-primary checkout-inline-button"
              :disabled="isBarcodeLoading"
              @click="addBarcode"
            >
              Add barcode
            </button>
          </div>
        </label>
        <p class="muted checkout-status-note">Press Enter or click “Add barcode” to add.</p>

        <div v-if="barcodes.length" class="checkout-list">
          <p class="checkout-subheading">Items</p>
          <ul class="checkout-inline-list">
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

        <div class="actions checkout-actions">
          <button type="button" class="button-primary checkout-submit-button" :disabled="isSubmitting" @click="submit">
            Complete transaction
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
import { nextTick, onMounted, onUnmounted, ref } from "vue";
import {
  fetchCheckedOutGear,
  fetchGearByBarcode,
  getBufferedCheckoutCount,
  fetchStudentByStudentId,
  submitCheckoutReturn,
  syncBufferedCheckoutQueue,
  type GearSummary,
  type StudentSummary,
} from "../../services/checkoutService";
import {
  enforceTenantLookupRateLimit,
  getTenantLookupCooldownRemainingMs,
} from "../../services/rateLimitService";
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
const syncInFlight = ref(false);
const studentLookupCooldownSeconds = ref(0);
let studentLookupCooldownTimer: number | null = null;
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

const updateStudentLookupCooldown = () => {
  const remainingMs = getTenantLookupCooldownRemainingMs();
  studentLookupCooldownSeconds.value = remainingMs > 0 ? Math.ceil(remainingMs / 1000) : 0;

  if (studentLookupCooldownSeconds.value === 0 && studentLookupCooldownTimer !== null) {
    window.clearInterval(studentLookupCooldownTimer);
    studentLookupCooldownTimer = null;
  }
};

const ensureStudentLookupCooldownTimer = () => {
  updateStudentLookupCooldown();
  if (studentLookupCooldownSeconds.value === 0 || studentLookupCooldownTimer !== null) {
    return;
  }

  studentLookupCooldownTimer = window.setInterval(() => {
    updateStudentLookupCooldown();
  }, 250);
};

const syncOfflineBuffer = async (showWhenNoOps = false) => {
  if (syncInFlight.value) return;
  if (!navigator.onLine) return;
  syncInFlight.value = true;
  try {
    const result = await syncBufferedCheckoutQueue();
    if (result.processed > 0) {
      toastStatus.value = "Success";
      toastTitle.value = "Offline transactions synced.";
      toastMessage.value = `${result.processed} buffered transaction(s) sent.`;
      return;
    }
    if (showWhenNoOps && result.remaining === 0) {
      toastStatus.value = "Success";
      toastTitle.value = "No buffered transactions.";
      toastMessage.value = "Everything is up to date.";
    }
  } finally {
    syncInFlight.value = false;
  }
};

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
  if (studentLookupCooldownSeconds.value > 0) {
    error.value = `Rate limit reached. Wait ${studentLookupCooldownSeconds.value} second${studentLookupCooldownSeconds.value === 1 ? "" : "s"} and try again.`;
    ensureStudentLookupCooldownTimer();
    return;
  }
  isStudentLoading.value = true;
  try {
    await enforceTenantLookupRateLimit();
    updateStudentLookupCooldown();
    const studentRow = await fetchStudentByStudentId(studentId.value.trim());
    student.value = studentRow;
    checkedOutGear.value = await fetchCheckedOutGear(studentRow.id);
    await nextTick();
    barcodeField.value?.focus();
  } catch (err) {
    ensureStudentLookupCooldownTimer();
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

    const submitResult = await submitCheckoutReturn({
      student_id: studentId.value.trim(),
      gear_barcodes: barcodes.value.map((item) => item.barcode),
      action_type: "auto",
    });
    if (submitResult.buffered) {
      const bufferedCount = submitResult.queuedCount;
      success.value = "";
      receipt.value = null;
      barcodes.value = [];
      barcodeInput.value = "";
      studentId.value = "";
      student.value = null;
      checkedOutGear.value = [];
      toastStatus.value = "Processing";
      toastTitle.value = "Saved offline.";
      toastMessage.value = `No connection. Transaction was buffered and will auto-sync when you're online. Buffered: ${bufferedCount}`;
      return;
    }
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

const handleOnline = () => {
  void syncOfflineBuffer(false);
};

onMounted(() => {
  window.addEventListener("online", handleOnline);
  updateStudentLookupCooldown();
  ensureStudentLookupCooldownTimer();
  const buffered = getBufferedCheckoutCount();
  if (buffered > 0) {
    toastStatus.value = "Processing";
    toastTitle.value = "Buffered transactions detected.";
    toastMessage.value = `${buffered} transaction(s) pending sync.`;
  }
  void syncOfflineBuffer(false);
});

onUnmounted(() => {
  window.removeEventListener("online", handleOnline);
  if (studentLookupCooldownTimer !== null) {
    window.clearInterval(studentLookupCooldownTimer);
    studentLookupCooldownTimer = null;
  }
});
</script>

<style scoped>
.checkout-page {
  display: grid;
  gap: 0.9rem;
}

.checkout-page-header {
  margin-bottom: 0;
}

.checkout-brand-title {
  color: inherit;
}

.checkout-page-copy {
  margin: 0;
  color: var(--muted);
  font-size: 1rem;
}

.checkout-card {
  background:
    radial-gradient(circle at top right, color-mix(in srgb, var(--accent) 10%, transparent 90%), transparent 30%),
    linear-gradient(180deg, color-mix(in srgb, var(--surface) 94%, transparent 6%) 0%, color-mix(in srgb, var(--surface-2) 92%, transparent 8%) 100%);
  border-color: color-mix(in srgb, var(--border) 74%, var(--accent) 26%);
}

.checkout-input-row {
  gap: 0.55rem;
  align-items: center;
}

.checkout-input-row input {
  height: 2.2rem;
  min-height: 2.2rem;
  padding: 0 0.72rem;
  border-radius: 12px;
  border: 1px solid color-mix(in srgb, var(--border) 72%, var(--accent) 28%);
  background: color-mix(in srgb, var(--surface) 88%, transparent 12%);
  font-size: 0.92rem;
  line-height: 1.1;
}

.checkout-inline-button {
  min-width: 7rem;
  min-height: 2.2rem;
  padding: 0.36rem 0.8rem;
  border-radius: 12px;
  white-space: nowrap;
}

.checkout-status-note {
  margin-top: 0.7rem;
}

.checkout-rate-limit-note {
  margin-top: 0.45rem;
  min-height: 1.2rem;
}

.checkout-student-panel {
  margin-top: 1rem;
  border-radius: 16px;
  border: 1px solid color-mix(in srgb, var(--border) 78%, var(--accent) 22%);
  background: color-mix(in srgb, var(--surface) 94%, transparent 6%);
}

.checkout-subheading {
  margin-bottom: 0.45rem;
  font-weight: 700;
}

.checkout-list {
  margin-top: 1rem;
}

.checkout-inline-list {
  margin: 0.55rem 0 0;
  padding-left: 1.6rem;
}

.checkout-item-row {
  width: fit-content;
  max-width: 100%;
  margin: 0.35rem 0;
}

.checkout-item-name {
  font-weight: 600;
}

.checkout-item-row .tag,
.checkout-item-row .chip-button {
  margin-left: 0.5rem;
}

.checkout-actions {
  margin-top: 1rem;
}

.checkout-submit-button {
  min-height: 2.35rem;
  padding-inline: 1rem;
  border-radius: 12px;
}

@media (max-width: 760px) {
  .checkout-input-row {
    flex-direction: column;
    align-items: stretch;
  }


  .checkout-inline-button,
  .checkout-submit-button {
    width: 100%;
  }
}
</style>
