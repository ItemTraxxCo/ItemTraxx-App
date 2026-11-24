<template>
  <main class="page">
    <header>
      <h1>Borrowers</h1>
    </header>

    <label v-if="encryptedMode" for="borrower-search">Search borrowers</label>
    <input v-if="encryptedMode" id="borrower-search" v-model="search" type="search" autocomplete="off" />
    <p v-if="loading">Loading…</p>
    <p v-else-if="error" class="error" v-app-toast-error>{{ error }}</p>
    <template v-else>
      <table>
        <thead>
          <tr><th>Name</th><th>Borrower ID</th></tr>
        </thead>
        <tbody>
          <tr v-for="borrower in borrowers" :key="borrower.id">
            <td data-session-replay-mask>{{ borrower.username }}</td>
            <td data-session-replay-mask>{{ borrower.borrower_id }}</td>
          </tr>
          <tr v-if="!borrowers.length"><td colspan="2">No borrowers found.</td></tr>
        </tbody>
      </table>
      <div class="account-pagination">
        <button type="button" :disabled="page === 0 || loading" @click="goToPage(-1)">‹ Previous 20</button>
        <span>{{ pageLabel }}</span>
        <button type="button" :disabled="!hasMore || loading" @click="goToPage(1)">Next 20 ›</button>
      </div>
    </template>
  </main>
</template>

<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref, watch } from "vue";
import { fetchBorrowerPage, fetchSortedBorrowers, isEncryptedBorrowerDirectoryEnabled, type BorrowerItem } from "../../services/borrowerService";
import { getAuthState } from "../../store/authState";

const PAGE_SIZE = 20;
type Row = Pick<BorrowerItem, "id" | "username" | "borrower_id">;

const borrowers = ref<Row[]>([]);
const page = ref(0);
const hasMore = ref(false);
const loading = ref(true);
const error = ref("");
const encryptedMode = isEncryptedBorrowerDirectoryEnabled();
const search = ref("");
const decryptedRows = ref<Row[] | null>(null);
const auth = getAuthState();
let requestVersion = 0;

const pageLabel = computed(() => {
  if (!borrowers.value.length) return "No borrowers";
  const start = page.value * PAGE_SIZE + 1;
  const end = start + borrowers.value.length - 1;
  return `${start}–${end}${hasMore.value ? "+" : ""}`;
});

const load = async (requestedPage = page.value) => {
  loading.value = true;
  error.value = "";
  const version = ++requestVersion;
  try {
    let result: { rows: Row[]; hasMore: boolean };
    if (encryptedMode) {
      const rows = decryptedRows.value ?? await fetchSortedBorrowers();
      if (version !== requestVersion) return;
      decryptedRows.value = rows;
      const needle = search.value.trim().toLowerCase();
      const filtered = needle ? rows.filter((row) => `${row.username} ${row.borrower_id}`.toLowerCase().includes(needle)) : rows;
      const start = requestedPage * PAGE_SIZE;
      result = { rows: filtered.slice(start, start + PAGE_SIZE), hasMore: start + PAGE_SIZE < filtered.length };
    } else {
      result = await fetchBorrowerPage(requestedPage, PAGE_SIZE, "username.asc");
    }
    if (version !== requestVersion || requestedPage !== page.value) return;
    borrowers.value = result.rows;
    hasMore.value = result.hasMore;
  } catch {
    if (version !== requestVersion || requestedPage !== page.value) return;
    decryptedRows.value = null;
    borrowers.value = [];
    error.value = "Unable to load borrowers.";
  } finally {
    if (version === requestVersion && requestedPage === page.value) loading.value = false;
  }
};

const goToPage = (delta: number) => {
  const nextPage = page.value + delta;
  if (nextPage < 0 || (delta > 0 && !hasMore.value) || loading.value) return;
  page.value = nextPage;
};

onMounted(() => void load());
watch(page, (nextPage, previousPage) => {
  if (nextPage !== previousPage && auth.isAuthenticated && auth.workspaceContextId) void load(nextPage);
});
watch(search, () => {
  if (!auth.isAuthenticated || !auth.workspaceContextId) return;
  if (page.value !== 0) page.value = 0;
  else void load(0);
});
watch(() => [auth.userId, auth.workspaceContextId, auth.isAuthenticated], () => {
  requestVersion++;
  decryptedRows.value = null;
  borrowers.value = [];
  search.value = "";
  hasMore.value = false;
  if (!auth.isAuthenticated || !auth.workspaceContextId) { loading.value = false; return; }
  if (page.value !== 0) page.value = 0;
  else void load(0);
});
onUnmounted(() => { requestVersion++; decryptedRows.value = null; borrowers.value = []; });
</script>
