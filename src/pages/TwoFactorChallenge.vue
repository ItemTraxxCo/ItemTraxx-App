<template><main class="page"><h1>Two-factor verification</h1><p>Enter an authenticator code or a one-time backup code.</p><label>Code <input v-model="code" autocomplete="one-time-code" /></label><button :disabled="busy || !code" @click="verifyTotp">Verify authenticator code</button><button :disabled="busy || !code" @click="verifyBackup">Use backup code</button><p v-if="error" class="error" v-app-toast-error>{{ error }}</p></main></template>
<script setup lang="ts">
import { ref } from "vue";
import { useRouter } from "vue-router";
import { authClient } from "../auth/client";
import { refreshAuthFromSession } from "../services/auth/sessionBootstrap";
import { registerPrivilegedAdminStepUp } from "../services/privilegedStepUpService";
import { touchSuperAdminSession } from "../services/superOps/sessions";
import { getAuthState, markAdminVerified, setSecondaryAuth } from "../store/authState";

const router = useRouter();
const code = ref("");
const error = ref("");
const busy = ref(false);

const run = async (kind: "totp" | "backup") => {
  if (busy.value) return;
  busy.value = true;
  error.value = "";
  try {
    const result = kind === "totp"
      ? await authClient.twoFactor.verifyTotp({ code: code.value, trustDevice: false })
      : await authClient.twoFactor.verifyBackupCode({ code: code.value, trustDevice: false });

    if (result.error) {
      error.value = result.error.message ?? "Verification failed.";
      return;
    }

    await refreshAuthFromSession();
    const auth = getAuthState();
    if (auth.role === "workspace_admin" || auth.role === "individual_account") {
      await registerPrivilegedAdminStepUp();
      markAdminVerified();
    } else if (auth.role === "super_admin") {
      await touchSuperAdminSession({ loginLocation: "super_auth" });
      await registerPrivilegedAdminStepUp();
      setSecondaryAuth(true);
    }

    await router.replace(auth.role === "super_admin" ? "/super-admin" : "/");
  } catch (cause) {
    error.value = cause instanceof Error ? cause.message : "Verification failed.";
  } finally {
    busy.value = false;
  }
};

const verifyTotp = () => run("totp");
const verifyBackup = () => run("backup");
</script>
