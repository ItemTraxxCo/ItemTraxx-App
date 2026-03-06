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
            <option value="starter">starter</option>
            <option value="standard">standard</option>
            <option value="enterprise">enterprise</option>
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
      <table v-else class="table">
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
          <tr v-for="district in districts" :key="district.id">
            <td>{{ district.name }}</td>
            <td>{{ district.slug }}</td>
            <td>{{ districtUrlPreview(district.slug) }}</td>
            <td>{{ district.tenants_count ?? 0 }}</td>
            <td>{{ district.is_active ? "active" : "inactive" }}</td>
            <td>{{ district.subscription_plan || "-" }}</td>
            <td>{{ district.support_email || district.contact_name || "-" }}</td>
            <td class="actions-cell">
              <RouterLink class="button-link" :to="`/super-admin/districts/${district.id}`">
                Open
              </RouterLink>
              <button type="button" @click="openEditModal(district)">Edit</button>
            </td>
          </tr>
        </tbody>
      </table>
    </div>

    <div v-if="editModalVisible" class="modal-backdrop" @click.self="closeEditModal">
      <div class="modal">
        <h2>Edit District</h2>
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
              <option value="starter">starter</option>
              <option value="standard">standard</option>
              <option value="enterprise">enterprise</option>
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
const createSubscriptionPlan = ref<"" | "starter" | "standard" | "enterprise">("");
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
const editSubscriptionPlan = ref<"" | "starter" | "standard" | "enterprise">("");
const editBillingStatus = ref<"" | "draft" | "active" | "past_due" | "canceled">("");
const editRenewalDate = ref("");
const editBillingEmail = ref("");
const editInvoiceReference = ref("");
const editIsActive = ref(true);
const toastTitle = ref("");
const toastMessage = ref("");
let toastTimer: number | null = null;

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

const districtUrlPreview = (slug: string) => `https://${slug}.app.itemtraxx.com`;

const loadDistricts = async () => {
  isLoading.value = true;
  error.value = "";
  try {
    districts.value = await listDistricts(search.value.trim());
  } catch (err) {
    error.value = err instanceof Error ? err.message : "Unable to load districts.";
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
    showToast("Create failed", err instanceof Error ? err.message : "Unable to create district.");
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
    showToast("Update failed", err instanceof Error ? err.message : "Unable to update district.");
  } finally {
    isSaving.value = false;
  }
};

onMounted(() => {
  void loadDistricts();
});
</script>
