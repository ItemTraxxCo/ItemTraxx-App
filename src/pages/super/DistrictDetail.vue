<template>
  <div class="page">
    <div class="page-nav-left">
      <RouterLink class="button-link" to="/super-admin">Return to Super Admin</RouterLink>
      <RouterLink class="button-link" to="/super-admin/districts">Districts</RouterLink>
      <RouterLink class="button-link" to="/super-admin/tenants">Tenants</RouterLink>
      <button type="button" class="button-link" :disabled="isLoading" @click="loadDetail">
        {{ isLoading ? "Refreshing..." : "Refresh" }}
      </button>
      <a v-if="detail" class="button-link" :href="districtUrlPreview(detail.district.slug)" target="_blank" rel="noreferrer">
        Open District URL
      </a>
    </div>

    <h1>{{ detail?.district.name || "District Overview" }}</h1>
    <p v-if="detail" class="muted">
      {{ districtUrlPreview(detail.district.slug) }} ·
      {{ detail.district.is_active ? "active" : "inactive" }}
    </p>

    <p v-if="isLoading" class="muted">Loading district...</p>
    <p v-else-if="error" class="error">{{ error }}</p>

    <template v-else-if="detail">
      <div class="admin-grid">
        <div class="stat-card">
          <h3>Tenants</h3>
          <p class="stat-value">{{ detail.tenants.length }}</p>
        </div>
        <div class="stat-card">
          <h3>Items</h3>
          <p class="stat-value">{{ detail.usage.gear_total }}</p>
        </div>
        <div class="stat-card">
          <h3>Borrowers</h3>
          <p class="stat-value">{{ detail.usage.students_total }}</p>
        </div>
        <div class="stat-card">
          <h3>Active checkouts</h3>
          <p class="stat-value">{{ detail.usage.active_checkouts }}</p>
        </div>
        <div class="stat-card">
          <h3>Overdue</h3>
          <p class="stat-value">{{ detail.usage.overdue_items }}</p>
        </div>
        <div class="stat-card">
          <h3>Transactions (7d)</h3>
          <p class="stat-value">{{ detail.usage.transactions_7d }}</p>
        </div>
        <div class="stat-card">
          <h3>Events (24h)</h3>
          <p class="stat-value">{{ detail.traffic.events_24h }}</p>
        </div>
      </div>

      <div class="card">
        <h2>Needs Attention</h2>
        <div class="needs-grid">
          <div v-for="item in detail.needs_attention" :key="item.key" class="needs-item" :class="`level-${item.level}`">
            <strong>{{ item.title }}</strong>
            <p class="muted">{{ item.count }} affected</p>
          </div>
          <p v-if="detail.needs_attention.length === 0" class="muted">No urgent district items.</p>
        </div>
      </div>

      <div class="card">
        <h2>Traffic (24h)</h2>
        <div class="bar-grid">
          <div v-for="bucket in detail.traffic_by_hour.slice(-12)" :key="bucket.hour" class="bar-cell">
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
            <tr v-for="metric in detail.tenant_metrics" :key="metric.tenant_id">
              <td>{{ metric.tenant_name }}</td>
              <td>{{ metric.gear_total }}</td>
              <td>{{ metric.students_total }}</td>
              <td>{{ metric.active_checkouts }}</td>
              <td>{{ metric.overdue_items }}</td>
              <td>{{ metric.transactions_7d }}</td>
            </tr>
            <tr v-if="detail.tenant_metrics.length === 0">
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
            <tr v-for="event in detail.recent_events" :key="`${event.action_time}-${event.tenant_id}-${event.gear_barcode}`">
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
            <tr v-if="detail.recent_events.length === 0">
              <td colspan="6" class="muted">No recent activity.</td>
            </tr>
          </tbody>
        </table>
      </div>

      <div class="card">
        <h2>District Support</h2>
        <p><strong>Support Email:</strong> {{ detail.district.support_email || "-" }}</p>
        <p><strong>Contact Name:</strong> {{ detail.district.contact_name || "-" }}</p>
        <p><strong>Subdomain:</strong> {{ districtUrlPreview(detail.district.slug) }}</p>
      </div>

      <div class="card">
        <h2>Support Requests</h2>
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
            <tr v-for="request in detail.support_requests" :key="request.id">
              <td>{{ formatDate(request.created_at) }}</td>
              <td><span class="status-pill">{{ request.priority }}</span></td>
              <td><span class="status-pill">{{ request.status }}</span></td>
              <td>{{ request.subject }}</td>
              <td>{{ request.requester_email || request.requester_name || "-" }}</td>
            </tr>
            <tr v-if="detail.support_requests.length === 0">
              <td colspan="5" class="muted">No support requests yet.</td>
            </tr>
          </tbody>
        </table>
      </div>

      <div class="card">
        <h2>District Admins</h2>
        <form class="form district-admin-form" @submit.prevent="createDistrictAdmin">
          <label>
            Admin Email
            <input v-model="createAdminEmail" type="email" placeholder="district.admin@district.org" />
          </label>
          <label>
            Temporary Password
            <input v-model="createAdminPassword" type="password" placeholder="Temporary password" />
          </label>
          <div class="form-actions">
            <button
              type="submit"
              class="button-primary"
              :disabled="isSavingAdmins || !createAdminEmail.trim() || createAdminPassword.length < 8"
            >
              Create District Admin
            </button>
          </div>
        </form>

        <p v-if="isLoadingAdmins" class="muted">Loading district admins...</p>
        <table v-else class="table">
          <thead>
            <tr>
              <th>Email</th>
              <th>Status</th>
              <th>Created</th>
              <th>Actions</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="admin in districtAdmins" :key="admin.id">
              <td>{{ admin.auth_email }}</td>
              <td>{{ admin.is_active ? "active" : "disabled" }}</td>
              <td>{{ formatDate(admin.created_at) }}</td>
              <td class="actions-cell">
                <button type="button" :disabled="isSavingAdmins" @click="sendReset(admin.auth_email)">
                  Send Reset
                </button>
                <button
                  type="button"
                  :disabled="isSavingAdmins"
                  @click="toggleAdminStatus(admin)"
                >
                  {{ admin.is_active ? "Disable" : "Enable" }}
                </button>
              </td>
            </tr>
            <tr v-if="districtAdmins.length === 0">
              <td colspan="4" class="muted">No district admins yet.</td>
            </tr>
          </tbody>
        </table>
      </div>

      <div class="card">
        <h2>Subscription</h2>
        <div class="modal-body">
          <div class="kv-row"><span>Plan</span><strong>{{ detail.district.subscription_plan || "-" }}</strong></div>
          <div class="kv-row"><span>Billing Status</span><strong>{{ detail.district.billing_status || "-" }}</strong></div>
          <div class="kv-row"><span>Renewal Date</span><strong>{{ formatDate(detail.district.renewal_date || "") || "-" }}</strong></div>
          <div class="kv-row"><span>Billing Email</span><strong>{{ detail.district.billing_email || "-" }}</strong></div>
          <div class="kv-row"><span>Invoice Reference</span><strong>{{ detail.district.invoice_reference || "-" }}</strong></div>
        </div>
        <p class="muted">Manage billing metadata from District Management.</p>
      </div>

      <div class="card">
        <h2>District Tenants</h2>
        <table class="table">
          <thead>
            <tr>
              <th>Name</th>
              <th>Access Code</th>
              <th>Status</th>
              <th>Primary Admin</th>
              <th>Created</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="tenant in detail.tenants" :key="tenant.id">
              <td>{{ tenant.name }}</td>
              <td>{{ tenant.access_code }}</td>
              <td>{{ tenant.status }}</td>
              <td>{{ tenant.primary_admin_email || "-" }}</td>
              <td>{{ formatDate(tenant.created_at) }}</td>
            </tr>
            <tr v-if="detail.tenants.length === 0">
              <td colspan="5" class="muted">No tenants assigned to this district.</td>
            </tr>
          </tbody>
        </table>
      </div>
    </template>
  </div>
</template>

<script setup lang="ts">
import { onMounted, ref } from "vue";
import { RouterLink, useRoute } from "vue-router";
import {
  createTenantAdmin,
  listTenantAdmins,
  sendTenantAdminReset,
  setTenantAdminStatus,
  type SuperTenantAdmin,
} from "../../services/superAdminService";
import { getDistrictDetails, type SuperDistrictDetail } from "../../services/superTenantService";

const route = useRoute();
const detail = ref<SuperDistrictDetail | null>(null);
const isLoading = ref(false);
const isLoadingAdmins = ref(false);
const isSavingAdmins = ref(false);
const error = ref("");
const districtAdmins = ref<SuperTenantAdmin[]>([]);
const createAdminEmail = ref("");
const createAdminPassword = ref("");

const districtUrlPreview = (slug: string) => `https://${slug}.app.itemtraxx.com`;

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
  const values = detail.value?.traffic_by_hour.flatMap((bucket) => [bucket.checkout, bucket.return]) ?? [0];
  const max = Math.max(1, ...values);
  return Math.max(6, Math.round((value / max) * 120));
};

const loadDetail = async () => {
  const districtId = String(route.params.id || "").trim();
  if (!districtId) {
    error.value = "District id is missing.";
    return;
  }

  isLoading.value = true;
  error.value = "";
  try {
    detail.value = await getDistrictDetails(districtId);
  } catch (err) {
    error.value = err instanceof Error ? err.message : "Unable to load district.";
  } finally {
    isLoading.value = false;
  }
};

const loadDistrictAdmins = async () => {
  const districtId = String(route.params.id || "").trim();
  if (!districtId) return;
  isLoadingAdmins.value = true;
  try {
    districtAdmins.value = await listTenantAdmins("", "all", "district", districtId);
  } finally {
    isLoadingAdmins.value = false;
  }
};

const createDistrictAdmin = async () => {
  const districtId = String(route.params.id || "").trim();
  if (!districtId || !createAdminEmail.value.trim() || !createAdminPassword.value.trim()) {
    return;
  }
  if (createAdminPassword.value.length < 8) {
    error.value = "Temporary password must be at least 8 characters.";
    return;
  }
  isSavingAdmins.value = true;
  try {
    const created = await createTenantAdmin({
      district_id: districtId,
      auth_email: createAdminEmail.value.trim(),
      password: createAdminPassword.value,
      admin_scope: "district",
    });
    districtAdmins.value = [created, ...districtAdmins.value];
    createAdminEmail.value = "";
    createAdminPassword.value = "";
  } catch (err) {
    error.value = err instanceof Error ? err.message : "Unable to create district admin.";
  } finally {
    isSavingAdmins.value = false;
  }
};

const sendReset = async (authEmail: string) => {
  isSavingAdmins.value = true;
  try {
    await sendTenantAdminReset({ auth_email: authEmail, admin_scope: "district" });
  } catch (err) {
    error.value = err instanceof Error ? err.message : "Unable to send reset.";
  } finally {
    isSavingAdmins.value = false;
  }
};

const toggleAdminStatus = async (admin: SuperTenantAdmin) => {
  isSavingAdmins.value = true;
  try {
    const updated = await setTenantAdminStatus({
      id: admin.id,
      is_active: !admin.is_active,
      admin_scope: "district",
    });
    districtAdmins.value = districtAdmins.value.map((item) =>
      item.id === updated.id ? updated : item
    );
  } catch (err) {
    error.value = err instanceof Error ? err.message : "Unable to update district admin.";
  } finally {
    isSavingAdmins.value = false;
  }
};

onMounted(() => {
  void loadDetail();
  void loadDistrictAdmins();
});
</script>

<style scoped>
.district-admin-form {
  margin-bottom: 1rem;
}

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
</style>
