<template>
  <div class="page admin-shell">
    <div class="admin-hero">
      <div class="page-nav-left">
        <RouterLink class="button-link" to="/admin">Return to admin panel</RouterLink>
      </div>
      <h1>Borrower Management</h1>
      <p class="admin-hero-copy">Add borrowers, review details, and manage archived records.</p>
      <div class="admin-summary-grid">
        <div class="admin-summary-card">
          <strong>{{ borrowers.length }}</strong>
          <span>Active borrowers</span>
        </div>
        <div class="admin-summary-card">
          <strong>{{ archivedBorrowers.length }}</strong>
          <span>Archived borrowers</span>
        </div>
        <div class="admin-summary-card">
          <strong>{{ filteredBorrowers.length }}</strong>
          <span>Visible in table</span>
        </div>
      </div>
    </div>

    <div class="card admin-section-card">
      <div class="admin-section-header">
        <div>
          <h2>Add Borrower</h2>
          <p class="admin-section-copy">Generate a new borrower identity and add it to this tenant.</p>
        </div>
      </div>
      <form class="form" @submit.prevent="handleCreate">
        <label>
          Username
          <input
            v-model="usernamePreview"
            type="text"
            readonly
            title="If you need to change this, contact support."
          />
        </label>
        <label>
          Borrower ID
          <input
            v-model="borrowerIdPreview"
            type="text"
            readonly
            title="If you need to change this, contact support."
          />
        </label>
        <fieldset>
          <legend>Tenant Account access</legend>
          <label><input v-model="accessMode" type="radio" value="all" /> All Tenant Accounts</label>
          <label><input v-model="accessMode" type="radio" value="restricted" /> Specific Tenant Accounts</label>
          <div v-if="accessMode === 'restricted'"><label v-for="account in tenantAccounts" :key="account.id"><input v-model="selectedProfileIds" type="checkbox" :value="account.id" /> {{ account.auth_email }}</label></div>
        </fieldset>
        <div class="form-actions">
          <button type="button" @click="regenerateIdentity">Regenerate</button>
          <button type="submit" class="button-primary" :disabled="isSaving">Add borrower</button>
        </div>
      </form>
      <p v-if="error" class="error">{{ error }}</p>
      <p v-if="success" class="success">{{ success }}</p>
    </div>

    <div v-if="toastMessage" class="toast">
      <div class="toast-title">{{ toastTitle }}</div>
      <div class="toast-body">{{ toastMessage }}</div>
      <div v-if="toastActionLabel" class="toast-actions">
        <button type="button" class="toast-action-button" @click="runToastAction">
          {{ toastActionLabel }}
        </button>
      </div>
    </div>

    <div class="card admin-section-card">
      <div class="admin-section-header">
        <div>
          <h2>Borrowers</h2>
          <p class="admin-section-copy">Search, export, and inspect borrower records from one table.</p>
        </div>
        <div class="admin-toolbar-actions">
          <button type="button" @click="exportCsv">Export CSV</button>
          <button type="button" @click="exportPdf">Export PDF</button>
        </div>
      </div>
      <div class="form-grid-2">
        <label>
          Search borrowers
          <input
            v-model="searchQuery"
            type="text"
            placeholder="Search by username or borrower ID"
          />
        </label>
      </div>
      <p class="muted">Showing {{ filteredBorrowers.length }} of {{ borrowers.length }} borrowers.</p>
      <SkeletonLoader v-if="isLoading" variant="table" :rows="6" :columns="3" label="Loading borrowers" />
      <div v-else class="table-wrap">
      <table class="table">
        <thead>
          <tr>
            <th>Username</th>
            <th>Borrower ID</th>
            <th>Details</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="item in filteredBorrowers" :key="item.id">
            <td>{{ item.username }}</td>
            <td>{{ item.borrower_id }}</td>
            <td>
              <div class="admin-actions">
                <button type="button" @click="openDetails(item)">Details</button>
              </div>
            </td>
          </tr>
        </tbody>
      </table>
      </div>
    </div>

    <div class="card admin-section-card">
      <div class="admin-section-header">
        <div>
          <h2>Archived Borrowers</h2>
          <p class="admin-section-copy">Archived borrowers can be restored at any time.</p>
        </div>
      </div>
      <SkeletonLoader v-if="isLoadingArchived" variant="table" :rows="4" :columns="3" label="Loading archived borrowers" />
      <div v-else class="table-wrap">
      <table class="table">
        <thead>
          <tr>
            <th>Username</th>
            <th>Borrower ID</th>
            <th></th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="item in filteredArchivedBorrowers" :key="item.id">
            <td>{{ item.username }}</td>
            <td>{{ item.borrower_id }}</td>
            <td>
              <button type="button" class="link" :disabled="isSaving" @click="handleRestore(item)">
                Restore
              </button>
            </td>
          </tr>
          <tr v-if="filteredArchivedBorrowers.length === 0">
            <td colspan="3" class="muted">No archived borrowers.</td>
          </tr>
        </tbody>
      </table>
      </div>
    </div>

    <div v-if="featureFlags.enable_bulk_borrower_tools" class="card admin-section-card">
      <div class="admin-section-header">
        <div>
          <h2>Bulk Borrower Tools</h2>
          <p class="admin-section-copy">Generate identities in bulk and import them in one action.</p>
        </div>
      </div>
      <div class="form-grid-2">
        <label>
          Generate count
          <input v-model.number="bulkGenerateCount" type="number" min="1" max="200" />
        </label>
      </div>
      <div class="form-actions">
        <button type="button" @click="generateBulkRows">Generate identities</button>
      </div>

      <div class="form-actions">
        <button
          type="button"
          class="button-primary"
          :disabled="isSaving || bulkRows.length === 0"
          @click="runBulkImport"
        >
          Import Generated Rows
        </button>
      </div>

      <p class="muted" v-if="bulkRows.length">
        Generated rows ready: {{ bulkRows.length }}
      </p>
    </div>

    <div v-if="showDetails" class="modal-backdrop">
      <div class="modal">
        <h2>Borrower details</h2>
        <p class="muted">View username, borrower ID, and checkout history.</p>
        <h3>{{ selected?.username }}</h3>
        <p class="muted">Borrower ID: {{ selected?.borrower_id }}</p>
        <div class="form-grid-2">
          <label>
            Username
            <input
              class="identity-readonly"
              :value="selected?.username || ''"
              type="text"
              readonly
              title="If you need to change this, contact support."
            />
          </label>
          <label>
            Borrower ID
            <input
              class="identity-readonly"
              :value="selected?.borrower_id || ''"
              type="text"
              readonly
              title="If you need to change this, contact support."
            />
          </label>
        </div>

        <SkeletonLoader v-if="detailsLoading" variant="lines" :rows="3" label="Loading borrower details" />
        <div v-else>
          <div>
            <h3>Currently checked out</h3>
            <ul v-if="details?.checkedOutItem.length">
              <li v-for="item in details.checkedOutItem" :key="item.id">
                {{ item.name }}
                <span class="muted">({{ item.barcode }})</span>
              </li>
            </ul>
            <p v-else class="muted">No items currently checked out.</p>
          </div>

          <div>
            <h3>Last checkout</h3>
            <p v-if="details?.lastCheckout">
              {{ formatTime(details.lastCheckout.action_time) }}
              <span v-if="details.lastCheckout.item_name"> — {{ details.lastCheckout.item_name }} </span>
            </p>
            <p v-else class="muted">No checkout history.</p>
          </div>

          <div>
            <h3>Last return</h3>
            <p v-if="details?.lastReturn">
              {{ formatTime(details.lastReturn.action_time) }}
              <span v-if="details.lastReturn.item_name"> — {{ details.lastReturn.item_name }} </span>
            </p>
            <p v-else class="muted">No return history.</p>
          </div>
        </div>

        <div class="admin-actions">
          <button type="button" class="link" @click="removeSelected">Archive borrower</button>
          <button type="button" class="link" @click="closeDetails">Close</button>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref } from "vue";
import { RouterLink } from "vue-router";
import SkeletonLoader from "../../../components/SkeletonLoader.vue";
import { getAuthState } from "../../../store/authState";
import {
  bulkCreateBorrowers,
  createBorrower,
  deleteBorrower,
  fetchDeletedBorrowers,
  fetchBorrowerDetails,
  fetchBorrowers,
  restoreBorrower,
  type BorrowerDetails,
  type BorrowerItem,
} from "../../../services/borrowerService";
import { fetchWorkspaceSettings } from "../../../services/adminOpsService";
import { logAdminAction } from "../../../services/auditLogService";
import { exportRowsToCsv, exportRowsToPdf } from "../../../services/exportService";
import { generateBorrowerIdentity } from "../../../utils/borrowerIdentity";
import { authenticatedSelect } from "../../../services/authenticatedDataClient";

const borrowers = ref<BorrowerItem[]>([]);
const archivedBorrowers = ref<BorrowerItem[]>([]);
const isLoading = ref(false);
const isLoadingArchived = ref(false);
const isSaving = ref(false);
const error = ref("");
const success = ref("");
const showDetails = ref(false);
const detailsLoading = ref(false);
const details = ref<BorrowerDetails | null>(null);
const selected = ref<BorrowerItem | null>(null);
const toastTitle = ref("");
const toastMessage = ref("");
const toastActionLabel = ref("");
const toastAction = ref<(() => Promise<void>) | null>(null);

const usernamePreview = ref("");
const borrowerIdPreview = ref("");
const accessMode = ref<"" | "all" | "restricted">("");
const selectedProfileIds = ref<string[]>([]);
const tenantAccounts = ref<Array<{id:string;auth_email:string}>>([]);
const searchQuery = ref("");
const featureFlags = ref({
  enable_notifications: true,
  enable_bulk_item_import: true,
  enable_bulk_borrower_tools: true,
  enable_status_tracking: true,
  enable_barcode_generator: true,
});
const bulkGenerateCount = ref(20);
const bulkRows = ref<Array<{ username: string; borrower_id: string }>>([]);
let toastTimer: number | null = null;

const matchesSearch = (item: BorrowerItem, query: string) => {
  if (!query) return true;
  const haystack = `${item.username} ${item.borrower_id}`.toLowerCase();
  return haystack.includes(query);
};

const filteredBorrowers = computed(() => {
  const query = searchQuery.value.trim().toLowerCase();
  return borrowers.value.filter((item) => matchesSearch(item, query));
});

const filteredArchivedBorrowers = computed(() => {
  const query = searchQuery.value.trim().toLowerCase();
  return archivedBorrowers.value.filter((item) => matchesSearch(item, query));
});

const showToast = (title: string, message: string) => {
  toastTitle.value = title;
  toastMessage.value = message;
  toastActionLabel.value = "";
  toastAction.value = null;
  if (toastTimer) {
    window.clearTimeout(toastTimer);
  }
  toastTimer = window.setTimeout(() => {
    toastTitle.value = "";
    toastMessage.value = "";
    toastTimer = null;
  }, 4000);
};

const showToastWithAction = (
  title: string,
  message: string,
  actionLabel: string,
  action: () => Promise<void>
) => {
  toastTitle.value = title;
  toastMessage.value = message;
  toastActionLabel.value = actionLabel;
  toastAction.value = action;
  if (toastTimer) {
    window.clearTimeout(toastTimer);
  }
  toastTimer = window.setTimeout(() => {
    toastTitle.value = "";
    toastMessage.value = "";
    toastActionLabel.value = "";
    toastAction.value = null;
    toastTimer = null;
  }, 7000);
};

const runToastAction = async () => {
  if (!toastAction.value) return;
  const action = toastAction.value;
  toastAction.value = null;
  toastActionLabel.value = "";
  await action();
};

const showDuplicateBorrowerToast = () => {
  showToast(
    "Unable to add borrower.",
    "Check borrower ID number and make sure it does not match another borrower's ID number. If you believe this is an error, contact support with the current borrower details and the details you want to add."
  );
};

const loadArchivedBorrowers = async () => {
  isLoadingArchived.value = true;
  try {
    archivedBorrowers.value = await fetchDeletedBorrowers();
  } catch {
    archivedBorrowers.value = [];
  } finally {
    isLoadingArchived.value = false;
  }
};

const loadBorrowers = async () => {
  isLoading.value = true;
  error.value = "";
  try {
    borrowers.value = await fetchBorrowers();
  } catch (err) {
    error.value = err instanceof Error ? err.message : "Unable to load borrowers. Please sign out completeley and sign back in. If issue persists, contact support.";
  } finally {
    isLoading.value = false;
  }
  await loadArchivedBorrowers();
};

const regenerateIdentity = () => {
  const next = generateBorrowerIdentity();
  usernamePreview.value = next.username;
  borrowerIdPreview.value = next.borrowerId;
};

const generateBulkRows = () => {
  const count = Math.min(200, Math.max(1, Math.round(Number(bulkGenerateCount.value) || 0)));
  bulkGenerateCount.value = count;
  bulkRows.value = Array.from({ length: count }, () => generateBorrowerIdentity()).map((row) => ({
    username: row.username,
    borrower_id: row.borrowerId,
  }));
};

const runBulkImport = async () => {
  if (!bulkRows.value.length) {
    showToast("No rows to import.", "Generate rows first.");
    return;
  }
  error.value = "";
  success.value = "";
  isSaving.value = true;
  try {
    const result = await bulkCreateBorrowers(bulkRows.value);
    borrowers.value = [...result.inserted, ...borrowers.value];
    success.value = `Imported ${result.inserted_count} borrower(s).`;
    showToast("Bulk import complete", `Imported ${result.inserted_count}, skipped ${result.skipped_count}.`);
    bulkRows.value = [];
  } catch (err) {
    error.value = err instanceof Error ? err.message : "Unable to import borrowers. Please try again. If the issue persists, contact support.";
    showToast("Import failed", error.value);
  } finally {
    isSaving.value = false;
  }
};

const exportCsv = () => {
  exportRowsToCsv(
    `borrowers-${new Date().toISOString().slice(0, 10)}.csv`,
    ["username", "borrower_id"],
    filteredBorrowers.value
  );
};

const exportPdf = async () => {
  await exportRowsToPdf(
    `borrowers-${new Date().toISOString().slice(0, 10)}.pdf`,
    "Borrower Export",
    ["username", "borrower_id"],
    filteredBorrowers.value
  );
};

const handleCreate = async () => {
  error.value = "";
  success.value = "";

  const auth = getAuthState();
  if (!auth.workspaceContextId) {
    error.value = "Missing user context. Please sign out completeley and sign back in.";
    return;
  }
  if (!accessMode.value || (accessMode.value === "restricted" && selectedProfileIds.value.length === 0)) { error.value = "Choose All Tenant Accounts or select at least one specific account."; return; }

  isSaving.value = true;
  try {
    const created = await createBorrower({
      workspace_id: auth.workspaceContextId,
      username: usernamePreview.value,
      borrower_id: borrowerIdPreview.value,
      access_mode: accessMode.value,
      profile_ids: selectedProfileIds.value,
    });
    await logAdminAction({
      action_type: "borrower_create",
      entity_type: "borrower",
      entity_id: created.id,
      metadata: { borrower_id: created.borrower_id },
    });
    borrowers.value = [created, ...borrowers.value];
    usernamePreview.value = created.username;
    borrowerIdPreview.value = created.borrower_id;
    regenerateIdentity();
    accessMode.value = "";
    selectedProfileIds.value = [];
    success.value = "Borrower added.";
  } catch (err) {
    error.value = err instanceof Error ? err.message : "Unable to create borrower. Please try again. If the issue persists, contact support.";
    showDuplicateBorrowerToast();
  } finally {
    isSaving.value = false;
  }
};

onMounted(() => {
  regenerateIdentity();
  void (async () => {
    try {
      const settings = await fetchWorkspaceSettings();
      featureFlags.value = settings.feature_flags;
    } catch {
      featureFlags.value = {
        enable_notifications: true,
        enable_bulk_item_import: true,
        enable_bulk_borrower_tools: true,
        enable_status_tracking: true,
        enable_barcode_generator: true,
      };
    }
    await loadBorrowers();
    tenantAccounts.value = await authenticatedSelect<Array<{id:string;auth_email:string}>>("profiles", { select: "id,auth_email", role: "eq.tenant_account", is_active: "eq.true", deleted_at: "is.null", order: "auth_email.asc" });
  })();
});

const openDetails = async (item: BorrowerItem) => {
  if (showDetails.value && selected.value?.id === item.id) {
    closeDetails();
    return;
  }
  selected.value = item;
  showDetails.value = true;
  detailsLoading.value = true;
  error.value = "";
  try {
    details.value = await fetchBorrowerDetails(item.id);
  } catch (err) {
    error.value = err instanceof Error ? err.message : "Unable to load details. Please sign out completeley and sign back in. If issue persists, contact support.";
    details.value = null;
  } finally {
    detailsLoading.value = false;
  }
};

const closeDetails = () => {
  showDetails.value = false;
  details.value = null;
  selected.value = null;
};

const formatTime = (value: string) => {
  const date = new Date(value);
  return date.toLocaleString(undefined, {
    month: "numeric",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
};

const removeBorrower = async (item: BorrowerItem) => {
  const confirmed = window.confirm(`Archive borrower "${item.username}"? You can restore them later if needed.`);
  if (!confirmed) return;
  error.value = "";
  success.value = "";
  isSaving.value = true;
  try {
    await deleteBorrower(item.id);
    await logAdminAction({
      action_type: "borrower_archive",
      entity_type: "borrower",
      entity_id: item.id,
      metadata: { borrower_id: item.borrower_id },
    });
    borrowers.value = borrowers.value.filter((row) => row.id !== item.id);
    archivedBorrowers.value = [item, ...archivedBorrowers.value];
    success.value = "Borrower archived.";
    showToastWithAction(
      "Borrower archived",
      `${item.username} was archived.`,
      "Undo",
      async () => {
        await handleRestore(item);
      }
    );
  } catch (err) {
    error.value = err instanceof Error ? err.message : "Unable to archive borrower. Please sign out completeley and sign back in. If issue persists, contact support.";
  } finally {
    isSaving.value = false;
  }
};

const removeSelected = async () => {
  if (!selected.value) return;
  await removeBorrower(selected.value);
  if (!error.value) {
    closeDetails();
  }
};

const handleRestore = async (item: BorrowerItem) => {
  error.value = "";
  success.value = "";
  isSaving.value = true;
  try {
    const restored = await restoreBorrower(item.id);
    await logAdminAction({
      action_type: "borrower_restore",
      entity_type: "borrower",
      entity_id: item.id,
      metadata: { borrower_id: item.borrower_id },
    });
    archivedBorrowers.value = archivedBorrowers.value.filter((row) => row.id !== item.id);
    borrowers.value = [restored, ...borrowers.value];
    success.value = "Borrower restored.";
  } catch (err) {
    error.value = err instanceof Error ? err.message : "Unable to restore borrower. If you believe this is an error, contact support.";
  } finally {
    isSaving.value = false;
  }
};

onUnmounted(() => {
  if (toastTimer) {
    window.clearTimeout(toastTimer);
    toastTimer = null;
  }
});
</script>

<style scoped>
.modal-backdrop {
  position: fixed;
  inset: 0;
  background: rgba(10, 14, 25, 0.55);
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 1rem;
  z-index: 1000;
}

.modal {
  width: min(680px, 100%);
  max-height: 90vh;
  overflow: auto;
  border: 1px solid var(--border);
  border-radius: 12px;
  background: var(--surface);
  padding: 1rem;
}

.modal h3 {
  margin-top: 0.25rem;
  margin-bottom: 0.5rem;
}

.modal .admin-actions {
  margin-top: 0.75rem;
}

.identity-readonly {
  width: auto;
  min-width: 120px;
  max-width: 100%;
}
</style>
