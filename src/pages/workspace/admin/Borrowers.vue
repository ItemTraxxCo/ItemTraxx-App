<template>
  <div class="page admin-shell">
    <div class="admin-hero">
      <div class="page-nav-left">
        <RouterLink class="button-link" :to="managerRoot">Back</RouterLink>
      </div>
      <h1>Borrower Management</h1>
      <p class="admin-hero-copy">Add borrowers, review details, and manage archived records.</p>
      <div class="admin-summary-grid">
        <div class="admin-summary-card">
          <strong>{{ isLoading ? "…" : borrowers.length }}</strong>
          <span>Active borrowers</span>
        </div>
        <div class="admin-summary-card">
          <strong>{{ isLoadingArchived ? "…" : archivedBorrowers.length }}</strong>
          <span>Archived borrowers</span>
        </div>
      </div>
    </div>

    <div class="card admin-section-card">
      <div class="admin-section-header">
        <div>
          <h2>Add Borrower</h2>
          <p class="admin-section-copy">Enter a name and borrower ID to add a borrower.</p>
        </div>
      </div>
      <form class="form" @submit.prevent="handleCreate">
        <fieldset class="name-mode-picker">
          <legend>Name format</legend>
          <div class="name-mode-track">
            <label class="name-mode-option"><input v-model="nameMode" type="radio" name="borrower-name-format" value="split" /> First &amp; Last Name</label>
            <label class="name-mode-option"><input v-model="nameMode" type="radio" name="borrower-name-format" value="free" /> Free Input</label>
          </div>
        </fieldset>
        <template v-if="nameMode === 'split'">
          <label>First Name <input v-model="firstName" type="text" maxlength="100" required /></label>
          <label>Last Name <input v-model="lastName" type="text" maxlength="100" /></label>
        </template>
        <label v-else>Name / Identifier <input v-model="freeName" type="text" maxlength="100" required /></label>
        <label>Borrower ID <input v-model="borrowerId" type="text" maxlength="32" pattern="[A-Za-z0-9]+" required /></label>
        <label>Email <input v-model="email" type="email" maxlength="254" /></label>
        <TenantAccessPicker
          v-if="!isIndividualAccount"
          v-model:access-mode="accessMode"
          v-model:selected-ids="selectedProfileIds"
          :accounts="tenantAccounts"
        />
        <div class="form-actions">
          <button type="submit" class="button-primary" :disabled="isSaving">Add borrower</button>
        </div>
      </form>
      <p v-if="error" class="error" v-app-toast-error="{ suppressMessage: toastMessage }">{{ error }}</p>
      <p v-if="success" class="success" v-app-toast-message>{{ success }}</p>
    </div>

    <div v-if="toastMessage" class="toast">
      <div class="toast-title">{{ toastTitle }}</div>
      <div class="toast-body" data-session-replay-mask>{{ toastMessage }}</div>
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
          <button type="button" @click="toggleBulkMode">
            {{ bulkMode ? "Exit bulk actions" : "Bulk actions" }}
          </button>
        </div>
      </div>

      <div v-if="bulkMode && selectedBorrowerIds.size > 0" class="bulk-action-bar">
        <span>{{ selectedBorrowerIds.size }} selected</span>
        <button v-if="!isIndividualAccount" type="button" @click="openBulkAccessModal">Change tenant account access</button>
        <button type="button" :disabled="isSaving" @click="applyBulkArchive">Archive selected</button>
      </div>
      <div class="form-grid-2">
        <label>
          Search borrowers
          <input
            v-model="searchQuery"
            type="text"
            placeholder="Search by name, borrower ID, or email"
          />
        </label>
      </div>
      <p v-if="isLoading" class="muted">Loading borrowers…</p>
      <p v-else class="muted">Showing {{ filteredBorrowers.length }} of {{ borrowers.length }} borrowers.</p>
      <BoneyardSkeleton
        :name="bulkMode ? 'admin-borrowers-table-bulk' : 'admin-borrowers-table'"
        :loading="isLoading"
        variant="table"
        :rows="6"
        :columns="bulkMode ? 5 : 4"
        action-column
        label="Loading borrowers"
      >
        <template #fixture>
          <BoneyardTableFixture
            :headers="bulkMode ? borrowerBulkFixtureHeaders : borrowerFixtureHeaders"
            :rows="6"
            action-column
          />
        </template>

        <div v-if="isLoading">
          <BoneyardTableFixture
            :headers="bulkMode ? borrowerBulkFixtureHeaders : borrowerFixtureHeaders"
            :rows="6"
            action-column
          />
        </div>
        <div v-else class="table-wrap">
          <table class="table">
            <thead>
              <tr>
                <th v-if="bulkMode">
                  <input
                    type="checkbox"
                    :checked="allFilteredSelected"
                    @change="toggleSelectAll"
                    aria-label="Select all borrowers"
                  />
                </th>
                <th>Name</th>
                <th>Borrower ID</th>
                <th v-if="!isIndividualAccount">Tenant Accounts</th>
                <th>Details</th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="(item, index) in filteredBorrowers" :key="item.id">
                <td v-if="bulkMode">
                  <input
                    type="checkbox"
                    :checked="selectedBorrowerIds.has(item.id)"
                    @click="toggleBorrowerSelection(item.id, index, $event)"
                    :aria-label="`Select ${borrowerDisplayName(item)}`"
                  />
                </td>
                <td data-session-replay-mask>{{ borrowerDisplayName(item) }}</td>
                <td data-session-replay-mask>{{ item.borrower_id }}</td>
                <td v-if="!isIndividualAccount">
                  <span class="scoped-accounts-cell" data-session-replay-mask :title="scopedAccountsTitle(item)">
                    {{ scopedAccountsLabel(item) }}
                  </span>
                </td>
                <td>
                  <div class="admin-actions">
                    <button type="button" @click="openDetails(item)">Details</button>
                  </div>
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      </BoneyardSkeleton>
    </div>

    <div class="card admin-section-card">
      <div class="admin-section-header">
        <div>
          <h2>Archived Borrowers</h2>
          <p class="admin-section-copy">Archived borrowers can be restored at any time.</p>
        </div>
      </div>
      <BoneyardSkeleton
        name="admin-archived-borrowers-table"
        :loading="isLoadingArchived"
        variant="table"
        :rows="4"
        :columns="3"
        action-column
        label="Loading archived borrowers"
      >
        <template #fixture>
          <BoneyardTableFixture :headers="archivedBorrowerFixtureHeaders" :rows="4" action-column />
        </template>

        <div v-if="isLoadingArchived">
          <BoneyardTableFixture :headers="archivedBorrowerFixtureHeaders" :rows="4" action-column />
        </div>
        <div v-else class="table-wrap">
          <table class="table">
            <thead>
              <tr>
                <th>Name</th>
                <th>Borrower ID</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="item in filteredArchivedBorrowers" :key="item.id">
                <td data-session-replay-mask>{{ borrowerDisplayName(item) }}</td>
                <td data-session-replay-mask>{{ item.borrower_id }}</td>
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
      </BoneyardSkeleton>
    </div>

    <div v-if="!isIndividualAccount && showBulkAccessModal" class="modal-backdrop">
      <div class="modal">
        <h2>Change tenant account access</h2>
        <p class="admin-section-copy">Applies to {{ selectedBorrowerIds.size }} selected borrower(s).</p>
        <TenantAccessPicker
          v-model:access-mode="bulkAccessMode"
          v-model:selected-ids="bulkAccessProfileIds"
          :accounts="tenantAccounts"
        />
        <div class="admin-actions">
          <button type="button" class="link" :disabled="!bulkAccessMode || isSaving" @click="applyBulkAccess">
            Apply
          </button>
          <button type="button" class="link" @click="showBulkAccessModal = false">Cancel</button>
        </div>
      </div>
    </div>

    <div v-if="showDetails" class="modal-backdrop">
      <div class="modal">
        <h2>Borrower details</h2>
        <p class="muted">View name, borrower ID, and checkout history.</p>
        <h3 data-session-replay-mask>{{ selected ? borrowerDisplayName(selected) : "" }}</h3>
        <p class="muted">Borrower ID: <span data-session-replay-mask>{{ selected?.borrower_id }}</span></p>
        <p v-if="selected && !isIndividualAccount" class="muted">
          Tenant Accounts:
          <span class="scoped-accounts-cell" data-session-replay-mask :title="scopedAccountsTitle(selected)">{{ scopedAccountsLabel(selected) }}</span>
        </p>

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
import BoneyardSkeleton from "../../../components/BoneyardSkeleton.vue";
import BoneyardTableFixture from "../../../components/BoneyardTableFixture.vue";
import SkeletonLoader from "../../../components/SkeletonLoader.vue";
import TenantAccessPicker from "../../../components/app/TenantAccessPicker.vue";
import { getAuthState } from "../../../store/authState";
import {
  createBorrower,
  deleteBorrower,
  fetchDeletedBorrowers,
  fetchBorrowerDetails,
  fetchBorrowerAccessGrants,
  fetchBorrowers,
  restoreBorrower,
  updateBorrowerAccess,
  type BorrowerDetails,
  type BorrowerItem,
} from "../../../services/borrowerService";
import { exportRowsToCsv, exportRowsToPdf } from "../../../services/exportService";
import { borrowerDisplayName, sortBorrowersByName, normalizeBorrowerName } from "../../../utils/borrowerName";
import { listTenantAccounts } from "../../../services/workspaceAdminManageService";
import { useManagerContext } from "../../../composables/useManagerContext";

const { isIndividualAccount, managerRoot } = useManagerContext();

const borrowers = ref<BorrowerItem[]>([]);
const archivedBorrowers = ref<BorrowerItem[]>([]);
const isLoading = ref(true);
const isLoadingArchived = ref(true);
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

const nameMode = ref<"split" | "free">("split");
const firstName = ref("");
const lastName = ref("");
const freeName = ref("");
const borrowerId = ref("");
const email = ref("");
const accessMode = ref<"" | "all" | "restricted">(isIndividualAccount.value ? "all" : "");
const selectedProfileIds = ref<string[]>([]);
const tenantAccounts = ref<Array<{id:string;auth_email:string}>>([]);
const searchQuery = ref("");
const bulkMode = ref(
  import.meta.env.VITE_E2E_TEST_UTILS === "true" &&
    new URLSearchParams(window.location.search).get("boneyard-bulk") === "true"
);
const selectedBorrowerIds = ref<Set<string>>(new Set());
const lastSelectedIndex = ref<number | null>(null);
const showBulkAccessModal = ref(false);
const bulkAccessMode = ref<"" | "all" | "restricted">("");
const bulkAccessProfileIds = ref<string[]>([]);
const borrowerFixtureHeaders = ["Name", "Borrower ID", "Tenant Accounts", "Details"];
const borrowerBulkFixtureHeaders = ["Select", ...borrowerFixtureHeaders];
const archivedBorrowerFixtureHeaders = ["Name", "Borrower ID", ""];
const isBoneyardCapture =
  import.meta.env.VITE_E2E_TEST_UTILS === "true" &&
  new URLSearchParams(window.location.search).has("boneyard");
let toastTimer: number | null = null;

const matchesSearch = (item: BorrowerItem, query: string) => {
  if (!query) return true;
  const haystack = `${borrowerDisplayName(item)} ${item.borrower_id} ${item.email ?? ""}`.toLowerCase();
  return haystack.includes(query);
};

const filteredBorrowers = computed(() => {
  const query = searchQuery.value.trim().toLowerCase();
  return sortBorrowersByName(borrowers.value.filter((item) => matchesSearch(item, query)));
});

const filteredArchivedBorrowers = computed(() => {
  const query = searchQuery.value.trim().toLowerCase();
  return sortBorrowersByName(archivedBorrowers.value.filter((item) => matchesSearch(item, query)));
});

const allFilteredSelected = computed(
  () =>
    filteredBorrowers.value.length > 0 &&
    filteredBorrowers.value.every((item) => selectedBorrowerIds.value.has(item.id))
);

const toggleBulkMode = () => {
  bulkMode.value = !bulkMode.value;
  selectedBorrowerIds.value = new Set();
  lastSelectedIndex.value = null;
};

const toggleSelectAll = () => {
  selectedBorrowerIds.value = allFilteredSelected.value
    ? new Set()
    : new Set(filteredBorrowers.value.map((item) => item.id));
};

const toggleBorrowerSelection = (id: string, index: number, event: MouseEvent) => {
  const next = new Set(selectedBorrowerIds.value);
  if (event.shiftKey && lastSelectedIndex.value !== null) {
    const [start, end] = [lastSelectedIndex.value, index].sort((a, b) => a - b);
    for (let i = start; i <= end; i++) {
      next.add(filteredBorrowers.value[i].id);
    }
  } else if (next.has(id)) {
    next.delete(id);
  } else {
    next.add(id);
  }
  selectedBorrowerIds.value = next;
  lastSelectedIndex.value = index;
};

const openBulkAccessModal = () => {
  bulkAccessMode.value = "";
  bulkAccessProfileIds.value = [];
  showBulkAccessModal.value = true;
};

const applyBulkAccess = async () => {
  const accessMode = bulkAccessMode.value;
  if (accessMode !== "all" && accessMode !== "restricted") return;
  isSaving.value = true;
  try {
    for (const id of selectedBorrowerIds.value) {
      await updateBorrowerAccess({ id, access_mode: accessMode, profile_ids: bulkAccessProfileIds.value });
    }
    success.value = "Tenant account access updated.";
    showToast("Access updated", "Tenant account access updated for the selected borrowers.");
    showBulkAccessModal.value = false;
    selectedBorrowerIds.value = new Set();
  } catch (err) {
    error.value = err instanceof Error ? err.message : "Unable to update tenant account access.";
    showToast("Update failed", error.value);
  } finally {
    isSaving.value = false;
  }
};

const applyBulkArchive = async () => {
  const targets = borrowers.value.filter((row) => selectedBorrowerIds.value.has(row.id));
  if (targets.length === 0) return;
  const confirmed = window.confirm(`Archive ${targets.length} selected borrower(s)? You can restore them later.`);
  if (!confirmed) return;
  isSaving.value = true;
  try {
    for (const item of targets) {
      await deleteBorrower(item.id);
      borrowers.value = borrowers.value.filter((row) => row.id !== item.id);
      archivedBorrowers.value = [item, ...archivedBorrowers.value];
    }
    success.value = "Selected borrowers archived.";
    showToast("Borrowers archived", `${targets.length} borrower(s) archived.`);
    selectedBorrowerIds.value = new Set();
  } catch (err) {
    error.value = err instanceof Error ? err.message : "Unable to archive selected borrowers.";
    showToast("Archive failed", error.value);
  } finally {
    isSaving.value = false;
  }
};

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

const loadArchivedBorrowers = async () => {
  isLoadingArchived.value = true;
  try {
    archivedBorrowers.value = await fetchDeletedBorrowers();
  } catch (err) {
    archivedBorrowers.value = [];
    error.value = err instanceof Error ? err.message : "Unable to load archived borrowers.";
  } finally {
    isLoadingArchived.value = false;
  }
};

const borrowerAccessGrants = ref<Record<string, string[]>>({});

const loadBorrowerAccessGrants = async () => {
  const restrictedIds = borrowers.value.filter((row) => row.access_mode === "restricted").map((row) => row.id);
  if (restrictedIds.length === 0) {
    borrowerAccessGrants.value = {};
    return;
  }
  try {
    const grants = await fetchBorrowerAccessGrants(restrictedIds);
    const map: Record<string, string[]> = {};
    for (const grant of grants) {
      (map[grant.borrower_id] ??= []).push(grant.profile_id);
    }
    borrowerAccessGrants.value = map;
  } catch {
    borrowerAccessGrants.value = {};
  }
};

const tenantAccountEmailById = computed(() => {
  const map = new Map<string, string>();
  for (const account of tenantAccounts.value) {
    map.set(account.id, account.auth_email);
  }
  return map;
});

const scopedAccountsLabel = (item: BorrowerItem) => {
  if (item.access_mode !== "restricted") return "All";
  const ids = borrowerAccessGrants.value[item.id] ?? [];
  if (ids.length === 0) return "No tenant accounts";
  return ids.map((id) => tenantAccountEmailById.value.get(id) ?? id).join(", ");
};

const scopedAccountsTitle = (item: BorrowerItem) => {
  if (item.access_mode !== "restricted") return "";
  return scopedAccountsLabel(item);
};

const loadBorrowers = async () => {
  isLoading.value = true;
  error.value = "";
  try {
    borrowers.value = await fetchBorrowers();
    await loadBorrowerAccessGrants();
  } catch (err) {
    error.value = err instanceof Error ? err.message : "Unable to load borrowers. Please sign out completeley and sign back in. If issue persists, contact support.";
  } finally {
    isLoading.value = false;
  }
  await loadArchivedBorrowers();
};

const exportRows = computed(() =>
  filteredBorrowers.value.map((item) => ({ ...item, name: borrowerDisplayName(item), tenant_accounts: scopedAccountsLabel(item) }))
);

const exportCsv = () => {
  exportRowsToCsv(
    `borrowers-${new Date().toISOString().slice(0, 10)}.csv`,
    ["name", "borrower_id", "tenant_accounts"],
    exportRows.value
  );
};

const exportPdf = async () => {
  await exportRowsToPdf(
    `borrowers-${new Date().toISOString().slice(0, 10)}.pdf`,
    "Borrower Export",
    ["name", "borrower_id", "tenant_accounts"],
    exportRows.value
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
    const names = normalizeBorrowerName(nameMode.value === "split" ? firstName.value : freeName.value, nameMode.value === "split" ? lastName.value : "");
    const cleanId = borrowerId.value.trim();
    if (!/^[A-Za-z0-9]{1,32}$/.test(cleanId)) throw new Error("Enter an alphanumeric borrower ID.");
    const created = await createBorrower({
      workspace_id: auth.workspaceContextId,
      ...names,
      email: email.value.trim() || null,
      borrower_id: cleanId,
      access_mode: isIndividualAccount.value ? "all" : accessMode.value,
      profile_ids: isIndividualAccount.value ? [] : selectedProfileIds.value,
    });
    borrowers.value = [created, ...borrowers.value];
    firstName.value = "";
    lastName.value = "";
    freeName.value = "";
    borrowerId.value = "";
    email.value = "";
    accessMode.value = isIndividualAccount.value ? "all" : "";
    selectedProfileIds.value = [];
    success.value = "Borrower added.";
  } catch (err) {
    error.value = err instanceof Error ? err.message : "Unable to create borrower. Please try again. If the issue persists, contact support.";
    showToast("Unable to add borrower.", error.value);
  } finally {
    isSaving.value = false;
  }
};

onMounted(() => {
  if (isBoneyardCapture) return;
  void (async () => {
    await loadBorrowers();
    if (!isIndividualAccount.value) {
      try {
        const accounts = await listTenantAccounts();
        tenantAccounts.value = accounts
          .filter((account) => account.is_active)
          .map(({ id, auth_email }) => ({ id, auth_email }));
        tenantAccounts.value.sort((left, right) => left.auth_email.localeCompare(right.auth_email));
      } catch {
        tenantAccounts.value = [];
      }
    }
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
  const confirmed = window.confirm(`Archive borrower "${borrowerDisplayName(item)}"? You can restore them later if needed.`);
  if (!confirmed) return;
  error.value = "";
  success.value = "";
  isSaving.value = true;
  try {
    await deleteBorrower(item.id);
    borrowers.value = borrowers.value.filter((row) => row.id !== item.id);
    archivedBorrowers.value = [item, ...archivedBorrowers.value];
    success.value = "Borrower archived.";
    showToastWithAction(
      "Borrower archived",
      `${borrowerDisplayName(item)} was archived.`,
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
.name-mode-picker {
  min-width: 0;
  margin: 0;
  padding: 0;
  border: 0;
}

.name-mode-picker legend {
  margin-bottom: 0.4rem;
  padding: 0;
  font-weight: 600;
}

.name-mode-track {
  display: inline-flex;
  align-items: center;
  max-width: 100%;
  padding: 0.25rem;
  border: 1px solid var(--border);
  border-radius: 10px;
  background: var(--surface-2);
}

.name-mode-picker .name-mode-option {
  position: relative;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  margin: 0;
  padding: 0.55rem 0.8rem;
  border-radius: 7px;
  font-size: 0.875rem;
  line-height: 1.25rem;
  text-align: center;
  cursor: pointer;
}

.name-mode-option:has(input:checked) {
  background: var(--surface);
  box-shadow: 0 1px 4px rgba(0, 0, 0, 0.15);
}

.name-mode-option:has(input:focus-visible) {
  outline: 2px solid currentColor;
  outline-offset: 2px;
}

.name-mode-option input {
  position: absolute;
  width: 1px;
  height: 1px;
  margin: 0;
  opacity: 0;
}

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

.scoped-accounts-cell {
  display: inline-block;
  max-width: 220px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  vertical-align: bottom;
}

.bulk-action-bar {
  display: flex;
  align-items: center;
  gap: 0.6rem;
  flex-wrap: wrap;
  margin-bottom: 0.85rem;
  padding: 0.6rem 0.8rem;
  border: 1px solid var(--border);
  border-radius: 10px;
  background: var(--surface-2);
}


</style>
