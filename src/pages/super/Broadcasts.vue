<template>
  <div class="page">
    <div class="page-nav-left">
      <RouterLink class="button-link" to="/super-admin">Return to Super Admin</RouterLink>
      <RouterLink class="button-link" to="/super-admin/tenants">Tenants</RouterLink>
      <RouterLink class="button-link" to="/super-admin/admins">Tenant Admins</RouterLink>
      <RouterLink class="button-link" to="/super-admin/gear">All Items</RouterLink>
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

    <div class="card">
      <h2>Tenant Notification Update</h2>
      <form class="form" @submit.prevent="saveTenantUpdate">
        <label>
          Title
          <input v-model="updateTitle" type="text" maxlength="80" placeholder="What changed?" />
        </label>
        <label>
          Message
          <textarea
            v-model="updateMessage"
            rows="3"
            maxlength="240"
            placeholder="Short update shown in tenant notification bell."
          />
        </label>
        <label>
          Severity
          <select v-model="updateLevel">
            <option value="info">info</option>
            <option value="warning">warning</option>
            <option value="critical">critical</option>
          </select>
        </label>
        <label>
          Optional link
          <input v-model="updateLinkUrl" type="url" placeholder="https://statuspage.incident.io/itemtraxx-status" />
        </label>
        <div class="form-actions">
          <button type="submit" class="button-primary" :disabled="isSaving">Publish Update</button>
          <button type="button" :disabled="isSaving" @click="clearTenantUpdates">Clear Updates</button>
        </div>
      </form>
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
const updateTitle = ref("");
const updateMessage = ref("");
const updateLevel = ref<"info" | "warning" | "critical">("info");
const updateLinkUrl = ref("");
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

const saveTenantUpdate = async () => {
  if (!updateMessage.value.trim()) {
    showToast("Invalid input", "Enter an update message.");
    return;
  }

  isSaving.value = true;
  try {
    const nowIso = new Date().toISOString();
    await setRuntimeConfig({
      key: "tenant_updates",
      value: {
        enabled: true,
        items: [
          {
            id: nowIso,
            title: updateTitle.value.trim() || "Product update",
            message: updateMessage.value.trim(),
            level: updateLevel.value,
            link_url: updateLinkUrl.value.trim() || null,
            created_at: nowIso,
          },
        ],
        updated_at: nowIso,
      },
    });
    showToast("Published", "Tenant notification update published.");
    updateTitle.value = "";
    updateMessage.value = "";
    updateLevel.value = "info";
    updateLinkUrl.value = "";
  } catch (err) {
    showToast("Save failed", err instanceof Error ? err.message : "Unable to publish update.");
  } finally {
    isSaving.value = false;
  }
};

const clearTenantUpdates = async () => {
  isSaving.value = true;
  try {
    await setRuntimeConfig({
      key: "tenant_updates",
      value: {
        enabled: false,
        items: [],
        updated_at: new Date().toISOString(),
      },
    });
    showToast("Cleared", "Tenant notification updates cleared.");
  } catch (err) {
    showToast("Action failed", err instanceof Error ? err.message : "Unable to clear tenant updates.");
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
