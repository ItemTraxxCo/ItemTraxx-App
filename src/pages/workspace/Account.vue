<template>
  <main class="page">
    <header>
      <h1>My Account</h1>
      <nav>
        <RouterLink to="/checkout">Checkout</RouterLink> ·
        <RouterLink to="/items">Items</RouterLink> ·
        <RouterLink to="/borrowers">Borrowers</RouterLink> ·
        <RouterLink to="/settings">Settings</RouterLink>
      </nav>
    </header>

    <section>
      <h2>Borrowers</h2>
      <p v-if="borrowersLoading">Loading…</p>
      <p v-else-if="borrowersError" class="error">{{ borrowersError }}</p>
      <template v-else>
        <table>
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
          </tbody>
        </table>
        <div class="account-pagination">
          <button type="button" :disabled="borrowerPage === 0" @click="borrowerPage--">‹ Previous 20</button>
          <span>{{ borrowerPageLabel }}</span>
          <button type="button" :disabled="!hasMoreBorrowers" @click="borrowerPage++">Next 20 ›</button>
        </div>
      </template>
    </section>

    <section>
      <h2>Items</h2>
      <p v-if="itemsLoading">Loading…</p>
      <p v-else-if="itemsError" class="error">{{ itemsError }}</p>
      <template v-else>
        <table>
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
          </tbody>
        </table>
        <div class="account-pagination">
          <button type="button" :disabled="itemPage === 0" @click="itemPage--">‹ Previous 20</button>
          <span>{{ itemPageLabel }}</span>
          <button type="button" :disabled="!hasMoreItems" @click="itemPage++">Next 20 ›</button>
        </div>
      </template>
    </section>

    <section>
      <h2>Signed-in devices</h2>
      <button type="button" @click="loadSessions">Refresh</button>
      <ul>
        <li v-for="session in sessions" :key="session.id">
          <strong>{{ session.device_label || "Unknown device" }}</strong>
          — last used {{ new Date(session.last_seen_at).toLocaleString() }}
          <span v-if="session.is_current">(current)</span>
          <button type="button" @click="revokeSession(session.id)">Revoke</button>
        </li>
      </ul>
    </section>
  </main>
</template>

<script setup lang="ts">
import { computed, onMounted, ref } from "vue";
import { RouterLink } from "vue-router";
import { authenticatedSelect } from "../../services/authenticatedDataClient";
import {
  listAccountSessions,
  revokeAccountSession,
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
  sessions.value = (await listAccountSessions()).sessions;
};

const revokeSession = async (id: string) => {
  await revokeAccountSession(id);
  await loadSessions();
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
