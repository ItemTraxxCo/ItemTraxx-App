<template>
  <div class="page admin-shell">
    <div class="admin-hero">
      <div class="page-nav-left">
        <RouterLink class="button-link" to="/admin">Return to admin panel</RouterLink>
      </div>
      <h1>Settings</h1>
      <p class="admin-hero-copy">Configure checkout defaults and manage active admin sessions from one place.</p>
      <div class="admin-summary-grid">
        <div class="admin-summary-card">
          <strong>{{ checkoutDueHours }}</strong>
          <span>Due window (hours)</span>
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
        <RouterLink class="button-link" to="/admin/admins">Admin Access</RouterLink>
      </div>
      <div class="admin-summary-grid">
        <div class="admin-summary-card">
          <strong>{{ accountCategoryLabel }}</strong>
          <span>Account Category</span>
        </div>
        <div class="admin-summary-card">
          <strong>{{ planLabel }}</strong>
          <span>Assigned plan</span>
        </div>
      </div>
      <p class="muted account-overview-copy">
        {{
          accountCategory === "individual"
            ? "This account uses the root ItemTraxx url and is not attached to a custom subdomain."
            : accountCategory === "workspace" || accountCategory === "education" || accountCategory === "custom"
              ? "Workspace-linked accounts inherit their routing and billing context from tenant configuration."
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
              <th>Login flow</th>
              <th>Location</th>
              <th>Last seen</th>
              <th>Signed in</th>
              <th>Status</th>
              <th class="session-actions-header">Actions</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="session in sessions" :key="session.id">
              <td>{{ session.device_label || "Unknown device" }}</td>
              <td>{{ formatLoginMethod(session.login_method) }}</td>
              <td>{{ formatLoginLocation(session.login_location) }}</td>
              <td>{{ formatGeneralLocation(session.general_location) }}</td>
              <td>{{ formatDate(session.last_seen_at) }}</td>
              <td>{{ formatDate(session.created_at) }}</td>
              <td>{{ session.is_current ? "Current" : "Active" }}</td>
              <td class="session-actions-cell">
                <div v-if="!session.is_current" class="session-actions">
                  <button
                    type="button"
                    class="session-menu-trigger"
                    :aria-label="`Open actions for ${session.device_label || 'Unknown device'}`"
                    aria-haspopup="menu"
                    :aria-expanded="openSessionMenuId === session.id"
                    :aria-controls="`session-menu-${session.id}`"
                    :disabled="isSessionSaving"
                    @click.stop="toggleSessionMenu(session.id)"
                    @keydown.esc.stop="closeSessionMenu"
                  >
                    <svg viewBox="0 0 20 20" aria-hidden="true">
                      <circle cx="10" cy="4" r="1.5" />
                      <circle cx="10" cy="10" r="1.5" />
                      <circle cx="10" cy="16" r="1.5" />
                    </svg>
                  </button>
                  <div
                    v-if="openSessionMenuId === session.id"
                    :id="`session-menu-${session.id}`"
                    class="session-menu"
                    role="menu"
                    @click.stop
                  >
                    <button
                      type="button"
                      class="session-menu-item session-menu-item--danger"
                      role="menuitem"
                      :disabled="isSessionSaving"
                      @click="handleRevokeSession(session)"
                    >
                      Revoke device
                    </button>
                  </div>
                </div>
                <span v-else class="session-current-action">This device</span>
              </td>
            </tr>
            <tr v-if="!sessions.length">
              <td colspan="8" class="muted">No active sessions found.</td>
            </tr>
          </tbody>
        </table>
      </div>
      <div class="form-actions session-bulk-actions">
        <button
          type="button"
          class="session-bulk-revoke"
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
  fetchWorkspaceSettings,
  listAccountSessions,
  revokeAllAccountSessions,
  revokeAccountSession,
  type AccountSessionItem,
  updateWorkspaceSettings,
  type WorkspaceSettingsPayload,
} from "../../../services/adminOpsService";

const isSaving = ref(false);
const error = ref("");
const success = ref("");
const checkoutDueHours = ref(72);
const accountCategory = ref<"workspace" | "education" | "custom" | "individual" | null>(null);
const planCode = ref<
  | "workspace_core"
  | "workspace_growth"
  | "workspace_enterprise"
  | "education"
  | "custom"
  | "individual_yearly"
  | "individual_monthly"
  | null
>(null);
const sessions = ref<AccountSessionItem[]>([]);
const openSessionMenuId = ref<string | null>(null);
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

const applySettings = (settings: WorkspaceSettingsPayload) => {
  checkoutDueHours.value = settings.checkout_due_hours;
  accountCategory.value =
    settings.account_category === "individual"
      ? "individual"
      : settings.account_category === "education"
        ? "education"
      : settings.account_category === "custom"
        ? "custom"
      : settings.account_category === "workspace"
        ? "workspace"
        : null;
  planCode.value = settings.plan_code ?? null;
};

const formatLoginMethod = (value: AccountSessionItem["login_method"]) =>
  value === "password"
    ? "Password"
    : value === "magic_link"
      ? "Magic link"
      : value === "session_handoff"
        ? "Session handoff"
        : "Unknown";

const formatLoginLocation = (value: AccountSessionItem["login_location"]) =>
  value === "regular_login"
    ? "Regular login"
    : value === "admin_login"
      ? "Admin sign in"
      : "Unknown";

const formatGeneralLocation = (value: AccountSessionItem["general_location"]) =>
  value?.trim() ? value : "Unknown";

const accountCategoryLabel = computed(() =>
  accountCategory.value === "individual"
    ? "Individual"
    : accountCategory.value === "education"
      ? "Education"
    : accountCategory.value === "custom"
      ? "Custom"
    : accountCategory.value === "workspace"
      ? "Workspace"
      : "Unavailable"
);

const planLabel = computed(() => {
  switch (planCode.value) {
    case "workspace_core":
      return "Workspace Core";
    case "workspace_growth":
      return "Workspace Growth";
    case "workspace_enterprise":
      return "Workspace Enterprise";
    case "education":
      return "Education";
    case "custom":
      return "Custom";
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

const closeSessionMenu = () => {
  openSessionMenuId.value = null;
};

const toggleSessionMenu = (sessionId: string) => {
  if (isSessionSaving.value) return;
  openSessionMenuId.value = openSessionMenuId.value === sessionId ? null : sessionId;
};

const handleSessionMenuKeydown = (event: KeyboardEvent) => {
  if (event.key === "Escape") closeSessionMenu();
};

const formatDate = (value: string) => {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "Unknown";
  return date.toLocaleString();
};

const loadSessions = async () => {
  sessionError.value = "";
  sessionSuccess.value = "";
  try {
    const data = await listAccountSessions();
    sessions.value = data.sessions ?? [];
    if (openSessionMenuId.value && !sessions.value.some((row) => row.id === openSessionMenuId.value)) {
      closeSessionMenu();
    }
  } catch (err) {
    sessionError.value = toUserFacingErrorMessage(err, "Unable to load sessions.");
  }
};

const loadSettings = async () => {
  error.value = "";
  success.value = "";
  try {
    const settings = await fetchWorkspaceSettings();
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
    const saved = await updateWorkspaceSettings({ checkout_due_hours: Math.round(nextHours) });
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

const handleRevokeSession = async (session: AccountSessionItem) => {
  if (isSessionSaving.value) return;
  closeSessionMenu();
  const deviceLabel = session.device_label || "this device";
  if (!window.confirm(`Revoke ${deviceLabel}? This device will be signed out.`)) return;
  isSessionSaving.value = true;
  sessionError.value = "";
  sessionSuccess.value = "";
  try {
    await revokeAccountSession(session.id);
    showToast("Session revoked", "Selected device has been signed out.");
    await loadSessions();
    if (!sessionError.value) sessionSuccess.value = "Device revoked.";
  } catch (err) {
    sessionError.value = toUserFacingErrorMessage(err, "Unable to revoke device.");
  } finally {
    isSessionSaving.value = false;
  }
};

const handleSignOutAllOthers = async () => {
  if (!removableSessions.value.length) return;
  if (!window.confirm("Sign out all other devices? This will end every other active session.")) return;
  isSessionSaving.value = true;
  sessionError.value = "";
  sessionSuccess.value = "";
  try {
    await revokeAllAccountSessions(false);
    showToast("Sessions revoked", "All other devices have been signed out.");
    await loadSessions();
    if (!sessionError.value) sessionSuccess.value = "All other devices signed out.";
  } catch (err) {
    sessionError.value = toUserFacingErrorMessage(err, "Unable to sign out all other devices.");
  } finally {
    isSessionSaving.value = false;
  }
};

onMounted(() => {
  document.addEventListener("click", closeSessionMenu);
  document.addEventListener("keydown", handleSessionMenuKeydown);
  void loadSettings();
  void loadSessions();
});

onUnmounted(() => {
  document.removeEventListener("click", closeSessionMenu);
  document.removeEventListener("keydown", handleSessionMenuKeydown);
  if (toastTimer) {
    window.clearTimeout(toastTimer);
    toastTimer = null;
  }
});
</script>

<style scoped>
.account-overview-copy {
  font-size: 0.82rem;
  color: var(--muted);
}

.session-actions-header,
.session-actions-cell {
  text-align: right;
  white-space: nowrap;
}

.session-actions-cell {
  width: 1%;
}

.session-actions {
  position: relative;
  display: flex;
  justify-content: flex-end;
}

.session-menu-trigger {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 2.25rem;
  height: 2.25rem;
  padding: 0;
  border: 1px solid var(--border);
  border-radius: 999px;
  background: transparent;
  color: var(--muted);
  cursor: pointer;
  transition: border-color 150ms ease, background-color 150ms ease, color 150ms ease;
}

.session-menu-trigger:hover:not(:disabled),
.session-menu-trigger:focus-visible {
  border-color: var(--text);
  background: var(--surface-2);
  color: var(--text);
}

.session-menu-trigger:disabled {
  cursor: wait;
  opacity: 0.55;
}

.session-menu-trigger svg {
  width: 1.1rem;
  height: 1.1rem;
  fill: currentColor;
}

.session-menu {
  position: absolute;
  z-index: 20;
  top: calc(100% + 0.35rem);
  right: 0;
  min-width: 9.5rem;
  padding: 0.35rem;
  border: 1px solid var(--border);
  border-radius: 0.75rem;
  background: var(--surface);
}

.session-menu-item {
  width: 100%;
  padding: 0.55rem 0.65rem;
  border: 0;
  border-radius: 0.5rem;
  background: transparent;
  font: inherit;
  text-align: left;
  cursor: pointer;
}

.session-menu-item--danger {
  color: var(--danger);
}

.session-menu-item--danger:hover:not(:disabled),
.session-menu-item--danger:focus-visible {
  background: color-mix(in srgb, var(--danger) 12%, transparent);
}

.session-menu-item:disabled {
  cursor: wait;
  opacity: 0.55;
}

.session-current-action {
  color: var(--muted);
  font-size: 0.8rem;
}

.session-bulk-actions {
  justify-content: flex-end;
  margin-top: 0;
}

.session-bulk-revoke {
  color: var(--danger);
  border-color: color-mix(in srgb, var(--danger) 46%, var(--button-border) 54%);
}

.session-bulk-revoke:hover:not(:disabled) {
  color: var(--danger);
  border-color: var(--danger);
  background: color-mix(in srgb, var(--danger) 10%, var(--surface-2) 90%);
}
</style>
