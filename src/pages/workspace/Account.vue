<template>
  <main class="page">
    <header>
      <h1>My Account</h1>
      <nav>
        <RouterLink class="button-link" to="/checkout">Back to checkout</RouterLink>
      </nav>
    </header>

    <section class="card admin-section-card">
      <div class="admin-section-header">
        <div>
          <h2>Borrowers</h2>
          <p class="admin-section-copy">Read-only view of this workspace's borrowers.</p>
        </div>
      </div>
      <p v-if="borrowersLoading">Loading…</p>
      <p v-else-if="borrowersError" class="error">{{ borrowersError }}</p>
      <template v-else>
        <div class="table-wrap">
          <table class="table">
            <thead>
              <tr>
                <th>Username</th>
                <th>Borrower ID</th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="borrower in pagedBorrowers" :key="borrower.id">
                <td>{{ borrower.username }}</td>
                <td>{{ borrower.borrower_id }}</td>
              </tr>
              <tr v-if="!pagedBorrowers.length">
                <td colspan="2" class="muted">No borrowers found.</td>
              </tr>
            </tbody>
          </table>
        </div>
        <div class="account-pagination">
          <button type="button" :disabled="borrowerPage === 0" @click="borrowerPage--">‹ Previous 20</button>
          <span>{{ borrowerPageLabel }}</span>
          <button type="button" :disabled="!hasMoreBorrowers" @click="borrowerPage++">Next 20 ›</button>
        </div>
      </template>
    </section>

    <section class="card admin-section-card">
      <div class="admin-section-header">
        <div>
          <h2>Items</h2>
          <p class="admin-section-copy">Read-only view of this workspace's items.</p>
        </div>
      </div>
      <p v-if="itemsLoading">Loading…</p>
      <p v-else-if="itemsError" class="error">{{ itemsError }}</p>
      <template v-else>
        <div class="table-wrap">
          <table class="table">
            <thead>
              <tr>
                <th>Name</th>
                <th>Barcode</th>
                <th>Status</th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="item in pagedItems" :key="item.id">
                <td>{{ item.name }}</td>
                <td>{{ item.barcode }}</td>
                <td>{{ item.status }}</td>
              </tr>
              <tr v-if="!pagedItems.length">
                <td colspan="3" class="muted">No items found.</td>
              </tr>
            </tbody>
          </table>
        </div>
        <div class="account-pagination">
          <button type="button" :disabled="itemPage === 0" @click="itemPage--">‹ Previous 20</button>
          <span>{{ itemPageLabel }}</span>
          <button type="button" :disabled="!hasMoreItems" @click="itemPage++">Next 20 ›</button>
        </div>
      </template>
    </section>

    <section class="card admin-section-card">
      <div class="admin-section-header">
        <div>
          <h2>Active Devices</h2>
          <p class="admin-section-copy">Review active sessions for your account and remotely sign out devices.</p>
        </div>
      </div>
      <div class="table-wrap">
        <table class="table">
          <thead>
            <tr>
              <th>Device</th>
              <th>Login method</th>
              <th>Login flow</th>
              <th>Location</th>
              <th>Last seen</th>
              <th>Signed in</th>
              <th>Status</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="session in sessions" :key="session.id">
              <td>{{ session.device_label || "Unknown device" }}</td>
              <td>{{ formatLoginMethod(session.login_method) }}</td>
              <td>{{ formatLoginLocation(session.login_location) }}</td>
              <td>{{ formatGeneralLocation(session.general_location) }}</td>
              <td>{{ formatDate(session.last_seen_at) }}</td>
              <td>{{ formatDate(session.created_at) }}</td>
              <td>{{ session.is_current ? "Current" : "Active" }}</td>
            </tr>
            <tr v-if="!sessions.length">
              <td colspan="7" class="muted">No active sessions found.</td>
            </tr>
          </tbody>
        </table>
      </div>
      <div class="form-actions">
        <label class="session-select">
          Select device
          <select v-model="selectedSessionId">
            <option value="">Choose a device</option>
            <option
              v-for="session in removableSessions"
              :key="session.id"
              :value="session.id"
            >
              {{ session.device_label || "Unknown device" }} — {{ formatDate(session.last_seen_at) }}
            </option>
          </select>
        </label>
      </div>
      <div class="form-actions">
        <button
          type="button"
          :disabled="isSessionSaving || !selectedSessionId"
          @click="handleSignOutSelected"
        >
          Sign out selected device
        </button>
        <button
          type="button"
          :disabled="isSessionSaving || !removableSessions.length"
          @click="handleSignOutAllOthers"
        >
          Sign out all other devices
        </button>
      </div>
      <p v-if="sessionError" class="error">{{ sessionError }}</p>
      <p v-if="sessionSuccess" class="success">{{ sessionSuccess }}</p>
    </section>
  </main>
</template>

<script setup lang="ts">
import { computed, onMounted, ref } from "vue";
import { RouterLink } from "vue-router";
import { authenticatedSelect } from "../../services/authenticatedDataClient";
import { toUserFacingErrorMessage } from "../../services/appErrors";
import {
  listAccountSessions,
  revokeAccountSession,
  revokeAllAccountSessions,
  type AccountSessionItem,
} from "../../services/adminOpsService";

const PAGE_SIZE = 20;

type BorrowerRow = { id: string; username: string; borrower_id: string };
type ItemRow = { id: string; name: string; barcode: string; status: string };

const borrowers = ref<BorrowerRow[]>([]);
const borrowersLoading = ref(true);
const borrowersError = ref("");
const borrowerPage = ref(0);

const items = ref<ItemRow[]>([]);
const itemsLoading = ref(true);
const itemsError = ref("");
const itemPage = ref(0);

const sessions = ref<AccountSessionItem[]>([]);
const selectedSessionId = ref("");
const isSessionSaving = ref(false);
const sessionError = ref("");
const sessionSuccess = ref("");

const pagedBorrowers = computed(() =>
  borrowers.value.slice(borrowerPage.value * PAGE_SIZE, (borrowerPage.value + 1) * PAGE_SIZE),
);
const hasMoreBorrowers = computed(() => (borrowerPage.value + 1) * PAGE_SIZE < borrowers.value.length);
const borrowerPageLabel = computed(() => {
  if (!borrowers.value.length) return "No borrowers";
  const start = borrowerPage.value * PAGE_SIZE + 1;
  const end = Math.min(borrowers.value.length, (borrowerPage.value + 1) * PAGE_SIZE);
  return `${start}–${end} of ${borrowers.value.length}`;
});

const pagedItems = computed(() =>
  items.value.slice(itemPage.value * PAGE_SIZE, (itemPage.value + 1) * PAGE_SIZE),
);
const hasMoreItems = computed(() => (itemPage.value + 1) * PAGE_SIZE < items.value.length);
const itemPageLabel = computed(() => {
  if (!items.value.length) return "No items";
  const start = itemPage.value * PAGE_SIZE + 1;
  const end = Math.min(items.value.length, (itemPage.value + 1) * PAGE_SIZE);
  return `${start}–${end} of ${items.value.length}`;
});

const removableSessions = computed(() => sessions.value.filter((session) => !session.is_current));

const formatLoginMethod = (value: AccountSessionItem["login_method"]) =>
  value === "password"
    ? "Password"
    : value === "magic_link"
      ? "Magic link"
      : value === "session_handoff"
        ? "Session handoff"
        : "Unknown";

const formatLoginLocation = (value: AccountSessionItem["login_location"]) =>
  value === "regular_login"
    ? "Regular login"
    : value === "admin_login"
      ? "Admin sign in"
      : "Unknown";

const formatGeneralLocation = (value: AccountSessionItem["general_location"]) =>
  value?.trim() ? value : "Unknown";

const formatDate = (value: string) => {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "Unknown";
  return date.toLocaleString();
};

const loadBorrowers = async () => {
  try {
    borrowers.value = await authenticatedSelect<BorrowerRow[]>("borrowers", {
      select: "id,username,borrower_id",
      deleted_at: "is.null",
      order: "username.asc",
    });
  } catch {
    borrowersError.value = "Unable to load borrowers.";
  } finally {
    borrowersLoading.value = false;
  }
};

const loadItems = async () => {
  try {
    items.value = await authenticatedSelect<ItemRow[]>("items", {
      select: "id,name,barcode,status",
      deleted_at: "is.null",
      order: "name.asc",
    });
  } catch {
    itemsError.value = "Unable to load items.";
  } finally {
    itemsLoading.value = false;
  }
};

const loadSessions = async () => {
  sessionError.value = "";
  sessionSuccess.value = "";
  try {
    const data = await listAccountSessions();
    sessions.value = data.sessions ?? [];
    if (selectedSessionId.value && !sessions.value.some((row) => row.id === selectedSessionId.value)) {
      selectedSessionId.value = "";
    }
  } catch (err) {
    sessionError.value = toUserFacingErrorMessage(err, "Unable to load sessions.");
  }
};

const handleSignOutSelected = async () => {
  if (!selectedSessionId.value) return;
  isSessionSaving.value = true;
  sessionError.value = "";
  sessionSuccess.value = "";
  try {
    await revokeAccountSession(selectedSessionId.value);
    selectedSessionId.value = "";
    sessionSuccess.value = "Selected device signed out.";
    await loadSessions();
  } catch (err) {
    sessionError.value = toUserFacingErrorMessage(err, "Unable to sign out selected device.");
  } finally {
    isSessionSaving.value = false;
  }
};

const handleSignOutAllOthers = async () => {
  isSessionSaving.value = true;
  sessionError.value = "";
  sessionSuccess.value = "";
  try {
    await revokeAllAccountSessions(false);
    selectedSessionId.value = "";
    sessionSuccess.value = "All other devices signed out.";
    await loadSessions();
  } catch (err) {
    sessionError.value = toUserFacingErrorMessage(err, "Unable to sign out all other devices.");
  } finally {
    isSessionSaving.value = false;
  }
};

onMounted(() => {
  void loadBorrowers();
  void loadItems();
  void loadSessions();
});
</script>

<style scoped>
.account-pagination {
  display: flex;
  align-items: center;
  gap: 0.75rem;
  margin-top: 0.6rem;
}
</style>
