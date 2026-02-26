<template>
  <div class="page">
    <h1>Sales Leads</h1>
    <p>Requests submitted from the public pricing contact form.</p>

    <nav class="page-nav-left">
      <RouterLink class="button-link" to="/super-admin">Return to Super Admin</RouterLink>
      <RouterLink class="button-link" to="/super-admin/tenants">Tenants</RouterLink>
      <RouterLink class="button-link" to="/super-admin/admins">Tenant Admins</RouterLink>
      <RouterLink class="button-link" to="/super-admin/broadcasts">Broadcasts</RouterLink>
      <RouterLink class="button-link" to="/super-admin/sales-leads">Sales Leads</RouterLink>
      <RouterLink class="button-link" to="/super-admin/customers">Customers</RouterLink>
    </nav>

    <div class="admin-grid lead-stats">
      <div v-for="option in stageOptions" :key="option.value" class="stat-card">
        <h3>{{ option.label }}</h3>
        <p class="stat-value">{{ countByStage(option.value) }}</p>
      </div>
    </div>

    <div class="card">
      <div class="filters">
        <input v-model.trim="search" type="text" placeholder="Search name, organization, or email" />
        <select v-model="leadStateFilter">
          <option value="open">Open leads</option>
          <option value="">All lead states</option>
          <option value="closed">Closed</option>
          <option value="converted_to_customer">Moved to customers</option>
        </select>
        <select v-model="stageFilter">
          <option value="">All stages</option>
          <option v-for="option in stageOptions" :key="option.value" :value="option.value">
            {{ option.label }}
          </option>
        </select>
        <button type="button" @click="loadLeads" :disabled="isLoading">Search</button>
      </div>

      <p v-if="error" class="error">{{ error }}</p>
      <p v-else-if="isLoading" class="muted">Loading leads...</p>

      <table v-else class="table">
        <thead>
          <tr>
            <th>Plan</th>
            <th>Name</th>
            <th>Organization</th>
            <th>Reply Email</th>
            <th>Open</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="lead in filteredLeads" :key="lead.id">
            <td>{{ planLabel(lead.plan) }}</td>
            <td>{{ lead.name }}</td>
            <td>{{ lead.organization }}</td>
            <td class="email-cell">{{ lead.reply_email }}</td>
            <td>
              <button type="button" @click="openLead(lead.id)">Details</button>
            </td>
          </tr>
          <tr v-if="!filteredLeads.length">
            <td colspan="5" class="muted">No leads found.</td>
          </tr>
        </tbody>
      </table>

      <p v-if="success" class="success">{{ success }}</p>
    </div>

    <div v-if="selectedLead" class="modal-overlay" @click.self="closeLeadModal">
      <div class="modal-card">
        <h2>Lead Details</h2>
        <div class="modal-body">
          <div class="kv-row"><span>Created</span><strong>{{ formatDate(selectedLead.created_at) }}</strong></div>
          <div class="kv-row"><span>Plan</span><strong>{{ planLabel(selectedLead.plan) }}</strong></div>
          <div class="kv-row"><span>Schools</span><strong>{{ selectedLead.schools_count ?? "-" }}</strong></div>
          <div class="kv-row"><span>Name</span><strong>{{ selectedLead.name }}</strong></div>
          <div class="kv-row"><span>Organization</span><strong>{{ selectedLead.organization }}</strong></div>
          <div class="kv-row"><span>Reply Email</span><strong>{{ selectedLead.reply_email }}</strong></div>
          <div class="kv-row"><span>Lead State</span><strong>{{ leadStateLabel(selectedLead.lead_state) }}</strong></div>
          <div class="kv-row kv-row-stage">
            <span>Stage</span>
            <select
              v-model="stageDrafts[selectedLead.id]"
              :disabled="isSavingStageId === selectedLead.id"
            >
              <option
                v-for="option in stageOptions"
                :key="option.value"
                :value="option.value"
              >
                {{ option.label }}
              </option>
            </select>
          </div>
          <div class="kv-row kv-row-details">
            <span>Details</span>
            <p>{{ selectedLead.details || "-" }}</p>
          </div>
        </div>

        <div class="row-actions modal-actions">
          <button
            type="button"
            :disabled="isSavingStageId === selectedLead.id || stageDrafts[selectedLead.id] === selectedLead.stage"
            @click="saveStage(selectedLead.id)"
          >
            {{ isSavingStageId === selectedLead.id ? "Saving..." : "Save stage" }}
          </button>
          <button type="button" @click="copyEmail(selectedLead.reply_email)">Copy email</button>
          <button
            type="button"
            class="danger"
            :disabled="isSavingStageId === selectedLead.id || selectedLead.lead_state === 'closed'"
            @click="closeLead(selectedLead.id)"
          >
            Close lead
          </button>
          <button
            type="button"
            :disabled="isSavingStageId === selectedLead.id || selectedLead.lead_state === 'converted_to_customer'"
            @click="moveToCustomers(selectedLead.id)"
          >
            Move to customers
          </button>
          <button type="button" @click="closeLeadModal">Close</button>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, ref } from "vue";
import { RouterLink } from "vue-router";
import {
  closeSalesLead,
  listSalesLeads,
  moveSalesLeadToCustomer,
  setSalesLeadStage,
  type SalesLead,
} from "../../services/superOpsService";

const stageOptions = [
  { value: "waiting_for_quote", label: "Waiting for quote" },
  { value: "quote_generated", label: "Quote generated" },
  { value: "quote_sent", label: "Quote sent" },
  { value: "quote_converted_to_invoice", label: "Quote converted to invoice" },
  { value: "invoice_sent", label: "Invoice sent" },
  { value: "invoice_paid", label: "Invoice paid" },
] as const;

const leads = ref<SalesLead[]>([]);
const search = ref("");
const leadStateFilter = ref("open");
const stageFilter = ref("");
const isLoading = ref(false);
const isSavingStageId = ref("");
const selectedLeadId = ref("");
const error = ref("");
const success = ref("");
const stageDrafts = ref<Record<string, SalesLead["stage"]>>({});

const filteredLeads = computed(() =>
  leads.value.filter((lead) => {
    if (leadStateFilter.value && lead.lead_state !== leadStateFilter.value) return false;
    if (stageFilter.value && lead.stage !== stageFilter.value) return false;
    return true;
  })
);
const selectedLead = computed(() =>
  leads.value.find((lead) => lead.id === selectedLeadId.value) ?? null
);

const countByStage = (stage: string) =>
  leads.value.filter((item) => item.stage === stage).length;

const formatDate = (value: string) => {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString();
};

const planLabel = (value: SalesLead["plan"]) => {
  if (value === "enterprise") return "Enterprise";
  if (value === "growth") return "Growth";
  return "Core";
};

const leadStateLabel = (value: SalesLead["lead_state"]) => {
  if (value === "converted_to_customer") return "Moved to customers";
  if (value === "closed") return "Closed";
  return "Open";
};

const loadLeads = async () => {
  isLoading.value = true;
  error.value = "";
  success.value = "";
  try {
    const response = await listSalesLeads({ search: search.value, limit: 200 });
    leads.value = response.leads ?? [];
    stageDrafts.value = Object.fromEntries(
      leads.value.map((lead) => [lead.id, lead.stage])
    ) as Record<string, SalesLead["stage"]>;
  } catch (err) {
    error.value = err instanceof Error ? err.message : "Unable to load sales leads.";
  } finally {
    isLoading.value = false;
  }
};

const openLead = (leadId: string) => {
  selectedLeadId.value = leadId;
};

const closeLeadModal = () => {
  selectedLeadId.value = "";
};

const saveStage = async (leadId: string) => {
  const nextStage = stageDrafts.value[leadId];
  if (!nextStage) return;
  isSavingStageId.value = leadId;
  error.value = "";
  success.value = "";
  try {
    const response = await setSalesLeadStage({
      lead_id: leadId,
      stage: nextStage,
    });
    const updated = response.lead;
    leads.value = leads.value.map((lead) => (lead.id === leadId ? updated : lead));
    stageDrafts.value[leadId] = updated.stage;
    success.value = "Lead stage updated.";
  } catch (err) {
    error.value = err instanceof Error ? err.message : "Unable to update lead stage.";
  } finally {
    isSavingStageId.value = "";
  }
};

const closeLead = async (leadId: string) => {
  const confirmed = window.confirm("Close this lead?");
  if (!confirmed) return;
  isSavingStageId.value = leadId;
  error.value = "";
  success.value = "";
  try {
    const response = await closeSalesLead({ lead_id: leadId });
    leads.value = leads.value.map((lead) =>
      lead.id === leadId ? response.lead : lead
    );
    stageDrafts.value[leadId] = response.lead.stage;
    success.value = "Lead closed.";
  } catch (err) {
    error.value = err instanceof Error ? err.message : "Unable to close lead.";
  } finally {
    isSavingStageId.value = "";
  }
};

const moveToCustomers = async (leadId: string) => {
  const confirmed = window.confirm("Move this lead to the customers page?");
  if (!confirmed) return;
  isSavingStageId.value = leadId;
  error.value = "";
  success.value = "";
  try {
    const response = await moveSalesLeadToCustomer({ lead_id: leadId });
    leads.value = leads.value.map((lead) =>
      lead.id === leadId ? response.lead : lead
    );
    stageDrafts.value[leadId] = response.lead.stage;
    success.value = "Lead moved to customers.";
  } catch (err) {
    error.value = err instanceof Error ? err.message : "Unable to move lead.";
  } finally {
    isSavingStageId.value = "";
  }
};

const copyEmail = async (value: string) => {
  try {
    await navigator.clipboard.writeText(value);
    success.value = "Email copied.";
  } catch {
    error.value = "Unable to copy email.";
  }
};

onMounted(() => {
  void loadLeads();
});
</script>

<style scoped>
.lead-stats {
  margin-top: 1rem;
}

.filters {
  display: grid;
  grid-template-columns: minmax(280px, 1fr) minmax(190px, 230px) auto;
  gap: 0.6rem;
  align-items: center;
  margin-bottom: 0.9rem;
}

.row-actions {
  display: flex;
  gap: 0.5rem;
  align-items: center;
  flex-wrap: wrap;
}

.email-cell {
  word-break: break-word;
}

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
  width: min(760px, 100%);
  max-height: calc(100vh - 4rem);
  overflow-y: auto;
  background: var(--surface);
  border: 1px solid var(--border);
  border-radius: 14px;
  padding: 1rem;
}

.modal-card h2 {
  margin: 0 0 0.8rem;
}

.modal-body {
  display: grid;
  gap: 0.6rem;
}

.kv-row {
  display: grid;
  grid-template-columns: minmax(140px, 180px) minmax(0, 1fr);
  gap: 0.65rem;
  align-items: start;
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

.kv-row-details p {
  white-space: pre-wrap;
}

.kv-row-stage select {
  max-width: 100%;
}

.modal-actions {
  margin-top: 1rem;
}

@media (max-width: 980px) {
  .filters {
    grid-template-columns: 1fr;
  }

  .row-actions {
    flex-direction: column;
    align-items: stretch;
  }

  .kv-row {
    grid-template-columns: 1fr;
  }
}
</style>
