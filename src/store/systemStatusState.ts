import { computed, reactive } from "vue";
import {
  fetchSystemStatus,
  type SystemStatusPayload,
} from "../services/systemStatusService";

const POLL_INTERVAL_MS = 300_000;

const state = reactive({
  payload: {} as SystemStatusPayload,
  responseStatus: 0,
  responseOk: false,
  hasResult: false,
  loading: false,
  refreshedAt: 0,
});

let consumers = 0;
let timer: number | null = null;

const statusLabel = computed(() => {
  if (!state.hasResult) return "Loading...";
  if (state.responseOk && state.payload.status === "operational") return "Running";
  if (state.responseStatus >= 500 || state.payload.status === "down") return "Down";
  return "Degraded";
});

const statusClass = computed<
  "status-ok" | "status-warn" | "status-down" | "status-unknown"
>(() => {
  if (statusLabel.value === "Running") return "status-ok";
  if (statusLabel.value === "Degraded") return "status-warn";
  if (statusLabel.value === "Down") return "status-down";
  return "status-unknown";
});

const refresh = async (force = false): Promise<void> => {
  if (state.loading) return;
  state.loading = true;
  try {
    const result = await fetchSystemStatus({
      force,
      staleWhileRevalidate: !force,
    });
    if (result?.payload) {
      state.payload = result.payload;
      state.responseStatus = result.status;
      state.responseOk = result.ok;
      state.hasResult = true;
    } else {
      state.responseStatus = 0;
      state.responseOk = false;
      state.hasResult = false;
    }
    state.refreshedAt = Date.now();
  } finally {
    state.loading = false;
  }
};

const stopPolling = () => {
  if (timer === null) return;
  window.clearInterval(timer);
  timer = null;
};

const startPolling = () => {
  if (timer !== null || consumers === 0 || document.visibilityState === "hidden") return;
  timer = window.setInterval(() => {
    void refresh(true);
  }, POLL_INTERVAL_MS);
};

const handleVisibilityChange = () => {
  if (document.visibilityState === "hidden") {
    stopPolling();
    return;
  }
  void refresh();
  startPolling();
};

const acquire = () => {
  consumers += 1;
  if (consumers !== 1) return;
  document.addEventListener("visibilitychange", handleVisibilityChange);
  void refresh();
  startPolling();
};

const release = () => {
  consumers = Math.max(0, consumers - 1);
  if (consumers !== 0) return;
  stopPolling();
  document.removeEventListener("visibilitychange", handleVisibilityChange);
};

export const systemStatusState = {
  state,
  statusLabel,
  statusClass,
  refresh,
  acquire,
  release,
};
