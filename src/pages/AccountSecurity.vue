<template>
  <main class="page auth-security-page">
    <button type="button" class="back-link" @click="router.back()">Back</button>
    <header>
      <h1>Account security</h1>
      <p>Manage the security methods attached to your ItemTraxx account.</p>
    </header>

    <section class="card">
      <h2>Sign-in email</h2>
      <p>Current email: <strong data-session-replay-mask>{{ authState.email || "Unavailable" }}</strong></p>
      <p>We’ll send an approval link to your current address, then a verification link to the new address. The change takes effect after both addresses approve it.</p>
      <form class="email-change-form" @submit.prevent="requestEmailChange">
        <label>
          New email address
          <input v-model.trim="newEmail" type="email" autocomplete="email" data-session-replay-mask required />
        </label>
        <button type="submit" :disabled="busy || !newEmail.trim()">
          {{ isRequestingEmailChange ? "Sending…" : "Send approval link" }}
        </button>
      </form>
    </section>

    <section class="card">
      <h2>Passkeys</h2>
      <p>Use Face ID, Touch ID, Windows Hello, or a hardware security key.</p>
      <label>Passkey name <input v-model="passkeyName" maxlength="80" placeholder="iCloud Keychain" /></label>
      <label v-if="authState.role === 'super_admin'">
        Current password
        <input
          v-model="passkeyConfirmationPassword"
          type="password"
          autocomplete="current-password"
          data-session-replay-mask
        />
      </label>
      <p v-if="authState.role === 'super_admin'" class="muted">
        Confirm with your current password. This keeps your existing session active.
      </p>
      <button
        :disabled="busy || (authState.role === 'super_admin' && !passkeyConfirmationPassword)"
        @click="addPasskey"
      >Add passkey</button>
      <ul>
        <li v-for="passkey in passkeys" :key="passkey.id">
          <input v-model="passkey.name" aria-label="Passkey name" />
          <button :disabled="busy" @click="renamePasskey(passkey)">Rename</button>
          <button :disabled="busy" @click="removePasskey(passkey.id)">Delete</button>
        </li>
      </ul>
      <p v-if="!passkeys.length" class="muted">No passkeys registered.</p>
    </section>

    <section class="card">
      <h2>Authenticator app (TOTP)</h2>
      <label>Current password <input v-model="password" type="password" autocomplete="current-password" /></label>
      <button v-if="!twoFactorEnabled" :disabled="busy || !password" @click="beginTwoFactor">Set up authenticator</button>
      <template v-if="totpUri">
        <img
          v-if="qrCode"
          data-session-replay-mask
          :src="qrCode"
          alt="Authenticator enrollment QR code"
          width="220"
          height="220"
        />
        <details data-session-replay-mask>
          <summary>Manual setup code</summary>
          <code data-session-replay-mask>{{ totpUri }}</code>
        </details>
        <label>Verification code <input v-model="totpCode" inputmode="numeric" autocomplete="one-time-code" /></label>
        <button :disabled="busy || totpCode.length < 6" @click="verifyEnrollment">Verify and enable</button>
      </template>
      <template v-if="twoFactorEnabled">
        <p class="success">Two-factor authentication is enabled.</p>
        <button :disabled="busy || !password" @click="regenerateBackupCodes">Regenerate backup codes</button>
        <button :disabled="busy || !password" @click="disableTwoFactor">Disable two-factor authentication</button>
      </template>
      <div v-if="backupCodes.length" class="backup-codes" data-session-replay-mask role="status">
        <h3>Save these backup codes now</h3>
        <p>Each code works once. Store them somewhere secure.</p>
        <code v-for="code in backupCodes" :key="code" data-session-replay-mask>{{ code }}</code>
      </div>
    </section>

    <section class="card">
      <h2>Sessions</h2>
      <p>Manage your active sessions and sign out of other devices.</p>
      <button :disabled="busy" @click="signOutOthers">Sign out other sessions</button>
    </section>

    <p v-if="message" class="success">{{ message }}</p>
    <p v-if="error" class="error" v-app-toast-error>{{ error }}</p>
  </main>
</template>

<script setup lang="ts">
import { onMounted, ref } from "vue";
import QRCode from "qrcode";
import { useRouter } from "vue-router";
import { authClient } from "../auth/client";
import { requestAccountEmailChange } from "../services/accountEmailChangeService";
import {
  revokeAllSuperAdminSessions,
  verifySuperAdminPassword,
} from "../services/superOps/sessions";
import { getAuthState } from "../store/authState";

type PasskeyItem = { id: string; name?: string | null };
const passkeys = ref<PasskeyItem[]>([]);
const passkeyName = ref("");
const newEmail = ref("");
const passkeyConfirmationPassword = ref("");
const password = ref("");
const totpCode = ref("");
const totpUri = ref("");
const qrCode = ref("");
const backupCodes = ref<string[]>([]);
const twoFactorEnabled = ref(false);
const busy = ref(false);
const isRequestingEmailChange = ref(false);
const message = ref("");
const error = ref("");
const router = useRouter();
const authState = getAuthState();

const run = async (action: () => Promise<void>) => {
  busy.value = true; error.value = ""; message.value = "";
  try { await action(); } catch (cause) { error.value = cause instanceof Error ? cause.message : "Security action failed."; }
  finally { busy.value = false; }
};

const load = async () => {
  const [{ data: keys }, { data: session }] = await Promise.all([
    authClient.passkey.listUserPasskeys(),
    authClient.getSession(),
  ]);
  passkeys.value = (keys ?? []).map((key) => ({ id: key.id, name: key.name }));
  twoFactorEnabled.value = Boolean((session?.user as { twoFactorEnabled?: boolean } | undefined)?.twoFactorEnabled);
};
const addPasskey = () => run(async () => {
  if (authState.role === "super_admin") {
    const confirmationPassword = passkeyConfirmationPassword.value;
    if (!confirmationPassword) {
      throw new Error("Enter your current password to add a passkey.");
    }
    try {
      await verifySuperAdminPassword(confirmationPassword);
    } finally {
      passkeyConfirmationPassword.value = "";
    }
  }
  const result = await authClient.passkey.addPasskey({ name: passkeyName.value.trim() || undefined });
  if (result.error) throw new Error(result.error.message ?? "Unable to add passkey.");
  passkeyName.value = ""; message.value = "Passkey added."; await load();
});
const renamePasskey = (passkey: PasskeyItem) => run(async () => {
  const result = await authClient.passkey.updatePasskey({ id: passkey.id, name: passkey.name?.trim() || "Passkey" });
  if (result.error) throw new Error(result.error.message ?? "Unable to rename passkey.");
  message.value = "Passkey renamed."; await load();
});
const removePasskey = (id: string) => run(async () => {
  const result = await authClient.passkey.deletePasskey({ id });
  if (result.error) throw new Error(result.error.message ?? "Unable to delete passkey.");
  message.value = "Passkey deleted."; await load();
});
const beginTwoFactor = () => run(async () => {
  const result = await authClient.twoFactor.enable({ password: password.value, method: "totp", issuer: "ItemTraxx" });
  if (result.error) throw new Error(result.error.message ?? "Unable to start two-factor setup.");
  if (result.data.method !== "totp") throw new Error("Unexpected two-factor method.");
  totpUri.value = result.data.totpURI; backupCodes.value = result.data.backupCodes;
  qrCode.value = await QRCode.toDataURL(totpUri.value, { errorCorrectionLevel: "M", margin: 1 });
});
const verifyEnrollment = () => run(async () => {
  const result = await authClient.twoFactor.verifyTotp({ code: totpCode.value, trustDevice: false });
  if (result.error) throw new Error(result.error.message ?? "Invalid authenticator code.");
  twoFactorEnabled.value = true; totpUri.value = ""; qrCode.value = ""; totpCode.value = "";
  message.value = "Two-factor authentication enabled.";
});
const regenerateBackupCodes = () => run(async () => {
  const result = await authClient.twoFactor.generateBackupCodes({ password: password.value });
  if (result.error) throw new Error(result.error.message ?? "Unable to regenerate backup codes.");
  backupCodes.value = result.data.backupCodes; message.value = "Old backup codes are now invalid.";
});
const disableTwoFactor = () => run(async () => {
  const result = await authClient.twoFactor.disable({ password: password.value });
  if (result.error) throw new Error(result.error.message ?? "Unable to disable two-factor authentication.");
  twoFactorEnabled.value = false; backupCodes.value = []; message.value = "Two-factor authentication disabled.";
});
const signOutOthers = () => run(async () => {
  if (authState.role === "super_admin") {
    await revokeAllSuperAdminSessions(false);
  } else {
    const result = await authClient.revokeOtherSessions();
    if (result.error) throw new Error(result.error.message ?? "Unable to revoke sessions.");
  }
  message.value = "Other sessions signed out.";
});
const requestEmailChange = async () => {
  isRequestingEmailChange.value = true;
  busy.value = true;
  error.value = "";
  message.value = "";
  try {
    message.value = await requestAccountEmailChange(newEmail.value);
    newEmail.value = "";
  } catch (cause) {
    error.value = cause instanceof Error ? cause.message : "Unable to request an email change.";
  } finally {
    isRequestingEmailChange.value = false;
    busy.value = false;
  }
};
onMounted(() => void run(load));
</script>

<style scoped>
.auth-security-page{max-width:58rem;margin:0 auto}.back-link{display:inline-block;margin-bottom:1rem}.card{margin:1rem 0;padding:1.25rem}.card label{display:grid;gap:.35rem;max-width:28rem;margin:.75rem 0}.card li{display:flex;gap:.5rem;align-items:center;margin:.5rem 0}.backup-codes{display:grid;gap:.35rem;margin-top:1rem;padding:1rem;border:1px solid currentColor}.backup-codes code{user-select:all}
</style>
