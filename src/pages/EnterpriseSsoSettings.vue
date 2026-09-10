<template>
  <main class="page sso-settings">
    <RouterLink to="/workspace/settings">Back to settings</RouterLink>
    <h1>Enterprise SSO</h1>
    <p class="muted">Configure a verified SAML 2.0 or OIDC provider for the selected ItemTraxx workspace.</p>

    <label v-if="workspaces.length">
      Workspace
      <select v-model="organizationId" @change="loadProviders">
        <option v-for="workspace in workspaces" :key="workspace.id" :value="workspace.organizationId ?? ''">
          {{ workspace.name }}
        </option>
      </select>
    </label>

    <section class="card">
      <h2>Add connection</h2>
      <form class="form" @submit.prevent="registerProvider">
        <label>Protocol<select v-model="protocol"><option value="saml">SAML 2.0</option><option value="oidc">OIDC</option></select></label>
        <label>Provider ID<input v-model="providerId" required pattern="[a-z0-9-]+" placeholder="acme-sso" /></label>
        <label>Verified email domain<input v-model="domain" required placeholder="example.edu" /></label>
        <label>Issuer / entity ID<input v-model="issuer" required /></label>
        <template v-if="protocol === 'saml'">
          <label>IdP SSO URL<input v-model="entryPoint" required type="url" /></label>
          <label>IdP signing certificate<textarea v-model="certificate" required rows="8" autocomplete="off" /></label>
        </template>
        <template v-else>
          <label>OIDC discovery URL<input v-model="discoveryEndpoint" required type="url" /></label>
          <label>Client ID<input v-model="clientId" required autocomplete="off" /></label>
          <label>Client secret<input v-model="clientSecret" required type="password" autocomplete="new-password" /></label>
        </template>
        <button class="button-primary" :disabled="saving || !organizationId">{{ saving ? "Saving…" : "Create connection" }}</button>
      </form>
    </section>
    <section v-if="domainVerificationToken" class="card">
      <h2>Verify the domain</h2>
      <p>Add a DNS TXT record named <code>_better-auth-token-{{ providerId }}.{{ domain }}</code> with this value:</p>
      <code>{{ domainVerificationToken }}</code>
      <button :disabled="saving" @click="verifyDomain(providerId)">Verify DNS record</button>
    </section>

    <section class="card">
      <h2>Connections</h2>
      <p v-if="!providers.length" class="muted">No SSO connections configured.</p>
      <article v-for="provider in providers" :key="provider.providerId" class="provider-row">
        <div><strong>{{ provider.providerId }}</strong><br /><span>{{ provider.domain }} · {{ provider.samlConfig ? "SAML" : "OIDC" }} · {{ provider.domainVerified ? "domain verified" : "verification required" }}</span></div>
        <div>
          <a v-if="provider.samlConfig" :href="metadataUrl(provider.providerId)" target="_blank" rel="noopener">SP metadata</a>
          <button v-if="!provider.domainVerified" @click="verifyDomain(provider.providerId)">Verify domain</button>
          <button class="button-danger" @click="removeProvider(provider.providerId)">Remove</button>
        </div>
      </article>
    </section>
    <p v-if="message" :class="error ? 'error' : 'muted'">{{ message }}</p>
  </main>
</template>

<script setup lang="ts">
import { onMounted, ref } from "vue";
import { RouterLink } from "vue-router";
import { authClient } from "../auth/client";

type Provider = { providerId: string; domain: string; domainVerified: boolean; organizationId: string | null; samlConfig: object | null; oidcConfig: object | null };
type Workspace = { id: string; name: string; organizationId: string | null };
const edgeOrigin = ((import.meta.env.VITE_EDGE_PROXY_URL as string | undefined)?.trim() || location.origin).replace(/\/+$/, "");
const providers = ref<Provider[]>([]), workspaces = ref<Workspace[]>([]), organizationId = ref("");
const protocol = ref<"saml" | "oidc">("saml"), providerId = ref(""), domain = ref(""), issuer = ref("");
const entryPoint = ref(""), certificate = ref(""), discoveryEndpoint = ref(""), clientId = ref(""), clientSecret = ref("");
const saving = ref(false), message = ref(""), error = ref(false);
const domainVerificationToken = ref("");
const metadataUrl = (id: string) => `${edgeOrigin}/api/auth/sso/saml2/sp/metadata?providerId=${encodeURIComponent(id)}`;
const loadProviders = async () => {
  const query = organizationId.value ? `?organizationId=${encodeURIComponent(organizationId.value)}` : "";
  const response = await fetch(`${edgeOrigin}/api/itemtraxx/sso/providers${query}`, { credentials: "include" });
  if (!response.ok) throw new Error("Unable to load SSO configuration");
  const data = await response.json() as { organizationId?: string | null; providers: Provider[]; workspaces?: Workspace[] };
  providers.value = data.providers;
  workspaces.value = data.workspaces ?? workspaces.value;
  if (!organizationId.value) organizationId.value = data.organizationId ?? workspaces.value[0]?.organizationId ?? "";
};
const registerProvider = async () => {
  saving.value = true; message.value = ""; error.value = false;
  try {
    const common = { providerId: providerId.value, domain: domain.value, issuer: issuer.value, organizationId: organizationId.value };
    const configuration = protocol.value === "saml"
      ? { ...common, samlConfig: { entryPoint: entryPoint.value, cert: certificate.value, wantAssertionsSigned: true } }
      : { ...common, oidcConfig: { discoveryEndpoint: discoveryEndpoint.value, clientId: clientId.value, clientSecret: clientSecret.value, pkce: true } };
    const result = await authClient.sso.register(configuration);
    if (result.error) throw new Error(result.error.message);
    domainVerificationToken.value = result.data?.domainVerificationToken ?? "";
    clientSecret.value = ""; certificate.value = ""; message.value = "SSO connection created. Complete domain verification before enabling sign-in.";
    await loadProviders();
  } catch (cause) { error.value = true; message.value = cause instanceof Error ? cause.message : "Unable to create SSO connection"; }
  finally { saving.value = false; }
};
const removeProvider = async (id: string) => {
  if (!confirm(`Remove SSO connection ${id}?`)) return;
  const response = await fetch(`${edgeOrigin}/api/itemtraxx/sso/providers?providerId=${encodeURIComponent(id)}`, { method: "DELETE", credentials: "include" });
  if (!response.ok) { error.value = true; message.value = "Unable to remove SSO connection"; return; }
  await loadProviders();
};
const verifyDomain = async (id: string) => {
  saving.value = true; message.value = ""; error.value = false;
  try {
    const result = await authClient.sso.verifyDomain({ providerId: id });
    if (result.error) throw new Error(result.error.message);
    domainVerificationToken.value = "";
    message.value = "SSO domain verified.";
    await loadProviders();
  } catch (cause) {
    error.value = true;
    message.value = cause instanceof Error ? cause.message : "Unable to verify the SSO domain";
  } finally { saving.value = false; }
};
onMounted(() => void loadProviders().catch((cause) => { error.value = true; message.value = cause instanceof Error ? cause.message : "Unable to load SSO configuration"; }));
</script>

<style scoped>
.sso-settings{max-width:58rem}.form{display:grid;gap:.9rem}.form label{display:grid;gap:.35rem}.provider-row{display:flex;justify-content:space-between;gap:1rem;padding:1rem 0;border-top:1px solid var(--border)}.provider-row>div:last-child{display:flex;align-items:center;gap:.8rem}
</style>
