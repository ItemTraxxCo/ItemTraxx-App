<template>
  <main class="page">
    <div class="sa-toolbar">
      <div>
        <RouterLink to="/super-admin" class="sa-back-link">&larr; Back to Control Center</RouterLink>
        <h1 class="sa-toolbar-title">Customers</h1>
        <p class="sa-toolbar-sub">Leads moved to customers and invoice/payment tracking.</p>
      </div>
    </div>

    <nav class="page-nav-left">
      <RouterLink class="sa-btn" to="/super-admin">Return to Super Admin</RouterLink>
      <RouterLink class="sa-btn" to="/super-admin/sales-leads">Sales Leads</RouterLink>
      <RouterLink class="sa-btn" to="/super-admin/customers">Customers</RouterLink>
      <RouterLink class="sa-btn" to="/super-admin/workspaces">Workspaces</RouterLink>
      <RouterLink class="sa-btn" to="/super-admin/admins">Tenant Admins</RouterLink>
    </nav>

    <section class="sa-panel sa-filters">
      <label>Search <input v-model.trim="search" type="text" placeholder="Search organization, name, or email" /></label>
      <button class="sa-btn" type="button" :disabled="isLoading" @click="loadCustomers">Search</button>
    </section>

    <p v-if="error" class="sa-error">{{ error }}</p>
    <p v-else-if="isLoading" class="muted">Loading customers...</p>

    <div v-else class="sa-table-wrap">
      <table class="sa-table">
        <thead>
          <tr>
            <th>Organization</th>
            <th>Plan</th>
            <th>Status</th>
            <th>Open</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="customer in customers" :key="customer.id">
            <td>{{ customer.organization }}</td>
            <td>{{ planLabel(customer.plan) }}</td>
            <td>{{ statusLabel(customer.latest_status) }}</td>
            <td>
              <div class="sa-table-row-actions">
                <button class="sa-btn" type="button" @click="openCustomer(customer.id)">Details</button>
              </div>
            </td>
          </tr>
          <tr v-if="!customers.length">
            <td colspan="4" class="muted">No customers found.</td>
          </tr>
        </tbody>
      </table>
    </div>

    <p v-if="success" class="sa-notice">{{ success }}</p>

    <div v-if="selectedCustomer" class="sa-modal-backdrop" @click.self="closeCustomer">
      <section class="sa-modal" role="dialog" aria-modal="true" aria-labelledby="customer-details-title">
        <h2 id="customer-details-title">Customer Details</h2>
        <div class="modal-body">
          <div class="kv-row"><span>Plan</span><strong>{{ planLabel(selectedCustomer.plan) }}</strong></div>
          <div class="kv-row"><span>Schools</span><strong>{{ selectedCustomer.schools_count ?? "-" }}</strong></div>
          <div class="kv-row"><span>Name</span><strong>{{ selectedCustomer.name }}</strong></div>
          <div class="kv-row"><span>Organization</span><strong>{{ selectedCustomer.organization }}</strong></div>
          <div class="kv-row"><span>Reply Email</span><strong>{{ selectedCustomer.reply_email }}</strong></div>
          <div class="kv-row"><span>Stage</span><strong>{{ stageLabel(selectedCustomer.stage) }}</strong></div>
          <div class="kv-row"><span>Details</span><p>{{ selectedCustomer.details || "-" }}</p></div>
          <div class="kv-row"><span>Status</span><strong>{{ statusLabel(selectedCustomer.latest_status) }}</strong></div>
        </div>

        <section class="sa-panel">
          <h2>Add Invoice Status Entry</h2>
          <div class="sa-filters">
            <label>Invoice ID <input v-model.trim="invoiceIdDraft" type="text" placeholder="Enter invoice ID" /></label>
            <label>Status
              <select v-model="invoiceStatusDraft">
                <option value="paid_on_time">Paid, on time</option>
                <option value="paid_late">Paid, late</option>
                <option value="awaiting_payment">Awaiting payment</option>
                <option value="canceling">Canceling</option>
              </select>
            </label>
            <button class="sa-btn primary" type="button" :disabled="isSaving" @click="addStatusEntry">Add Entry</button>
          </div>
        </section>

        <section class="sa-panel">
          <h2>Status History</h2>
          <div class="sa-table-wrap">
            <table class="sa-table">
              <thead>
                <tr>
                  <th>Created</th>
                  <th>Invoice ID</th>
                  <th>Status</th>
                </tr>
              </thead>
              <tbody>
                <tr v-for="entry in selectedCustomer.status_logs" :key="entry.id">
                  <td>{{ formatDate(entry.created_at) }}</td>
                  <td>{{ entry.invoice_id }}</td>
                  <td>{{ statusLabel(entry.status) }}</td>
                </tr>
                <tr v-if="!selectedCustomer.status_logs.length">
                  <td colspan="3" class="muted">No status entries yet.</td>
                </tr>
              </tbody>
            </table>
          </div>
        </section>

        <div class="panel-actions">
          <button class="sa-btn" type="button" @click="closeCustomer">Close</button>
        </div>
      </section>
    </div>
  </main>
</template>

<script setup lang="ts">
import { computed, onMounted, ref } from "vue";
import { RouterLink } from "vue-router";
import { toUserFacingErrorMessage } from "../../services/appErrors";
import {
  addCustomerStatusEntry,
  listCustomers,
  type CustomerInvoiceStatus,
  type CustomerRecord,
} from "../../services/superOps/salesCustomers";

const customers = ref<CustomerRecord[]>([]);
const search = ref("");
const isLoading = ref(false);
const isSaving = ref(false);
const error = ref("");
const success = ref("");
const selectedCustomerId = ref("");
const invoiceIdDraft = ref("");
const invoiceStatusDraft = ref<CustomerInvoiceStatus>("awaiting_payment");

const selectedCustomer = computed(
  () => customers.value.find((row) => row.id === selectedCustomerId.value) ?? null
);

const formatDate = (value: string) => {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString();
};

const planLabel = (value: CustomerRecord["plan"]) =>
  value === "enterprise" ? "Enterprise" : value === "growth" ? "Growth" : "Core";

const stageLabel = (value: CustomerRecord["stage"]) =>
  value === "quote_converted_to_invoice"
    ? "Quote converted to invoice"
    : value.split("_").join(" ");

const statusLabel = (value: CustomerInvoiceStatus | null) => {
  if (!value) return "No status entries";
  if (value === "paid_on_time") return "Paid, on time";
  if (value === "paid_late") return "Paid, late";
  if (value === "awaiting_payment") return "Awaiting payment";
  return "Canceling";
};

const loadCustomers = async () => {
  isLoading.value = true;
  error.value = "";
  success.value = "";
  try {
    const response = await listCustomers({ search: search.value, limit: 200 });
    customers.value = response.customers ?? [];
  } catch (err) {
    error.value = toUserFacingErrorMessage(err, "Unable to load customers.");
  } finally {
    isLoading.value = false;
  }
};

const openCustomer = (id: string) => {
  selectedCustomerId.value = id;
  invoiceIdDraft.value = "";
  invoiceStatusDraft.value = "awaiting_payment";
};

const closeCustomer = () => {
  selectedCustomerId.value = "";
};

const addStatusEntry = async () => {
  if (!selectedCustomer.value) return;
  if (!invoiceIdDraft.value) {
    error.value = "Invoice ID is required.";
    return;
  }
  isSaving.value = true;
  error.value = "";
  success.value = "";
  try {
    const response = await addCustomerStatusEntry({
      lead_id: selectedCustomer.value.id,
      invoice_id: invoiceIdDraft.value,
      status: invoiceStatusDraft.value,
    });
    const entry = response.entry;
    customers.value = customers.value.map((row) =>
      row.id === selectedCustomer.value?.id
        ? {
            ...row,
            latest_status: entry.status,
            latest_invoice_id: entry.invoice_id,
            status_logs: [entry, ...row.status_logs],
          }
        : row
    );
    success.value = "Status entry added.";
    invoiceIdDraft.value = "";
  } catch (err) {
    error.value = toUserFacingErrorMessage(err, "Unable to add status entry.");
  } finally {
    isSaving.value = false;
  }
};

onMounted(() => {
  void loadCustomers();
});
</script>

<style scoped>
.page {
  max-width: 1320px;
  margin: 0 auto;
  padding: 2rem;
}

.page-nav-left {
  display: flex;
  flex-direction: column;
  gap: 0.5rem;
  margin-bottom: 1.25rem;
}

.panel-actions {
  display: flex;
  gap: 0.5rem;
  margin-top: 1rem;
}

.modal-body {
  display: grid;
  gap: 0.5rem;
  margin-bottom: 1.25rem;
}

.kv-row {
  display: grid;
  grid-template-columns: minmax(140px, 180px) minmax(0, 1fr);
  gap: 0.65rem;
}

.kv-row span {
  color: var(--muted);
  font-weight: 600;
}

.kv-row strong,
.kv-row p {
  margin: 0;
  word-break: break-word;
}

@media (max-width: 980px) {
  .kv-row {
    grid-template-columns: 1fr;
  }
}
</style>
