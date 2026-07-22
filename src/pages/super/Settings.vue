<template>
  <div class="page admin-shell">
    <div class="admin-hero">
      <div class="page-nav-left">
        <RouterLink class="button-link" to="/super-admin">Return to super admin</RouterLink>
      </div>
      <h1>Super Admin Settings</h1>
      <p class="admin-hero-copy">
        Manage account security, passkeys, and active sessions for your super admin access.
      </p>
      <div class="admin-summary-grid">
        <div class="admin-summary-card">
          <strong>{{ passkeys.length }}</strong>
          <span>Registered passkeys</span>
        </div>
        <div class="admin-summary-card">
          <strong>{{ sessions.length }}</strong>
          <span>Active sessions</span>
        </div>
        <div class="admin-summary-card">
          <strong>{{ reauthLabel }}</strong>
          <span>Passkey changes</span>
        </div>
      </div>
    </div>

    <div class="card admin-section-card">
      <div class="admin-section-header">
        <div>
          <h2>Password reset</h2>
          <p class="admin-section-copy">Send yourself a reset link if you want to rotate your password.</p>
        </div>
      </div>
      <p class="muted">Reset links are sent to <strong>{{ auth.email || "your account email" }}</strong>.</p>
      <div class="form-actions">
        <button type="button" class="button-primary" :disabled="isPasswordResetSending" @click="sendPasswordReset">
          Send reset password email
        </button>
      </div>
      <p v-if="passwordResetMessage" class="success">{{ passwordResetMessage }}</p>
      <p v-if="passwordResetError" class="error">{{ passwordResetError }}</p>
    </div>

    <div class="card admin-section-card">
      <div class="admin-section-header">
        <div>
          <h2>Passkey security gate</h2>
          <p class="admin-section-copy">
            Protected changes require re-authentication. If needed, you will be prompted automatically.
          </p>
        </div>
      </div>

      <div class="security-gate-grid">
        <label>
          Current password
          <input
            v-model="reauthPassword"
            type="password"
            placeholder="Enter current password"
            autocomplete="current-password"
          />
        </label>
        <div class="form-actions">
          <button type="button" :disabled="isReauthLoading || !reauthPassword.trim()" @click="reauthWithPassword">
            Verify password
          </button>
          <button type="button" :disabled="isReauthLoading || !isPasskeySupported" @click="reauthWithPasskey">
            Verify with passkey
          </button>
        </div>
      </div>
      <p class="muted">Authorization lasts 5 minutes.</p>
      <p v-if="reauthError" class="error">{{ reauthError }}</p>
      <p v-if="reauthSuccess" class="success">{{ reauthSuccess }}</p>
    </div>

    <div class="card admin-section-card">
      <div class="admin-section-header">
        <div>
          <h2>Passkeys</h2>
          <p class="admin-section-copy">Add or remove passkeys for super admin sign-in.</p>
        </div>
      </div>
      <div class="form-actions">
        <button type="button" class="button-primary" :disabled="isPasskeyActionLoading" @click="addPasskey">
          Add passkey
        </button>
        <button type="button" :disabled="isPasskeyActionLoading" @click="loadPasskeys">Reload passkeys</button>
      </div>
      <div class="table-wrap">
        <table class="table">
          <thead>
            <tr>
              <th>Passkey ID</th>
              <th>Created</th>
              <th>Last used</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="passkey in passkeys" :key="passkey.id">
              <td>{{ passkey.id }}</td>
              <td>{{ formatDate(passkey.created_at) }}</td>
              <td>{{ formatDate(passkey.last_used_at) }}</td>
              <td>
                <button
                  type="button"
                  :disabled="isPasskeyActionLoading"
                  @click="removePasskey(passkey.id)"
                >
                  Remove
                </button>
              </td>
            </tr>
            <tr v-if="!passkeys.length">
              <td colspan="4" class="muted">No passkeys registered.</td>
            </tr>
          </tbody>
        </table>
      </div>
      <p v-if="passkeyError" class="error">{{ passkeyError }}</p>
      <p v-if="passkeySuccess" class="success">{{ passkeySuccess }}</p>
    </div>

    <div class="card admin-section-card">
      <div class="admin-section-header">
        <div>
          <h2>Active sessions</h2>
          <p class="admin-section-copy">Review and revoke active super admin sessions for this account.</p>
        </div>
      </div>
      <div class="table-wrap">
        <table class="table">
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
      <div class="form-actions">
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
      <div class="form-actions">
        <button type="button" :disabled="isSessionSaving || !selectedSessionId" @click="revokeSelectedSession">
          Sign out selected session
        </button>
        <button type="button" :disabled="isSessionSaving || !removableSessions.length" @click="revokeAllOtherSessions">
          Sign out all other sessions
        </button>
        <button type="button" :disabled="isSessionSaving" @click="loadSessions">Reload sessions</button>
      </div>
      <p v-if="sessionError" class="error">{{ sessionError }}</p>
      <p v-if="sessionSuccess" class="success">{{ sessionSuccess }}</p>
    </div>

    <div v-if="reauthModalOpen" class="settings-reauth-modal-backdrop" role="dialog" aria-modal="true">
      <div class="settings-reauth-modal">
        <h3>Re-authentication required</h3>
        <p class="muted">
          For security, confirm your identity before making this settings change.
        </p>
        <label>
          Current password
          <input
            v-model="modalReauthPassword"
            type="password"
            placeholder="Enter current password"
            autocomplete="current-password"
          />
        </label>
        <div class="form-actions">
          <button
            type="button"
            class="button-primary"
            :disabled="isReauthLoading || !modalReauthPassword.trim()"
            @click="handleModalPasswordReauth"
          >
            Verify password
          </button>
          <button type="button" :disabled="isReauthLoading || !isPasskeySupported" @click="handleModalPasskeyReauth">
            Verify with passkey
          </button>
          <button type="button" :disabled="isReauthLoading" @click="closeReauthModal">Cancel</button>
        </div>
        <p v-if="modalReauthError" class="error">{{ modalReauthError }}</p>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, ref } from "vue";
import { RouterLink } from "vue-router";
import { supabase } from "../../services/supabaseClient";
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
import { superAdminPasskeyLogin } from "../../services/authService";
import { getPasswordResetRedirectUrl } from "../../utils/passwordResetRedirect";

const auth = getAuthState();
const REAUTH_WINDOW_MS = 5 * 60 * 1000;

const isPasswordResetSending = ref(false);
const passwordResetMessage = ref("");
const passwordResetError = ref("");

const reauthPassword = ref("");
const isReauthLoading = ref(false);
const reauthError = ref("");
const reauthSuccess = ref("");
const passkeyManagementAuthorizedUntil = ref<number | null>(null);

const passkeys = ref<SuperAdminPasskeyItem[]>([]);
const isPasskeyActionLoading = ref(false);
const passkeyError = ref("");
const passkeySuccess = ref("");
const reauthModalOpen = ref(false);
const modalReauthPassword = ref("");
const modalReauthError = ref("");
let pendingProtectedAction: null | (() => Promise<void>) = null;

const sessions = ref<SuperAdminSessionItem[]>([]);
const selectedSessionId = ref("");
const isSessionSaving = ref(false);
const sessionError = ref("");
const sessionSuccess = ref("");

const isPasskeySupported = computed(
  () => typeof window !== "undefined" && "PublicKeyCredential" in window
);

const canManagePasskeys = computed(
  () =>
    isPasskeySupported.value &&
    !!passkeyManagementAuthorizedUntil.value &&
    passkeyManagementAuthorizedUntil.value > Date.now()
);

const reauthLabel = computed(() =>
  canManagePasskeys.value ? "Verified" : "Re-auth required"
);

const removableSessions = computed(() => sessions.value.filter((session) => !session.is_current));

const formatDate = (value: string | null | undefined) => {
  if (!value) return "Unknown";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "Unknown";
  return date.toLocaleString();
};

const formatLoginMethod = (value: SuperAdminSessionItem["login_method"]) =>
  value === "password" ? "Password" : value === "passkey" ? "Passkey" : "Unknown";

const formatLoginLocation = (value: SuperAdminSessionItem["login_location"]) =>
  value === "super_auth" ? "Super auth" : value === "super_settings" ? "Settings" : "Unknown";

const loadPasskeys = async () => {
  passkeyError.value = "";
  try {
    passkeys.value = await listSuperAdminPasskeys();
  } catch (err) {
    passkeyError.value = toUserFacingErrorMessage(err, "Unable to load passkeys.");
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
    const { error } = await supabase.auth.resetPasswordForEmail(email, { redirectTo });
    if (error) throw error;
    passwordResetMessage.value = "Password reset email sent.";
  } catch (err) {
    passwordResetError.value = toUserFacingErrorMessage(err, "Unable to send reset email.");
  } finally {
    isPasswordResetSending.value = false;
  }
};

const grantPasskeyManagementWindow = () => {
  passkeyManagementAuthorizedUntil.value = Date.now() + REAUTH_WINDOW_MS;
};

const reauthWithPassword = async () => {
  reauthError.value = "";
  reauthSuccess.value = "";
  passkeyError.value = "";
  isReauthLoading.value = true;
  try {
    const email = (auth.email || "").trim().toLowerCase();
    if (!email) {
      throw new Error("No account email found for this session.");
    }
    const signIn = await supabase.auth.signInWithPassword({
      email,
      password: reauthPassword.value,
    });
    if (signIn.error || !signIn.data.session?.access_token) {
      throw signIn.error || new Error("Invalid password.");
    }
    await touchSuperAdminSession({
      loginMethod: "password",
      loginLocation: "super_settings",
    });
    grantPasskeyManagementWindow();
    reauthPassword.value = "";
    reauthSuccess.value = "Password verified. You can now manage passkeys for 5 minutes.";
  } catch (err) {
    reauthError.value = toUserFacingErrorMessage(err, "Password verification failed.");
  } finally {
    isReauthLoading.value = false;
  }
};

const reauthWithPasskey = async () => {
  reauthError.value = "";
  reauthSuccess.value = "";
  passkeyError.value = "";
  isReauthLoading.value = true;
  try {
    await superAdminPasskeyLogin({
      sendLoginNotification: false,
      loginLocation: "super_settings",
    });
    await touchSuperAdminSession({
      loginMethod: "passkey",
      loginLocation: "super_settings",
    });
    grantPasskeyManagementWindow();
    reauthSuccess.value = "Passkey verified. You can now manage passkeys for 5 minutes.";
    await Promise.all([loadPasskeys(), loadSessions()]);
  } catch (err) {
    reauthError.value = toUserFacingErrorMessage(err, "Passkey verification failed.");
  } finally {
    isReauthLoading.value = false;
  }
};

const runProtectedAction = async (action: () => Promise<void>) => {
  if (canManagePasskeys.value) {
    await action();
    return;
  }
  pendingProtectedAction = action;
  modalReauthPassword.value = "";
  modalReauthError.value = "";
  reauthModalOpen.value = true;
};

const closeReauthModal = () => {
  if (isReauthLoading.value) return;
  reauthModalOpen.value = false;
  modalReauthPassword.value = "";
  modalReauthError.value = "";
  pendingProtectedAction = null;
};

const completeModalReauth = async () => {
  const action = pendingProtectedAction;
  pendingProtectedAction = null;
  reauthModalOpen.value = false;
  modalReauthPassword.value = "";
  modalReauthError.value = "";
  if (action) {
    await action();
  }
};

const handleModalPasswordReauth = async () => {
  modalReauthError.value = "";
  reauthPassword.value = modalReauthPassword.value;
  await reauthWithPassword();
  if (!canManagePasskeys.value) {
    modalReauthError.value = reauthError.value || "Password verification failed.";
    return;
  }
  await completeModalReauth();
};

const handleModalPasskeyReauth = async () => {
  modalReauthError.value = "";
  await reauthWithPasskey();
  if (!canManagePasskeys.value) {
    modalReauthError.value = reauthError.value || "Passkey verification failed.";
    return;
  }
  await completeModalReauth();
};

const addPasskey = async () => {
  passkeyError.value = "";
  passkeySuccess.value = "";
  await runProtectedAction(async () => {
    isPasskeyActionLoading.value = true;
    try {
      const result = await supabase.auth.registerPasskey();
      if (result.error) throw result.error;
      await touchSuperAdminSession({
        loginMethod: "passkey",
        loginLocation: "super_settings",
      });
      passkeySuccess.value = "Passkey added successfully.";
      await loadPasskeys();
    } catch (err) {
      passkeyError.value = toUserFacingErrorMessage(err, "Unable to add passkey.");
    } finally {
      isPasskeyActionLoading.value = false;
    }
  });
};

const removePasskey = async (passkeyId: string) => {
  passkeyError.value = "";
  passkeySuccess.value = "";
  await runProtectedAction(async () => {
    isPasskeyActionLoading.value = true;
    try {
      const result = await supabase.auth.passkey.delete({ passkeyId });
      if (result.error) throw result.error;
      passkeySuccess.value = "Passkey removed.";
      await loadPasskeys();
    } catch (err) {
      passkeyError.value = toUserFacingErrorMessage(err, "Unable to remove passkey.");
    } finally {
      isPasskeyActionLoading.value = false;
    }
  });
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
.security-gate-grid {
  display: grid;
  gap: 0.75rem;
}

.session-select {
  max-width: 28rem;
}

.settings-reauth-modal-backdrop {
  position: fixed;
  inset: 0;
  z-index: 1300;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 1rem;
  background: color-mix(in srgb, #000 32%, transparent);
}

.settings-reauth-modal {
  width: min(100%, 28rem);
  background: var(--surface);
  border: 1px solid var(--border);
  border-radius: 14px;
  padding: 1rem;
}

.settings-reauth-modal h3 {
  margin: 0 0 0.4rem;
}
</style>
