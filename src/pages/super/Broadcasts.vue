<template>
  <div class="page">
    <div class="page-nav-left">
      <RouterLink class="button-link" to="/super-admin">Return to Super Admin</RouterLink>
      <RouterLink class="button-link" to="/super-admin/tenants">Tenants</RouterLink>
      <RouterLink class="button-link" to="/super-admin/admins">Tenant Admins</RouterLink>
      <RouterLink class="button-link" to="/super-admin/gear">All Gear</RouterLink>
      <RouterLink class="button-link" to="/super-admin/students">All Students</RouterLink>
      <RouterLink class="button-link" to="/super-admin/logs">All Logs</RouterLink>
    </div>

    <h1>Broadcasts</h1>
    <p>Push a message banner to all signed-in users until they dismiss it.</p>

    <div class="card">
      <h2>Broadcast Message</h2>
      <form class="form" @submit.prevent="saveBroadcast">
        <label>
          Message
          <textarea
            v-model="message"
            rows="4"
            maxlength="500"
            placeholder="System maintenance starts at 9 PM ET."
          />
        </label>
        <label>
          Severity
          <select v-model="level">
            <option value="info">info</option>
            <option value="warning">warning</option>
            <option value="critical">critical</option>
          </select>
        </label>
        <label>
          Enabled
          <select v-model="enabled">
            <option :value="true">true</option>
            <option :value="false">false</option>
          </select>
        </label>
        <div class="form-actions">
          <button type="submit" class="button-primary" :disabled="isSaving">Save Broadcast</button>
          <button type="button" :disabled="isSaving" @click="clearBroadcast">Disable Broadcast</button>
        </div>
      </form>
      <p class="muted" v-if="lastUpdated">Last updated: {{ formatDateTime(lastUpdated) }}</p>
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
import { getControlCenter, setRuntimeConfig } from "../../services/superOpsService";

const message = ref("");
const level = ref<"info" | "warning" | "critical">("info");
const enabled = ref(true);
const isSaving = ref(false);
const lastUpdated = ref("");
const toastTitle = ref("");
const toastMessage = ref("");
let toastTimer: number | null = null;

const showToast = (title: string, body: string) => {
  toastTitle.value = title;
  toastMessage.value = body;
  if (toastTimer) {
    window.clearTimeout(toastTimer);
  }
  toastTimer = window.setTimeout(() => {
    toastTitle.value = "";
    toastMessage.value = "";
    toastTimer = null;
  }, 4000);
};

const formatDateTime = (value: string) => {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString();
};

const loadCurrent = async () => {
  try {
    const data = await getControlCenter();
    const raw = (data.runtime_config?.broadcast_message ?? {}) as Record<string, unknown>;
    message.value = typeof raw.message === "string" ? raw.message : "";
    level.value =
      raw.level === "warning" || raw.level === "critical" ? raw.level : "info";
    enabled.value = raw.enabled === true;
    lastUpdated.value = typeof raw.updated_at === "string" ? raw.updated_at : "";
  } catch (err) {
    showToast("Load failed", err instanceof Error ? err.message : "Unable to load broadcast settings.");
  }
};

const saveBroadcast = async () => {
  if (enabled.value && !message.value.trim()) {
    showToast("Invalid input", "Enter a message or disable the broadcast.");
    return;
  }

  isSaving.value = true;
  try {
    const nowIso = new Date().toISOString();
    await setRuntimeConfig({
      key: "broadcast_message",
      value: {
        enabled: enabled.value,
        message: message.value.trim(),
        level: level.value,
        updated_at: nowIso,
      },
    });
    lastUpdated.value = nowIso;
    showToast("Saved", "Broadcast settings updated.");
  } catch (err) {
    showToast("Save failed", err instanceof Error ? err.message : "Unable to save broadcast settings.");
  } finally {
    isSaving.value = false;
  }
};

const clearBroadcast = async () => {
  isSaving.value = true;
  try {
    const nowIso = new Date().toISOString();
    await setRuntimeConfig({
      key: "broadcast_message",
      value: {
        enabled: false,
        message: "",
        level: "info",
        updated_at: nowIso,
      },
    });
    enabled.value = false;
    message.value = "";
    level.value = "info";
    lastUpdated.value = nowIso;
    showToast("Disabled", "Broadcast disabled.");
  } catch (err) {
    showToast("Action failed", err instanceof Error ? err.message : "Unable to disable broadcast.");
  } finally {
    isSaving.value = false;
  }
};

onMounted(() => {
  void loadCurrent();
});

onUnmounted(() => {
  if (toastTimer) {
    window.clearTimeout(toastTimer);
    toastTimer = null;
  }
});
</script>
