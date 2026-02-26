<template>
  <div class="page">
    <div class="page-nav-left">
      <RouterLink class="button-link" to="/super-admin">Back to Super Admin</RouterLink>
      <button type="button" @click="loadSnapshot(true)" :disabled="isLoading">
        {{ isLoading ? "Refreshing..." : "Refresh now" }}
      </button>
      <span class="muted small">
        Last update:
        <strong>{{ lastUpdatedLabel }}</strong>
      </span>
    </div>

    <h1>Internal Operations</h1>
    <p class="muted">
      Live internal visibility for traffic, async queue health, lead pipeline, and runtime status.
    </p>

    <section class="metrics-grid">
      <article class="card metric-card">
        <h2>Traffic (15 min)</h2>
        <div class="metric-row"><span>Checkouts</span><strong>{{ snapshot?.traffic.checkout_15m ?? 0 }}</strong></div>
        <div class="metric-row"><span>Returns</span><strong>{{ snapshot?.traffic.return_15m ?? 0 }}</strong></div>
        <div class="metric-row"><span>Active tenants</span><strong>{{ snapshot?.traffic.active_tenants_15m ?? 0 }}</strong></div>
        <div class="metric-row"><span>Events (24h)</span><strong>{{ snapshot?.traffic.events_24h ?? 0 }}</strong></div>
      </article>

      <article class="card metric-card">
        <h2>Async Jobs</h2>
        <div class="metric-row"><span>Queued</span><strong>{{ snapshot?.queue.queued ?? 0 }}</strong></div>
        <div class="metric-row"><span>Processing</span><strong>{{ snapshot?.queue.processing ?? 0 }}</strong></div>
        <div class="metric-row"><span>Completed</span><strong>{{ snapshot?.queue.completed ?? 0 }}</strong></div>
        <div class="metric-row danger"><span>Failed</span><strong>{{ snapshot?.queue.failed ?? 0 }}</strong></div>
      </article>

      <article class="card metric-card">
        <h2>Lead Pipeline</h2>
        <div class="metric-row"><span>Open</span><strong>{{ snapshot?.leads.open ?? 0 }}</strong></div>
        <div class="metric-row"><span>Converted</span><strong>{{ snapshot?.leads.converted ?? 0 }}</strong></div>
        <div class="metric-row"><span>Quote sent</span><strong>{{ snapshot?.leads.quote_sent ?? 0 }}</strong></div>
        <div class="metric-row"><span>Invoice paid</span><strong>{{ snapshot?.leads.invoice_paid ?? 0 }}</strong></div>
      </article>

      <article class="card metric-card">
        <h2>Runtime</h2>
        <div class="metric-row">
          <span>Maintenance mode</span>
          <strong>{{ maintenanceEnabled ? "Enabled" : "Disabled" }}</strong>
        </div>
        <div class="metric-row">
          <span>Broadcast</span>
          <strong>{{ broadcastEnabled ? "Active" : "Inactive" }}</strong>
        </div>
      </article>
    </section>

    <section class="card">
      <h2>Recent Checkout/Return Activity</h2>
      <p class="muted">Most recent events across all tenants.</p>
      <div class="table-wrap">
        <table class="table">
          <thead>
            <tr>
              <th>Time</th>
              <th>Tenant</th>
              <th>Action</th>
              <th>Item</th>
              <th>Barcode</th>
              <th>Student</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="event in snapshot?.recent_events ?? []" :key="`${event.action_time}-${event.tenant_id}-${event.gear_barcode}`">
              <td>{{ formatDateTime(event.action_time) }}</td>
              <td>{{ event.tenant_name }}</td>
              <td>
                <span class="status-pill" :class="event.action_type === 'checkout' ? 'status-open' : 'status-closed'">
                  {{ event.action_type }}
                </span>
              </td>
              <td>{{ event.gear_name ?? "-" }}</td>
              <td>{{ event.gear_barcode ?? "-" }}</td>
              <td>{{ event.student_username ?? "-" }}</td>
            </tr>
            <tr v-if="(snapshot?.recent_events?.length ?? 0) === 0">
              <td colspan="6" class="muted">No recent activity found.</td>
            </tr>
          </tbody>
        </table>
      </div>
    </section>

    <div v-if="toastMessage" class="toast">
      <div class="toast-title">{{ toastTitle }}</div>
      <div class="toast-body">{{ toastMessage }}</div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref } from "vue";
import { RouterLink } from "vue-router";
import { getInternalOpsSnapshot, type InternalOpsSnapshot } from "../../services/superOpsService";

const snapshot = ref<InternalOpsSnapshot | null>(null);
const isLoading = ref(false);
const toastTitle = ref("");
const toastMessage = ref("");
let pollTimer: number | null = null;
let toastTimer: number | null = null;

const showToast = (title: string, message: string) => {
  toastTitle.value = title;
  toastMessage.value = message;
  if (toastTimer !== null) {
    window.clearTimeout(toastTimer);
  }
  toastTimer = window.setTimeout(() => {
    toastMessage.value = "";
    toastTitle.value = "";
    toastTimer = null;
  }, 3000);
};

const maintenanceEnabled = computed(() => {
  const runtime = snapshot.value?.runtime ?? {};
  const row = runtime.maintenance_mode as { enabled?: boolean } | undefined;
  return row?.enabled === true;
});

const broadcastEnabled = computed(() => {
  const runtime = snapshot.value?.runtime ?? {};
  const row = runtime.broadcast_message as { enabled?: boolean } | undefined;
  return row?.enabled === true;
});

const lastUpdatedLabel = computed(() => {
  const value = snapshot.value?.checked_at;
  if (!value) return "never";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "unknown";
  return date.toLocaleString();
});

const formatDateTime = (iso: string) => {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  return date.toLocaleString();
};

const loadSnapshot = async (manual = false) => {
  if (isLoading.value) return;
  isLoading.value = true;
  try {
    snapshot.value = await getInternalOpsSnapshot();
    if (manual) {
      showToast("Internal Ops", "Snapshot refreshed.");
    }
  } catch (error) {
    showToast("Error", error instanceof Error ? error.message : "Unable to load internal ops.");
  } finally {
    isLoading.value = false;
  }
};

const startPolling = () => {
  if (pollTimer !== null) window.clearInterval(pollTimer);
  pollTimer = window.setInterval(() => {
    void loadSnapshot();
  }, 15000);
};

onMounted(async () => {
  await loadSnapshot();
  startPolling();
});

onUnmounted(() => {
  if (pollTimer !== null) {
    window.clearInterval(pollTimer);
  }
  if (toastTimer !== null) {
    window.clearTimeout(toastTimer);
  }
});
</script>

<style scoped>
.small {
  font-size: 0.9rem;
}

.metrics-grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(220px, 1fr));
  gap: 1rem;
  margin-bottom: 1rem;
}

.metric-card h2 {
  margin-top: 0;
  margin-bottom: 0.8rem;
  font-size: 1.1rem;
}

.metric-row {
  display: flex;
  justify-content: space-between;
  gap: 0.6rem;
  padding: 0.35rem 0;
  border-bottom: 1px solid var(--border);
}

.metric-row:last-child {
  border-bottom: 0;
}

.metric-row.danger strong {
  color: #d64b4b;
}

.table-wrap {
  overflow-x: auto;
}
</style>
