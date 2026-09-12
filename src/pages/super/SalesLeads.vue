<template>
  <div class="page">
    <div class="sa-toolbar">
      <div>
        <RouterLink to="/super-admin" class="sa-back-link">&larr; Back to Control Center</RouterLink>
        <h1 class="sa-toolbar-title">Sales Leads</h1>
        <p class="sa-toolbar-sub">Requests submitted from the public pricing contact form.</p>
      </div>
    </div>

    <div class="sa-stat-strip" aria-label="Lead stage summary">
      <div v-for="option in stageOptions" :key="option.value" class="sa-stat">
        <div class="n">{{ countByStage(option.value) }}</div>
        <div class="l">{{ option.label }}</div>
      </div>
    </div>

    <section class="sa-panel sa-filters">
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
      <button type="button" class="sa-btn" @click="loadLeads" :disabled="isLoading">Search</button>
    </section>

    <p v-if="error" class="sa-error">{{ error }}</p>
    <p v-else-if="isLoading" class="muted">Loading leads...</p>

    <div v-else class="sa-table-wrap">
      <table class="sa-table">
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
              <div class="sa-table-row-actions">
                <button type="button" class="sa-btn" @click="openLead(lead.id)">Details</button>
              </div>
            </td>
          </tr>
          <tr v-if="!filteredLeads.length">
            <td colspan="5" class="muted">No leads found.</td>
          </tr>
        </tbody>
      </table>
    </div>

    <p v-if="success" class="sa-notice">{{ success }}</p>

    <div v-if="selectedLead" class="sa-modal-backdrop" @click.self="closeLeadModal">
      <section class="sa-modal" role="dialog" aria-modal="true" aria-labelledby="lead-details-title">
        <h2 id="lead-details-title">Lead Details</h2>
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

        <div class="panel-actions">
          <button
            type="button"
            class="sa-btn primary"
            :disabled="isSavingStageId === selectedLead.id || stageDrafts[selectedLead.id] === selectedLead.stage"
            @click="saveStage(selectedLead.id)"
          >
            {{ isSavingStageId === selectedLead.id ? "Saving..." : "Save stage" }}
          </button>
          <button type="button" class="sa-btn" @click="copyEmail(selectedLead.reply_email)">Copy email</button>
          <button
            type="button"
            class="sa-btn danger"
            :disabled="isSavingStageId === selectedLead.id || selectedLead.lead_state === 'closed'"
            @click="closeLead(selectedLead.id)"
          >
            Close lead
          </button>
          <button
            type="button"
            class="sa-btn"
            :disabled="isSavingStageId === selectedLead.id || selectedLead.lead_state === 'converted_to_customer'"
            @click="moveToCustomers(selectedLead.id)"
          >
            Move to customers
          </button>
          <button type="button" class="sa-btn" @click="closeLeadModal">Close</button>
        </div>
      </section>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, ref } from "vue";
import { RouterLink } from "vue-router";
import { toUserFacingErrorMessage } from "../../services/appErrors";
import {
  closeSalesLead,
  listSalesLeads,
  moveSalesLeadToCustomer,
  setSalesLeadStage,
  type SalesLead,
} from "../../services/superOps/salesCustomers";

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
    error.value = toUserFacingErrorMessage(err, "Unable to update lead stage.");
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
    error.value = toUserFacingErrorMessage(err, "Unable to close lead.");
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
    error.value = toUserFacingErrorMessage(err, "Unable to move lead.");
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
.panel-actions {
  display: flex;
  gap: 0.5rem;
  margin-top: 1rem;
  flex-wrap: wrap;
}

.email-cell {
  word-break: break-word;
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

@media (max-width: 980px) {
  .kv-row {
    grid-template-columns: 1fr;
  }
}
</style>
