<template>
  <main class="page admin-shell">
    <header class="admin-hero">
      <div class="page-nav-left">
        <RouterLink class="button-link" to="/admin">Return to workspace home</RouterLink>
      </div>
      <h1>Account Settings</h1>
      <p class="admin-hero-copy">Manage security and active sessions for your account.</p>
      <p>
        <RouterLink class="button-link" to="/account/security">Account Security</RouterLink>
        ·
        <RouterLink class="button-link" to="/settings/organization">Workspace Settings</RouterLink>
      </p>
      <div class="admin-summary-grid">
        <div class="admin-summary-card">
          <strong>{{ sessions.length }}</strong>
          <span>Active devices</span>
        </div>
      </div>
    </header>

    <section class="card admin-section-card">
      <div class="admin-section-header">
        <div>
          <h2>Active Devices</h2>
          <p class="admin-section-copy">Review active sessions and sign out devices you no longer use.</p>
        </div>
        <button type="button" :disabled="isLoading" @click="loadSessions">Reload</button>
      </div>

      <p v-if="sessionError" class="error" role="alert">{{ sessionError }}</p>
      <p v-if="sessionSuccess" class="success" role="status">{{ sessionSuccess }}</p>

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
                    :disabled="isSaving"
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
                      :disabled="isSaving"
                      @click="revokeSession(session)"
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
          :disabled="isSaving || !removableSessions.length"
          @click="revokeOtherSessions"
        >
          Sign out all other devices
        </button>
      </div>
    </section>

    <div v-if="toastMessage" class="toast">
      <div class="toast-title">{{ toastTitle }}</div>
      <div class="toast-body">{{ toastMessage }}</div>
    </div>
  </main>
</template>

<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref } from "vue";
import { RouterLink } from "vue-router";
import { toUserFacingErrorMessage } from "../../../services/appErrors";
import {
  listAccountSessions,
  revokeAccountSession,
  revokeAllAccountSessions,
  type AccountSessionItem,
} from "../../../services/adminOpsService";

const sessions = ref<AccountSessionItem[]>([]);
const isLoading = ref(false);
const isSaving = ref(false);
const sessionError = ref("");
const sessionSuccess = ref("");
const openSessionMenuId = ref<string | null>(null);
const toastTitle = ref("");
const toastMessage = ref("");
let toastTimer: number | null = null;

const removableSessions = computed(() => sessions.value.filter((session) => !session.is_current));

const showToast = (title: string, message: string) => {
  toastTitle.value = title;
  toastMessage.value = message;
  if (toastTimer) window.clearTimeout(toastTimer);
  toastTimer = window.setTimeout(() => {
    toastTitle.value = "";
    toastMessage.value = "";
    toastTimer = null;
  }, 4000);
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

const formatDate = (value: string) => {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "Unknown" : date.toLocaleString();
};

const closeSessionMenu = () => {
  openSessionMenuId.value = null;
};

const toggleSessionMenu = (sessionId: string) => {
  if (isSaving.value) return;
  openSessionMenuId.value = openSessionMenuId.value === sessionId ? null : sessionId;
};

const handleSessionMenuKeydown = (event: KeyboardEvent) => {
  if (event.key === "Escape") closeSessionMenu();
};

const loadSessions = async () => {
  if (isLoading.value) return;
  isLoading.value = true;
  sessionError.value = "";
  sessionSuccess.value = "";
  try {
    const data = await listAccountSessions();
    sessions.value = data.sessions ?? [];
    if (openSessionMenuId.value && !sessions.value.some((session) => session.id === openSessionMenuId.value)) {
      closeSessionMenu();
    }
  } catch (error) {
    sessions.value = [];
    closeSessionMenu();
    sessionError.value = toUserFacingErrorMessage(error, "Unable to load active sessions.");
  } finally {
    isLoading.value = false;
  }
};

const revokeSession = async (session: AccountSessionItem) => {
  if (isSaving.value || session.is_current) return;
  closeSessionMenu();
  const deviceLabel = session.device_label || "this device";
  if (!window.confirm(`Revoke ${deviceLabel}? This device will be signed out.`)) return;
  isSaving.value = true;
  sessionError.value = "";
  sessionSuccess.value = "";
  try {
    await revokeAccountSession(session.id);
    showToast("Session revoked", "Selected device has been signed out.");
    await loadSessions();
    if (!sessionError.value) sessionSuccess.value = "Device revoked.";
  } catch (error) {
    sessionError.value = toUserFacingErrorMessage(error, "Unable to revoke this device.");
  } finally {
    isSaving.value = false;
  }
};

const revokeOtherSessions = async () => {
  if (isSaving.value || !removableSessions.value.length) return;
  if (!window.confirm("Sign out all other devices? This will end every other active session.")) return;
  isSaving.value = true;
  sessionError.value = "";
  sessionSuccess.value = "";
  try {
    await revokeAllAccountSessions(false);
    showToast("Sessions revoked", "All other devices have been signed out.");
    await loadSessions();
    if (!sessionError.value) sessionSuccess.value = "All other devices signed out.";
  } catch (error) {
    sessionError.value = toUserFacingErrorMessage(error, "Unable to sign out other devices.");
  } finally {
    isSaving.value = false;
  }
};

onMounted(() => {
  document.addEventListener("click", closeSessionMenu);
  document.addEventListener("keydown", handleSessionMenuKeydown);
  void loadSessions();
});

onUnmounted(() => {
  document.removeEventListener("click", closeSessionMenu);
  document.removeEventListener("keydown", handleSessionMenuKeydown);
  if (toastTimer) window.clearTimeout(toastTimer);
});
</script>

<style scoped>
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
