<template>
  <div class="page">
    <h1>Customers</h1>
    <p>Leads moved to customers and invoice/payment tracking.</p>

    <nav class="page-nav-left">
      <RouterLink class="button-link" to="/super-admin">Return to Super Admin</RouterLink>
      <RouterLink class="button-link" to="/super-admin/sales-leads">Sales Leads</RouterLink>
      <RouterLink class="button-link" to="/super-admin/customers">Customers</RouterLink>
      <RouterLink class="button-link" to="/super-admin/tenants">Tenants</RouterLink>
      <RouterLink class="button-link" to="/super-admin/admins">Tenant Admins</RouterLink>
    </nav>

    <div class="card">
      <div class="form-actions">
        <input v-model.trim="search" type="text" placeholder="Search organization, name, or email" />
        <button type="button" :disabled="isLoading" @click="loadCustomers">Search</button>
      </div>

      <p v-if="error" class="error">{{ error }}</p>
      <p v-else-if="isLoading" class="muted">Loading customers...</p>

      <table v-else class="table">
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
            <td><button type="button" @click="openCustomer(customer.id)">Details</button></td>
          </tr>
          <tr v-if="!customers.length">
            <td colspan="4" class="muted">No customers found.</td>
          </tr>
        </tbody>
      </table>
      <p v-if="success" class="success">{{ success }}</p>
    </div>

    <div v-if="selectedCustomer" class="modal-overlay" @click.self="closeCustomer">
      <div class="modal-card">
        <h2>Customer Details</h2>
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

        <div class="status-entry card">
          <h3>Add Invoice Status Entry</h3>
          <div class="form-actions">
            <input v-model.trim="invoiceIdDraft" type="text" placeholder="Invoice ID" />
            <select v-model="invoiceStatusDraft">
              <option value="paid_on_time">Paid, on time</option>
              <option value="paid_late">Paid, late</option>
              <option value="awaiting_payment">Awaiting payment</option>
              <option value="canceling">Canceling</option>
            </select>
            <button type="button" :disabled="isSaving" @click="addStatusEntry">Add Entry</button>
          </div>
        </div>

        <div class="card">
          <h3>Status History</h3>
          <table class="table">
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

        <div class="form-actions">
          <button type="button" @click="closeCustomer">Close</button>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, ref } from "vue";
import { RouterLink } from "vue-router";
import {
  addCustomerStatusEntry,
  listCustomers,
  type CustomerInvoiceStatus,
  type CustomerRecord,
} from "../../services/superOpsService";

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
    error.value = err instanceof Error ? err.message : "Unable to load customers.";
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
    error.value = err instanceof Error ? err.message : "Unable to add status entry.";
  } finally {
    isSaving.value = false;
  }
};

onMounted(() => {
  void loadCustomers();
});
</script>

<style scoped>
.modal-overlay {
  position: fixed;
  inset: 0;
  background: rgba(5, 12, 24, 0.62);
  z-index: 2100;
  display: flex;
  justify-content: center;
  align-items: flex-start;
  padding: 2rem 1rem;
}

.modal-card {
  width: min(860px, 100%);
  max-height: calc(100vh - 4rem);
  overflow-y: auto;
  background: var(--surface);
  border: 1px solid var(--border);
  border-radius: 14px;
  padding: 1rem;
}

.modal-body {
  display: grid;
  gap: 0.5rem;
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

.status-entry {
  margin-top: 0.9rem;
}

.status-entry h3 {
  margin-top: 0;
}

@media (max-width: 980px) {
  .kv-row {
    grid-template-columns: 1fr;
  }
}
</style>
