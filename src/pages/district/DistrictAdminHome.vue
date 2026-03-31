<template>
  <div class="page">
    <div class="page-nav-left">
      <button type="button" class="button-link" :disabled="isLoading" @click="loadDashboard">
        {{ isLoading ? "Refreshing..." : "Refresh" }}
      </button>
      <a class="button-link" href="#district-analytics">Analytics</a>
      <a class="button-link" href="#district-support">Support</a>
      <a class="button-link" href="#district-tenants">Tenants</a>
    </div>

    <h1>{{ dashboard?.district.name || "District Admin" }}</h1>
    <p v-if="dashboard" class="muted">
      {{ districtUrlPreview(dashboard.district.slug) }} ·
      {{ dashboard.district.is_active ? "active" : "inactive" }}
    </p>

    <p v-if="isLoading" class="muted">Loading district dashboard...</p>
    <p v-else-if="error" class="error">{{ error }}</p>

    <template v-else-if="dashboard">
      <div class="admin-grid">
        <div class="stat-card">
          <h3>Tenants</h3>
          <p class="stat-value">{{ dashboard.tenants.length }}</p>
        </div>
        <div class="stat-card">
          <h3>Items</h3>
          <p class="stat-value">{{ dashboard.usage.gear_total }}</p>
        </div>
        <div class="stat-card">
          <h3>Borrowers</h3>
          <p class="stat-value">{{ dashboard.usage.students_total }}</p>
        </div>
        <div class="stat-card">
          <h3>Active Checkouts</h3>
          <p class="stat-value">{{ dashboard.usage.active_checkouts }}</p>
        </div>
        <div class="stat-card">
          <h3>Overdue</h3>
          <p class="stat-value">{{ dashboard.usage.overdue_items }}</p>
        </div>
        <div class="stat-card">
          <h3>Transactions (7d)</h3>
          <p class="stat-value">{{ dashboard.usage.transactions_7d }}</p>
        </div>
        <div class="stat-card">
          <h3>Events (24h)</h3>
          <p class="stat-value">{{ dashboard.traffic.events_24h }}</p>
        </div>
      </div>

      <div id="district-analytics" class="card">
        <h2>Needs Attention</h2>
        <div class="needs-grid">
          <div v-for="item in dashboard.needs_attention" :key="item.key" class="needs-item" :class="`level-${item.level}`">
            <strong>{{ item.title }}</strong>
            <p class="muted">{{ item.count }} affected</p>
          </div>
          <p v-if="dashboard.needs_attention.length === 0" class="muted">No urgent district items.</p>
        </div>
      </div>

      <div class="card">
        <h2>Traffic (24h)</h2>
        <div class="bar-grid">
          <div v-for="bucket in dashboard.traffic_by_hour.slice(-12)" :key="bucket.hour" class="bar-cell">
            <div class="bar-stack">
              <div class="bar bar-checkout" :style="{ height: `${calcBarHeight(bucket.checkout)}px` }"></div>
              <div class="bar bar-return" :style="{ height: `${calcBarHeight(bucket.return)}px` }"></div>
            </div>
            <small>{{ formatHour(bucket.hour) }}</small>
          </div>
        </div>
      </div>

      <div class="card">
        <h2>Tenant Metrics</h2>
        <table class="table">
          <thead>
            <tr>
              <th>Tenant</th>
              <th>Items</th>
              <th>Borrowers</th>
              <th>Active Checkouts</th>
              <th>Overdue</th>
              <th>Transactions (7d)</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="metric in dashboard.tenant_metrics" :key="metric.tenant_id">
              <td>{{ metric.tenant_name }}</td>
              <td>{{ metric.gear_total }}</td>
              <td>{{ metric.students_total }}</td>
              <td>{{ metric.active_checkouts }}</td>
              <td>{{ metric.overdue_items }}</td>
              <td>{{ metric.transactions_7d }}</td>
            </tr>
            <tr v-if="dashboard.tenant_metrics.length === 0">
              <td colspan="6" class="muted">No tenant metrics yet.</td>
            </tr>
          </tbody>
        </table>
      </div>

      <div class="card">
        <h2>Recent Activity</h2>
        <table class="table">
          <thead>
            <tr>
              <th>Time</th>
              <th>Tenant</th>
              <th>Action</th>
              <th>Item</th>
              <th>Barcode</th>
              <th>Borrower</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="event in dashboard.recent_events" :key="`${event.action_time}-${event.tenant_id}-${event.gear_barcode}`">
              <td>{{ formatDate(event.action_time) }}</td>
              <td>{{ event.tenant_name }}</td>
              <td>
                <span class="status-pill" :class="event.action_type === 'checkout' ? 'status-open' : 'status-closed'">
                  {{ event.action_type }}
                </span>
              </td>
              <td>{{ event.gear_name || "-" }}</td>
              <td>{{ event.gear_barcode || "-" }}</td>
              <td>{{ event.student_username || "-" }}</td>
            </tr>
            <tr v-if="dashboard.recent_events.length === 0">
              <td colspan="6" class="muted">No recent activity.</td>
            </tr>
          </tbody>
        </table>
      </div>

      <div id="district-support" class="card">
        <h2>Support</h2>
        <p><strong>Support Email:</strong> {{ dashboard.district.support_email || "-" }}</p>
        <p><strong>Contact Name:</strong> {{ dashboard.district.contact_name || "-" }}</p>
      </div>

      <div class="card">
        <h2>Contact Support</h2>
        <form class="form" @submit.prevent="submitSupportRequest">
          <label>
            Subject
            <input v-model="supportSubject" type="text" placeholder="Issue summary" />
          </label>
          <label>
            Priority
            <select v-model="supportPriority">
              <option value="low">low</option>
              <option value="normal">normal</option>
              <option value="high">high</option>
              <option value="urgent">urgent</option>
            </select>
          </label>
          <label>
            Message
            <textarea v-model="supportMessage" rows="5" placeholder="Describe the issue and requested help."></textarea>
          </label>
          <div class="form-actions">
            <button type="submit" class="button-primary" :disabled="isSaving">Send Request</button>
          </div>
        </form>
      </div>

      <div class="card">
        <h2>Subscription</h2>
        <p><strong>Plan:</strong> {{ dashboard.district.subscription_plan || "-" }}</p>
        <p><strong>Billing Status:</strong> {{ dashboard.district.billing_status || "-" }}</p>
        <p><strong>Renewal Date:</strong> {{ formatDate(dashboard.district.renewal_date || "") || "-" }}</p>
        <p><strong>Billing Email:</strong> {{ dashboard.district.billing_email || "-" }}</p>
        <p><strong>Invoice Reference:</strong> {{ dashboard.district.invoice_reference || "-" }}</p>
      </div>

      <div class="card">
        <h2>Recent Support Requests</h2>
        <table class="table">
          <thead>
            <tr>
              <th>Created</th>
              <th>Priority</th>
              <th>Status</th>
              <th>Subject</th>
              <th>Requester</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="request in dashboard.support_requests" :key="request.id">
              <td>{{ formatDate(request.created_at) }}</td>
              <td><span class="status-pill">{{ request.priority }}</span></td>
              <td><span class="status-pill">{{ request.status }}</span></td>
              <td>{{ request.subject }}</td>
              <td>{{ request.requester_email || request.requester_name || "-" }}</td>
            </tr>
            <tr v-if="dashboard.support_requests.length === 0">
              <td colspan="5" class="muted">No support requests yet.</td>
            </tr>
          </tbody>
        </table>
      </div>

      <div id="district-tenants" class="card">
        <h2>District Tenants</h2>
        <div class="input-row">
          <input v-model="search" type="text" placeholder="Search tenants" />
          <select v-model="statusFilter">
            <option value="all">all</option>
            <option value="active">active</option>
            <option value="suspended">disabled</option>
            <option value="archived">archived</option>
          </select>
        </div>
        <table class="table">
          <thead>
            <tr>
              <th>Name</th>
              <th>Access Code</th>
              <th>Status</th>
              <th>Primary Admin</th>
              <th>Created</th>
              <th>Actions</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="tenant in filteredTenants" :key="tenant.id">
              <td>{{ tenant.name }}</td>
              <td>{{ tenant.access_code }}</td>
              <td><span class="status-pill" :class="tenantStatusClass(tenant.status)">{{ tenant.status }}</span></td>
              <td>{{ tenant.primary_admin_email || "-" }}</td>
              <td>{{ formatDate(tenant.created_at) }}</td>
              <td class="actions-cell">
                <button type="button" :disabled="isSaving" @click="openEditModal(tenant)">Edit</button>
                <button
                  type="button"
                  :disabled="isSaving"
                  @click="resetPrimaryAdmin(tenant)"
                >
                  Reset Admin
                </button>
                <button
                  type="button"
                  :disabled="isSaving"
                  @click="toggleTenantStatus(tenant)"
                >
                  {{
                    tenant.status === "active"
                      ? "Disable"
                      : tenant.status === "suspended"
                        ? "Enable"
                        : "Restore"
                  }}
                </button>
                <button
                  v-if="tenant.status !== 'archived'"
                  type="button"
                  :disabled="isSaving"
                  @click="archiveTenant(tenant)"
                >
                  Archive
                </button>
              </td>
            </tr>
            <tr v-if="filteredTenants.length === 0">
              <td colspan="6" class="muted">No district tenants match the current filter.</td>
            </tr>
          </tbody>
        </table>
      </div>
    </template>

    <div v-if="success" class="success">{{ success }}</div>

    <div v-if="editModalVisible && editTarget" class="modal-backdrop" @click.self="closeEditModal">
      <div class="modal">
        <h2>Edit Tenant</h2>
        <form class="form" @submit.prevent="saveTenantEdit">
          <label>
            Tenant Name
            <input v-model="editName" type="text" placeholder="Tenant name" />
          </label>
          <label>
            Access Code
            <input v-model="editAccessCode" type="text" placeholder="Access code" />
          </label>
          <div class="form-actions">
            <button type="submit" class="button-primary" :disabled="isSaving">Save</button>
            <button type="button" :disabled="isSaving" @click="closeEditModal">Cancel</button>
          </div>
        </form>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, ref } from "vue";
import { toUserFacingErrorMessage } from "../../services/appErrors";
import {
  createDistrictSupportRequest,
  getDistrictAdminDashboard,
  sendDistrictTenantPrimaryAdminReset,
  setDistrictTenantStatus,
  updateDistrictTenant,
  type DistrictAdminDashboard,
  type DistrictAdminTenant,
} from "../../services/districtAdminService";

const dashboard = ref<DistrictAdminDashboard | null>(null);
const isLoading = ref(false);
const isSaving = ref(false);
const error = ref("");
const success = ref("");
const search = ref("");
const statusFilter = ref<"all" | "active" | "suspended" | "archived">("all");
const editModalVisible = ref(false);
const editTarget = ref<DistrictAdminTenant | null>(null);
const editName = ref("");
const editAccessCode = ref("");
const supportSubject = ref("");
const supportMessage = ref("");
const supportPriority = ref<"low" | "normal" | "high" | "urgent">("normal");

const districtUrlPreview = (slug: string) => `https://${slug}.app.itemtraxx.com`;

const tenantStatusClass = (status: DistrictAdminTenant["status"]) =>
  status === "active" ? "status-open" : status === "suspended" ? "status-closed" : "status-archived";

const filteredTenants = computed(() => {
  const tenants = dashboard.value?.tenants ?? [];
  const query = search.value.trim().toLowerCase();
  return tenants.filter((tenant) => {
    const matchesStatus = statusFilter.value === "all" || tenant.status === statusFilter.value;
    const matchesSearch =
      !query ||
      tenant.name.toLowerCase().includes(query) ||
      tenant.access_code.toLowerCase().includes(query) ||
      (tenant.primary_admin_email ?? "").toLowerCase().includes(query);
    return matchesStatus && matchesSearch;
  });
});

const formatDate = (value: string) => {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleDateString();
};

const formatHour = (value: string) => {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleTimeString([], { hour: "numeric" });
};

const calcBarHeight = (value: number) => {
  const values = dashboard.value?.traffic_by_hour.flatMap((bucket) => [bucket.checkout, bucket.return]) ?? [0];
  const max = Math.max(1, ...values);
  return Math.max(6, Math.round((value / max) * 120));
};

const upsertTenant = (updated: DistrictAdminTenant) => {
  if (!dashboard.value) return;
  dashboard.value = {
    ...dashboard.value,
    tenants: dashboard.value.tenants.map((tenant) =>
      tenant.id === updated.id ? updated : tenant
    ),
  };
};

const loadDashboard = async () => {
  isLoading.value = true;
  error.value = "";
  try {
    dashboard.value = await getDistrictAdminDashboard();
  } catch (err) {
    error.value = toUserFacingErrorMessage(err, "Unable to load district dashboard.");
  } finally {
    isLoading.value = false;
  }
};

const openEditModal = (tenant: DistrictAdminTenant) => {
  editTarget.value = tenant;
  editName.value = tenant.name;
  editAccessCode.value = tenant.access_code;
  editModalVisible.value = true;
};

const closeEditModal = () => {
  editModalVisible.value = false;
  editTarget.value = null;
  editName.value = "";
  editAccessCode.value = "";
};

const saveTenantEdit = async () => {
  if (!editTarget.value) return;
  isSaving.value = true;
  try {
    const updated = await updateDistrictTenant({
      id: editTarget.value.id,
      name: editName.value.trim(),
      access_code: editAccessCode.value.trim(),
    });
    upsertTenant(updated);
    success.value = "Tenant updated.";
    closeEditModal();
  } catch (err) {
    error.value = toUserFacingErrorMessage(err, "Unable to update tenant.");
  } finally {
    isSaving.value = false;
  }
};

const toggleTenantStatus = async (tenant: DistrictAdminTenant) => {
  isSaving.value = true;
  try {
    const updated = await setDistrictTenantStatus({
      id: tenant.id,
      status:
        tenant.status === "active"
          ? "suspended"
          : "active",
    });
    upsertTenant(updated);
    success.value =
      updated.status === "active" ? "Tenant restored." : "Tenant disabled.";
  } catch (err) {
    error.value = toUserFacingErrorMessage(err, "Unable to update tenant status.");
  } finally {
    isSaving.value = false;
  }
};

const archiveTenant = async (tenant: DistrictAdminTenant) => {
  isSaving.value = true;
  try {
    const updated = await setDistrictTenantStatus({
      id: tenant.id,
      status: "archived",
    });
    upsertTenant(updated);
    success.value = "Tenant archived.";
  } catch (err) {
    error.value = toUserFacingErrorMessage(err, "Unable to archive tenant.");
  } finally {
    isSaving.value = false;
  }
};

const submitSupportRequest = async () => {
  if (!supportSubject.value.trim() || !supportMessage.value.trim()) {
    error.value = "Support subject and message are required.";
    return;
  }
  isSaving.value = true;
  try {
    const created = await createDistrictSupportRequest({
      subject: supportSubject.value.trim(),
      message: supportMessage.value.trim(),
      priority: supportPriority.value,
    });
    if (dashboard.value) {
      dashboard.value = {
        ...dashboard.value,
        support_requests: [created, ...dashboard.value.support_requests],
      };
    }
    supportSubject.value = "";
    supportMessage.value = "";
    supportPriority.value = "normal";
    success.value = "Support request sent.";
  } catch (err) {
    error.value = toUserFacingErrorMessage(err, "Unable to send support request.");
  } finally {
    isSaving.value = false;
  }
};

const resetPrimaryAdmin = async (tenant: DistrictAdminTenant) => {
  isSaving.value = true;
  try {
    await sendDistrictTenantPrimaryAdminReset({ tenant_id: tenant.id });
    success.value = "Primary admin reset email sent.";
  } catch (err) {
    error.value = toUserFacingErrorMessage(err, "Unable to send reset.");
  } finally {
    isSaving.value = false;
  }
};

onMounted(() => {
  void loadDashboard();
});
</script>

<style scoped>
.actions-cell {
  display: flex;
  gap: 0.5rem;
  flex-wrap: wrap;
}

.needs-grid {
  display: grid;
  gap: 0.75rem;
}

.needs-item {
  border: 1px solid var(--border);
  border-radius: 12px;
  padding: 0.85rem 1rem;
  background: color-mix(in srgb, var(--surface) 92%, #ffffff 8%);
}

.level-high {
  border-color: rgba(190, 24, 93, 0.35);
}

.level-medium {
  border-color: rgba(217, 119, 6, 0.35);
}

.level-low {
  border-color: rgba(14, 116, 144, 0.35);
}

.bar-grid {
  display: grid;
  grid-template-columns: repeat(12, minmax(0, 1fr));
  gap: 0.75rem;
  align-items: end;
}

.bar-cell {
  display: grid;
  gap: 0.4rem;
  justify-items: center;
}

.bar-stack {
  width: 100%;
  min-height: 128px;
  display: flex;
  align-items: end;
  justify-content: center;
  gap: 0.2rem;
}

.bar {
  width: 45%;
  border-radius: 999px 999px 0 0;
}

.bar-checkout {
  background: #1d4ed8;
}

.bar-return {
  background: #059669;
}

.status-pill {
  display: inline-flex;
  align-items: center;
  padding: 0.15rem 0.5rem;
  border-radius: 999px;
  background: rgba(148, 163, 184, 0.18);
  color: var(--text);
  font-size: 0.82rem;
}

.status-open {
  background: rgba(34, 197, 94, 0.16);
}

.status-closed {
  background: rgba(245, 158, 11, 0.18);
}

.status-archived {
  background: rgba(100, 116, 139, 0.2);
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
</style>
