<template>
  <div class="page">
    <div class="workspace-hero card">
      <div class="workspace-copy">
        <p class="workspace-eyebrow">Platform Control Center</p>
        <h1>Super Admin</h1>
        <p class="workspace-summary">
          Manage workspaces, runtime controls, and platform health from a smaller set of
          focused entry points.
        </p>
      </div>
    </div>

    <div class="admin-grid">
      <div class="stat-card">
        <h3>Total workspaces</h3>
        <p class="stat-value">{{ dashboard?.total_workspaces ?? "-" }}</p>
      </div>
      <div class="stat-card">
        <h3>Active workspaces</h3>
        <p class="stat-value">{{ dashboard?.active_workspaces ?? "-" }}</p>
      </div>
      <div class="stat-card">
        <h3>Disabled workspaces</h3>
        <p class="stat-value">{{ dashboard?.suspended_workspaces ?? "-" }}</p>
      </div>
      <div class="stat-card">
        <h3>Workspace Admins</h3>
        <p class="stat-value">{{ dashboard?.workspace_admins_count ?? "-" }}</p>
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

    <div class="quick-actions">
      <RouterLink class="quick-action" to="/super-admin/workspaces">
        <SuperAdminIcon name="plus" />
        New Workspace
      </RouterLink>
      <RouterLink class="quick-action" to="/super-admin/broadcasts">
        <SuperAdminIcon name="megaphone" />
        New Broadcast
      </RouterLink>
      <RouterLink class="quick-action" to="/super-admin/logs">
        <SuperAdminIcon name="fileText" />
        View Logs
      </RouterLink>
      <RouterLink class="quick-action" to="/super-admin/support-requests">
        <SuperAdminIcon name="lifeBuoy" />
        Support Requests
      </RouterLink>
    </div>

    <div class="attention-grid">
      <section class="card attention-card">
        <h2>Needs attention</h2>
        <p v-if="attentionItems.length === 0" class="muted">Nothing needs attention right now.</p>
        <ul v-else class="attention-list">
          <li v-for="item in attentionItems" :key="item.id" class="attention-item">
            <span
              class="attention-dot"
              :class="`attention-dot-${item.tone}`"
              role="img"
              :aria-label="`${item.tone} severity`"
              :title="item.tone"
            ></span>
            {{ item.label }}
          </li>
        </ul>
      </section>

      <section class="card attention-card">
        <h2>Recent privileged actions</h2>
        <p v-if="(dashboard?.recent_actions?.length ?? 0) === 0" class="muted">No recent actions.</p>
        <ul v-else class="attention-list">
          <li v-for="item in (dashboard?.recent_actions ?? []).slice(0, 5)" :key="item.id" class="attention-item">
            {{ item.actor_email || item.actor_id }} — {{ item.action_type }}
          </li>
        </ul>
      </section>
    </div>

    <div id="control-center" class="card">
      <h2>Control Center</h2>
      <p class="muted">Configure runtime settings, alert rules, and emergency actions.</p>

      <div class="control-grid">
        <section class="control-card">
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
        </section>

        <section class="control-card control-card-wide">
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
        </section>

        <section class="control-card control-card-wide">
          <h3>Alert Rules</h3>
          <div class="control-form-grid">
            <label>
              Name
              <input v-model="alertName" type="text" placeholder="Overdue checkouts high" />
            </label>
            <label>
              Metric
              <select v-model="alertMetricKey">
                <option value="suspended_workspaces">suspended_workspaces</option>
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
          </div>
          <div class="form-actions">
            <button type="button" class="button-primary" :disabled="isSaving" @click="saveAlertRule">
              Save Alert Rule
            </button>
          </div>
        </section>

        <section class="control-card">
          <h3>Emergency Controls</h3>
          <label>
            Tenant ID
            <input v-model="forceReauthWorkspaceId" type="text" placeholder="Tenant UUID" />
          </label>
          <div class="form-actions">
            <button type="button" :disabled="isSaving" @click="forceTenantSignOut">
              Force Tenant Re-Login
            </button>
          </div>
        </section>
      </div>
    </div>

    <div class="report-grid">
      <section class="card report-card">
        <div class="report-card-header">
          <div>
            <h2>Active Alert Events</h2>
            <p class="muted">Live signals from the platform rules you have configured.</p>
          </div>
        </div>
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
      </section>

      <section class="card report-card">
        <div class="report-card-header">
          <div>
            <h2>Pending Approvals</h2>
            <p class="muted">High-sensitivity actions waiting for explicit approval.</p>
          </div>
        </div>
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
      </section>

      <section class="card report-card report-card-wide">
        <div class="report-card-header">
          <div>
            <h2>Tenant Activity (Last 7 Days)</h2>
            <p class="muted">Top tenant performance indicators for the last seven days.</p>
          </div>
        </div>
        <table class="table">
          <thead>
            <tr>
              <th>Workspace</th>
              <th>Items</th>
              <th>Borrowers</th>
              <th>Active Checkouts</th>
              <th>Overdue</th>
              <th>Transactions (7d)</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="item in (dashboard?.workspace_metrics ?? []).slice(0, 20)" :key="item.workspace_id">
              <td>{{ item.workspace_name }}</td>
              <td>{{ item.item_total }}</td>
              <td>{{ item.borrowers_total }}</td>
              <td>{{ item.active_checkouts }}</td>
              <td>{{ item.overdue_items }}</td>
              <td>{{ item.transactions_7d }}</td>
            </tr>
            <tr v-if="(dashboard?.workspace_metrics?.length ?? 0) === 0">
              <td colspan="6" class="muted">No workspace metrics available.</td>
            </tr>
          </tbody>
        </table>
      </section>

      <section class="card report-card report-card-wide">
        <div class="report-card-header">
          <div>
            <h2>Recent Privileged Actions</h2>
            <p class="muted">Recent cross-tenant changes and administrative interventions.</p>
          </div>
        </div>
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
      </section>

      <section id="recent-jobs" class="card report-card report-card-wide">
        <div class="report-card-header">
          <div>
            <h2>Recent Jobs</h2>
            <p class="muted">Background jobs and automation activity from the platform queue.</p>
          </div>
        </div>
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
      </section>
    </div>

    <div v-if="toastMessage" class="toast">
      <div class="toast-title">{{ toastTitle }}</div>
      <div class="toast-body">{{ toastMessage }}</div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref } from "vue";
import { RouterLink } from "vue-router";
import SuperAdminIcon from "../../components/superadmin/SuperAdminIcon.vue";
import { fetchSuperDashboard, type SuperDashboard } from "../../services/superAuditService";
import { toUserFacingErrorMessage } from "../../services/appErrors";
import {
  approveRequest,
  forceWorkspaceReauth,
  getControlCenter,
  setRuntimeConfig,
  upsertAlertRule,
  type SuperControlCenter,
} from "../../services/superOps/controlCenter";

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
const forceReauthWorkspaceId = ref("");
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

type AttentionTone = "critical" | "warning" | "info";
type AttentionItem = { id: string; label: string; tone: AttentionTone };

const attentionItems = computed<AttentionItem[]>(() => {
  const items: AttentionItem[] = [];
  for (const alert of dashboard.value?.alert_events ?? []) {
    items.push({
      id: `alert-${alert.id}`,
      label: `${alert.name}: ${alert.current} (threshold ${alert.threshold})`,
      tone: alert.severity === "critical" ? "critical" : "warning",
    });
  }
  const suspended = dashboard.value?.suspended_workspaces ?? 0;
  if (suspended > 0) {
    items.push({
      id: "suspended-workspaces",
      label: `${suspended} workspace${suspended === 1 ? "" : "s"} suspended`,
      tone: "warning",
    });
  }
  const pendingApprovals = controlCenter.value?.approvals?.filter((item) => item.status === "pending").length ?? 0;
  if (pendingApprovals > 0) {
    items.push({
      id: "pending-approvals",
      label: `${pendingApprovals} pending approval${pendingApprovals === 1 ? "" : "s"}`,
      tone: "info",
    });
  }
  const failedJobs = controlCenter.value?.jobs?.filter((job) => job.status === "failed").length ?? 0;
  if (failedJobs > 0) {
    items.push({
      id: "failed-jobs",
      label: `${failedJobs} job${failedJobs === 1 ? "" : "s"} failed`,
      tone: "critical",
    });
  }
  return items;
});

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
    error.value = toUserFacingErrorMessage(err, "Unable to load dashboard.");
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
    showToast("Save failed", toUserFacingErrorMessage(err, "Unable to save status override."));
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
    showToast("Save failed", toUserFacingErrorMessage(err, "Unable to save maintenance mode."));
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
    showToast("Save failed", toUserFacingErrorMessage(err, "Unable to save alert rule."));
  } finally {
    isSaving.value = false;
  }
};

const forceTenantSignOut = async () => {
  const workspaceId = forceReauthWorkspaceId.value.trim();
  if (!workspaceId) {
    showToast("Invalid input", "Enter a tenant ID.");
    return;
  }

  isSaving.value = true;
  try {
    await forceWorkspaceReauth({ workspace_id: workspaceId });
    forceReauthWorkspaceId.value = "";
    showToast("Done", "Tenant sessions were invalidated.");
    await loadAll();
  } catch (err) {
    showToast("Action failed", toUserFacingErrorMessage(err, "Unable to force tenant re-login."));
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
    showToast("Approval failed", toUserFacingErrorMessage(err, "Unable to approve request."));
  } finally {
    isSaving.value = false;
  }
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
/* The global .form-actions (src/styles/base.css) only adds margin-top, not
   margin-bottom, so a button row followed directly by another element has
   zero gap between them. Add the missing space here rather than changing
   the global rule, which is used by other pages too. */
.form-actions {
  margin-bottom: 1rem;
}

.workspace-hero {
  margin-bottom: 1rem;
}

.workspace-copy h1 {
  margin-bottom: 0.35rem;
}

.workspace-eyebrow {
  margin: 0 0 0.45rem;
  text-transform: uppercase;
  letter-spacing: 0.08em;
  font-size: 0.74rem;
  font-weight: 700;
  color: var(--muted);
}

.workspace-summary {
  max-width: 48rem;
  margin: 0;
}

.quick-actions {
  display: flex;
  flex-wrap: wrap;
  gap: 0.6rem;
  margin: 1rem 0 1.5rem;
}

.quick-action {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  border: 1px solid var(--border);
  border-radius: 14px;
  padding: 0.55rem 0.9rem;
  background: var(--surface-2);
  color: inherit;
  text-decoration: none;
  font-weight: 600;
  font-size: 0.9rem;
}

.quick-action:hover {
  border-color: var(--accent);
  text-decoration: none;
}

.attention-grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(280px, 1fr));
  gap: 1rem;
  margin-bottom: 1.5rem;
}

.attention-card h2 {
  margin: 0 0 0.75rem;
  font-size: 1.05rem;
}

.attention-list {
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: 0.5rem;
}

.attention-item {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  font-size: 0.9rem;
  padding-bottom: 0.5rem;
  border-bottom: 1px solid var(--border);
}

.attention-item:last-child {
  border-bottom: none;
  padding-bottom: 0;
}

.attention-dot {
  width: 7px;
  height: 7px;
  border-radius: 50%;
  flex-shrink: 0;
  background: var(--muted);
}

.attention-dot-critical {
  background: var(--danger);
}

.attention-dot-warning {
  background: var(--warning);
}

.attention-dot-info {
  background: var(--accent);
}

.report-grid {
  display: grid;
  gap: 1rem;
  grid-template-columns: repeat(12, minmax(0, 1fr));
  margin-top: 1rem;
}

.report-card {
  grid-column: span 6;
  display: flex;
  flex-direction: column;
  gap: 0.85rem;
}

.report-card-wide {
  grid-column: span 12;
}

.report-card-header {
  display: flex;
  justify-content: space-between;
  gap: 1rem;
  align-items: flex-start;
}

.report-card-header h2 {
  margin: 0;
}

.report-card-header p {
  margin: 0.35rem 0 0;
}

.control-grid {
  display: grid;
  gap: 1rem;
  grid-template-columns: repeat(12, minmax(0, 1fr));
  margin-top: 1rem;
}

.control-card {
  grid-column: span 4;
  display: flex;
  flex-direction: column;
  gap: 0.85rem;
  border: 1px solid var(--border);
  border-radius: 14px;
  padding: 1rem;
  background: var(--surface-2);
}

.control-card-wide {
  grid-column: span 8;
}

.control-card h3 {
  margin: 0;
}

.control-card .muted {
  margin: 0;
}

.control-form-grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 0.85rem 1rem;
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

@media (max-width: 900px) {
  .report-grid {
    grid-template-columns: 1fr;
  }

  .report-card,
  .report-card-wide {
    grid-column: auto;
  }

  .control-grid {
    grid-template-columns: 1fr;
  }

  .control-card,
  .control-card-wide {
    grid-column: auto;
  }

  .control-form-grid {
    grid-template-columns: 1fr;
  }
}
</style>
