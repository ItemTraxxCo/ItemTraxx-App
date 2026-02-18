<template>
  <div class="page">
    <h1>Super Admin</h1>
    <p>Platform management</p>

    <div class="admin-grid">
      <div class="stat-card">
        <h3>Total tenants</h3>
        <p class="stat-value">{{ dashboard?.total_tenants ?? "-" }}</p>
      </div>
      <div class="stat-card">
        <h3>Active tenants</h3>
        <p class="stat-value">{{ dashboard?.active_tenants ?? "-" }}</p>
      </div>
      <div class="stat-card">
        <h3>Disabled tenants</h3>
        <p class="stat-value">{{ dashboard?.suspended_tenants ?? "-" }}</p>
      </div>
      <div class="stat-card">
        <h3>Tenant admins</h3>
        <p class="stat-value">{{ dashboard?.tenant_admins_count ?? "-" }}</p>
      </div>
      <div class="stat-card">
        <h3>Active alerts</h3>
        <p class="stat-value">{{ dashboard?.alert_events?.length ?? 0 }}</p>
      </div>
      <div class="stat-card">
        <h3>Pending approvals</h3>
        <p class="stat-value">{{ controlCenter?.approvals?.filter((item) => item.status === "pending").length ?? 0 }}</p>
      </div>
    </div>

    <nav class="page-nav-left">
      <RouterLink class="button-link" to="/super-admin/tenants">Tenants</RouterLink>
      <RouterLink class="button-link" to="/super-admin/admins">Tenant Admins</RouterLink>
      <RouterLink class="button-link" to="/super-admin/gear">All Gear</RouterLink>
      <RouterLink class="button-link" to="/super-admin/students">All Students</RouterLink>
      <RouterLink class="button-link" to="/super-admin/logs">All Logs</RouterLink>
      <RouterLink class="button-link" to="/super-admin/broadcasts">Broadcasts</RouterLink>
    </nav>

    <div class="card">
      <h2>Control Center</h2>
      <p class="muted">Configure runtime settings, alert rules, and emergency actions.</p>

      <div class="control-grid">
        <div>
          <h3>System Status Override</h3>
          <p class="muted">Leave at <code>auto</code> for automatic health checks.</p>
          <label>
            Mode
            <select v-model="statusOverrideMode">
              <option value="auto">auto</option>
              <option value="running">running</option>
              <option value="degraded">degraded</option>
              <option value="outage">outage</option>
            </select>
          </label>
          <div class="form-actions">
            <button type="button" class="button-primary" :disabled="isSaving" @click="saveStatusOverride">
              Save Status Mode
            </button>
          </div>
        </div>

        <div>
          <h3>Maintenance Mode</h3>
          <p class="muted">Blocks tenant logins and write actions while enabled.</p>
          <label>
            Enabled
            <select v-model="maintenanceEnabled">
              <option :value="false">false</option>
              <option :value="true">true</option>
            </select>
          </label>
          <label>
            Message
            <input
              v-model="maintenanceMessage"
              type="text"
              maxlength="180"
              placeholder="Scheduled maintenance in progress."
            />
          </label>
          <div class="form-actions">
            <button type="button" class="button-primary" :disabled="isSaving" @click="saveMaintenanceMode">
              Save Maintenance Mode
            </button>
          </div>
        </div>

        <div>
          <h3>Alert Rules</h3>
          <label>
            Name
            <input v-model="alertName" type="text" placeholder="Overdue checkouts high" />
          </label>
          <label>
            Metric
            <select v-model="alertMetricKey">
              <option value="suspended_tenants">suspended_tenants</option>
              <option value="overdue_items">overdue_items</option>
              <option value="active_checkouts">active_checkouts</option>
              <option value="transactions_7d">transactions_7d</option>
            </select>
          </label>
          <label>
            Threshold
            <input v-model.number="alertThreshold" type="number" min="1" step="1" />
          </label>
          <label>
            Enabled
            <select v-model="alertEnabled">
              <option :value="true">true</option>
              <option :value="false">false</option>
            </select>
          </label>
          <div class="form-actions">
            <button type="button" class="button-primary" :disabled="isSaving" @click="saveAlertRule">
              Save Alert Rule
            </button>
          </div>
        </div>

        <div>
          <h3>Emergency Controls</h3>
          <label>
            Tenant ID
            <input v-model="forceReauthTenantId" type="text" placeholder="Tenant UUID" />
          </label>
          <div class="form-actions">
            <button type="button" :disabled="isSaving" @click="forceTenantSignOut">
              Force Tenant Re-Login
            </button>
          </div>
        </div>
      </div>
    </div>

    <div class="card">
      <h2>Active Alert Events</h2>
      <p v-if="isLoading" class="muted">Loading dashboard...</p>
      <p v-else-if="error" class="error">{{ error }}</p>
      <table v-else class="table">
        <thead>
          <tr>
            <th>Rule</th>
            <th>Metric</th>
            <th>Current</th>
            <th>Threshold</th>
            <th>Severity</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="item in dashboard?.alert_events ?? []" :key="item.id">
            <td>{{ item.name }}</td>
            <td>{{ item.metric_key }}</td>
            <td>{{ item.current }}</td>
            <td>{{ item.threshold }}</td>
            <td>
              <span class="severity" :class="`severity-${item.severity}`">{{ item.severity }}</span>
            </td>
          </tr>
          <tr v-if="(dashboard?.alert_events?.length ?? 0) === 0">
            <td colspan="5" class="muted">No active alerts.</td>
          </tr>
        </tbody>
      </table>
    </div>

    <div class="card">
      <h2>Pending Approvals</h2>
      <table class="table">
        <thead>
          <tr>
            <th>Created</th>
            <th>Action</th>
            <th>Status</th>
            <th>Requested By</th>
            <th>Actions</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="item in controlCenter?.approvals ?? []" :key="item.id">
            <td>{{ formatDateTime(item.created_at) }}</td>
            <td>{{ item.action_type }}</td>
            <td>{{ item.status }}</td>
            <td>{{ item.requested_by }}</td>
            <td>
              <button
                v-if="item.status === 'pending'"
                type="button"
                :disabled="isSaving"
                @click="approve(item.id)"
              >
                Approve
              </button>
            </td>
          </tr>
          <tr v-if="(controlCenter?.approvals?.length ?? 0) === 0">
            <td colspan="5" class="muted">No approval requests.</td>
          </tr>
        </tbody>
      </table>
    </div>

    <div class="card">
      <h2>Tenant Activity (Last 7 Days)</h2>
      <table class="table">
        <thead>
          <tr>
            <th>Tenant</th>
            <th>Gear</th>
            <th>Students</th>
            <th>Active Checkouts</th>
            <th>Overdue</th>
            <th>Transactions (7d)</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="item in (dashboard?.tenant_metrics ?? []).slice(0, 20)" :key="item.tenant_id">
            <td>{{ item.tenant_name }}</td>
            <td>{{ item.gear_total }}</td>
            <td>{{ item.students_total }}</td>
            <td>{{ item.active_checkouts }}</td>
            <td>{{ item.overdue_items }}</td>
            <td>{{ item.transactions_7d }}</td>
          </tr>
          <tr v-if="(dashboard?.tenant_metrics?.length ?? 0) === 0">
            <td colspan="6" class="muted">No tenant metrics available.</td>
          </tr>
        </tbody>
      </table>
    </div>

    <div class="card">
      <h2>Recent privileged actions</h2>
      <table class="table">
        <thead>
          <tr>
            <th>When</th>
            <th>Action</th>
            <th>Actor</th>
            <th>Target</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="item in dashboard?.recent_actions ?? []" :key="item.id">
            <td>{{ formatDateTime(item.created_at) }}</td>
            <td>{{ item.action_type }}</td>
            <td>{{ item.actor_email || item.actor_id }}</td>
            <td>{{ item.target_type || "-" }} {{ item.target_id || "" }}</td>
          </tr>
          <tr v-if="(dashboard?.recent_actions?.length ?? 0) === 0">
            <td colspan="4" class="muted">No recent actions.</td>
          </tr>
        </tbody>
      </table>
    </div>

    <div class="card">
      <h2>Recent jobs</h2>
      <table class="table">
        <thead>
          <tr>
            <th>Updated</th>
            <th>Type</th>
            <th>Status</th>
            <th>Details</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="item in controlCenter?.jobs ?? []" :key="item.id">
            <td>{{ formatDateTime(item.updated_at) }}</td>
            <td>{{ item.job_type }}</td>
            <td>{{ item.status }}</td>
            <td class="mono">{{ summarizeDetails(item.details) }}</td>
          </tr>
          <tr v-if="(controlCenter?.jobs?.length ?? 0) === 0">
            <td colspan="4" class="muted">No jobs yet.</td>
          </tr>
        </tbody>
      </table>
    </div>

    <button type="button" class="link" @click="handleSignOut">Sign out</button>

    <div v-if="toastMessage" class="toast">
      <div class="toast-title">{{ toastTitle }}</div>
      <div class="toast-body">{{ toastMessage }}</div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { onMounted, onUnmounted, ref } from "vue";
import { RouterLink, useRouter } from "vue-router";
import { signOut } from "../../services/authService";
import { fetchSuperDashboard, type SuperDashboard } from "../../services/superAuditService";
import {
  approveRequest,
  forceTenantReauth,
  getControlCenter,
  setRuntimeConfig,
  upsertAlertRule,
  type SuperControlCenter,
} from "../../services/superOpsService";

const router = useRouter();
const dashboard = ref<SuperDashboard | null>(null);
const controlCenter = ref<SuperControlCenter | null>(null);
const isLoading = ref(false);
const isSaving = ref(false);
const error = ref("");
const toastTitle = ref("");
const toastMessage = ref("");
const statusOverrideMode = ref("auto");
const maintenanceEnabled = ref(false);
const maintenanceMessage = ref("Scheduled maintenance in progress.");
const alertName = ref("");
const alertMetricKey = ref("overdue_items");
const alertThreshold = ref(5);
const alertEnabled = ref(true);
const forceReauthTenantId = ref("");
let toastTimer: number | null = null;

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

const formatDateTime = (value: string) => {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString();
};

const summarizeDetails = (details: Record<string, unknown>) => {
  const entries = Object.entries(details || {});
  if (!entries.length) return "-";
  return entries
    .slice(0, 3)
    .map(([key, value]) => `${key}: ${String(value)}`)
    .join(" | ");
};

const loadDashboard = async () => {
  const data = await fetchSuperDashboard();
  dashboard.value = data;
  const statusOverride = (data.runtime_config?.system_status_override ?? {}) as {
    mode?: string;
  };
  if (typeof statusOverride.mode === "string") {
    statusOverrideMode.value = statusOverride.mode;
  }
  const maintenance = (data.runtime_config?.maintenance_mode ?? {}) as {
    enabled?: boolean;
    message?: string;
  };
  maintenanceEnabled.value = maintenance.enabled === true;
  maintenanceMessage.value =
    typeof maintenance.message === "string" && maintenance.message.trim()
      ? maintenance.message
      : "Scheduled maintenance in progress.";
};

const loadControlCenter = async () => {
  const data = await getControlCenter();
  controlCenter.value = data;
};

const loadAll = async () => {
  isLoading.value = true;
  error.value = "";
  try {
    await Promise.all([loadDashboard(), loadControlCenter()]);
  } catch (err) {
    error.value = err instanceof Error ? err.message : "Unable to load dashboard.";
  } finally {
    isLoading.value = false;
  }
};

const saveStatusOverride = async () => {
  isSaving.value = true;
  try {
    await setRuntimeConfig({
      key: "system_status_override",
      value: { mode: statusOverrideMode.value },
    });
    showToast("Saved", "System status override was updated.");
    await loadAll();
  } catch (err) {
    showToast("Save failed", err instanceof Error ? err.message : "Unable to save status override.");
  } finally {
    isSaving.value = false;
  }
};

const saveMaintenanceMode = async () => {
  isSaving.value = true;
  try {
    await setRuntimeConfig({
      key: "maintenance_mode",
      value: {
        enabled: maintenanceEnabled.value,
        message: maintenanceMessage.value.trim() || "Scheduled maintenance in progress.",
        updated_at: new Date().toISOString(),
      },
    });
    showToast("Saved", "Maintenance mode updated.");
    await loadAll();
  } catch (err) {
    showToast("Save failed", err instanceof Error ? err.message : "Unable to save maintenance mode.");
  } finally {
    isSaving.value = false;
  }
};

const saveAlertRule = async () => {
  if (!alertName.value.trim() || !Number.isFinite(alertThreshold.value) || alertThreshold.value <= 0) {
    showToast("Invalid input", "Enter alert name and a threshold greater than zero.");
    return;
  }

  isSaving.value = true;
  try {
    await upsertAlertRule({
      name: alertName.value.trim(),
      metric_key: alertMetricKey.value,
      threshold: alertThreshold.value,
      is_enabled: alertEnabled.value,
    });
    alertName.value = "";
    alertThreshold.value = 5;
    alertEnabled.value = true;
    showToast("Saved", "Alert rule saved.");
    await loadAll();
  } catch (err) {
    showToast("Save failed", err instanceof Error ? err.message : "Unable to save alert rule.");
  } finally {
    isSaving.value = false;
  }
};

const forceTenantSignOut = async () => {
  const tenantId = forceReauthTenantId.value.trim();
  if (!tenantId) {
    showToast("Invalid input", "Enter a tenant ID.");
    return;
  }

  isSaving.value = true;
  try {
    await forceTenantReauth({ tenant_id: tenantId });
    forceReauthTenantId.value = "";
    showToast("Done", "Tenant sessions were invalidated.");
    await loadAll();
  } catch (err) {
    showToast("Action failed", err instanceof Error ? err.message : "Unable to force tenant re-login.");
  } finally {
    isSaving.value = false;
  }
};

const approve = async (id: string) => {
  isSaving.value = true;
  try {
    await approveRequest({ id });
    showToast("Approved", "Request approved.");
    await loadAll();
  } catch (err) {
    showToast("Approval failed", err instanceof Error ? err.message : "Unable to approve request.");
  } finally {
    isSaving.value = false;
  }
};

const handleSignOut = async () => {
  await signOut();
  await router.push("/");
};

onMounted(() => {
  void loadAll();
});

onUnmounted(() => {
  if (toastTimer) {
    window.clearTimeout(toastTimer);
    toastTimer = null;
  }
});
</script>

<style scoped>
.control-grid {
  display: grid;
  gap: 1rem;
  grid-template-columns: repeat(auto-fit, minmax(220px, 1fr));
  margin-top: 1rem;
}

.severity {
  display: inline-block;
  border-radius: 999px;
  padding: 0.2rem 0.55rem;
  font-size: 0.75rem;
  font-weight: 700;
  text-transform: uppercase;
}

.severity-warn {
  background: rgba(247, 176, 31, 0.2);
  color: #d48b00;
}

.severity-critical {
  background: rgba(210, 38, 38, 0.2);
  color: #b42318;
}

.mono {
  font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", "Courier New", monospace;
  font-size: 0.8rem;
}
</style>
