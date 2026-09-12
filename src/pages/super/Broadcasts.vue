<template>
  <main class="page">
    <div class="page-nav">
      <RouterLink to="/super-admin" class="sa-back-link">&larr; Back to Control Center</RouterLink>
      <div class="page-nav-quick">
        <RouterLink to="/super-admin/workspaces" class="sa-btn">Workspaces</RouterLink>
        <RouterLink to="/super-admin/admins" class="sa-btn">Tenant Admins</RouterLink>
        <RouterLink to="/super-admin/items" class="sa-btn">All Items</RouterLink>
        <RouterLink to="/super-admin/borrowers" class="sa-btn">All Borrowers</RouterLink>
        <RouterLink to="/super-admin/logs" class="sa-btn">All Logs</RouterLink>
        <RouterLink to="/super-admin/sales-leads" class="sa-btn">Sales Leads</RouterLink>
        <RouterLink to="/super-admin/customers" class="sa-btn">Customers</RouterLink>
      </div>
    </div>

    <div class="sa-toolbar">
      <div>
        <h1 class="sa-toolbar-title">Broadcasts</h1>
        <p class="sa-toolbar-sub">Push a message banner to all users until they dismiss it.</p>
      </div>
    </div>

    <section class="sa-panel">
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
        <div class="panel-actions">
          <button type="submit" class="sa-btn primary" :disabled="isSaving">Save Broadcast</button>
          <button type="button" class="sa-btn" :disabled="isSaving" @click="clearBroadcast">Disable Broadcast</button>
        </div>
      </form>
      <p class="form-meta" v-if="lastUpdated">Last updated: {{ formatDateTime(lastUpdated) }}</p>
    </section>

    <section class="sa-panel">
      <h2>Tenant Notification Update</h2>
      <form class="form" @submit.prevent="saveWorkspaceUpdate">
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
            placeholder="Short update shown in workspace notification bell."
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
          <input v-model="updateLinkUrl" type="url" placeholder="https://status.itemtraxx.com/" />
        </label>
        <div class="panel-actions">
          <button type="submit" class="sa-btn primary" :disabled="isSaving">Publish Update</button>
          <button type="button" class="sa-btn" :disabled="isSaving" @click="clearWorkspaceUpdates">Clear Updates</button>
        </div>
      </form>
    </section>

    <div v-if="toastMessage" class="toast">
      <div class="toast-title">{{ toastTitle }}</div>
      <div class="toast-body">{{ toastMessage }}</div>
    </div>
  </main>
</template>

<script setup lang="ts">
import { onMounted, onUnmounted, ref } from "vue";
import { RouterLink } from "vue-router";
import { getControlCenter, setRuntimeConfig } from "../../services/superOps/controlCenter";
import { toUserFacingErrorMessage } from "../../services/appErrors";

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
    showToast("Load failed", toUserFacingErrorMessage(err, "Unable to load broadcast settings."));
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
    showToast("Save failed", toUserFacingErrorMessage(err, "Unable to save broadcast settings."));
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
    showToast("Action failed", toUserFacingErrorMessage(err, "Unable to disable broadcast."));
  } finally {
    isSaving.value = false;
  }
};

const saveWorkspaceUpdate = async () => {
  if (!updateMessage.value.trim()) {
    showToast("Invalid input", "Enter an update message.");
    return;
  }

  isSaving.value = true;
  try {
    const nowIso = new Date().toISOString();
    await setRuntimeConfig({
      key: "workspace_updates",
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
    showToast("Save failed", toUserFacingErrorMessage(err, "Unable to publish update."));
  } finally {
    isSaving.value = false;
  }
};

const clearWorkspaceUpdates = async () => {
  isSaving.value = true;
  try {
    await setRuntimeConfig({
      key: "workspace_updates",
      value: {
        enabled: false,
        items: [],
        updated_at: new Date().toISOString(),
      },
    });
    showToast("Cleared", "Tenant notification updates cleared.");
  } catch (err) {
    showToast("Action failed", toUserFacingErrorMessage(err, "Unable to clear workspace updates."));
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

<style scoped>
.page {
  max-width: 1000px;
  margin: 0 auto;
  padding: 2rem;
}

.page-nav {
  margin-bottom: 1.5rem;
}

.page-nav-quick {
  display: flex;
  gap: 0.5rem;
  flex-wrap: wrap;
  margin-top: 0.75rem;
}

.panel-actions {
  display: flex;
  gap: 0.5rem;
  margin-top: 1rem;
}

.form {
  display: grid;
  gap: 1rem;
}

.form label {
  display: grid;
  gap: 0.35rem;
  font-size: 0.85rem;
}

.form input,
.form textarea,
.form select {
  font: inherit;
  padding: 0.5rem;
  border: 1px solid var(--border);
  border-radius: 6px;
  background: var(--surface);
  color: var(--text);
}

.form textarea {
  resize: vertical;
}

.form-meta {
  font-size: 0.8rem;
  color: var(--muted);
  margin-top: 0.75rem;
}

.toast {
  position: fixed;
  bottom: 1rem;
  right: 1rem;
  border: 1px solid var(--border);
  border-radius: 8px;
  padding: 1rem;
  background: var(--surface);
  box-shadow: 0 2px 8px rgba(0, 0, 0, 0.1);
  z-index: 50;
  max-width: 300px;
}

.toast-title {
  font-weight: 600;
  font-size: 0.85rem;
  margin-bottom: 0.25rem;
}

.toast-body {
  font-size: 0.8rem;
  color: var(--muted);
}
</style>
