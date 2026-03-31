<template>
  <div class="page admin-shell">
    <div class="admin-hero">
      <div class="page-nav-left">
        <RouterLink class="button-link" to="/tenant/admin">Return to admin panel</RouterLink>
      </div>
      <h1>Settings</h1>
      <p class="admin-hero-copy">Configure checkout defaults and manage active admin sessions from one place.</p>
      <div class="admin-summary-grid">
        <div class="admin-summary-card">
          <strong>{{ checkoutDueHours }}</strong>
          <span>Due window (hours)</span>
        </div>
        <div class="admin-summary-card">
          <strong>{{ accountCategoryLabel }}</strong>
          <span>Account category</span>
        </div>
        <div class="admin-summary-card">
          <strong>{{ planLabel }}</strong>
          <span>Plan</span>
        </div>
        <div class="admin-summary-card">
          <strong>{{ sessions.length }}</strong>
          <span>Active devices</span>
        </div>
      </div>
    </div>

    <div class="card admin-section-card">
      <div class="admin-section-header">
        <div>
          <h2>Account Overview</h2>
          <p class="admin-section-copy">Review how this workspace is classified for billing and support.</p>
        </div>
        <RouterLink class="button-link" to="/tenant/admin/admins">Admin Access</RouterLink>
      </div>
      <div class="admin-summary-grid">
        <div class="admin-summary-card">
          <strong>{{ accountCategoryLabel }}</strong>
          <span>Workspace type</span>
        </div>
        <div class="admin-summary-card">
          <strong>{{ planLabel }}</strong>
          <span>Assigned plan</span>
        </div>
      </div>
      <p class="muted">
        {{
          accountCategory === "individual"
            ? "This account uses the root ItemTraxx url and is not attached to a custom subdomain."
            : accountCategory === "organization"
              ? "Organization-linked accounts inherit their routing and billing context from tenant configuration."
              : "Account plan metadata has not been configured for this tenant yet. If you believe this is an error, please contact support to resolve this."
        }}
      </p>
    </div>

    <div class="card admin-section-card">
      <div class="admin-section-header">
        <div>
          <h2>Checkout Policy</h2>
          <p class="admin-section-copy">Set the default checkout due window.</p>
        </div>
      </div>
      <form class="form" @submit.prevent="handleSave">
        <label>
          Checkout due limit (hours)
          <input v-model.number="checkoutDueHours" type="number" min="1" max="720" step="1" />
        </label>
        <p class="muted">This value is used for overdue notifications.</p>
        <div class="form-actions">
          <button type="submit" class="button-primary" :disabled="isSaving">Save settings</button>
          <button type="button" :disabled="isSaving" @click="loadSettings">Reload</button>
        </div>
      </form>
      <p v-if="error" class="error">{{ error }}</p>
      <p v-if="success" class="success">{{ success }}</p>
    </div>

    <div class="card admin-section-card">
      <div class="admin-section-header">
        <div>
          <h2>Active Devices</h2>
          <p class="admin-section-copy">Review active sessions for your account and remotely sign out devices.</p>
        </div>
      </div>
      <div class="table-wrap">
        <table class="table">
          <thead>
            <tr>
              <th>Device</th>
              <th>Login method</th>
              <th>Login location</th>
              <th>Last seen</th>
              <th>Signed in</th>
              <th>Status</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="session in sessions" :key="session.id">
              <td>{{ session.device_label || "Unknown device" }}</td>
              <td>{{ formatLoginMethod(session.login_method) }}</td>
              <td>{{ formatLoginLocation(session.login_location) }}</td>
              <td>{{ formatDate(session.last_seen_at) }}</td>
              <td>{{ formatDate(session.created_at) }}</td>
              <td>{{ session.is_current ? "Current" : "Active" }}</td>
            </tr>
            <tr v-if="!sessions.length">
              <td colspan="6" class="muted">No active sessions found.</td>
            </tr>
          </tbody>
        </table>
      </div>
      <div class="form-actions">
        <label class="session-select">
          Select device
          <select v-model="selectedSessionId">
            <option value="">Choose a device</option>
            <option
              v-for="session in removableSessions"
              :key="session.id"
              :value="session.id"
            >
              {{ session.device_label || "Unknown device" }} — {{ formatDate(session.last_seen_at) }}
            </option>
          </select>
        </label>
      </div>
      <div class="form-actions">
        <button
          type="button"
          :disabled="isSessionSaving || !selectedSessionId"
          @click="handleSignOutSelected"
        >
          Sign out selected device
        </button>
        <button
          type="button"
          :disabled="isSessionSaving || !removableSessions.length"
          @click="handleSignOutAllOthers"
        >
          Sign out all other devices
        </button>
      </div>
      <p v-if="sessionError" class="error">{{ sessionError }}</p>
      <p v-if="sessionSuccess" class="success">{{ sessionSuccess }}</p>
    </div>

    <div v-if="toastMessage" class="toast">
      <div class="toast-title">{{ toastTitle }}</div>
      <div class="toast-body">{{ toastMessage }}</div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref } from "vue";
import { RouterLink } from "vue-router";
import { toUserFacingErrorMessage } from "../../../services/appErrors";
import {
  fetchTenantSettings,
  listTenantAdminSessions,
  revokeAllTenantAdminSessions,
  revokeTenantAdminSession,
  type TenantSessionItem,
  updateTenantSettings,
  type TenantSettingsPayload,
} from "../../../services/adminOpsService";

const isSaving = ref(false);
const error = ref("");
const success = ref("");
const checkoutDueHours = ref(72);
const accountCategory = ref<"organization" | "district" | "individual" | null>(null);
const planCode = ref<
  | "core"
  | "growth"
  | "starter"
  | "scale"
  | "enterprise"
  | "individual_yearly"
  | "individual_monthly"
  | null
>(null);
const sessions = ref<TenantSessionItem[]>([]);
const selectedSessionId = ref("");
const isSessionSaving = ref(false);
const sessionError = ref("");
const sessionSuccess = ref("");
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
  accountCategory.value =
    settings.account_category === "individual"
      ? "individual"
      : settings.account_category === "district"
        ? "district"
      : settings.account_category === "organization"
        ? "organization"
        : null;
  planCode.value = settings.plan_code ?? null;
};

const formatLoginMethod = (value: TenantSessionItem["login_method"]) =>
  value === "password"
    ? "Password"
    : value === "magic_link"
      ? "Magic link"
      : value === "session_handoff"
        ? "Session handoff"
        : "Unknown";

const formatLoginLocation = (value: TenantSessionItem["login_location"]) =>
  value === "regular_login"
    ? "Regular login"
    : value === "admin_login"
      ? "Admin sign in"
      : "Unknown";

const accountCategoryLabel = computed(() =>
  accountCategory.value === "individual"
    ? "Individual"
    : accountCategory.value === "district"
      ? "District"
    : accountCategory.value === "organization"
      ? "Organization"
      : "Unavailable"
);

const planLabel = computed(() => {
  switch (planCode.value) {
    case "core":
      return "Core";
    case "growth":
      return "Growth";
    case "starter":
      return "Starter";
    case "scale":
      return "Scale";
    case "enterprise":
      return "Enterprise";
    case "individual_yearly":
      return "Individual Yearly";
    case "individual_monthly":
      return "Individual Monthly";
    default:
      return "Unavailable";
  }
});

const removableSessions = computed(() =>
  sessions.value.filter((session) => !session.is_current)
);

const formatDate = (value: string) => {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "Unknown";
  return date.toLocaleString();
};

const loadSessions = async () => {
  sessionError.value = "";
  sessionSuccess.value = "";
  try {
    const data = await listTenantAdminSessions();
    sessions.value = data.sessions ?? [];
    if (selectedSessionId.value && !sessions.value.some((row) => row.id === selectedSessionId.value)) {
      selectedSessionId.value = "";
    }
  } catch (err) {
    sessionError.value = toUserFacingErrorMessage(err, "Unable to load sessions.");
  }
};

const loadSettings = async () => {
  error.value = "";
  success.value = "";
  try {
    const settings = await fetchTenantSettings();
    applySettings(settings);
  } catch (err) {
    error.value = toUserFacingErrorMessage(err, "Unable to load tenant settings.");
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
    error.value = toUserFacingErrorMessage(err, "Unable to save tenant settings.");
    showToast("Save failed", error.value);
  } finally {
    isSaving.value = false;
  }
};

const handleSignOutSelected = async () => {
  if (!selectedSessionId.value) return;
  isSessionSaving.value = true;
  sessionError.value = "";
  sessionSuccess.value = "";
  try {
    await revokeTenantAdminSession(selectedSessionId.value);
    selectedSessionId.value = "";
    sessionSuccess.value = "Selected device signed out.";
    showToast("Session revoked", "Selected device has been signed out.");
    await loadSessions();
  } catch (err) {
    sessionError.value = toUserFacingErrorMessage(err, "Unable to sign out selected device.");
  } finally {
    isSessionSaving.value = false;
  }
};

const handleSignOutAllOthers = async () => {
  isSessionSaving.value = true;
  sessionError.value = "";
  sessionSuccess.value = "";
  try {
    await revokeAllTenantAdminSessions(false);
    selectedSessionId.value = "";
    sessionSuccess.value = "All other devices signed out.";
    showToast("Sessions revoked", "All other devices have been signed out.");
    await loadSessions();
  } catch (err) {
    sessionError.value = toUserFacingErrorMessage(err, "Unable to sign out all other devices.");
  } finally {
    isSessionSaving.value = false;
  }
};

onMounted(() => {
  void loadSettings();
  void loadSessions();
});

onUnmounted(() => {
  if (toastTimer) {
    window.clearTimeout(toastTimer);
    toastTimer = null;
  }
});
</script>

<style scoped></style>
