<template>
  <main class="page">
    <header>
      <h1>Borrowers</h1>
      <nav>
        <RouterLink to="/checkout">Checkout</RouterLink> ·
        <RouterLink to="/items">Items</RouterLink> ·
        <RouterLink to="/settings">Settings</RouterLink>
      </nav>
    </header>

    <p v-if="loading">Loading…</p>
    <p v-else-if="error" class="error">{{ error }}</p>
    <template v-else>
      <table>
        <thead>
          <tr><th>Name</th><th>Borrower ID</th></tr>
        </thead>
        <tbody>
          <tr v-for="borrower in borrowers" :key="borrower.id">
            <td>{{ borrower.username }}</td>
            <td>{{ borrower.borrower_id }}</td>
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
import { computed, onMounted, ref, watch } from "vue";
import { RouterLink } from "vue-router";
import { fetchBorrowerPage, type BorrowerItem } from "../../services/borrowerService";

const PAGE_SIZE = 20;
type Row = Pick<BorrowerItem, "id" | "username" | "borrower_id">;

const borrowers = ref<Row[]>([]);
const page = ref(0);
const hasMore = ref(false);
const loading = ref(true);
const error = ref("");

const pageLabel = computed(() => {
  if (!borrowers.value.length) return "No borrowers";
  const start = page.value * PAGE_SIZE + 1;
  const end = start + borrowers.value.length - 1;
  return `${start}–${end}${hasMore.value ? "+" : ""}`;
});

const load = async (requestedPage = page.value) => {
  loading.value = true;
  error.value = "";
  try {
    const result = await fetchBorrowerPage(requestedPage, PAGE_SIZE, "username.asc");
    if (requestedPage !== page.value) return;
    borrowers.value = result.rows;
    hasMore.value = result.hasMore;
  } catch {
    if (requestedPage !== page.value) return;
    error.value = "Unable to load borrowers.";
  } finally {
    if (requestedPage === page.value) loading.value = false;
  }
};

const goToPage = (delta: number) => {
  const nextPage = page.value + delta;
  if (nextPage < 0 || (delta > 0 && !hasMore.value) || loading.value) return;
  page.value = nextPage;
};

onMounted(() => void load());
watch(page, (nextPage, previousPage) => {
  if (nextPage !== previousPage) void load(nextPage);
});
</script>
