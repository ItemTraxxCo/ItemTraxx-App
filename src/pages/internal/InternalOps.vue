<template>
  <div class="page">
    <div class="internal-toolbar">
      <div class="toolbar-left">
        <button type="button" @click="loadSnapshot(true)" :disabled="isLoading">
          {{ isLoading ? "Refreshing..." : "Refresh now" }}
        </button>
        <span class="muted small">
          Last update:
          <strong>{{ lastUpdatedLabel }}</strong>
        </span>
      </div>

      <div class="toolbar-right">
        <label class="muted small" for="viewPreset">View</label>
        <select id="viewPreset" v-model="activePreset" @change="applyPreset(activePreset)">
          <option value="default">Default</option>
          <option value="ops">Ops Focus</option>
          <option value="sales">Sales Focus</option>
          <option value="finance">Finance Focus</option>
          <option v-for="custom in customPresets" :key="custom.name" :value="custom.name">
            {{ custom.name }}
          </option>
        </select>
        <button type="button" @click="saveCurrentPreset">Save View</button>
      </div>
    </div>

    <h1>Internal Operations</h1>
    <p class="muted">
      Internal command center for traffic, reliability, incidents, lead flow, and customer health.
    </p>

    <section class="card command-card">
      <div class="command-row">
        <input
          v-model="commandQuery"
          class="command-input"
          type="search"
          placeholder="Jump to tenants, pages, and workflows"
          @keydown.enter.prevent="goToFirstCommandResult"
        />
      </div>
      <div v-if="commandResults.length" class="command-results">
        <button
          v-for="result in commandResults"
          :key="result.id"
          type="button"
          class="command-result"
          @click="navigate(result.route)"
        >
          <span>{{ result.label }}</span>
          <small class="muted">{{ result.type }}</small>
        </button>
      </div>
    </section>

    <section class="metrics-grid">
      <article v-if="viewFlags.alerts" class="card metric-card">
        <h2>Real-time Alerts</h2>
        <div class="metric-row">
          <span>Active alerts</span>
          <strong>{{ snapshot?.needs_attention.length ?? 0 }}</strong>
        </div>
        <div class="metric-row">
          <span>High priority</span>
          <strong>{{ highPriorityAlertCount }}</strong>
        </div>
        <div class="metric-row">
          <span>Queue failures</span>
          <strong>{{ snapshot?.queue.failed ?? 0 }}</strong>
        </div>
        <div class="metric-row">
          <span>Open stale leads</span>
          <strong>{{ staleLeadCount }}</strong>
        </div>
      </article>

      <article v-if="viewFlags.sla" class="card metric-card">
        <h2>SLA</h2>
        <div class="metric-row">
          <span>Median latency</span>
          <strong>{{ formatMs(snapshot?.sla.median_latency_ms) }}</strong>
        </div>
        <div class="metric-row">
          <span>P95 latency</span>
          <strong>{{ formatMs(snapshot?.sla.p95_latency_ms) }}</strong>
        </div>
        <div class="metric-row">
          <span>Error rate</span>
          <strong>{{ snapshot?.sla.error_rate_percent ?? 0 }}%</strong>
        </div>
        <div class="metric-row">
          <span>Status probe</span>
          <strong>{{ formatMs(snapshot?.sla.probe_latency_ms) }}</strong>
        </div>
      </article>

      <article v-if="viewFlags.customer" class="card metric-card">
        <h2>Customer Health</h2>
        <div class="metric-row"><span>Total customers</span><strong>{{ snapshot?.customer_health.total_customers ?? 0 }}</strong></div>
        <div class="metric-row"><span>Awaiting payment</span><strong>{{ snapshot?.customer_health.awaiting_payment ?? 0 }}</strong></div>
        <div class="metric-row"><span>Canceling</span><strong>{{ snapshot?.customer_health.canceling ?? 0 }}</strong></div>
        <div class="metric-row"><span>Paid late</span><strong>{{ snapshot?.customer_health.paid_late ?? 0 }}</strong></div>
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
        <div class="metric-row"><span>Checkouts (15m)</span><strong>{{ snapshot?.traffic.checkout_15m ?? 0 }}</strong></div>
        <div class="metric-row"><span>Returns (15m)</span><strong>{{ snapshot?.traffic.return_15m ?? 0 }}</strong></div>
      </article>
    </section>

    <section class="card incident-controls">
      <h2>Incident Controls</h2>
      <p class="muted">One-click maintenance and broadcast presets with confirmation.</p>
      <div class="controls-row">
        <button type="button" class="warn" @click="enableMaintenancePreset" :disabled="isSavingRuntime">
          Start Maintenance
        </button>
        <button type="button" @click="disableMaintenancePreset" :disabled="isSavingRuntime">
          End Maintenance
        </button>
        <button type="button" @click="setBroadcastPreset('degraded')" :disabled="isSavingRuntime">
          Broadcast Degraded
        </button>
        <button type="button" @click="setBroadcastPreset('all_clear')" :disabled="isSavingRuntime">
          Broadcast All Clear
        </button>
        <button type="button" @click="setBroadcastPreset('clear')" :disabled="isSavingRuntime">
          Clear Broadcast
        </button>
      </div>
    </section>

    <section v-if="viewFlags.needs" class="card">
      <h2>Needs Attention</h2>
      <div class="needs-grid">
        <button
          v-for="item in snapshot?.needs_attention ?? []"
          :key="item.key"
          type="button"
          class="needs-item"
          :class="`level-${item.level}`"
          @click="navigate(item.route)"
        >
          <div>
            <strong>{{ item.title }}</strong>
            <p class="muted">{{ item.count }} affected</p>
          </div>
          <span class="status-pill">{{ item.level }}</span>
        </button>
        <p v-if="(snapshot?.needs_attention.length ?? 0) === 0" class="muted">
          No urgent items.
        </p>
      </div>
    </section>

    <section v-if="viewFlags.traffic" class="card chart-card">
      <h2>Traffic (24h)</h2>
      <p class="muted">Hourly checkouts vs returns.</p>
      <div class="bar-grid">
        <div v-for="bucket in lastTrafficBuckets" :key="bucket.hour" class="bar-cell">
          <div class="bar-stack">
            <div class="bar bar-checkout" :style="{ height: `${calcBarHeight(bucket.checkout)}px` }"></div>
            <div class="bar bar-return" :style="{ height: `${calcBarHeight(bucket.return)}px` }"></div>
          </div>
          <small>{{ formatHour(bucket.hour) }}</small>
        </div>
      </div>
    </section>

    <section v-if="viewFlags.funnel" class="card chart-card">
      <h2>Lead Funnel</h2>
      <p class="muted">Stage distribution across active pipeline.</p>
      <div class="funnel-list">
        <div v-for="stage in funnelRows" :key="stage.key" class="funnel-row">
          <span>{{ stage.label }}</span>
          <div class="funnel-track">
            <div class="funnel-fill" :style="{ width: `${funnelWidth(stage.value)}%` }"></div>
          </div>
          <strong>{{ stage.value }}</strong>
        </div>
      </div>
    </section>

    <section v-if="viewFlags.activity" class="card">
      <h2>Recent Checkout/Return Activity</h2>
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
          </tbody>
        </table>
      </div>
    </section>

    <section v-if="viewFlags.audit" class="card">
      <h2>Audit Feed</h2>
      <div class="table-wrap">
        <table class="table">
          <thead>
            <tr>
              <th>Time</th>
              <th>Actor</th>
              <th>Action</th>
              <th>Target</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="row in snapshot?.recent_audit ?? []" :key="row.id">
              <td>{{ formatDateTime(row.created_at) }}</td>
              <td>{{ row.actor_email ?? "-" }}</td>
              <td>{{ row.action_type }}</td>
              <td>{{ row.target_type ?? "-" }} {{ row.target_id ?? "" }}</td>
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
import { useRouter } from "vue-router";
import { getInternalOpsSnapshot, setRuntimeConfig, type InternalOpsSnapshot } from "../../services/superOpsService";

const router = useRouter();
const snapshot = ref<InternalOpsSnapshot | null>(null);
const isLoading = ref(false);
const isSavingRuntime = ref(false);
const toastTitle = ref("");
const toastMessage = ref("");
const commandQuery = ref("");

const activePreset = ref("default");
const customPresets = ref<Array<{ name: string; flags: ViewFlags }>>([]);

type ViewFlags = {
  alerts: boolean;
  sla: boolean;
  needs: boolean;
  traffic: boolean;
  funnel: boolean;
  activity: boolean;
  audit: boolean;
  customer: boolean;
};

const DEFAULT_VIEW_FLAGS: ViewFlags = {
  alerts: true,
  sla: true,
  needs: true,
  traffic: true,
  funnel: true,
  activity: true,
  audit: true,
  customer: true,
};

const presetMap: Record<string, ViewFlags> = {
  default: DEFAULT_VIEW_FLAGS,
  ops: {
    alerts: true,
    sla: true,
    needs: true,
    traffic: true,
    funnel: false,
    activity: true,
    audit: true,
    customer: false,
  },
  sales: {
    alerts: true,
    sla: false,
    needs: true,
    traffic: false,
    funnel: true,
    activity: false,
    audit: true,
    customer: true,
  },
  finance: {
    alerts: true,
    sla: true,
    needs: true,
    traffic: false,
    funnel: true,
    activity: false,
    audit: true,
    customer: true,
  },
};

const viewFlags = ref<ViewFlags>({ ...DEFAULT_VIEW_FLAGS });

let pollTimer: number | null = null;
let toastTimer: number | null = null;

const showToast = (title: string, message: string) => {
  toastTitle.value = title;
  toastMessage.value = message;
  if (toastTimer !== null) window.clearTimeout(toastTimer);
  toastTimer = window.setTimeout(() => {
    toastMessage.value = "";
    toastTitle.value = "";
    toastTimer = null;
  }, 3500);
};

const maintenanceEnabled = computed(() => {
  const row = snapshot.value?.runtime.maintenance_mode as { enabled?: boolean } | undefined;
  return row?.enabled === true;
});

const broadcastEnabled = computed(() => {
  const row = snapshot.value?.runtime.broadcast_message as { enabled?: boolean } | undefined;
  return row?.enabled === true;
});

const highPriorityAlertCount = computed(
  () => snapshot.value?.needs_attention.filter((item) => item.level === "high").length ?? 0
);

const staleLeadCount = computed(() => snapshot.value?.needs_attention.find((item) => item.key === "stale_open_leads")?.count ?? 0);

const lastUpdatedLabel = computed(() => {
  const value = snapshot.value?.checked_at;
  if (!value) return "never";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "unknown";
  return date.toLocaleString();
});

const commandResults = computed(() => {
  const all = snapshot.value?.search_index ?? [];
  const term = commandQuery.value.trim().toLowerCase();
  if (!term) return all.slice(0, 8);
  return all.filter((item) => item.label.toLowerCase().includes(term)).slice(0, 8);
});

const lastTrafficBuckets = computed(() => (snapshot.value?.traffic_by_hour ?? []).slice(-12));

const funnelRows = computed(() => {
  const funnel = snapshot.value?.lead_funnel;
  if (!funnel) return [];
  return [
    { key: "waiting_for_quote", label: "Waiting for quote", value: funnel.waiting_for_quote },
    { key: "quote_generated", label: "Quote generated", value: funnel.quote_generated },
    { key: "quote_sent", label: "Quote sent", value: funnel.quote_sent },
    { key: "quote_converted_to_invoice", label: "Quote converted", value: funnel.quote_converted_to_invoice },
    { key: "invoice_sent", label: "Invoice sent", value: funnel.invoice_sent },
    { key: "invoice_paid", label: "Invoice paid", value: funnel.invoice_paid },
  ];
});

const maxTrafficValue = computed(() => {
  const values = (snapshot.value?.traffic_by_hour ?? []).flatMap((bucket) => [bucket.checkout, bucket.return]);
  return Math.max(1, ...values);
});

const calcBarHeight = (value: number) => {
  const ratio = value / maxTrafficValue.value;
  return Math.max(4, Math.round(ratio * 72));
};

const funnelWidth = (value: number) => {
  const max = Math.max(1, ...funnelRows.value.map((row) => row.value));
  return Math.max(4, Math.round((value / max) * 100));
};

const formatDateTime = (iso: string) => {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  return date.toLocaleString();
};

const formatHour = (iso: string) => {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "--";
  return `${String(date.getHours()).padStart(2, "0")}:00`;
};

const formatMs = (value: number | null | undefined) =>
  typeof value === "number" && Number.isFinite(value) ? `${Math.round(value)}ms` : "-";

const navigate = (route: string) => {
  void router.push(route);
};

const goToFirstCommandResult = () => {
  const first = commandResults.value[0];
  if (!first) return;
  navigate(first.route);
};

const loadSnapshot = async (manual = false) => {
  if (isLoading.value) return;
  isLoading.value = true;
  try {
    snapshot.value = await getInternalOpsSnapshot();
    if (manual) showToast("Internal Ops", "Snapshot refreshed.");
  } catch (error) {
    showToast("Error", error instanceof Error ? error.message : "Unable to load internal ops.");
  } finally {
    isLoading.value = false;
  }
};

const writeRuntimeConfig = async (key: string, value: Record<string, unknown>, successMessage: string) => {
  if (isSavingRuntime.value) return;
  isSavingRuntime.value = true;
  try {
    await setRuntimeConfig({ key, value });
    await loadSnapshot();
    showToast("Runtime updated", successMessage);
  } catch (error) {
    showToast("Update failed", error instanceof Error ? error.message : "Unable to save runtime config.");
  } finally {
    isSavingRuntime.value = false;
  }
};

const enableMaintenancePreset = async () => {
  if (!window.confirm("Enable maintenance mode now?")) return;
  await writeRuntimeConfig(
    "maintenance_mode",
    {
      enabled: true,
      message: "Scheduled maintenance in progress. ItemTraxx is temporarily unavailable. Check status page for details.",
      updated_at: new Date().toISOString(),
    },
    "Maintenance mode enabled."
  );
};

const disableMaintenancePreset = async () => {
  if (!window.confirm("Disable maintenance mode?")) return;
  await writeRuntimeConfig(
    "maintenance_mode",
    {
      enabled: false,
      message: "",
      updated_at: new Date().toISOString(),
    },
    "Maintenance mode disabled."
  );
};

const setBroadcastPreset = async (preset: "degraded" | "all_clear" | "clear") => {
  const payloadByPreset: Record<typeof preset, Record<string, unknown>> = {
    degraded: {
      enabled: true,
      level: "warning",
      message: "We are experiencing degraded performance. The team is actively investigating.",
      updated_at: new Date().toISOString(),
    },
    all_clear: {
      enabled: true,
      level: "info",
      message: "Service has stabilized and all systems are operational.",
      updated_at: new Date().toISOString(),
    },
    clear: {
      enabled: false,
      level: "info",
      message: "",
      updated_at: new Date().toISOString(),
    },
  };

  await writeRuntimeConfig("broadcast_message", payloadByPreset[preset], "Broadcast updated.");
};

const PRESET_STORAGE_KEY = "internal_ops_custom_presets";

const applyPreset = (presetName: string) => {
  const preset = presetMap[presetName];
  if (preset) {
    viewFlags.value = { ...preset };
    return;
  }
  const custom = customPresets.value.find((item) => item.name === presetName);
  if (custom) {
    viewFlags.value = { ...custom.flags };
  }
};

const loadCustomPresets = () => {
  try {
    const raw = window.localStorage.getItem(PRESET_STORAGE_KEY);
    if (!raw) return;
    const parsed = JSON.parse(raw) as Array<{ name: string; flags: Partial<ViewFlags> }>;
    if (Array.isArray(parsed)) {
      customPresets.value = parsed
        .filter((row) => row && typeof row.name === "string")
        .map((row) => ({
          name: row.name,
          flags: {
            ...DEFAULT_VIEW_FLAGS,
            ...(row.flags ?? {}),
          } as ViewFlags,
        }));
    }
  } catch {
    customPresets.value = [];
  }
};

const saveCurrentPreset = () => {
  const name = window.prompt("Save current view as:")?.trim();
  if (!name) return;
  const next = [
    ...customPresets.value.filter((item) => item.name !== name),
    { name, flags: { ...viewFlags.value } },
  ];
  customPresets.value = next;
  window.localStorage.setItem(PRESET_STORAGE_KEY, JSON.stringify(next));
  activePreset.value = name;
  showToast("View saved", `Saved preset \"${name}\".`);
};

const startPolling = () => {
  if (pollTimer !== null) window.clearInterval(pollTimer);
  pollTimer = window.setInterval(() => {
    void loadSnapshot();
  }, 15000);
};

onMounted(async () => {
  loadCustomPresets();
  applyPreset("default");
  await loadSnapshot();
  startPolling();
});

onUnmounted(() => {
  if (pollTimer !== null) window.clearInterval(pollTimer);
  if (toastTimer !== null) window.clearTimeout(toastTimer);
});
</script>

<style scoped>
.small {
  font-size: 0.9rem;
}

.internal-toolbar {
  display: flex;
  justify-content: space-between;
  gap: 1rem;
  flex-wrap: wrap;
  margin-bottom: 0.8rem;
}

.toolbar-left,
.toolbar-right {
  display: flex;
  align-items: center;
  gap: 0.6rem;
}

.command-card {
  margin-bottom: 1rem;
}

.command-input {
  width: 100%;
}

.command-results {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(220px, 1fr));
  gap: 0.5rem;
  margin-top: 0.7rem;
}

.command-result {
  display: flex;
  justify-content: space-between;
  align-items: center;
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
  font-size: 1.05rem;
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

.incident-controls {
  margin-bottom: 1rem;
}

.controls-row {
  display: flex;
  flex-wrap: wrap;
  gap: 0.6rem;
}

.warn {
  background: #9f1239;
}

.needs-grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(220px, 1fr));
  gap: 0.7rem;
}

.needs-item {
  display: flex;
  justify-content: space-between;
  align-items: center;
  text-align: left;
  width: 100%;
}

.level-high {
  border-color: #dc2626;
}

.level-medium {
  border-color: #d97706;
}

.chart-card {
  margin-bottom: 1rem;
}

.bar-grid {
  display: grid;
  grid-template-columns: repeat(12, minmax(0, 1fr));
  gap: 0.45rem;
  align-items: end;
}

.bar-cell {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 0.3rem;
}

.bar-stack {
  display: flex;
  align-items: flex-end;
  gap: 2px;
  min-height: 76px;
}

.bar {
  width: 8px;
  border-radius: 5px 5px 0 0;
}

.bar-checkout {
  background: #2563eb;
}

.bar-return {
  background: #16a34a;
}

.funnel-list {
  display: grid;
  gap: 0.6rem;
}

.funnel-row {
  display: grid;
  grid-template-columns: 180px 1fr 48px;
  align-items: center;
  gap: 0.65rem;
}

.funnel-track {
  height: 10px;
  border-radius: 999px;
  background: rgba(255, 255, 255, 0.15);
  overflow: hidden;
}

.funnel-fill {
  height: 100%;
  border-radius: inherit;
  background: linear-gradient(90deg, #1f4ca3 0%, #38d0b1 100%);
}

.table-wrap {
  overflow-x: auto;
}

@media (max-width: 780px) {
  .funnel-row {
    grid-template-columns: 1fr;
  }

  .bar-grid {
    grid-template-columns: repeat(6, minmax(0, 1fr));
  }
}
</style>
