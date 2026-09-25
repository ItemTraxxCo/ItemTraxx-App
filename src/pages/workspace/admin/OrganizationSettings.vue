<template>
  <main class="page admin-shell">
    <header class="admin-hero">
      <div class="page-nav-left">
        <RouterLink class="button-link" to="/admin">Return to workspace home</RouterLink>
      </div>
      <h1>Organization Settings</h1>
      <p class="admin-hero-copy">Manage organization details and shared checkout defaults.</p>
      <p>
        <RouterLink class="button-link" to="/settings/account">Your Account Settings</RouterLink>
        ·
        <RouterLink class="button-link" to="/admin/admins">Admin Access</RouterLink>
        ·
        <RouterLink class="button-link" to="/admin/settings/sso">Enterprise SSO</RouterLink>
      </p>
      <div class="admin-summary-grid">
        <div class="admin-summary-card">
          <strong>{{ checkoutDueHours }}</strong>
          <span>Due window (hours)</span>
        </div>
        <div class="admin-summary-card">
          <strong>{{ organizationProfile?.name || "Loading" }}</strong>
          <span>Workspace</span>
        </div>
      </div>
    </header>

    <section class="card admin-section-card">
      <div class="admin-section-header">
        <div>
          <h2>Organization Profile</h2>
          <p class="admin-section-copy">Update the name and logo shared by this workspace.</p>
        </div>
      </div>

      <p v-if="organizationError" class="error" role="alert">{{ organizationError }}</p>
      <p v-if="organizationSuccess" class="success" role="status">{{ organizationSuccess }}</p>

      <form class="form organization-profile-form" @submit.prevent="saveOrganizationProfile">
        <label>
          Organization name
          <input
            v-model.trim="organizationName"
            type="text"
            maxlength="160"
            autocomplete="organization"
            required
            :disabled="isOrganizationLoading || isOrganizationSaving"
          />
        </label>
        <label>
          Organization slug
          <input :value="organizationProfile?.slug || 'Loading'" type="text" readonly aria-describedby="slug-help" />
          <span id="slug-help" class="muted">The slug is managed separately and determines this organization's app URL.</span>
        </label>

        <div class="logo-editor">
          <div class="logo-preview" aria-live="polite">
            <img v-if="logoPreviewUrl" :src="logoPreviewUrl" :alt="`${organizationName || 'Organization'} logo preview`" />
            <span v-else class="muted">No organization logo set</span>
          </div>
          <div class="logo-controls">
            <label>
              Organization logo
              <input
                ref="logoInput"
                type="file"
                accept="image/png,image/jpeg,image/webp"
                :disabled="isOrganizationLoading || isOrganizationSaving"
                @change="handleLogoSelection"
              />
            </label>
            <p class="muted logo-help">Supported filetypes: PNG, JPEG, or WebP; 2 MB maximum.</p>
            <p v-if="selectedLogo" class="muted">Selected: {{ selectedLogo.name }}</p>
            <button
              v-if="logoPreviewUrl"
              type="button"
              class="text-button"
              :disabled="isOrganizationSaving"
              @click="removeLogo"
            >
              Remove logo
            </button>
          </div>
        </div>

        <div class="form-actions">
          <button
            type="submit"
            class="button-primary"
            :disabled="isOrganizationLoading || isOrganizationSaving || !canSaveOrganization"
          >
            {{ isOrganizationSaving ? "Saving…" : "Save organization settings" }}
          </button>
          <button type="button" :disabled="isOrganizationLoading || isOrganizationSaving" @click="loadOrganization">
            Reload
          </button>
        </div>
      </form>
    </section>

    <section class="card admin-section-card">
      <div class="admin-section-header">
        <div>
          <h2>Account Overview</h2>
          <p class="admin-section-copy">Review how this organization is classified for billing and support purposes.</p>
        </div>
      </div>
      <div class="admin-summary-grid">
        <div class="admin-summary-card">
          <strong>{{ accountCategoryLabel }}</strong>
          <span>Account category</span>
        </div>
        <div class="admin-summary-card">
          <strong>{{ planLabel }}</strong>
          <span>Plan</span>
        </div>
      </div>
      <p class="muted account-overview-copy">
        {{
          accountCategory === "workspace" || accountCategory === "education" || accountCategory === "custom"
            ? "Account category: Workspace"
            : "Account plan metadata has not been configured for this workspace. If you believe this is an error, please contact support."
        }}
      </p>
    </section>

    <section class="card admin-section-card">
      <div class="admin-section-header">
        <div>
          <h2>Default Checkout Policy</h2>
          <p class="admin-section-copy">Set the default checkout due window for your organization.</p>
        </div>
      </div>
      <form class="form" @submit.prevent="saveCheckoutPolicy">
        <label>
          Checkout due limit (hours)
          <input v-model.number="checkoutDueHours" type="number" min="1" max="720" step="1" :disabled="isSettingsSaving" />
        </label>
        <p class="muted">This value is used for overdue notifications. (coming soon)</p>
        <div class="form-actions">
          <button type="submit" class="button-primary" :disabled="isSettingsSaving">Save settings</button>
          <button type="button" :disabled="isSettingsSaving" @click="loadWorkspaceSettings">Reload Settings</button>
        </div>
      </form>
      <p v-if="settingsSuccess" class="success" role="status">{{ settingsSuccess }}</p>
      <p v-if="settingsError" class="error" role="alert">{{ settingsError }}</p>
    </section>
  </main>
</template>

<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref } from "vue";
import { RouterLink } from "vue-router";
import { authClient } from "../../../auth/client";
import { getAuthState } from "../../../store/authState";
import { setWorkspaceState } from "../../../store/workspaceState";
import { toUserFacingErrorMessage } from "../../../services/appErrors";
import {
  fetchWorkspaceSettings,
  updateWorkspaceSettings,
  type WorkspaceSettingsPayload,
} from "../../../services/adminOpsService";
import { uploadOrganizationLogo } from "../../../services/organizationLogoService";

type OrganizationProfile = {
  id: string;
  name: string;
  slug: string;
  logo: string | null;
};

const organizationId = computed(() => getAuthState().sessionWorkspaceId);
const organizationProfile = ref<OrganizationProfile | null>(null);
const organizationName = ref("");
const savedOrganizationName = ref("");
const selectedLogo = ref<File | null>(null);
const selectedLogoPreviewUrl = ref<string | null>(null);
const clearLogo = ref(false);
const logoInput = ref<HTMLInputElement | null>(null);
const isOrganizationLoading = ref(false);
const isOrganizationSaving = ref(false);
const organizationError = ref("");
const organizationSuccess = ref("");

const isSettingsSaving = ref(false);
const settingsError = ref("");
const settingsSuccess = ref("");
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

const logoPreviewUrl = computed(() => {
  if (clearLogo.value) return null;
  return selectedLogoPreviewUrl.value || organizationProfile.value?.logo || null;
});

const canSaveOrganization = computed(() => {
  const nameChanged = organizationName.value.trim() !== savedOrganizationName.value;
  return nameChanged || selectedLogo.value !== null || clearLogo.value;
});

const accountCategoryLabel = computed(() =>
  accountCategory.value === "education"
    ? "Education"
    : accountCategory.value === "custom"
      ? "Custom"
      : accountCategory.value === "workspace"
        ? "Workspace"
        : "Unavailable"
);

const planLabel = computed(() => {
  switch (planCode.value) {
    case "workspace_core": return "Workspace Core";
    case "workspace_growth": return "Workspace Growth";
    case "workspace_enterprise": return "Workspace Enterprise";
    case "education": return "Education";
    case "custom": return "Custom";
    case "individual_yearly": return "Individual Yearly";
    case "individual_monthly": return "Individual Monthly";
    default: return "Unavailable";
  }
});

const applySettings = (settings: WorkspaceSettingsPayload) => {
  checkoutDueHours.value = settings.checkout_due_hours;
  accountCategory.value = settings.account_category === "individual"
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

const loadOrganization = async () => {
  isOrganizationLoading.value = true;
  organizationError.value = "";
  organizationSuccess.value = "";
  try {
    const id = organizationId.value;
    if (!id) throw new Error("No active organization was found for this session.");
    const result = await authClient.organization.getOrganization({ query: { organizationId: id } });
    if (result.error) throw new Error(result.error.message || "Unable to load organization details.");
    if (!result.data) throw new Error("Unable to load organization details.");

    organizationProfile.value = {
      id: result.data.id,
      name: result.data.name,
      slug: result.data.slug,
      logo: result.data.logo ?? null,
    };
    organizationName.value = result.data.name;
    savedOrganizationName.value = result.data.name;
    clearLogo.value = false;
    selectedLogo.value = null;
    if (selectedLogoPreviewUrl.value) URL.revokeObjectURL(selectedLogoPreviewUrl.value);
    selectedLogoPreviewUrl.value = null;
    if (logoInput.value) logoInput.value.value = "";
  } catch (error) {
    organizationError.value = toUserFacingErrorMessage(error, "Unable to load organization details.");
  } finally {
    isOrganizationLoading.value = false;
  }
};

const loadWorkspaceSettings = async () => {
  settingsError.value = "";
  settingsSuccess.value = "";
  try {
    applySettings(await fetchWorkspaceSettings());
  } catch (error) {
    settingsError.value = toUserFacingErrorMessage(error, "Unable to load organization settings.");
  }
};

const handleLogoSelection = (event: Event) => {
  const input = event.target as HTMLInputElement;
  const file = input.files?.[0] ?? null;
  organizationError.value = "";
  if (!file) return;
  if (!["image/png", "image/jpeg", "image/webp"].includes(file.type)) {
    organizationError.value = "Choose a PNG, JPEG, or WebP image.";
    input.value = "";
    return;
  }
  if (file.size > 2 * 1024 * 1024) {
    organizationError.value = "Logo images must be 2 MB or smaller.";
    input.value = "";
    return;
  }

  if (selectedLogoPreviewUrl.value) URL.revokeObjectURL(selectedLogoPreviewUrl.value);
  selectedLogo.value = file;
  selectedLogoPreviewUrl.value = URL.createObjectURL(file);
  clearLogo.value = false;
};

const removeLogo = () => {
  if (selectedLogoPreviewUrl.value) URL.revokeObjectURL(selectedLogoPreviewUrl.value);
  selectedLogoPreviewUrl.value = null;
  selectedLogo.value = null;
  clearLogo.value = true;
  if (logoInput.value) logoInput.value.value = "";
};

const saveOrganizationProfile = async () => {
  organizationError.value = "";
  organizationSuccess.value = "";
  const id = organizationId.value;
  const name = organizationName.value.trim();
  if (!id) {
    organizationError.value = "No active organization was found for this session.";
    return;
  }
  if (!name) {
    organizationError.value = "Enter an organization name.";
    return;
  }

  isOrganizationSaving.value = true;
  try {
    const data: { name?: string; logo?: string | null } = {};
    if (name !== savedOrganizationName.value) data.name = name;
    if (selectedLogo.value) {
      data.logo = await uploadOrganizationLogo(id, selectedLogo.value);
    } else if (clearLogo.value) {
      data.logo = null;
    }
    if (!Object.keys(data).length) return;

    const result = await authClient.organization.update({ organizationId: id, data });
    if (result.error) throw new Error(result.error.message || "Unable to save organization details.");
    if (!result.data) throw new Error("Unable to save organization details.");

    organizationProfile.value = {
      id: result.data.id,
      name: result.data.name,
      slug: result.data.slug,
      logo: result.data.logo ?? null,
    };
    organizationName.value = result.data.name;
    savedOrganizationName.value = result.data.name;
    setWorkspaceState({ workspaceName: result.data.name });
    clearLogo.value = false;
    selectedLogo.value = null;
    if (selectedLogoPreviewUrl.value) URL.revokeObjectURL(selectedLogoPreviewUrl.value);
    selectedLogoPreviewUrl.value = null;
    if (logoInput.value) logoInput.value.value = "";
    organizationSuccess.value = "Organization details saved.";
  } catch (error) {
    organizationError.value = toUserFacingErrorMessage(error, "Unable to save organization details.");
  } finally {
    isOrganizationSaving.value = false;
  }
};

const saveCheckoutPolicy = async () => {
  settingsError.value = "";
  settingsSuccess.value = "";
  const hours = Number(checkoutDueHours.value);
  if (!Number.isFinite(hours) || hours < 1 || hours > 720) {
    settingsError.value = "Checkout due limit must be between 1 and 720 hours.";
    return;
  }
  isSettingsSaving.value = true;
  try {
    applySettings(await updateWorkspaceSettings({ checkout_due_hours: Math.round(hours) }));
    settingsSuccess.value = "Checkout policy saved.";
  } catch (error) {
    settingsError.value = toUserFacingErrorMessage(error, "Unable to save checkout policy.");
  } finally {
    isSettingsSaving.value = false;
  }
};

onMounted(() => {
  void loadOrganization();
  void loadWorkspaceSettings();
});

onUnmounted(() => {
  if (selectedLogoPreviewUrl.value) URL.revokeObjectURL(selectedLogoPreviewUrl.value);
});
</script>

<style scoped>
.account-overview-copy {
  font-size: 0.82rem;
  color: var(--muted);
}

.organization-profile-form {
  max-width: 42rem;
}

.logo-editor {
  display: grid;
  grid-template-columns: minmax(8rem, 11rem) minmax(0, 1fr);
  gap: 1.25rem;
  align-items: start;
}

.logo-preview {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 100%;
  min-height: 8rem;
  padding: 0.75rem;
  border: 1px dashed var(--border);
  border-radius: 0.75rem;
  background: var(--surface-2);
  text-align: center;
}

.logo-preview img {
  display: block;
  max-width: 100%;
  max-height: 8rem;
  object-fit: contain;
}

.logo-controls {
  display: grid;
  justify-items: start;
  gap: 0.4rem;
}

.logo-help {
  margin: 0;
}

.text-button {
  padding: 0;
  border: 0;
  color: var(--danger);
  background: transparent;
  text-decoration: underline;
  text-underline-offset: 0.15em;
}

@media (max-width: 600px) {
  .logo-editor {
    grid-template-columns: 1fr;
  }

  .logo-preview {
    max-width: 12rem;
  }
}
</style>
