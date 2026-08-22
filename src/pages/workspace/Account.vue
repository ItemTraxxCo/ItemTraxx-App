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
              <th class="session-actions-header">Actions</th>
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
              <td class="session-actions-cell">
                <div v-if="!session.is_current" class="session-actions">
                  <button
                    type="button"
                    class="session-menu-trigger"
                    :aria-label="`Open actions for ${session.device_label || 'Unknown device'}`"
                    aria-haspopup="menu"
                    :aria-expanded="openSessionMenuId === session.id"
                    :aria-controls="`session-menu-${session.id}`"
                    :disabled="isSessionSaving"
                    @click.stop="toggleSessionMenu(session.id)"
                    @keydown.esc.stop="closeSessionMenu"
                  >
                    <svg viewBox="0 0 20 20" aria-hidden="true">
                      <circle cx="10" cy="4" r="1.5" />
                      <circle cx="10" cy="10" r="1.5" />
                      <circle cx="10" cy="16" r="1.5" />
                    </svg>
                  </button>
                  <div
                    v-if="openSessionMenuId === session.id"
                    :id="`session-menu-${session.id}`"
                    class="session-menu"
                    role="menu"
                    @click.stop
                  >
                    <button
                      type="button"
                      class="session-menu-item session-menu-item--danger"
                      role="menuitem"
                      :disabled="isSessionSaving"
                      @click="handleRevokeSession(session)"
                    >
                      Revoke device
                    </button>
                  </div>
                </div>
                <span v-else class="session-current-action">This device</span>
              </td>
            </tr>
            <tr v-if="!sessions.length">
              <td colspan="8" class="muted">No active sessions found.</td>
            </tr>
          </tbody>
        </table>
      </div>
      <div class="form-actions session-bulk-actions">
        <button
          type="button"
          class="session-bulk-revoke"
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
import { computed, onMounted, onUnmounted, ref } from "vue";
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
const openSessionMenuId = ref<string | null>(null);
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

const closeSessionMenu = () => {
  openSessionMenuId.value = null;
};

const toggleSessionMenu = (sessionId: string) => {
  if (isSessionSaving.value) return;
  openSessionMenuId.value = openSessionMenuId.value === sessionId ? null : sessionId;
};

const handleSessionMenuKeydown = (event: KeyboardEvent) => {
  if (event.key === "Escape") closeSessionMenu();
};

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
    if (openSessionMenuId.value && !sessions.value.some((row) => row.id === openSessionMenuId.value)) {
      closeSessionMenu();
    }
  } catch (err) {
    sessionError.value = toUserFacingErrorMessage(err, "Unable to load sessions.");
  }
};

const handleRevokeSession = async (session: AccountSessionItem) => {
  if (isSessionSaving.value) return;
  closeSessionMenu();
  const deviceLabel = session.device_label || "this device";
  if (!window.confirm(`Revoke ${deviceLabel}? This device will be signed out.`)) return;
  isSessionSaving.value = true;
  sessionError.value = "";
  sessionSuccess.value = "";
  try {
    await revokeAccountSession(session.id);
    await loadSessions();
    if (!sessionError.value) sessionSuccess.value = "Device revoked.";
  } catch (err) {
    sessionError.value = toUserFacingErrorMessage(err, "Unable to revoke device.");
  } finally {
    isSessionSaving.value = false;
  }
};

const handleSignOutAllOthers = async () => {
  if (!removableSessions.value.length) return;
  if (!window.confirm("Sign out all other devices? This will end every other active session.")) return;
  isSessionSaving.value = true;
  sessionError.value = "";
  sessionSuccess.value = "";
  try {
    await revokeAllAccountSessions(false);
    await loadSessions();
    if (!sessionError.value) sessionSuccess.value = "All other devices signed out.";
  } catch (err) {
    sessionError.value = toUserFacingErrorMessage(err, "Unable to sign out all other devices.");
  } finally {
    isSessionSaving.value = false;
  }
};

onMounted(() => {
  document.addEventListener("click", closeSessionMenu);
  document.addEventListener("keydown", handleSessionMenuKeydown);
  void loadBorrowers();
  void loadItems();
  void loadSessions();
});

onUnmounted(() => {
  document.removeEventListener("click", closeSessionMenu);
  document.removeEventListener("keydown", handleSessionMenuKeydown);
});
</script>

<style scoped>
.account-pagination {
  display: flex;
  align-items: center;
  gap: 0.75rem;
  margin-top: 0.6rem;
}

.session-actions-header,
.session-actions-cell {
  text-align: right;
  white-space: nowrap;
}

.session-actions-cell {
  width: 1%;
}

.session-actions {
  position: relative;
  display: flex;
  justify-content: flex-end;
}

.session-menu-trigger {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 2.25rem;
  height: 2.25rem;
  padding: 0;
  border: 1px solid var(--border);
  border-radius: 999px;
  background: transparent;
  color: var(--muted);
  cursor: pointer;
  transition: border-color 150ms ease, background-color 150ms ease, color 150ms ease;
}

.session-menu-trigger:hover:not(:disabled),
.session-menu-trigger:focus-visible {
  border-color: var(--text);
  background: var(--surface-2);
  color: var(--text);
}

.session-menu-trigger:disabled {
  cursor: wait;
  opacity: 0.55;
}

.session-menu-trigger svg {
  width: 1.1rem;
  height: 1.1rem;
  fill: currentColor;
}

.session-menu {
  position: absolute;
  z-index: 20;
  top: calc(100% + 0.35rem);
  right: 0;
  min-width: 9.5rem;
  padding: 0.35rem;
  border: 1px solid var(--border);
  border-radius: 0.75rem;
  background: var(--surface);
}

.session-menu-item {
  width: 100%;
  padding: 0.55rem 0.65rem;
  border: 0;
  border-radius: 0.5rem;
  background: transparent;
  font: inherit;
  text-align: left;
  cursor: pointer;
}

.session-menu-item--danger {
  color: var(--danger);
}

.session-menu-item--danger:hover:not(:disabled),
.session-menu-item--danger:focus-visible {
  background: color-mix(in srgb, var(--danger) 12%, transparent);
}

.session-menu-item:disabled {
  cursor: wait;
  opacity: 0.55;
}

.session-current-action {
  color: var(--muted);
  font-size: 0.8rem;
}

.session-bulk-actions {
  justify-content: flex-end;
  margin-top: 0;
}

.session-bulk-revoke {
  color: var(--danger);
  border-color: color-mix(in srgb, var(--danger) 46%, var(--button-border) 54%);
}

.session-bulk-revoke:hover:not(:disabled) {
  color: var(--danger);
  border-color: var(--danger);
  background: color-mix(in srgb, var(--danger) 10%, var(--surface-2) 90%);
}
</style>
