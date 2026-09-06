<template>
  <main class="page">
    <header>
      <h1>Items</h1>
      <nav>
        <RouterLink to="/checkout">Checkout</RouterLink> ·
        <RouterLink to="/borrowers">Borrowers</RouterLink> ·
        <RouterLink to="/settings">Settings</RouterLink>
      </nav>
    </header>

    <p v-if="loading">Loading…</p>
    <p v-else-if="error" class="error">{{ error }}</p>
    <template v-else>
      <table>
        <thead>
          <tr><th>Name</th><th>Barcode</th><th>Status</th></tr>
        </thead>
        <tbody>
          <tr v-for="item in items" :key="item.id">
            <td>{{ item.name }}</td>
            <td>{{ item.barcode }}</td>
            <td>{{ item.status }}</td>
          </tr>
          <tr v-if="!items.length"><td colspan="3">No items found.</td></tr>
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
import { fetchItemPage, type ItemRecord } from "../../services/itemService";

const PAGE_SIZE = 20;
type Row = Pick<ItemRecord, "id" | "name" | "barcode" | "status">;

const items = ref<Row[]>([]);
const page = ref(0);
const hasMore = ref(false);
const loading = ref(true);
const error = ref("");

const pageLabel = computed(() => {
  if (!items.value.length) return "No items";
  const start = page.value * PAGE_SIZE + 1;
  const end = start + items.value.length - 1;
  return `${start}–${end}${hasMore.value ? "+" : ""}`;
});

const load = async (requestedPage = page.value) => {
  loading.value = true;
  error.value = "";
  try {
    const result = await fetchItemPage(requestedPage, PAGE_SIZE, "name.asc");
    if (requestedPage !== page.value) return;
    items.value = result.rows;
    hasMore.value = result.hasMore;
  } catch {
    if (requestedPage !== page.value) return;
    error.value = "Unable to load items.";
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
