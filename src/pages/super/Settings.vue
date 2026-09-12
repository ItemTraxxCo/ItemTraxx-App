<template>
  <main class="page">
    <div class="sa-toolbar">
      <div>
        <RouterLink to="/super-admin" class="sa-back-link">&larr; Back to Control Center</RouterLink>
        <h1 class="sa-toolbar-title">Super Admin Settings</h1>
        <p class="sa-toolbar-sub">
          Review account security, passkeys, and active sessions for your super admin access.
        </p>
        <p class="links-row"><RouterLink to="/account/security" class="sa-back-link">Account Security</RouterLink> · <RouterLink to="/super-admin/settings/sso" class="sa-back-link">Enterprise SSO oversight</RouterLink></p>
      </div>
    </div>

    <div class="sa-stat-strip" aria-label="Settings summary">
      <div class="sa-stat"><div class="n">{{ passkeys.length }}</div><div class="l">Registered passkeys</div></div>
      <div class="sa-stat"><div class="n">{{ sessions.length }}</div><div class="l">Active sessions</div></div>
    </div>

    <section class="sa-panel">
      <h2>Password reset</h2>
      <p class="sa-toolbar-sub">Send yourself a reset link if you want to rotate your password.</p>
      <p class="muted">Reset links are sent to <strong>{{ auth.email || "your account email" }}</strong>.</p>
      <div class="panel-actions">
        <button type="button" class="sa-btn primary" :disabled="isPasswordResetSending" @click="sendPasswordReset">
          Send reset password email
        </button>
      </div>
      <p v-if="passwordResetMessage" class="sa-notice">{{ passwordResetMessage }}</p>
      <p v-if="passwordResetError" class="sa-error">{{ passwordResetError }}</p>
    </section>

    <section class="sa-panel">
      <h2>Passkeys</h2>
      <p class="sa-toolbar-sub">
        Passkeys registered to this account. Add, rename, or remove passkeys from Account Security.
      </p>
      <div class="panel-actions">
        <RouterLink class="sa-btn" to="/account/security">Manage passkeys in Account Security</RouterLink>
        <button type="button" class="sa-btn" :disabled="isPasskeyLoading" @click="loadPasskeys">Reload passkeys</button>
      </div>
      <div class="sa-table-wrap">
        <table class="sa-table">
          <thead>
            <tr>
              <th>Name</th>
              <th>Created</th>
              <th>Last used</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="passkey in passkeys" :key="passkey.id">
              <td>{{ passkey.name?.trim() || "Unnamed passkey" }}</td>
              <td>{{ formatDate(passkey.created_at) }}</td>
              <td>{{ formatLastUsed(passkey.last_used_at) }}</td>
            </tr>
            <tr v-if="!passkeys.length">
              <td colspan="3" class="muted">No passkeys registered.</td>
            </tr>
          </tbody>
        </table>
      </div>
      <p class="muted passkey-inventory-note">
        Last-used timestamps are shown when available. Passkey changes are intentionally limited to Account Security.
      </p>
      <p v-if="passkeyError" class="sa-error">{{ passkeyError }}</p>
    </section>

    <section class="sa-panel">
      <h2>Active sessions</h2>
      <p class="sa-toolbar-sub">Review and revoke active super admin sessions for this account.</p>
      <div class="sa-table-wrap">
        <table class="sa-table">
          <thead>
            <tr>
              <th>Device</th>
              <th>Method</th>
              <th>Location</th>
              <th>Region</th>
              <th>Last seen</th>
              <th>Status</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="session in sessions" :key="session.id">
              <td>{{ session.device_label || "Unknown device" }}</td>
              <td>{{ formatLoginMethod(session.login_method) }}</td>
              <td>{{ formatLoginLocation(session.login_location) }}</td>
              <td>{{ session.general_location || "Unknown" }}</td>
              <td>{{ formatDate(session.last_seen_at) }}</td>
              <td>{{ session.is_current ? "Current" : "Active" }}</td>
            </tr>
            <tr v-if="!sessions.length">
              <td colspan="6" class="muted">No active sessions found.</td>
            </tr>
          </tbody>
        </table>
      </div>
      <div class="panel-actions">
        <label class="session-select">
          Select session
          <select v-model="selectedSessionId">
            <option value="">Choose a session</option>
            <option v-for="session in removableSessions" :key="session.id" :value="session.id">
              {{ session.device_label || "Unknown device" }} — {{ formatDate(session.last_seen_at) }}
            </option>
          </select>
        </label>
      </div>
      <div class="panel-actions">
        <button type="button" class="sa-btn" :disabled="isSessionSaving || !selectedSessionId" @click="revokeSelectedSession">
          Sign out selected session
        </button>
        <button type="button" class="sa-btn" :disabled="isSessionSaving || !removableSessions.length" @click="revokeAllOtherSessions">
          Sign out all other sessions
        </button>
        <button type="button" class="sa-btn" :disabled="isSessionSaving" @click="loadSessions">Reload sessions</button>
      </div>
      <p v-if="sessionError" class="sa-error">{{ sessionError }}</p>
      <p v-if="sessionSuccess" class="sa-notice">{{ sessionSuccess }}</p>
    </section>

  </main>
</template>

<script setup lang="ts">
import { computed, onMounted, ref } from "vue";
import { RouterLink } from "vue-router";
import { authClient } from "../../auth/client";
import { toUserFacingErrorMessage } from "../../services/appErrors";
import { getAuthState } from "../../store/authState";
import {
  listSuperAdminPasskeys,
  listSuperAdminSessions,
  revokeAllSuperAdminSessions,
  revokeSuperAdminSession,
  touchSuperAdminSession,
  type SuperAdminPasskeyItem,
  type SuperAdminSessionItem,
} from "../../services/superOps/sessions";
import { getPasswordResetRedirectUrl } from "../../utils/passwordResetRedirect";

const auth = getAuthState();

const isPasswordResetSending = ref(false);
const passwordResetMessage = ref("");
const passwordResetError = ref("");

const passkeys = ref<SuperAdminPasskeyItem[]>([]);
const isPasskeyLoading = ref(false);
const passkeyError = ref("");

const sessions = ref<SuperAdminSessionItem[]>([]);
const selectedSessionId = ref("");
const isSessionSaving = ref(false);
const sessionError = ref("");
const sessionSuccess = ref("");

const removableSessions = computed(() => sessions.value.filter((session) => !session.is_current));

const formatDate = (value: string | null | undefined) => {
  if (!value) return "Unknown";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "Unknown";
  return date.toLocaleString();
};

const formatLastUsed = (value: string | null | undefined) =>
  value ? formatDate(value) : "Not recorded";

const formatLoginMethod = (value: SuperAdminSessionItem["login_method"]) =>
  value === "password" ? "Password" : value === "passkey" ? "Passkey" : "Unknown";

const formatLoginLocation = (value: SuperAdminSessionItem["login_location"]) =>
  value === "super_auth" ? "Super auth" : value === "super_settings" ? "Settings" : "Unknown";

const loadPasskeys = async () => {
  passkeyError.value = "";
  isPasskeyLoading.value = true;
  try {
    passkeys.value = await listSuperAdminPasskeys();
  } catch (err) {
    passkeyError.value = toUserFacingErrorMessage(err, "Unable to load passkeys.");
  } finally {
    isPasskeyLoading.value = false;
  }
};

const loadSessions = async () => {
  sessionError.value = "";
  try {
    sessions.value = await listSuperAdminSessions();
    if (!sessions.value.some((session) => session.id === selectedSessionId.value)) {
      selectedSessionId.value = "";
    }
  } catch (err) {
    sessionError.value = toUserFacingErrorMessage(err, "Unable to load active sessions.");
  }
};

const sendPasswordReset = async () => {
  passwordResetMessage.value = "";
  passwordResetError.value = "";
  const email = (auth.email || "").trim();
  if (!email) {
    passwordResetError.value = "No account email found for this session.";
    return;
  }

  isPasswordResetSending.value = true;
  try {
    const redirectTo = getPasswordResetRedirectUrl();
    const { error } = await authClient.requestPasswordReset({ email, redirectTo });
    if (error) throw error;
    passwordResetMessage.value = "Password reset email sent.";
  } catch (err) {
    passwordResetError.value = toUserFacingErrorMessage(err, "Unable to send reset email.");
  } finally {
    isPasswordResetSending.value = false;
  }
};

const revokeSelectedSession = async () => {
  if (!selectedSessionId.value) return;
  sessionError.value = "";
  sessionSuccess.value = "";
  isSessionSaving.value = true;
  try {
    await revokeSuperAdminSession(selectedSessionId.value);
    sessionSuccess.value = "Session revoked.";
    selectedSessionId.value = "";
    await loadSessions();
  } catch (err) {
    sessionError.value = toUserFacingErrorMessage(err, "Unable to revoke session.");
  } finally {
    isSessionSaving.value = false;
  }
};

const revokeAllOtherSessions = async () => {
  sessionError.value = "";
  sessionSuccess.value = "";
  isSessionSaving.value = true;
  try {
    const result = await revokeAllSuperAdminSessions(false);
    sessionSuccess.value = `${result.revoked || 0} session(s) revoked.`;
    selectedSessionId.value = "";
    await loadSessions();
  } catch (err) {
    sessionError.value = toUserFacingErrorMessage(err, "Unable to revoke sessions.");
  } finally {
    isSessionSaving.value = false;
  }
};

onMounted(async () => {
  await Promise.all([
    loadPasskeys(),
    loadSessions(),
    touchSuperAdminSession({ loginMethod: null, loginLocation: "super_settings" }).catch(() => undefined),
  ]);
});
</script>

<style scoped>
.page {
  max-width: 1320px;
  margin: 0 auto;
  padding: 2rem;
}

.panel-actions {
  display: flex;
  gap: 0.5rem;
  margin-top: 1rem;
}

.links-row {
  font-size: 0.85rem;
  margin-top: 0.75rem;
}

.session-select {
  max-width: 28rem;
}

.passkey-inventory-note {
  margin-top: 0.75rem;
}
</style>
