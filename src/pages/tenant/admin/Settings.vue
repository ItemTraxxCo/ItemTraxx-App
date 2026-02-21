<template>
  <div class="page">
    <div class="page-nav-left">
      <RouterLink class="button-link" to="/tenant/admin">Return to admin panel</RouterLink>
    </div>

    <h1>Tenant Settings</h1>
    <p>Configure tenant checkout defaults and review enabled features.</p>

    <div class="card">
      <h2>Checkout Policy</h2>
      <form class="form" @submit.prevent="handleSave">
        <label>
          Checkout due limit (hours)
          <input v-model.number="checkoutDueHours" type="number" min="1" max="720" step="1" />
        </label>
        <p class="muted">Used for overdue notifications across tenant views.</p>
        <div class="form-actions">
          <button type="submit" class="button-primary" :disabled="isSaving">Save settings</button>
          <button type="button" :disabled="isSaving" @click="loadSettings">Reload</button>
        </div>
      </form>
      <p v-if="error" class="error">{{ error }}</p>
      <p v-if="success" class="success">{{ success }}</p>
    </div>

    <div v-if="toastMessage" class="toast">
      <div class="toast-title">{{ toastTitle }}</div>
      <div class="toast-body">{{ toastMessage }}</div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { onMounted, onUnmounted, ref } from "vue";
import { RouterLink } from "vue-router";
import {
  fetchTenantSettings,
  updateTenantSettings,
  type TenantSettingsPayload,
} from "../../../services/adminOpsService";

const isSaving = ref(false);
const error = ref("");
const success = ref("");
const checkoutDueHours = ref(72);
const toastTitle = ref("");
const toastMessage = ref("");
let toastTimer: number | null = null;

const showToast = (title: string, message: string) => {
  toastTitle.value = title;
  toastMessage.value = message;
  if (toastTimer) {
    window.clearTimeout(toastTimer);
  }
  toastTimer = window.setTimeout(() => {
    toastTitle.value = "";
    toastMessage.value = "";
    toastTimer = null;
  }, 4000);
};

const applySettings = (settings: TenantSettingsPayload) => {
  checkoutDueHours.value = settings.checkout_due_hours;
};

const loadSettings = async () => {
  error.value = "";
  success.value = "";
  try {
    const settings = await fetchTenantSettings();
    applySettings(settings);
  } catch (err) {
    error.value = err instanceof Error ? err.message : "Unable to load tenant settings.";
  }
};

const handleSave = async () => {
  error.value = "";
  success.value = "";
  const nextHours = Number(checkoutDueHours.value);
  if (!Number.isFinite(nextHours) || nextHours < 1 || nextHours > 720) {
    showToast("Invalid input", "Checkout due limit must be between 1 and 720 hours.");
    return;
  }

  isSaving.value = true;
  try {
    const saved = await updateTenantSettings({ checkout_due_hours: Math.round(nextHours) });
    applySettings(saved);
    success.value = "Settings saved.";
    showToast("Saved", "Tenant settings updated.");
  } catch (err) {
    error.value = err instanceof Error ? err.message : "Unable to save tenant settings.";
    showToast("Save failed", error.value);
  } finally {
    isSaving.value = false;
  }
};

onMounted(() => {
  void loadSettings();
});

onUnmounted(() => {
  if (toastTimer) {
    window.clearTimeout(toastTimer);
    toastTimer = null;
  }
});
</script>

<style scoped></style>
