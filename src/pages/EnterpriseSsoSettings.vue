<template>
  <main class="page sso-settings">
    <RouterLink class="back-link" :to="backTarget">{{ backLabel }}</RouterLink>
    <header class="page-heading">
      <p class="eyebrow">WORKSPACE ACCESS</p>
      <h1>Enterprise SSO</h1>
      <p class="muted">Connect your identity provider to sign users in to this ItemTraxx workspace.</p>
    </header>

    <label v-if="workspaces.length" class="workspace-picker">
      Workspace
      <select v-model="organizationId" @change="refreshProviders">
        <option v-for="workspace in workspaces" :key="workspace.id" :value="workspace.organizationId ?? ''">
          {{ workspace.name }}
        </option>
      </select>
    </label>

    <section class="card wizard-card" aria-labelledby="wizard-title">
      <div class="wizard-heading">
        <div>
          <p class="eyebrow">GUIDED SETUP</p>
          <h2 id="wizard-title">Connect an identity provider</h2>
          <p class="muted">Have your provider’s admin page open in another tab. You can review everything before creating the connection.</p>
        </div>
        <span class="protocol-badge">{{ protocolLabel }}</span>
      </div>

      <form class="wizard-form" @submit.prevent="submitConnection">
        <div class="progress-area">
          <div class="progress-caption">
            <span>Step {{ currentStep + 1 }} of {{ steps.length }}</span>
            <span>{{ Math.round(progressPercent) }}% complete</span>
          </div>
          <div
            class="progress-track"
            role="progressbar"
            :aria-valuenow="currentStep + 1"
            :aria-valuemin="1"
            :aria-valuemax="steps.length"
            :aria-label="`Step ${currentStep + 1} of ${steps.length}`"
          >
            <span class="progress-fill" :style="{ width: `${progressPercent}%` }" />
          </div>
        </div>

        <div class="step-content" :key="activeStep.key">
          <div class="step-title-row">
            <span class="step-number" aria-hidden="true">{{ currentStep + 1 }}</span>
            <div>
              <h3>{{ activeStep.title }}</h3>
              <p class="muted">{{ activeStep.summary }}</p>
            </div>
          </div>

          <fieldset v-if="activeStep.key === 'protocol'" class="protocol-options">
            <legend class="sr-only">Choose a sign-in protocol</legend>
            <label class="protocol-option" :class="{ selected: protocol === 'saml' }">
              <input type="radio" name="sso-protocol" value="saml" :checked="protocol === 'saml'" @change="setProtocol('saml')" />
              <span class="protocol-option-copy">
                <strong>SAML 2.0</strong>
                <span>Use any identity provider that supports SAML 2.0, such as Okta or Microsoft Entra ID.</span>
              </span>
            </label>
            <label class="protocol-option" :class="{ selected: protocol === 'oidc' }">
              <input type="radio" name="sso-protocol" value="oidc" :checked="protocol === 'oidc'" @change="setProtocol('oidc')" />
              <span class="protocol-option-copy">
                <strong>OpenID Connect (OIDC)</strong>
                <span>Use an OIDC provider that gives you a discovery URL, client ID, and client secret.</span>
              </span>
            </label>
          </fieldset>

          <div v-else-if="activeStep.key === 'review'" class="review-content">
            <p class="review-intro">Check that these values match your identity provider. Use Change to revisit any step.</p>
            <dl class="review-list">
              <div v-for="item in reviewRows" :key="item.key" class="review-row">
                <dt>{{ item.label }}</dt>
                <dd v-if="item.key === 'certificate'" class="review-value">
                  <details data-session-replay-mask>
                    <summary>{{ connectionCreated ? 'Certificate saved' : 'View signing certificate' }}</summary>
                    <pre>{{ certificate }}</pre>
                  </details>
                </dd>
                <dd v-else-if="item.key === 'clientSecret'" class="review-value secret-review" data-session-replay-mask>
                  <span>{{ revealSecret ? clientSecret : '••••••••••••' }}</span>
                  <button type="button" class="text-button" :aria-label="revealSecret ? 'Hide client secret' : 'Show client secret'" @click="revealSecret = !revealSecret">
                    {{ revealSecret ? 'Hide' : 'Show' }}
                  </button>
                </dd>
                <dd v-else class="review-value">{{ item.value }}</dd>
                <button type="button" class="text-button review-edit" :disabled="connectionCreated" @click="editStep(item.key)">Change</button>
              </div>
            </dl>
            <p v-if="protocol === 'saml'" class="review-note">After you create the connection, verify your email domain. Then copy ItemTraxx’s SP metadata into your identity provider to fill its Entity ID and ACS URL fields.</p>
            <p v-else class="review-note">After you create the connection, verify your email domain and add this callback / redirect URI to your OIDC provider:<code>{{ oidcCallbackUrl }}</code></p>
          </div>

          <div v-else class="field-step">
            <label class="wizard-field-label" :for="`sso-${activeStep.key}`">{{ activeStep.fieldLabel }}</label>
            <p class="field-hint muted">{{ activeStep.fieldHint }}</p>

            <textarea
              v-if="activeStep.multiline"
              :id="`sso-${activeStep.key}`"
              ref="currentInput"
              v-model="fieldValue"
              :placeholder="activeStep.placeholder"
              :aria-invalid="stepError ? 'true' : undefined"
              :aria-describedby="stepError ? `sso-help-${activeStep.key} sso-error-${activeStep.key}` : `sso-help-${activeStep.key}`"
              autocomplete="off"
              autocapitalize="off"
              spellcheck="false"
              rows="7"
              required
              data-session-replay-mask
            />
            <input
              v-else
              :id="`sso-${activeStep.key}`"
              ref="currentInput"
              v-model="fieldValue"
              :type="activeStep.inputType ?? 'text'"
              :placeholder="activeStep.placeholder"
              :pattern="activeStep.pattern"
              :aria-invalid="stepError ? 'true' : undefined"
              :aria-describedby="stepError ? `sso-help-${activeStep.key} sso-error-${activeStep.key}` : `sso-help-${activeStep.key}`"
              :autocomplete="activeStep.autocomplete ?? 'off'"
              :spellcheck="false"
              required
              :data-session-replay-mask="activeStep.key === 'clientSecret' ? '' : undefined"
            />

            <p v-if="stepError" :id="`sso-error-${activeStep.key}`" class="field-error" role="alert">{{ stepError }}</p>

            <p :id="`sso-help-${activeStep.key}`" class="field-guidance">
              <span><strong>Where to find it</strong>{{ activeStep.findIt }}</span>
              <span v-if="activeStep.aliases"><strong>It may be called</strong>{{ activeStep.aliases }}</span>
              <span v-if="activeStep.example"><strong>Example</strong><code>{{ activeStep.example }}</code></span>
            </p>

            <aside v-if="activeStep.key === 'providerId' && protocol === 'oidc' && providerId.trim()" class="callback-hint">
              <span>Register this callback / redirect URI in your OIDC provider:</span>
              <code>{{ oidcCallbackUrl }}</code>
            </aside>
            <aside v-if="activeStep.key === 'issuer' && protocol === 'saml'" class="callback-hint">
              <span>This is the IdP’s identifier. ItemTraxx’s Entity ID is provided later in its SP metadata.</span>
            </aside>
            <aside v-if="activeStep.key === 'certificate'" class="callback-hint">
              <span>Paste the public X.509 signing certificate. Never use a private key.</span>
            </aside>
          </div>
        </div>

        <div class="wizard-actions">
          <button v-if="currentStep > 0 && !connectionCreated" type="button" class="secondary-action" @click="goBack">Back</button>
          <span v-else class="actions-spacer" />
          <template v-if="!connectionCreated">
            <button v-if="activeStep.key !== 'review'" type="button" class="button-primary" @click="goForward">
              {{ currentStep === steps.length - 2 ? 'Review setup' : 'Continue' }}
            </button>
            <button v-else type="submit" class="button-primary" :disabled="saving || !organizationId">
              {{ saving ? 'Creating…' : 'Create SSO connection' }}
            </button>
          </template>
          <template v-else>
            <span class="created-label" role="status">Connection created</span>
            <button type="button" class="secondary-action" @click="startAnotherConnection">Set up another</button>
          </template>
        </div>
      </form>
    </section>

    <section v-if="domainVerificationToken" class="card verification-card" aria-labelledby="verify-domain-title">
      <p class="eyebrow">NEXT STEP</p>
      <h2 id="verify-domain-title">Verify {{ domainVerificationDomain }}</h2>
      <p>Add this DNS TXT record, then verify it here:</p>
      <dl class="dns-record">
        <div><dt>Record name</dt><dd><code>_better-auth-token-{{ domainVerificationProviderId }}.{{ domainVerificationDomain }}</code></dd></div>
        <div><dt>TXT value</dt><dd><code data-session-replay-mask>{{ domainVerificationToken }}</code></dd></div>
      </dl>
      <button class="secondary-action" :disabled="saving" @click="verifyDomain(domainVerificationProviderId)">Verify DNS record</button>
      <p v-if="metadataUrlForCreatedProvider" class="metadata-next-step">
        <a :href="metadataUrlForCreatedProvider" target="_blank" rel="noopener">Open ItemTraxx SP metadata</a>
        <span>Use it in your identity provider’s SAML app to fill ItemTraxx’s Entity ID and ACS URL.</span>
      </p>
    </section>

    <section class="card connections-card" aria-labelledby="connections-title">
      <div class="connections-heading">
        <div>
          <p class="eyebrow">WORKSPACE CONFIGURATION</p>
          <h2 id="connections-title">Connections</h2>
        </div>
        <span class="connection-count">{{ providers.length }}</span>
      </div>
      <p v-if="!providers.length" class="muted">No SSO connections configured.</p>
      <article v-for="provider in providers" :key="provider.providerId" class="provider-row">
        <div class="provider-details">
          <strong>{{ provider.providerId }}</strong>
          <span>{{ provider.domain }} · {{ provider.samlConfig ? 'SAML 2.0' : 'OIDC' }}</span>
          <span class="verification-status" :class="provider.domainVerified ? 'is-verified' : 'is-pending'">
            {{ provider.domainVerified ? 'Domain verified' : 'Domain verification needed' }}
          </span>
        </div>
        <div class="provider-actions">
          <a v-if="provider.samlConfig" :href="metadataUrl(provider.providerId)" target="_blank" rel="noopener">SP metadata</a>
          <button v-if="!provider.domainVerified" type="button" class="secondary-action" @click="verifyDomain(provider.providerId)">Verify domain</button>
          <button type="button" class="button-danger" @click="removeProvider(provider.providerId)">Remove</button>
        </div>
      </article>
    </section>

    <p v-if="message" class="form-message" :class="error ? 'error' : 'success-message'" :role="error ? 'alert' : 'status'">{{ message }}</p>
  </main>
</template>

<script setup lang="ts">
import { computed, nextTick, onMounted, ref } from "vue";
import { RouterLink, useRoute } from "vue-router";
import { authClient } from "../auth/client";

type Provider = { providerId: string; domain: string; domainVerified: boolean; organizationId: string | null; samlConfig: object | null; oidcConfig: object | null };
type Workspace = { id: string; name: string; organizationId: string | null };
type WizardKey = "protocol" | "providerId" | "domain" | "issuer" | "entryPoint" | "certificate" | "discoveryEndpoint" | "clientId" | "clientSecret" | "review";
type WizardStep = {
  key: WizardKey;
  title: string;
  summary: string;
  fieldLabel?: string;
  fieldHint?: string;
  findIt?: string;
  aliases?: string;
  placeholder?: string;
  example?: string;
  inputType?: string;
  autocomplete?: string;
  pattern?: string;
  multiline?: boolean;
};

const edgeOrigin = ((import.meta.env.VITE_EDGE_PROXY_URL as string | undefined)?.trim() || location.origin).replace(/\/+$/, "");
const providers = ref<Provider[]>([]), workspaces = ref<Workspace[]>([]), organizationId = ref("");
const protocol = ref<"saml" | "oidc">("saml"), providerId = ref(""), domain = ref(""), issuer = ref("");
const entryPoint = ref(""), certificate = ref(""), discoveryEndpoint = ref(""), clientId = ref(""), clientSecret = ref("");
const currentStep = ref(0), currentInput = ref<HTMLInputElement | HTMLTextAreaElement | null>(null);
const saving = ref(false), message = ref(""), error = ref(false), connectionCreated = ref(false), revealSecret = ref(false), stepError = ref("");
const domainVerificationToken = ref(""), domainVerificationProviderId = ref(""), domainVerificationDomain = ref("");
const domainVerificationProtocol = ref<"saml" | "oidc">("saml");
const route = useRoute();

const isSuperAdminSettings = computed(() => route.path.startsWith("/super-admin"));
const backTarget = computed(() => isSuperAdminSettings.value ? "/super-admin/settings" : "/settings/organization");
const backLabel = computed(() => isSuperAdminSettings.value ? "Back to super admin settings" : "Back to organization settings");
const protocolLabel = computed(() => protocol.value === "saml" ? "SAML 2.0" : "OpenID Connect (OIDC)");
const metadataUrl = (id: string) => `${edgeOrigin}/api/auth/sso/saml2/sp/metadata?providerId=${encodeURIComponent(id)}`;
const metadataUrlForCreatedProvider = computed(() => domainVerificationProviderId.value && domainVerificationProtocol.value === "saml"
  ? metadataUrl(domainVerificationProviderId.value)
  : "");
const oidcCallbackUrl = computed(() => `${edgeOrigin}/api/auth/sso/callback/${encodeURIComponent(providerId.value.trim())}`);

const steps = computed<WizardStep[]>(() => {
  const shared: WizardStep[] = [
    {
      key: "protocol",
      title: "Choose a sign-in protocol",
      summary: "Pick the protocol configured in your identity provider. You can change this later by creating a separate connection.",
      findIt: "Choose SAML 2.0 for a SAML app, or OIDC when your provider gives you an OIDC client registration.",
    },
    {
      key: "providerId",
      title: "Name this connection",
      summary: "Choose a short ID that identifies this provider in ItemTraxx.",
      fieldLabel: "Provider ID",
      fieldHint: "Use lowercase letters, numbers, and hyphens. This ID also appears in the domain verification record.",
      findIt: "Create a unique label for this connection. It does not need to match a value in your identity provider.",
      aliases: "Connection ID, provider slug, or SSO identifier",
      placeholder: "acme-sso",
      example: "acme-sso",
      pattern: "[a-z0-9\\-]+",
    },
    {
      key: "domain",
      title: "Add the sign-in email domain",
      summary: "ItemTraxx uses this domain to route members to the right sign-in provider.",
      fieldLabel: "Verified email domain",
      fieldHint: "Enter only the part after @. You will verify ownership with a DNS TXT record after creating the connection.",
      findIt: "Use the email domain assigned to people in this workspace. For example, for alex@example.edu, enter example.edu.",
      aliases: "Email domain, company domain, or sign-in domain",
      placeholder: "example.edu",
      example: "district.example.edu",
      pattern: "(?=.{1,253}$)(?:[A-Za-z0-9](?:[A-Za-z0-9\\-]{0,61}[A-Za-z0-9])?\\.)+[A-Za-z]{2,63}",
    },
    {
      key: "issuer",
      title: protocol.value === "saml" ? "Enter the IdP issuer" : "Enter the OIDC issuer URL",
      summary: protocol.value === "saml"
        ? "This identifies the identity provider that will send SAML responses to ItemTraxx."
        : "This identifies the OIDC provider that authenticates your users.",
      fieldLabel: protocol.value === "saml" ? "Identity provider issuer / entity ID" : "OIDC issuer URL",
      fieldHint: protocol.value === "saml"
        ? "Copy the IdP’s identifier exactly. This is not ItemTraxx’s Entity ID."
        : "Enter the issuer URL exactly as shown in your provider’s OIDC metadata.",
      findIt: protocol.value === "saml"
        ? "Open your identity provider’s SAML app settings or metadata and copy its issuer / Entity ID (sometimes called the IdP identifier)."
        : "Open the OIDC application or its discovery document and copy the issuer value. It is often the base URL before /.well-known/openid-configuration.",
      aliases: protocol.value === "saml" ? "Issuer, Entity ID, IdP Entity ID, or Identifier" : "Issuer, issuer URL, authority, or tenant issuer",
      placeholder: protocol.value === "saml" ? "https://idp.example.com/issuer" : "https://login.example.com/tenant/v2.0",
      example: protocol.value === "saml" ? "urn:example:identity-provider" : "https://login.example.com/tenant/v2.0",
      inputType: protocol.value === "oidc" ? "url" : "text",
    },
  ];

  const providerSteps: WizardStep[] = protocol.value === "saml"
    ? [
      {
        key: "entryPoint",
        title: "Add the IdP single sign-on URL",
        summary: "ItemTraxx sends the browser to this endpoint to sign in with SAML.",
        fieldLabel: "IdP SSO URL",
        fieldHint: "Copy the identity provider’s SAML sign-in endpoint, not the ItemTraxx ACS URL.",
        findIt: "Open your identity provider’s SAML app settings or metadata and copy its single sign-on endpoint. It may be listed as the SSO URL, Sign-on URL, Login URL, or entryPoint.",
        aliases: "SSO endpoint, Single Sign-On URL, Sign-on URL, or Login URL",
        placeholder: "https://idp.example.com/saml/sso",
        example: "https://login.example.com/sso/saml",
        inputType: "url",
      },
      {
        key: "certificate",
        title: "Add the IdP signing certificate",
        summary: "ItemTraxx uses this public certificate to validate signed SAML responses.",
        fieldLabel: "IdP signing certificate",
        fieldHint: "Paste the full public X.509 certificate text supplied by your IdP. Keep the BEGIN/END lines if it provides PEM format.",
        findIt: "Open your identity provider’s SAML app settings or download its metadata. Copy the public signing certificate, often labeled X.509 Certificate, Certificate, or Signing Certificate.",
        aliases: "Public key, signing certificate, X.509 certificate, or SAML certificate",
        placeholder: "-----BEGIN CERTIFICATE-----\nMIIC...\n-----END CERTIFICATE-----",
        example: "Paste the complete public certificate; include the BEGIN/END lines when provided.",
        multiline: true,
      },
    ]
    : [
      {
        key: "discoveryEndpoint",
        title: "Add the OIDC discovery URL",
        summary: "ItemTraxx reads the provider’s OpenID configuration from this URL.",
        fieldLabel: "OIDC discovery URL",
        fieldHint: "Use the complete URL to the OpenID Connect discovery document.",
        findIt: "Your identity provider’s OIDC app settings or discovery document will list this URL. It usually ends in /.well-known/openid-configuration.",
        aliases: "Discovery URL, OpenID configuration URL, or well-known endpoint",
        placeholder: "https://login.example.com/.well-known/openid-configuration",
        example: "https://login.example.com/tenant/.well-known/openid-configuration",
        inputType: "url",
      },
      {
        key: "clientId",
        title: "Add the OIDC client ID",
        summary: "This identifies the ItemTraxx sign-in integration in your identity provider.",
        fieldLabel: "Client ID",
        fieldHint: "Copy the public application identifier. It is not the client secret.",
        findIt: "Open the OIDC app registration in your identity provider and copy its application or client identifier.",
        aliases: "Application ID, OAuth client ID, or app ID",
        placeholder: "7f31a8c2-example-client",
        example: "7f31a8c2-example-client",
      },
      {
        key: "clientSecret",
        title: "Add the OIDC client secret",
        summary: "This credential lets ItemTraxx exchange an authorization code with your identity provider.",
        fieldLabel: "Client secret",
        fieldHint: "Paste the secret value shown when you created the OIDC app. Some providers show it only once.",
        findIt: "Open the app registration’s client credentials page and copy the secret value (not its secret ID or name).",
        aliases: "Client secret value, OAuth secret, or application secret",
        placeholder: "Paste the client secret value",
        example: "A private value generated by your identity provider",
        inputType: "password",
        autocomplete: "new-password",
      },
    ];

  return [...shared, ...providerSteps, {
    key: "review",
    title: "Review your connection",
    summary: "Confirm the details before ItemTraxx saves this SSO connection.",
  }];
});

const activeStep = computed(() => steps.value[currentStep.value] ?? steps.value[0]!);
const progressPercent = computed(() => ((currentStep.value + 1) / steps.value.length) * 100);
const fieldValue = computed({
  get: () => {
    switch (activeStep.value.key) {
      case "providerId": return providerId.value;
      case "domain": return domain.value;
      case "issuer": return issuer.value;
      case "entryPoint": return entryPoint.value;
      case "certificate": return certificate.value;
      case "discoveryEndpoint": return discoveryEndpoint.value;
      case "clientId": return clientId.value;
      case "clientSecret": return clientSecret.value;
      default: return "";
    }
  },
  set: (value: string) => {
    switch (activeStep.value.key) {
      case "providerId": providerId.value = value; break;
      case "domain": domain.value = value; break;
      case "issuer": issuer.value = value; break;
      case "entryPoint": entryPoint.value = value; break;
      case "certificate": certificate.value = value; break;
      case "discoveryEndpoint": discoveryEndpoint.value = value; break;
      case "clientId": clientId.value = value; break;
      case "clientSecret": clientSecret.value = value; break;
    }
    message.value = "";
    error.value = false;
    stepError.value = "";
  },
});

const reviewRows = computed(() => [
  { key: "protocol" as WizardKey, label: "Protocol", value: protocolLabel.value },
  ...steps.value
    .filter((step) => step.key !== "protocol" && step.key !== "review")
    .map((step) => ({ key: step.key, label: step.fieldLabel ?? step.title, value: reviewValue(step.key) })),
]);

function reviewValue(key: WizardKey): string {
  switch (key) {
    case "providerId": return providerId.value;
    case "domain": return domain.value;
    case "issuer": return issuer.value;
    case "entryPoint": return entryPoint.value;
    case "certificate": return "Certificate added";
    case "discoveryEndpoint": return discoveryEndpoint.value;
    case "clientId": return clientId.value;
    case "clientSecret": return "Client secret added";
    default: return "";
  }
}

function setProtocol(value: "saml" | "oidc") {
  protocol.value = value;
  currentStep.value = 0;
  revealSecret.value = false;
  message.value = "";
  error.value = false;
  stepError.value = "";
}

function isValidHttpUrl(value: string) {
  try {
    const url = new URL(value.trim());
    return url.protocol === "https:" || url.protocol === "http:";
  } catch {
    return false;
  }
}

function isValidSamlIssuer(value: string) {
  return /^[a-z][a-z\d+.-]*:\S+$/i.test(value.trim());
}

function getCertificateIssue(value: string) {
  const trimmed = value.trim();
  if (!trimmed) return "Paste the public signing certificate from your identity provider.";
  if (/-----BEGIN [^-]*PRIVATE KEY-----/i.test(trimmed)) {
    return "This looks like a private key. Copy the public SAML signing certificate (X.509) from your identity provider instead. Never paste a private key here.";
  }
  if (trimmed.includes("<") && trimmed.includes(">")) {
    return "This looks like full metadata XML. Copy only the public X.509 signing certificate from the metadata or your provider’s SAML settings.";
  }

  const pem = trimmed.match(/^-----BEGIN CERTIFICATE-----\s*([\s\S]+?)\s*-----END CERTIFICATE-----$/);
  const body = pem?.[1] ?? (/-----BEGIN|-----END/.test(trimmed) ? "" : trimmed);
  const base64 = body.replace(/\s+/g, "");
  if (!/^[A-Za-z0-9+/]+={0,2}$/.test(base64) || base64.length < 100) {
    return "This doesn’t look like a public X.509 certificate. Paste the full certificate in PEM or base64 format, not the SSO URL or full metadata document.";
  }
  return "";
}

function isStepComplete(key: WizardKey) {
  switch (key) {
    case "protocol": return true;
    case "providerId": return /^[a-z0-9-]+$/.test(providerId.value.trim());
    case "domain": return /^(?=.{1,253}$)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/i.test(domain.value.trim());
    case "issuer": return protocol.value === "saml" ? isValidSamlIssuer(issuer.value) : isValidHttpUrl(issuer.value);
    case "entryPoint": return isValidHttpUrl(entryPoint.value);
    case "certificate": return !getCertificateIssue(certificate.value);
    case "discoveryEndpoint": return isValidHttpUrl(discoveryEndpoint.value);
    case "clientId": return Boolean(clientId.value.trim());
    case "clientSecret": return Boolean(clientSecret.value.trim());
    case "review": return true;
  }
}

function getStepError(key: WizardKey) {
  switch (key) {
    case "providerId": return "Use lowercase letters, numbers, and hyphens only (for example, acme-sso). Remove spaces or underscores.";
    case "domain": return "Enter only the email domain, such as example.edu. Remove the @, https://, or any path.";
    case "issuer": return protocol.value === "saml"
      ? "Enter the IdP’s issuer / Entity ID as a URI, such as https://idp.example.com/issuer or urn:example:idp. Don’t use the SSO URL or ItemTraxx’s Entity ID."
      : "Enter the issuer URL from your provider’s OIDC configuration, not the full discovery URL. It should start with http:// or https://.";
    case "entryPoint": return "Enter the identity provider’s SAML single sign-on URL, not ItemTraxx’s ACS URL. Copy it from the provider’s SAML app settings.";
    case "certificate": return getCertificateIssue(certificate.value);
    case "discoveryEndpoint": return "Enter the full OIDC discovery URL from your provider. It commonly ends in /.well-known/openid-configuration.";
    case "clientId": return "Enter the client ID from your OIDC application.";
    case "clientSecret": return "Enter the client secret value from your OIDC application.";
    default: return "Complete this step to continue.";
  }
}

async function focusField() {
  await nextTick();
  currentInput.value?.focus();
}

async function goForward() {
  if (activeStep.value.key !== "protocol" && !isStepComplete(activeStep.value.key)) {
    stepError.value = getStepError(activeStep.value.key);
    currentInput.value?.reportValidity();
    return;
  }
  stepError.value = "";
  if (currentStep.value < steps.value.length - 1) {
    currentStep.value += 1;
    revealSecret.value = false;
    await focusField();
  }
}

async function goBack() {
  if (currentStep.value > 0) {
    currentStep.value -= 1;
    revealSecret.value = false;
    stepError.value = "";
    await focusField();
  }
}

async function editStep(key: WizardKey) {
  const targetIndex = steps.value.findIndex((step) => step.key === key);
  if (targetIndex < 0 || connectionCreated.value) return;
  currentStep.value = targetIndex;
  revealSecret.value = false;
  stepError.value = "";
  await focusField();
}

const loadProviders = async () => {
  const query = organizationId.value ? `?organizationId=${encodeURIComponent(organizationId.value)}` : "";
  const response = await fetch(`${edgeOrigin}/api/itemtraxx/sso/providers${query}`, { credentials: "include" });
  if (!response.ok) throw new Error("Unable to load SSO configuration");
  const data = await response.json() as { organizationId?: string | null; providers?: Provider[]; workspaces?: Workspace[] };
  providers.value = data.providers ?? [];
  workspaces.value = data.workspaces ?? workspaces.value;
  if (!organizationId.value) organizationId.value = data.organizationId ?? workspaces.value[0]?.organizationId ?? "";
};

function refreshProviders() {
  message.value = "";
  error.value = false;
  void loadProviders().catch((cause) => {
    error.value = true;
    message.value = cause instanceof Error ? cause.message : "Unable to load SSO configuration";
  });
}

async function submitConnection() {
  if (connectionCreated.value || activeStep.value.key !== "review") return;
  const incompleteIndex = steps.value.findIndex((step, index) => index > 0 && index < steps.value.length - 1 && !isStepComplete(step.key));
  if (incompleteIndex >= 0) {
    currentStep.value = incompleteIndex;
    stepError.value = getStepError(steps.value[incompleteIndex]!.key);
    await nextTick();
    currentInput.value?.reportValidity();
    return;
  }

  saving.value = true;
  message.value = "";
  error.value = false;
  try {
    const common = {
      providerId: providerId.value.trim(),
      domain: domain.value.trim().toLowerCase(),
      issuer: issuer.value.trim(),
      organizationId: organizationId.value,
    };
    const configuration = protocol.value === "saml"
      ? { ...common, samlConfig: { entryPoint: entryPoint.value.trim(), cert: certificate.value.trim(), wantAssertionsSigned: true } }
      : { ...common, oidcConfig: { discoveryEndpoint: discoveryEndpoint.value.trim(), clientId: clientId.value.trim(), clientSecret: clientSecret.value, pkce: true } };
    const result = await authClient.sso.register(configuration);
    if (result.error) throw new Error(result.error.message);

    domainVerificationProviderId.value = providerId.value.trim();
    domainVerificationDomain.value = domain.value.trim().toLowerCase();
    domainVerificationProtocol.value = protocol.value;
    domainVerificationToken.value = result.data?.domainVerificationToken ?? "";
    connectionCreated.value = true;
    clientSecret.value = "";
    revealSecret.value = false;
    message.value = "SSO connection created. Complete domain verification before enabling sign-in.";
    try {
      await loadProviders();
    } catch {
      message.value = "SSO connection created, but the connection list could not refresh. Reload the page to confirm it.";
      error.value = true;
    }
  } catch (cause) {
    error.value = true;
    message.value = cause instanceof Error ? cause.message : "Unable to create SSO connection";
  } finally {
    saving.value = false;
  }
}

function startAnotherConnection() {
  protocol.value = "saml";
  providerId.value = "";
  domain.value = "";
  issuer.value = "";
  entryPoint.value = "";
  certificate.value = "";
  discoveryEndpoint.value = "";
  clientId.value = "";
  clientSecret.value = "";
  currentStep.value = 0;
  connectionCreated.value = false;
  revealSecret.value = false;
  stepError.value = "";
  message.value = "";
  error.value = false;
}

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
    if (id === domainVerificationProviderId.value) domainVerificationToken.value = "";
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
.sso-settings {
  max-width: 58rem;
}

.back-link {
  display: inline-block;
  margin-bottom: 1rem;
}

.page-heading {
  margin-bottom: 1.4rem;
}

.page-heading h1,
.wizard-heading h2,
.connections-heading h2,
.verification-card h2 {
  margin: 0.15rem 0 0.4rem;
}

.eyebrow {
  margin: 0;
  color: var(--muted);
  font-size: 0.72rem;
  font-weight: 750;
  letter-spacing: 0.1em;
}

.workspace-picker {
  display: grid;
  gap: 0.4rem;
  max-width: 24rem;
  margin: 0 0 1.25rem;
}

.wizard-card {
  padding: clamp(1rem, 3vw, 1.65rem);
}

.wizard-heading {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 1rem;
  padding-bottom: 1.3rem;
  border-bottom: 1px solid var(--border);
}

.wizard-heading > div {
  max-width: 42rem;
}

.wizard-heading .muted {
  margin: 0.4rem 0 0;
}

.protocol-badge,
.connection-count {
  flex: none;
  padding: 0.32rem 0.65rem;
  border: 1px solid var(--border);
  border-radius: 999px;
  background: var(--surface-2);
  font-size: 0.78rem;
  font-weight: 650;
}

.progress-area {
  margin: 1.25rem 0 1.7rem;
}

.progress-caption {
  display: flex;
  justify-content: space-between;
  gap: 0.8rem;
  margin-bottom: 0.45rem;
  color: var(--muted);
  font-size: 0.82rem;
}

.progress-track {
  height: 0.38rem;
  overflow: hidden;
  border-radius: 999px;
  background: var(--surface-2);
}

.progress-fill {
  display: block;
  height: 100%;
  border-radius: inherit;
  background: var(--accent);
  transition: width 0.2s ease;
}

.step-content {
  min-height: 19rem;
}

.step-title-row {
  display: flex;
  align-items: flex-start;
  gap: 0.85rem;
  margin-bottom: 1.35rem;
}

.step-number {
  display: grid;
  place-items: center;
  flex: none;
  width: 2.15rem;
  height: 2.15rem;
  border-radius: 50%;
  background: var(--surface-2);
  font-weight: 700;
}

.step-title-row h3 {
  margin: 0 0 0.25rem;
  font-size: 1.22rem;
}

.step-title-row p {
  margin: 0;
}

.protocol-options {
  display: grid;
  gap: 0.75rem;
  margin: 0;
  padding: 0;
  border: 0;
}

.protocol-option {
  display: flex;
  align-items: flex-start;
  gap: 0.75rem;
  padding: 1rem;
  border: 1px solid var(--border);
  border-radius: 12px;
  background: var(--surface);
  cursor: pointer;
}

.protocol-option.selected {
  border-color: var(--accent);
  box-shadow: 0 0 0 1px var(--accent);
}

.protocol-option input {
  flex: none;
  width: auto;
  margin: 0.2rem 0 0;
  accent-color: var(--accent);
}

.protocol-option-copy {
  display: grid;
  gap: 0.2rem;
}

.protocol-option-copy span,
.field-hint,
.field-guidance,
.review-intro {
  color: var(--muted);
  font-size: 0.9rem;
}

.field-step {
  max-width: 44rem;
}

.wizard-field-label {
  display: block;
  margin: 0 0 0.25rem;
  font-weight: 650;
}

.field-hint {
  margin: 0 0 0.7rem;
}

.field-error {
  margin: 0.6rem 0 0;
  padding: 0.65rem 0.75rem;
  border-left: 3px solid var(--danger);
  border-radius: 4px;
  background: color-mix(in srgb, var(--danger) 9%, var(--surface));
  color: var(--danger);
  font-size: 0.86rem;
  line-height: 1.45;
}

.field-step input,
.field-step textarea {
  width: 100%;
  max-width: none;
}

.field-step input[aria-invalid="true"],
.field-step textarea[aria-invalid="true"] {
  border-color: var(--danger);
  box-shadow: 0 0 0 2px color-mix(in srgb, var(--danger) 28%, transparent);
}

.field-step input[aria-invalid="true"]:focus,
.field-step textarea[aria-invalid="true"]:focus {
  border-color: var(--danger);
  outline-color: var(--danger);
}

.field-step textarea {
  min-height: 10rem;
  resize: vertical;
  line-height: 1.5;
}

.field-guidance {
  display: grid;
  gap: 0.62rem;
  margin: 0.9rem 0 0;
}

.field-guidance span {
  display: grid;
  gap: 0.1rem;
}

.field-guidance strong {
  color: var(--text);
  font-size: 0.82rem;
}

.field-guidance code,
.callback-hint code {
  width: fit-content;
  max-width: 100%;
  padding: 0.2rem 0.4rem;
  border: 1px solid var(--border);
  border-radius: 5px;
  background: var(--surface-2);
  font-size: 0.82rem;
  overflow-wrap: anywhere;
}

.callback-hint {
  display: grid;
  gap: 0.45rem;
  margin-top: 1rem;
  padding: 0.8rem 0.9rem;
  border-left: 3px solid var(--accent-strong);
  border-radius: 4px;
  background: var(--surface-2);
  font-size: 0.86rem;
}

.wizard-actions {
  display: flex;
  align-items: center;
  justify-content: flex-end;
  gap: 0.65rem;
  margin-top: 1.25rem;
  padding-top: 1.1rem;
  border-top: 1px solid var(--border);
}

.actions-spacer {
  flex: 1;
}

.secondary-action {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  min-height: 2.55rem;
  padding: 0.5rem 0.9rem;
  border: 1px solid var(--button-border);
  border-radius: 8px;
  background: var(--button-bg);
  color: var(--text);
  font: inherit;
  font-weight: 600;
}

.wizard-actions .button-primary {
  min-height: 2.55rem;
  padding: 0.55rem 1rem;
  border-radius: 8px;
  font-weight: 650;
}

.review-intro {
  margin: 0 0 0.85rem;
}

.review-list {
  margin: 0;
  border-top: 1px solid var(--border);
}

.review-row {
  display: grid;
  grid-template-columns: minmax(10rem, 0.8fr) minmax(0, 1.6fr) auto;
  align-items: start;
  gap: 0.7rem;
  padding: 0.75rem 0;
  border-bottom: 1px solid var(--border);
}

.review-row dt {
  font-size: 0.88rem;
  font-weight: 600;
}

.review-value {
  min-width: 0;
  margin: 0;
  overflow-wrap: anywhere;
  font-size: 0.88rem;
}

.review-value details summary {
  color: var(--link-color);
  cursor: pointer;
}

.review-value pre {
  max-height: 11rem;
  overflow: auto;
  white-space: pre-wrap;
  overflow-wrap: anywhere;
  font-size: 0.76rem;
}

.secret-review {
  display: flex;
  align-items: center;
  gap: 0.7rem;
}

.text-button {
  padding: 0.1rem 0.2rem;
  border: 0;
  background: transparent;
  color: var(--link-color);
  font: inherit;
  font-size: 0.84rem;
  text-decoration: underline;
  text-underline-offset: 2px;
}

.text-button:hover:not(:disabled) {
  background: transparent;
  transform: none;
}

.review-edit {
  justify-self: end;
}

.review-note {
  margin: 1rem 0 0;
  padding: 0.85rem 1rem;
  border-radius: 8px;
  background: var(--surface-2);
  font-size: 0.87rem;
}

.review-note code {
  display: block;
  margin-top: 0.4rem;
  overflow-wrap: anywhere;
}

.created-label {
  color: var(--success, var(--muted));
  font-size: 0.9rem;
  font-weight: 650;
}

.verification-card {
  border-color: color-mix(in srgb, var(--success, #15803d) 40%, var(--border));
}

.verification-card > p:not(.eyebrow) {
  margin: 0.45rem 0;
}

.dns-record {
  display: grid;
  gap: 0.75rem;
  margin: 1rem 0;
}

.dns-record > div {
  display: grid;
  gap: 0.25rem;
}

.dns-record dt {
  color: var(--muted);
  font-size: 0.8rem;
  font-weight: 650;
}

.dns-record dd {
  margin: 0;
  overflow-wrap: anywhere;
}

.dns-record code {
  display: inline-block;
  max-width: 100%;
  padding: 0.35rem 0.5rem;
  border-radius: 5px;
  background: var(--surface-2);
  font-size: 0.84rem;
  overflow-wrap: anywhere;
}

.metadata-next-step {
  display: grid;
  gap: 0.25rem;
  margin-top: 1rem !important;
  font-size: 0.86rem;
}

.metadata-next-step span {
  color: var(--muted);
}

.connections-heading {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 0.7rem;
}

.connections-heading h2 {
  font-size: 1.25rem;
}

.connection-count {
  min-width: 2rem;
  text-align: center;
}

.provider-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 1rem;
  padding: 1rem 0;
  border-top: 1px solid var(--border);
}

.provider-details {
  display: grid;
  gap: 0.15rem;
  min-width: 0;
}

.provider-details > span {
  color: var(--muted);
  font-size: 0.86rem;
  overflow-wrap: anywhere;
}

.verification-status.is-verified {
  color: var(--success, #15803d);
}

.verification-status.is-pending {
  color: var(--warning, #8a5a00);
}

.provider-actions {
  display: flex;
  align-items: center;
  justify-content: flex-end;
  flex-wrap: wrap;
  gap: 0.6rem;
}

.button-danger {
  color: var(--danger);
}

.form-message {
  margin: 0.8rem 0;
}

.success-message {
  color: var(--success, #15803d);
}

.sr-only {
  position: absolute;
  width: 1px;
  height: 1px;
  padding: 0;
  margin: -1px;
  overflow: hidden;
  clip: rect(0, 0, 0, 0);
  white-space: nowrap;
  border: 0;
}

@media (max-width: 640px) {
  .wizard-heading {
    display: grid;
  }

  .protocol-badge {
    justify-self: start;
  }

  .step-content {
    min-height: 0;
  }

  .review-row {
    grid-template-columns: minmax(0, 1fr) auto;
  }

  .review-row dt {
    grid-column: 1 / -1;
  }

  .review-value {
    grid-column: 1;
  }

  .review-edit {
    grid-column: 2;
    grid-row: 2;
  }

  .provider-row {
    align-items: flex-start;
    flex-direction: column;
  }

  .provider-actions {
    justify-content: flex-start;
  }

  .wizard-actions {
    justify-content: space-between;
  }

  .wizard-actions .button-primary {
    margin-left: auto;
  }
}

@media (prefers-reduced-motion: reduce) {
  .progress-fill {
    transition: none;
  }
}
</style>
