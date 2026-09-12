<template>
  <main class="page">
    <div class="sa-toolbar">
      <div>
        <RouterLink to="/super-admin" class="sa-back-link">&larr; Back to Super Admin</RouterLink>
        <h1 class="sa-toolbar-title">All Logs</h1>
        <p class="sa-toolbar-sub">Read-only, immutable cross-tenant logs.</p>
      </div>
    </div>

    <section class="sa-panel sa-filters">
      <label>Workspace
        <select v-model="workspaceFilter"><option value="all">all workspaces</option><option v-for="t in workspaces" :key="t.id" :value="t.id">{{ t.name }}</option></select>
      </label>
      <label>Action
        <select v-model="actionFilter"><option value="all">all actions</option><option value="checkout">checkout</option><option value="return">return</option><option value="admin_return">admin_return</option></select>
      </label>
      <label>From
        <input v-model="startAt" type="datetime-local" />
      </label>
      <label>To
        <input v-model="endAt" type="datetime-local" />
      </label>
      <label>Search
        <input v-model="search" type="text" placeholder="Search logs" />
      </label>
      <button class="sa-btn" @click="loadLogs">Search</button>
      <button class="sa-btn" @click="exportCsv">Export CSV</button>
      <button class="sa-btn" @click="exportPdf">Export PDF</button>
    </section>

    <BoneyardSkeleton
      name="super-admin-logs-table"
      :loading="isLoading"
      variant="table"
      :rows="7"
      :columns="5"
      label="Loading all logs"
    >
      <template #fixture>
        <BoneyardTableFixture :headers="logFixtureHeaders" :rows="7" />
      </template>

      <div v-if="isLoading">
        <BoneyardTableFixture :headers="logFixtureHeaders" :rows="7" />
      </div>
      <template v-else>
        <p v-if="error" class="sa-error">{{ error }}</p>
        <div v-else class="sa-table-wrap">
          <table class="sa-table">
            <thead><tr><th>Time</th><th>Workspace</th><th>Action</th><th>Item</th><th>Borrower</th></tr></thead>
            <tbody>
              <tr v-for="row in rows" :key="row.id">
                <td>{{ formatDateTime(row.action_time) }}</td>
                <td>{{ row.workspace?.name || row.workspace_id }}</td>
                <td>{{ row.action_type }}</td>
                <td>{{ row.item?.name || "-" }} ({{ row.item?.barcode || "-" }})</td>
                <td>{{ row.borrower ? `${row.borrower.username} (${row.borrower.borrower_id})` : "-" }}</td>
              </tr>
            </tbody>
          </table>
        </div>
      </template>
    </BoneyardSkeleton>

    <div class="form-actions">
      <button class="sa-btn" @click="prevPage" :disabled="page <= 1 || isLoading">Prev</button>
      <span class="muted">Page {{ page }}</span>
      <button class="sa-btn" @click="nextPage" :disabled="isLoading">Next</button>
    </div>

    <div v-if="toastMessage" class="toast"><div class="toast-title">{{ toastTitle }}</div><div class="toast-body">{{ toastMessage }}</div></div>
  </main>
</template>

<script setup lang="ts">
import { onMounted, ref } from "vue";
import { RouterLink, useRouter } from "vue-router";
import BoneyardSkeleton from "../../components/BoneyardSkeleton.vue";
import BoneyardTableFixture from "../../components/BoneyardTableFixture.vue";
import {
  handleSuperAdminUnauthorized,
  isUnauthorizedError,
} from "../../services/authErrorHandling";
import { listSuperLogs, type SuperLogEntry } from "../../services/superLogsService";
import { listWorkspaces as listWorkspaces, type SuperWorkspace as SuperWorkspace } from "../../services/superWorkspaceService";
import { exportRowsToCsv, exportRowsToPdf } from "../../services/exportService";
import { toUserFacingErrorMessage } from "../../services/appErrors";

const router = useRouter();
const workspaces = ref<SuperWorkspace[]>([]);
const rows = ref<SuperLogEntry[]>([]);
const workspaceFilter = ref("all");
const actionFilter = ref("all");
const search = ref("");
const page = ref(1);
const pageSize = ref(50);
const startAt = ref("");
const endAt = ref("");
const isLoading = ref(false);
const error = ref("");
const toastTitle = ref("");
const toastMessage = ref("");
const logFixtureHeaders = ["Time", "Workspace", "Action", "Item", "Borrower"];
const isBoneyardCapture =
  import.meta.env.VITE_E2E_TEST_UTILS === "true" &&
  new URLSearchParams(window.location.search).has("boneyard");
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

const loadTenants = async () => {
  try {
    workspaces.value = await listWorkspaces("", "all");
  } catch (err) {
    if (isUnauthorizedError(err)) {
      error.value = "Your session expired. Sign in again.";
      await handleSuperAdminUnauthorized(router);
      return;
    }
    throw err;
  }
};

const loadLogs = async () => {
  isLoading.value = true;
  error.value = "";
  try {
    const result = await listSuperLogs({
      workspace_id: workspaceFilter.value,
      action_type: actionFilter.value,
      search: search.value.trim(),
      start_at: startAt.value ? new Date(startAt.value).toISOString() : undefined,
      end_at: endAt.value ? new Date(endAt.value).toISOString() : undefined,
      page: page.value,
      page_size: pageSize.value,
    });
    rows.value = result.rows;
  } catch (err) {
    if (isUnauthorizedError(err)) {
      error.value = "Your session expired. Sign in again.";
      await handleSuperAdminUnauthorized(router);
      return;
    }
    error.value = toUserFacingErrorMessage(err, "Unable to load logs.");
  } finally {
    isLoading.value = false;
  }
};

const nextPage = async () => {
  page.value += 1;
  await loadLogs();
};

const prevPage = async () => {
  if (page.value <= 1) return;
  page.value -= 1;
  await loadLogs();
};

const exportCsv = () => {
  if (!rows.value.length) {
    showToast("Export", "No rows to export.");
    return;
  }
  exportRowsToCsv(`super-logs-page-${page.value}.csv`, ["time", "workspace", "action", "item_name", "item_barcode", "borrower"], rows.value.map((row) => ({
    time: formatDateTime(row.action_time),
    workspace: row.workspace?.name ?? row.workspace_id,
    action: row.action_type,
    item_name: row.item?.name ?? "",
    item_barcode: row.item?.barcode ?? "",
    borrower: row.borrower ? `${row.borrower.username} (${row.borrower.borrower_id})` : "",
  })));
};

const exportPdf = async () => {
  if (!rows.value.length) {
    showToast("Export", "No rows to export.");
    return;
  }
  await exportRowsToPdf(`super-logs-page-${page.value}.pdf`, "Super Logs Export", ["time", "workspace", "action", "item_name", "item_barcode", "borrower"], rows.value.map((row) => ({
    time: formatDateTime(row.action_time),
    workspace: row.workspace?.name ?? row.workspace_id,
    action: row.action_type,
    item_name: row.item?.name ?? "",
    item_barcode: row.item?.barcode ?? "",
    borrower: row.borrower ? `${row.borrower.username} (${row.borrower.borrower_id})` : "",
  })));
};

onMounted(() => {
  if (isBoneyardCapture) return;
  void (async () => {
    await loadTenants();
    await loadLogs();
  })();
});
</script>

<style scoped>
.page {
  max-width: 1320px;
  margin: 0 auto;
  padding: 2rem;
}

.form-actions {
  display: flex;
  gap: 0.5rem;
  align-items: center;
  margin-top: 1rem;
  margin-bottom: 1rem;
}

.form-actions .muted {
  font-size: 0.85rem;
  color: var(--muted);
}

.toast {
  position: fixed;
  bottom: 1rem;
  right: 1rem;
  background: var(--surface);
  border: 1px solid var(--border);
  border-radius: 8px;
  padding: 1rem;
  max-width: 20rem;
  box-shadow: 0 4px 12px rgba(0, 0, 0, 0.15);
  z-index: 99;
}

.toast-title {
  font-weight: 600;
  margin-bottom: 0.5rem;
}

.toast-body {
  font-size: 0.85rem;
}
</style>
