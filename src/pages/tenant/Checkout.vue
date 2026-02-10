<template>
  <div class="page">
    <div class="page-header">
      <h1>ItemTraxx</h1>
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
          <strong>{{ student.first_name }} {{ student.last_name }}</strong>
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
        <p v-else class="muted">No gear currently checked out.</p>
      </div>
      <div v-if="student">
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
            <li v-for="item in barcodes" :key="item.barcode">
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
      <div v-if="toastMessage" class="toast">
        <div class="toast-title">Transaction complete ({{ toastStatus }}).</div>
        <div class="toast-body">{{ toastMessage }}</div>
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
const toastStatus = ref<"Success" | "Failed">("Success");
const barcodeField = ref<HTMLInputElement | null>(null);


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
    error.value = err instanceof Error ? err.message : "Student not found.";
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
    error.value = err instanceof Error ? err.message : "Invalid barcode.";
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
  error.value = "";
  success.value = "";
  if (barcodeInput.value.trim()) {
    await addBarcode();
  }
  if (!studentId.value.trim() || barcodes.value.length === 0) {
    error.value = "Enter a student ID and at least one barcode.";
    return;
  }

  if (!student.value) {
    await loadStudent();
    if (!student.value) {
      return;
    }
  }

  isSubmitting.value = true;
  try {
    await submitCheckoutReturn({
      student_id: studentId.value.trim(),
      gear_barcodes: barcodes.value.map((item) => item.barcode),
      action_type: "auto",
    });
    success.value = " ";
    lastSummary.value = `Processed ${barcodes.value.length} item(s).`;
    toastStatus.value = "Success";
    toastMessage.value = lastSummary.value;
    barcodes.value = [];
    barcodeInput.value = "";
    studentId.value = "";
    student.value = null;
    checkedOutGear.value = [];
    window.setTimeout(() => {
      lastSummary.value = "";
      toastMessage.value = "";
    }, 4000);
  } catch (err) {
    error.value = err instanceof Error ? err.message : "Request failed.";
    toastStatus.value = "Failed";
    toastMessage.value = error.value;
    window.setTimeout(() => {
      toastMessage.value = "";
    }, 4000);
  } finally {
    isSubmitting.value = false;
  }
};
</script>
