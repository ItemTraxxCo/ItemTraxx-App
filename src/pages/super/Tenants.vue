<template>
  <div class="page">
    <div class="super-page-header">
      <div>
        <div class="page-nav-left">
          <RouterLink class="button-link" to="/super-admin">Control Center</RouterLink>
          <RouterLink class="button-link" to="/super-admin/districts">Districts</RouterLink>
          <RouterLink class="button-link" to="/super-admin/admins">Admins</RouterLink>
        </div>
        <h1>Tenant Management</h1>
        <p>Create tenants, assign districts, and manage lifecycle changes without leaving this page.</p>
      </div>
      <div class="page-nav-left super-page-links">
        <RouterLink class="button-link" to="/super-admin/gear">All Items</RouterLink>
        <RouterLink class="button-link" to="/super-admin/students">All Borrowers</RouterLink>
        <RouterLink class="button-link" to="/super-admin/logs">All Logs</RouterLink>
      </div>
    </div>

    <div class="admin-grid tenant-stats">
      <div class="stat-card">
        <h3>Total tenants</h3>
        <p class="stat-value">{{ tenants.length }}</p>
      </div>
      <div class="stat-card">
        <h3>Active</h3>
        <p class="stat-value">{{ activeTenantCount }}</p>
      </div>
      <div class="stat-card">
        <h3>Disabled</h3>
        <p class="stat-value">{{ disabledTenantCount }}</p>
      </div>
      <div class="stat-card">
        <h3>District linked</h3>
        <p class="stat-value">{{ districtLinkedTenantCount }}</p>
      </div>
      <div class="stat-card">
        <h3>Individual</h3>
        <p class="stat-value">{{ individualTenantCount }}</p>
      </div>
    </div>

    <div class="section-grid">
      <div class="card section-card">
        <div class="section-heading">
          <div>
            <h2>Tenant List</h2>
            <p class="muted">Search, filter, edit, and change tenant status from one table.</p>
          </div>
          <button type="button" class="button-primary" @click="createModalVisible = true">
            Create New Tenant
          </button>
        </div>
        <div class="filter-toolbar">
          <div class="input-row">
            <input v-model="search" type="text" placeholder="Search by tenant name or access code" />
            <button type="button" @click="loadTenants">Search</button>
          </div>
          <label class="filter-select">
            Filter status
            <select v-model="statusFilterLabel" @change="loadTenants">
              <option value="all">all</option>
              <option value="active">active</option>
              <option value="disabled">disabled</option>
              <option value="archived">archived</option>
            </select>
          </label>
        </div>

        <p v-if="isLoading" class="muted">Loading tenants...</p>
        <p v-else-if="error" class="error">{{ error }}</p>
        <div v-else class="table-wrap tenant-table-wrap">
          <table class="table tenant-table">
            <thead>
              <tr>
                <th>Name</th>
                <th>Type</th>
                <th>Plan</th>
                <th>District</th>
                <th>Access Code</th>
                <th>Status</th>
                <th>Primary Admin</th>
                <th>Created</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="tenant in tenants" :key="tenant.id">
                <td>{{ tenant.name }}</td>
                <td>{{ formatAccountCategory(tenant.account_category) }}</td>
                <td>{{ formatPlanCode(tenant.plan_code) }}</td>
                <td>{{ tenant.district_slug || tenant.district_name || "-" }}</td>
                <td>{{ tenant.access_code }}</td>
                <td>{{ toTenantStatusLabel(tenant.status) }}</td>
                <td>{{ tenant.primary_admin_email || "-" }}</td>
                <td>{{ formatDate(tenant.created_at) }}</td>
                <td class="actions-cell">
                  <button type="button" @click="openEditModal(tenant)">Edit</button>
                  <button type="button" :disabled="isSaving" @click="openStatusModal(tenant)">
                    {{
                      tenant.status === "active"
                        ? "Disable"
                        : tenant.status === "suspended"
                          ? "Reactivate"
                          : "Restore"
                    }}
                  </button>
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>
    </div>

    <div v-if="createModalVisible" class="modal-backdrop" @click.self="closeCreateModal">
      <div class="modal">
        <h2>Create Tenant</h2>
        <p class="muted modal-copy">Provision tenant access and attach it to an active district.</p>
        <form class="form" @submit.prevent="handleCreate">
          <label>
            Name
            <input v-model="createName" type="text" placeholder="Tenant name" />
          </label>
          <label>
            Access Code
            <input v-model="createAccessCode" type="text" placeholder="Access code" />
          </label>
          <label>
            Tenant Admin Email
            <input v-model="createAuthEmail" type="email" placeholder="admin@tenant.com" />
          </label>
          <label>
            Tenant Admin Password
            <input
              v-model="createPassword"
              type="password"
              placeholder="Minimum 8 characters"
              autocomplete="off"
            />
          </label>
          <label>
            Account Type
            <select v-model="createAccountCategory">
              <option value="organization">Organization</option>
              <option value="district">District</option>
              <option value="individual">Individual</option>
            </select>
          </label>
          <label>
            Plan
            <select v-model="createPlanCode">
              <option
                v-for="option in createPlanOptions"
                :key="option.value"
                :value="option.value"
              >
                {{ option.label }}
              </option>
            </select>
          </label>
          <label>
            Status
            <select v-model="createStatusLabel">
              <option value="active">active</option>
              <option value="disabled">disabled</option>
            </select>
          </label>
          <label v-if="createAccountCategory !== 'individual'">
            District
            <select v-model="createDistrictId">
              <option value="">No district</option>
              <option v-for="district in activeDistricts" :key="district.id" :value="district.id">
                {{ district.name }} ({{ district.slug }})
              </option>
            </select>
          </label>
          <div class="form-actions">
            <button type="submit" class="button-primary" :disabled="isSaving">Create Tenant</button>
            <button type="button" @click="closeCreateModal">Cancel</button>
          </div>
        </form>
      </div>
    </div>

    <div v-if="editModalVisible" class="modal-backdrop" @click.self="closeEditModal">
      <div class="modal">
        <h2>Edit Tenant</h2>
        <form class="form" @submit.prevent="saveEdit">
          <label>
            Name
            <input v-model="editName" type="text" placeholder="Tenant name" />
          </label>
          <label>
            Access Code
            <input v-model="editAccessCode" type="text" placeholder="Access code" />
          </label>
          <label>
            Account Type
            <select v-model="editAccountCategory">
              <option value="organization">Organization</option>
              <option value="district">District</option>
              <option value="individual">Individual</option>
            </select>
          </label>
          <label>
            Plan
            <select v-model="editPlanCode">
              <option
                v-for="option in editPlanOptions"
                :key="option.value"
                :value="option.value"
              >
                {{ option.label }}
              </option>
            </select>
          </label>
          <label v-if="editAccountCategory !== 'individual'">
            District
            <select v-model="editDistrictId">
              <option value="">No district</option>
              <option v-for="district in activeDistricts" :key="district.id" :value="district.id">
                {{ district.name }} ({{ district.slug }})
              </option>
            </select>
          </label>
          <label>
            Checkout due limit (hours)
            <input v-model.number="editCheckoutDueHours" type="number" min="1" max="720" />
          </label>
          <h3>Feature Flags</h3>
          <label>
            <input v-model="editFeatureFlags.enable_notifications" type="checkbox" />
            Notifications
          </label>
          <label>
            <input v-model="editFeatureFlags.enable_bulk_item_import" type="checkbox" />
            Bulk item import
          </label>
          <label>
            <input v-model="editFeatureFlags.enable_bulk_student_tools" type="checkbox" />
            Bulk student tools
          </label>
          <label>
            <input v-model="editFeatureFlags.enable_status_tracking" type="checkbox" />
            Item status tracking
          </label>
          <label>
            <input v-model="editFeatureFlags.enable_barcode_generator" type="checkbox" />
            Barcode generator
          </label>
          <div class="form-actions">
            <button type="button" :disabled="isSaving" @click="sendEditTenantReset">
              Send Reset Link
            </button>
            <button type="submit" class="button-primary" :disabled="isSaving">Save</button>
            <button type="button" @click="closeEditModal">Cancel</button>
          </div>
        </form>
      </div>
    </div>

    <div v-if="toastMessage" class="toast">
      <div class="toast-title">{{ toastTitle }}</div>
      <div class="toast-body">{{ toastMessage }}</div>
    </div>

    <StepUpModal
      :visible="statusModalVisible"
      :title="statusModalTitle"
      :message="statusModalMessage"
      :confirm-label="statusModalConfirmLabel"
      @cancel="closeStatusModal"
      @confirm="confirmStatusChange"
    />
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, ref, watch } from "vue";
import { RouterLink, useRouter } from "vue-router";
import StepUpModal from "../../components/StepUpModal.vue";
import {
  handleSuperAdminUnauthorized,
  isUnauthorizedError,
} from "../../services/authErrorHandling";
import { setTenantPolicy } from "../../services/superOpsService";
import {
  createTenant,
  fromTenantStatusLabel,
  listDistricts,
  listTenants,
  sendPrimaryAdminReset,
  setTenantStatus,
  toTenantStatusLabel,
  updateTenant,
  type SuperDistrict,
  type SuperTenant,
} from "../../services/superTenantService";

const router = useRouter();
const tenants = ref<SuperTenant[]>([]);
const districts = ref<SuperDistrict[]>([]);
const isLoading = ref(false);
const isSaving = ref(false);
const error = ref("");
const search = ref("");
const statusFilterLabel = ref<"all" | "active" | "disabled" | "archived">("all");
const createName = ref("");
const createAccessCode = ref("");
const createAuthEmail = ref("");
const createPassword = ref("");
const createAccountCategory = ref<"organization" | "district" | "individual">("organization");
const createPlanCode = ref<
  "core" | "growth" | "starter" | "scale" | "enterprise" | "individual_yearly" | "individual_monthly"
>("starter");
const createStatusLabel = ref<"active" | "disabled">("active");
const createDistrictId = ref("");
const createModalVisible = ref(false);
const editTenantId = ref<string | null>(null);
const editModalVisible = ref(false);
const editName = ref("");
const editAccessCode = ref("");
const editAccountCategory = ref<"organization" | "district" | "individual">("organization");
const editPlanCode = ref<
  "core" | "growth" | "starter" | "scale" | "enterprise" | "individual_yearly" | "individual_monthly"
>("starter");
const editDistrictId = ref("");
const editCheckoutDueHours = ref(72);
const editFeatureFlags = ref({
  enable_notifications: true,
  enable_bulk_item_import: true,
  enable_bulk_student_tools: true,
  enable_status_tracking: true,
  enable_barcode_generator: true,
});
const initialEditCheckoutDueHours = ref(72);
const initialEditFeatureFlags = ref({
  enable_notifications: true,
  enable_bulk_item_import: true,
  enable_bulk_student_tools: true,
  enable_status_tracking: true,
  enable_barcode_generator: true,
});
const toastTitle = ref("");
const toastMessage = ref("");
const statusModalVisible = ref(false);
const statusModalTitle = ref("");
const statusModalMessage = ref("");
const statusModalConfirmLabel = ref("Confirm");
const statusTarget = ref<{ id: string; name: string; nextStatus: "active" | "suspended" | "archived" } | null>(null);
let toastTimer: number | null = null;

const activeDistricts = computed(() =>
  districts.value.filter((district) => district.is_active !== false)
);
const activeTenantCount = computed(() => tenants.value.filter((tenant) => tenant.status === "active").length);
const disabledTenantCount = computed(() =>
  tenants.value.filter((tenant) => tenant.status === "suspended").length
);
const districtLinkedTenantCount = computed(() =>
  tenants.value.filter((tenant) => !!tenant.district_id).length
);
const individualTenantCount = computed(
  () => tenants.value.filter((tenant) => tenant.account_category === "individual").length
);

const planOptionsByCategory = {
  district: [
    { value: "core", label: "Core" },
    { value: "growth", label: "Growth" },
    { value: "enterprise", label: "Enterprise" },
  ],
  organization: [
    { value: "starter", label: "Starter" },
    { value: "scale", label: "Scale" },
    { value: "enterprise", label: "Enterprise" },
  ],
  individual: [
    { value: "individual_yearly", label: "Individual Yearly" },
    { value: "individual_monthly", label: "Individual Monthly" },
  ],
} as const;

const createPlanOptions = computed(() => planOptionsByCategory[createAccountCategory.value]);
const editPlanOptions = computed(() => planOptionsByCategory[editAccountCategory.value]);

const formatAccountCategory = (value: SuperTenant["account_category"]) =>
  value === "individual" ? "Individual" : value === "district" ? "District" : "Organization";

const formatPlanCode = (value: SuperTenant["plan_code"]) => {
  switch (value) {
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
      return "-";
  }
};

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

const formatDate = (value: string) => {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleDateString();
};

const loadTenants = async () => {
  isLoading.value = true;
  error.value = "";
  try {
    const status =
      statusFilterLabel.value === "all"
        ? "all"
        : fromTenantStatusLabel(statusFilterLabel.value);
    tenants.value = await listTenants(search.value.trim(), status);
  } catch (err) {
    if (isUnauthorizedError(err)) {
      error.value = "Your session expired. Sign in again.";
      await handleSuperAdminUnauthorized(router);
      return;
    }
    error.value = err instanceof Error ? err.message : "Unable to load tenants.";
  } finally {
    isLoading.value = false;
  }
};

const loadDistrictOptions = async () => {
  try {
    districts.value = await listDistricts("");
  } catch {
    districts.value = [];
  }
};

const handleCreate = async () => {
  if (
    !createName.value.trim() ||
    !createAccessCode.value.trim() ||
    !createAuthEmail.value.trim() ||
    !createPassword.value
  ) {
    showToast(
      "Invalid input",
      "Enter tenant name, access code, tenant admin email, and password."
    );
    return;
  }
  if (createPassword.value.length < 8) {
    showToast("Invalid input", "Tenant admin password must be at least 8 characters.");
    return;
  }
  const selectedDistrict = activeDistricts.value.find(
    (district) => district.id === createDistrictId.value
  );
  isSaving.value = true;
  try {
    const created = await createTenant({
      name: createName.value.trim(),
      access_code: createAccessCode.value.trim(),
      auth_email: createAuthEmail.value.trim().toLowerCase(),
      password: createPassword.value,
      status: fromTenantStatusLabel(createStatusLabel.value),
      account_category: createAccountCategory.value,
      plan_code: createPlanCode.value,
      district_name:
        createAccountCategory.value !== "individual" ? selectedDistrict?.name || undefined : undefined,
      district_slug:
        createAccountCategory.value !== "individual" ? selectedDistrict?.slug || undefined : undefined,
    });
    tenants.value = [created, ...tenants.value];
    createName.value = "";
    createAccessCode.value = "";
    createAuthEmail.value = "";
    createPassword.value = "";
    createAccountCategory.value = "organization";
    createPlanCode.value = "starter";
    createStatusLabel.value = "active";
    createDistrictId.value = "";
    createModalVisible.value = false;
    showToast("Tenant created", "Tenant and tenant admin login were created successfully.");
  } catch (err) {
    showToast("Create failed", err instanceof Error ? err.message : "Unable to create tenant.");
  } finally {
    isSaving.value = false;
  }
};

const closeCreateModal = () => {
  createModalVisible.value = false;
  createName.value = "";
  createAccessCode.value = "";
  createAuthEmail.value = "";
  createPassword.value = "";
  createAccountCategory.value = "organization";
  createPlanCode.value = "starter";
  createStatusLabel.value = "active";
  createDistrictId.value = "";
};

const openEditModal = (tenant: SuperTenant) => {
  editTenantId.value = tenant.id;
  editName.value = tenant.name;
  editAccessCode.value = tenant.access_code;
  editAccountCategory.value =
    tenant.account_category === "individual"
      ? "individual"
      : tenant.account_category === "district"
        ? "district"
        : "organization";
  editPlanCode.value =
    tenant.plan_code ??
    (tenant.account_category === "individual"
      ? "individual_yearly"
      : tenant.account_category === "district"
        ? "core"
        : "starter");
  editDistrictId.value = tenant.district_id ?? "";
  editCheckoutDueHours.value =
    typeof tenant.checkout_due_hours === "number"
      ? tenant.checkout_due_hours
      : 72;
  editFeatureFlags.value = {
    enable_notifications: tenant.feature_flags?.enable_notifications !== false,
    enable_bulk_item_import: tenant.feature_flags?.enable_bulk_item_import !== false,
    enable_bulk_student_tools: tenant.feature_flags?.enable_bulk_student_tools !== false,
    enable_status_tracking: tenant.feature_flags?.enable_status_tracking !== false,
    enable_barcode_generator: tenant.feature_flags?.enable_barcode_generator !== false,
  };
  initialEditCheckoutDueHours.value = editCheckoutDueHours.value;
  initialEditFeatureFlags.value = { ...editFeatureFlags.value };
  editModalVisible.value = true;
};

const closeEditModal = () => {
  editModalVisible.value = false;
  editTenantId.value = null;
  editName.value = "";
  editAccessCode.value = "";
  editAccountCategory.value = "organization";
  editPlanCode.value = "starter";
  editDistrictId.value = "";
  editCheckoutDueHours.value = 72;
  initialEditCheckoutDueHours.value = 72;
  initialEditFeatureFlags.value = {
    enable_notifications: true,
    enable_bulk_item_import: true,
    enable_bulk_student_tools: true,
    enable_status_tracking: true,
    enable_barcode_generator: true,
  };
};

const saveEdit = async () => {
  if (!editTenantId.value) return;
  if (!editName.value.trim() || !editAccessCode.value.trim()) {
    showToast("Invalid input", "Enter tenant name and access code.");
    return;
  }
  const selectedDistrict = activeDistricts.value.find(
    (district) => district.id === editDistrictId.value
  );
  if (
    !Number.isFinite(editCheckoutDueHours.value) ||
    editCheckoutDueHours.value < 1 ||
    editCheckoutDueHours.value > 720
  ) {
    showToast("Invalid input", "Checkout due limit must be between 1 and 720 hours.");
    return;
  }

  isSaving.value = true;
  try {
    const updated = await updateTenant({
      id: editTenantId.value,
      name: editName.value.trim(),
      access_code: editAccessCode.value.trim(),
      account_category: editAccountCategory.value,
      plan_code: editPlanCode.value,
      district_name:
        editAccountCategory.value !== "individual" ? selectedDistrict?.name || undefined : undefined,
      district_slug:
        editAccountCategory.value !== "individual" ? selectedDistrict?.slug || undefined : undefined,
    });
    tenants.value = tenants.value.map((tenant) =>
      tenant.id === updated.id ? updated : tenant
    );
    const policyChanged =
      Math.round(editCheckoutDueHours.value) !== initialEditCheckoutDueHours.value ||
      JSON.stringify(editFeatureFlags.value) !== JSON.stringify(initialEditFeatureFlags.value);
    if (policyChanged) {
      await setTenantPolicy({
        tenant_id: editTenantId.value,
        checkout_due_hours: Math.round(editCheckoutDueHours.value),
        feature_flags: editFeatureFlags.value,
      });
    }
    await loadTenants();
    closeEditModal();
    showToast("Tenant updated", "Tenant details were updated.");
  } catch (err) {
    showToast("Update failed", err instanceof Error ? err.message : "Unable to update tenant.");
  } finally {
    isSaving.value = false;
  }
};

const sendEditTenantReset = async () => {
  if (!editTenantId.value) return;
  isSaving.value = true;
  try {
    const data = await sendPrimaryAdminReset({ tenant_id: editTenantId.value });
    showToast("Reset sent", `Password reset sent to ${data.auth_email}.`);
  } catch (err) {
    showToast(
      "Reset failed",
      err instanceof Error ? err.message : "Unable to send reset link."
    );
  } finally {
    isSaving.value = false;
  }
};

const openStatusModal = (tenant: SuperTenant) => {
  const nextStatus = tenant.status === "active" ? "suspended" : "active";
  statusTarget.value = { id: tenant.id, name: tenant.name, nextStatus };
  statusModalTitle.value =
    nextStatus === "suspended" ? "Disable Tenant" : "Reactivate Tenant";
  statusModalMessage.value = `Type CONFIRM and enter your super admin password to ${
    nextStatus === "suspended" ? "disable" : "reactivate"
  } ${tenant.name}.`;
  statusModalConfirmLabel.value =
    nextStatus === "suspended" ? "Disable" : "Reactivate";
  statusModalVisible.value = true;
};

const closeStatusModal = () => {
  statusModalVisible.value = false;
  statusTarget.value = null;
};

const confirmStatusChange = async (payload: {
  superPassword: string;
  confirmPhrase: string;
}) => {
  if (!statusTarget.value) return;
  isSaving.value = true;
  try {
    await setTenantStatus({
      id: statusTarget.value.id,
      status: statusTarget.value.nextStatus,
      super_password: payload.superPassword,
      confirm_phrase: payload.confirmPhrase,
    });
    await loadTenants();
    showToast(
      statusTarget.value.nextStatus === "suspended"
        ? "Tenant disabled"
        : "Tenant reactivated",
      `${statusTarget.value.name} is now ${
        statusTarget.value.nextStatus === "suspended" ? "disabled" : "active"
      }.`
    );
    closeStatusModal();
  } catch (err) {
    showToast(
      "Status update failed",
      err instanceof Error ? err.message : "Unable to update tenant status."
    );
  } finally {
    isSaving.value = false;
  }
};

onMounted(() => {
  void loadTenants();
  void loadDistrictOptions();
});

watch(createAccountCategory, (value) => {
  createPlanCode.value =
    value === "individual" ? "individual_yearly" : value === "district" ? "core" : "starter";
  if (value === "individual") {
    createDistrictId.value = "";
  }
});

watch(editAccountCategory, (value) => {
  editPlanCode.value =
    value === "individual" ? "individual_yearly" : value === "district" ? "core" : "starter";
  if (value === "individual") {
    editDistrictId.value = "";
  }
});
</script>

<style scoped>
.page {
  max-width: 1360px;
}

.super-page-header {
  display: flex;
  justify-content: space-between;
  align-items: flex-start;
  gap: 1rem;
  margin-bottom: 1rem;
}

.super-page-links {
  justify-content: flex-end;
}

.tenant-stats {
  margin-top: 1rem;
}

.section-grid {
  display: grid;
  grid-template-columns: minmax(0, 1fr);
  gap: 1rem;
  align-items: start;
}

.section-card {
  display: flex;
  flex-direction: column;
  gap: 1rem;
}

.section-heading h2 {
  margin: 0;
}

.section-heading p {
  margin: 0.35rem 0 0;
}

.filter-toolbar {
  display: flex;
  gap: 1rem;
  flex-wrap: wrap;
  align-items: end;
}

.filter-select {
  min-width: 180px;
}

.modal-copy {
  margin: -0.4rem 0 0.25rem;
}

.tenant-table-wrap {
  width: 100%;
  max-width: 100%;
  overflow-x: auto;
  overflow-y: hidden;
  padding-bottom: 0.25rem;
}

.tenant-table {
  min-width: 0;
  margin-top: 0;
}

.tenant-table td,
.tenant-table th {
  vertical-align: top;
}

.tenant-table td:nth-child(1),
.tenant-table td:nth-child(4),
.tenant-table td:nth-child(7) {
  min-width: 8.5rem;
  word-break: break-word;
}

.tenant-table td:nth-child(5),
.tenant-table th:nth-child(5) {
  white-space: nowrap;
}

.tenant-table td:nth-child(8),
.tenant-table th:nth-child(8) {
  white-space: nowrap;
}

.modal-backdrop {
  position: fixed;
  inset: 0;
  background: rgba(5, 10, 20, 0.52);
  display: grid;
  place-items: center;
  z-index: 80;
  padding: 1rem;
}

.modal {
  width: min(520px, 100%);
  border-radius: 14px;
  border: 1px solid var(--border);
  background: var(--surface);
  color: var(--text);
  box-shadow: 0 16px 36px rgba(0, 0, 0, 0.24);
  padding: 1rem;
}

.actions-cell {
  display: flex;
  flex-wrap: wrap;
  gap: 0.5rem;
  white-space: nowrap;
}

@media (max-width: 900px) {
  .super-page-header {
    flex-direction: column;
  }

  .super-page-links {
    justify-content: flex-start;
  }
}
</style>
