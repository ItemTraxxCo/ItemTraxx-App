<template>
  <div class="page">
    <div class="page-nav-left">
      <RouterLink class="button-link" to="/super-admin">Return to Super Admin</RouterLink>
      <RouterLink class="button-link" to="/super-admin/tenants">Tenants</RouterLink>
      <RouterLink class="button-link" to="/super-admin/admins">Tenant Admins</RouterLink>
    </div>

    <h1>District Management</h1>
    <p>Create and manage district records that power subdomain scoping.</p>

    <div class="card">
      <h2>Create District</h2>
      <form class="form" @submit.prevent="handleCreate">
        <label>
          Name
          <input v-model="createName" type="text" placeholder="Palo Alto Unified School District" />
        </label>
        <label>
          Slug
          <input v-model="createSlug" type="text" placeholder="pausd" />
        </label>
        <label>
          Support Email
          <input v-model="createSupportEmail" type="email" placeholder="support@district.org" />
        </label>
        <label>
          Contact Name
          <input v-model="createContactName" type="text" placeholder="District IT Team" />
        </label>
        <label>
          Subscription Plan
          <select v-model="createSubscriptionPlan">
            <option value="">Unset</option>
            <option
              v-for="plan in districtPlanOptions"
              :key="plan.value"
              :value="plan.value"
            >
              {{ plan.label }}
            </option>
          </select>
        </label>
        <label>
          Billing Status
          <select v-model="createBillingStatus">
            <option value="">Unset</option>
            <option value="draft">draft</option>
            <option value="active">active</option>
            <option value="past_due">past_due</option>
            <option value="canceled">canceled</option>
          </select>
        </label>
        <label>
          Renewal Date
          <input v-model="createRenewalDate" type="date" />
        </label>
        <label>
          Billing Email
          <input v-model="createBillingEmail" type="email" placeholder="billing@district.org" />
        </label>
        <label>
          Invoice Reference
          <input v-model="createInvoiceReference" type="text" placeholder="INV-2026-001" />
        </label>
        <div class="form-actions">
          <button type="submit" class="button-primary" :disabled="isSaving">Create District</button>
        </div>
      </form>
    </div>

    <div class="card">
      <h2>District List</h2>
      <div class="input-row">
        <input v-model="search" type="text" placeholder="Search by district name, slug, or email" />
        <button type="button" @click="loadDistricts">Search</button>
      </div>

      <p v-if="isLoading" class="muted">Loading districts...</p>
      <p v-else-if="error" class="error">{{ error }}</p>
      <div v-else class="districts-list-shell">
        <div class="districts-list-summary muted">{{ districts.length }} district{{ districts.length === 1 ? "" : "s" }}</div>
        <div class="table-wrap districts-table-wrap">
          <table class="table districts-table">
            <thead>
              <tr>
                <th>Name</th>
                <th>Slug</th>
                <th>URL Preview</th>
                <th>Tenants</th>
                <th>Status</th>
                <th>Plan</th>
                <th>Support</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="district in districts" :key="district.id" class="district-row">
                <td data-label="Name" class="district-cell-primary">
                  <span class="district-name">{{ district.name }}</span>
                </td>
                <td data-label="Slug">
                  <code class="district-code">{{ district.slug }}</code>
                </td>
                <td data-label="URL Preview">
                  <span class="district-url">{{ districtUrlPreview(district.slug) }}</span>
                </td>
                <td data-label="Tenants">
                  <span class="district-badge">{{ district.tenants_count ?? 0 }}</span>
                </td>
                <td data-label="Status">
                  <span class="district-status-pill" :class="district.is_active ? 'is-active' : 'is-inactive'">
                    {{ district.is_active ? "active" : "inactive" }}
                  </span>
                </td>
                <td data-label="Plan">
                  <span class="district-plan">{{ getDistrictPlanLabel(district.subscription_plan) }}</span>
                </td>
                <td data-label="Support">
                  <span class="district-support">{{ district.support_email || district.contact_name || "-" }}</span>
                </td>
                <td data-label="Actions" class="actions-cell district-actions-cell">
                  <RouterLink class="button-link" :to="`/super-admin/districts/${district.id}`">
                    Open
                  </RouterLink>
                  <button type="button" class="button-primary" @click="openEditModal(district)">Edit</button>
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>
    </div>

    <div
      v-if="editModalVisible"
      class="district-edit-overlay"
      role="dialog"
      aria-modal="true"
      aria-label="Edit district"
      @click.self="closeEditModal"
    >
      <div class="district-edit-modal">
        <div class="district-edit-header">
          <div>
            <p class="district-edit-kicker">District Editor</p>
            <h2>Edit District</h2>
          </div>
          <button type="button" class="district-edit-close" aria-label="Close edit dialog" @click="closeEditModal">
            ×
          </button>
        </div>
        <p class="muted district-edit-copy">Update district details, billing metadata, and status without leaving the list view.</p>
        <form class="form" @submit.prevent="saveEdit">
          <label>
            Name
            <input v-model="editName" type="text" placeholder="District name" />
          </label>
          <label>
            Slug
            <input v-model="editSlug" type="text" placeholder="pausd" />
          </label>
          <label>
            Support Email
            <input v-model="editSupportEmail" type="email" placeholder="support@district.org" />
          </label>
          <label>
            Contact Name
            <input v-model="editContactName" type="text" placeholder="District IT Team" />
          </label>
          <label>
            Subscription Plan
            <select v-model="editSubscriptionPlan">
              <option value="">Unset</option>
              <option
                v-for="plan in districtPlanOptions"
                :key="plan.value"
                :value="plan.value"
              >
                {{ plan.label }}
              </option>
            </select>
          </label>
          <label>
            Billing Status
            <select v-model="editBillingStatus">
              <option value="">Unset</option>
              <option value="draft">draft</option>
              <option value="active">active</option>
              <option value="past_due">past_due</option>
              <option value="canceled">canceled</option>
            </select>
          </label>
          <label>
            Renewal Date
            <input v-model="editRenewalDate" type="date" />
          </label>
          <label>
            Billing Email
            <input v-model="editBillingEmail" type="email" placeholder="billing@district.org" />
          </label>
          <label>
            Invoice Reference
            <input v-model="editInvoiceReference" type="text" placeholder="INV-2026-001" />
          </label>
          <label>
            Active
            <select v-model="editIsActive">
              <option :value="true">true</option>
              <option :value="false">false</option>
            </select>
          </label>
          <div class="form-actions">
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
  </div>
</template>

<script setup lang="ts">
import { onMounted, ref } from "vue";
import { RouterLink } from "vue-router";
import { toUserFacingErrorMessage } from "../../services/appErrors";
import {
  createDistrict,
  listDistricts,
  updateDistrict,
  type SuperDistrict,
} from "../../services/superTenantService";

const districts = ref<SuperDistrict[]>([]);
const isLoading = ref(false);
const isSaving = ref(false);
const error = ref("");
const search = ref("");
const createName = ref("");
const createSlug = ref("");
const createSupportEmail = ref("");
const createContactName = ref("");
const createSubscriptionPlan = ref<
  | ""
  | "district_core"
  | "district_growth"
  | "district_enterprise"
  | "organization_starter"
  | "organization_scale"
  | "organization_enterprise"
>("");
const createBillingStatus = ref<"" | "draft" | "active" | "past_due" | "canceled">("");
const createRenewalDate = ref("");
const createBillingEmail = ref("");
const createInvoiceReference = ref("");
const editModalVisible = ref(false);
const editDistrictId = ref<string | null>(null);
const editName = ref("");
const editSlug = ref("");
const editSupportEmail = ref("");
const editContactName = ref("");
const editSubscriptionPlan = ref<
  | ""
  | "district_core"
  | "district_growth"
  | "district_enterprise"
  | "organization_starter"
  | "organization_scale"
  | "organization_enterprise"
>("");
const editBillingStatus = ref<"" | "draft" | "active" | "past_due" | "canceled">("");
const editRenewalDate = ref("");
const editBillingEmail = ref("");
const editInvoiceReference = ref("");
const editIsActive = ref(true);
const toastTitle = ref("");
const toastMessage = ref("");
let toastTimer: number | null = null;

const districtPlanOptions = [
  { value: "district_core", label: "ItemTraxx School District Core Plan" },
  { value: "district_growth", label: "ItemTraxx School District Growth Plan" },
  { value: "district_enterprise", label: "ItemTraxx School District Enterprise Plan" },
  { value: "organization_starter", label: "ItemTraxx Organization Starter Plan" },
  { value: "organization_scale", label: "ItemTraxx Organization Scale Plan" },
  { value: "organization_enterprise", label: "ItemTraxx Organization Enterprise Plan" },
] as const;

const normalizeSlug = (value: string) =>
  value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9-]/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");

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

const getDistrictPlanLabel = (value: string | null | undefined) =>
  districtPlanOptions.find((plan) => plan.value === value)?.label ?? value ?? "-";

const districtUrlPreview = (slug: string) => `https://${slug}.app.itemtraxx.com`;

const loadDistricts = async () => {
  isLoading.value = true;
  error.value = "";
  try {
    districts.value = await listDistricts(search.value.trim());
  } catch (err) {
    error.value = toUserFacingErrorMessage(err, "Unable to load districts.");
  } finally {
    isLoading.value = false;
  }
};

const handleCreate = async () => {
  const name = createName.value.trim();
  const slug = normalizeSlug(createSlug.value);
  if (!name || !slug) {
    showToast("Invalid input", "District name and slug are required.");
    return;
  }

  isSaving.value = true;
  try {
    const created = await createDistrict({
      name,
      slug,
      support_email: createSupportEmail.value.trim() || undefined,
      contact_name: createContactName.value.trim() || undefined,
      subscription_plan: createSubscriptionPlan.value || undefined,
      billing_status: createBillingStatus.value || undefined,
      renewal_date: createRenewalDate.value || undefined,
      billing_email: createBillingEmail.value.trim() || undefined,
      invoice_reference: createInvoiceReference.value.trim() || undefined,
    });
    districts.value = [created, ...districts.value];
    createName.value = "";
    createSlug.value = "";
    createSupportEmail.value = "";
    createContactName.value = "";
    createSubscriptionPlan.value = "";
    createBillingStatus.value = "";
    createRenewalDate.value = "";
    createBillingEmail.value = "";
    createInvoiceReference.value = "";
    showToast("District created", "District foundation record created successfully.");
  } catch (err) {
    showToast("Create failed", toUserFacingErrorMessage(err, "Unable to create district."));
  } finally {
    isSaving.value = false;
  }
};

const openEditModal = (district: SuperDistrict) => {
  editDistrictId.value = district.id;
  editName.value = district.name;
  editSlug.value = district.slug;
  editSupportEmail.value = district.support_email ?? "";
  editContactName.value = district.contact_name ?? "";
  editSubscriptionPlan.value = district.subscription_plan ?? "";
  editBillingStatus.value = district.billing_status ?? "";
  editRenewalDate.value = district.renewal_date ?? "";
  editBillingEmail.value = district.billing_email ?? "";
  editInvoiceReference.value = district.invoice_reference ?? "";
  editIsActive.value = district.is_active;
  editModalVisible.value = true;
};

const closeEditModal = () => {
  editModalVisible.value = false;
  editDistrictId.value = null;
  editName.value = "";
  editSlug.value = "";
  editSupportEmail.value = "";
  editContactName.value = "";
  editSubscriptionPlan.value = "";
  editBillingStatus.value = "";
  editRenewalDate.value = "";
  editBillingEmail.value = "";
  editInvoiceReference.value = "";
  editIsActive.value = true;
};

const saveEdit = async () => {
  if (!editDistrictId.value) return;
  const name = editName.value.trim();
  const slug = normalizeSlug(editSlug.value);
  if (!name || !slug) {
    showToast("Invalid input", "District name and slug are required.");
    return;
  }

  isSaving.value = true;
  try {
    const updated = await updateDistrict({
      id: editDistrictId.value,
      name,
      slug,
      support_email: editSupportEmail.value.trim() || undefined,
      contact_name: editContactName.value.trim() || undefined,
      is_active: editIsActive.value,
      subscription_plan: editSubscriptionPlan.value || undefined,
      billing_status: editBillingStatus.value || undefined,
      renewal_date: editRenewalDate.value || undefined,
      billing_email: editBillingEmail.value.trim() || undefined,
      invoice_reference: editInvoiceReference.value.trim() || undefined,
    });
    districts.value = districts.value.map((district) =>
      district.id === updated.id ? updated : district
    );
    closeEditModal();
    showToast("District updated", "District record updated successfully.");
  } catch (err) {
    showToast("Update failed", toUserFacingErrorMessage(err, "Unable to update district."));
  } finally {
    isSaving.value = false;
  }
};

onMounted(() => {
  void loadDistricts();
});
</script>

<style scoped>
.districts-list-shell {
  display: grid;
  gap: 0.75rem;
}

.districts-list-summary {
  font-size: 0.88rem;
}

.districts-table-wrap {
  border: 1px solid var(--border);
  border-radius: 16px;
  background: var(--surface);
  overflow: auto;
}

.districts-table {
  margin-top: 0;
  table-layout: fixed;
  min-width: 980px;
}

.districts-table th,
.districts-table td {
  padding: 0.85rem 0.75rem;
  vertical-align: top;
  overflow-wrap: anywhere;
}

.districts-table th:nth-child(1) {
  width: 15%;
}

.districts-table th:nth-child(2) {
  width: 10%;
}

.districts-table th:nth-child(3) {
  width: 18%;
}

.districts-table th:nth-child(4) {
  width: 7%;
}

.districts-table th:nth-child(5) {
  width: 9%;
}

.districts-table th:nth-child(6) {
  width: 21%;
}

.districts-table th:nth-child(7) {
  width: 12%;
}

.districts-table th:nth-child(8) {
  width: 8%;
}

.district-row:hover {
  background: color-mix(in srgb, var(--surface) 78%, var(--accent) 22%);
}

.district-cell-primary {
  font-weight: 600;
}

.district-name {
  display: block;
}

.district-code {
  font-size: 0.86rem;
  padding: 0.2rem 0.38rem;
  border-radius: 8px;
  background: color-mix(in srgb, var(--surface-2) 82%, transparent 18%);
}

.district-url,
.district-plan,
.district-support {
  display: block;
}

.district-badge {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  min-width: 2rem;
  min-height: 2rem;
  padding: 0 0.55rem;
  border-radius: 999px;
  background: color-mix(in srgb, var(--accent) 16%, transparent 84%);
  font-weight: 700;
}

.district-status-pill {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  padding: 0.28rem 0.6rem;
  border-radius: 999px;
  border: 1px solid var(--border);
  font-size: 0.82rem;
  text-transform: capitalize;
}

.district-status-pill.is-active {
  background: color-mix(in srgb, var(--accent) 14%, transparent 86%);
  border-color: color-mix(in srgb, var(--accent) 42%, var(--border) 58%);
}

.district-status-pill.is-inactive {
  background: color-mix(in srgb, #c96b5d 14%, transparent 86%);
  border-color: color-mix(in srgb, #c96b5d 40%, var(--border) 60%);
}

.district-actions-cell {
  display: flex;
  flex-wrap: wrap;
  gap: 0.45rem;
}

.district-edit-overlay {
  position: fixed;
  inset: 0;
  z-index: 90;
  display: grid;
  place-items: center;
  padding: 1.25rem;
  background: rgba(7, 10, 16, 0.68);
}

.district-edit-modal {
  width: min(760px, 100%);
  max-height: min(88vh, 920px);
  overflow: auto;
  border-radius: 24px;
  border: 1px solid color-mix(in srgb, var(--border) 72%, var(--accent) 28%);
  background: var(--surface);
  padding: 1.35rem 1.35rem 1.5rem;
}

.district-edit-header {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 1rem;
}

.district-edit-header h2 {
  margin: 0;
}

.district-edit-kicker {
  margin: 0 0 0.35rem;
  font-size: 0.76rem;
  letter-spacing: 0.14em;
  text-transform: uppercase;
  color: var(--muted);
}

.district-edit-copy {
  margin: 0.65rem 0 1.1rem;
  max-width: 48rem;
}

.district-edit-close {
  width: 2.25rem;
  min-width: 2.25rem;
  height: 2.25rem;
  min-height: 2.25rem;
  border-radius: 999px;
  padding: 0;
  font-size: 1.2rem;
  line-height: 1;
}

@media (max-width: 860px) {
  .districts-table {
    min-width: 0;
  }

  .districts-table thead {
    display: none;
  }

  .districts-table,
  .districts-table tbody,
  .districts-table tr,
  .districts-table td {
    display: block;
    width: 100%;
  }

  .districts-table tbody {
    padding: 0.4rem;
  }

  .district-row {
    margin-bottom: 0.75rem;
    border: 1px solid var(--border);
    border-radius: 16px;
    background: color-mix(in srgb, var(--surface) 90%, transparent 10%);
    overflow: hidden;
  }

  .districts-table td {
    display: grid;
    grid-template-columns: minmax(7rem, 8.5rem) minmax(0, 1fr);
    gap: 0.75rem;
    padding: 0.75rem 0.9rem;
    border-bottom: 1px solid var(--border);
  }

  .districts-table td:last-child {
    border-bottom: 0;
  }

  .districts-table td::before {
    content: attr(data-label);
    color: var(--muted);
    font-size: 0.8rem;
    font-weight: 700;
    letter-spacing: 0.02em;
    text-transform: uppercase;
  }

  .district-actions-cell {
    justify-content: flex-start;
  }
}

@media (max-width: 640px) {
  .district-edit-overlay {
    padding: 0.75rem;
  }

  .district-edit-modal {
    padding: 1rem;
    border-radius: 18px;
  }

  .district-edit-header {
    align-items: center;
  }

  .districts-table td {
    grid-template-columns: 1fr;
    gap: 0.35rem;
  }
}
</style>
