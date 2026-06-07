<template>
  <div
    class="skeleton-loader"
    :class="`skeleton-loader-${variant}`"
    role="status"
    aria-live="polite"
    :aria-label="label"
  >
    <span class="sr-only">{{ label }}</span>

    <template v-if="variant === 'table'">
      <div class="skeleton-table">
        <div
          v-for="rowIndex in rows"
          :key="`skeleton-table-row-${rowIndex}`"
          class="skeleton-table-row"
          :style="{ gridTemplateColumns: tableTemplateColumns }"
        >
          <span
            v-for="columnIndex in columns"
            :key="`skeleton-table-cell-${rowIndex}-${columnIndex}`"
            class="skeleton-line"
            :class="{ 'skeleton-line-short': columnIndex === columns }"
          ></span>
        </div>
      </div>
    </template>

    <template v-else-if="variant === 'card'">
      <div v-for="rowIndex in rows" :key="`skeleton-card-${rowIndex}`" class="skeleton-card">
        <span class="skeleton-line skeleton-line-title"></span>
        <span class="skeleton-line"></span>
        <span class="skeleton-line skeleton-line-short"></span>
      </div>
    </template>

    <template v-else>
      <span
        v-for="rowIndex in rows"
        :key="`skeleton-line-${rowIndex}`"
        class="skeleton-line"
        :class="{ 'skeleton-line-short': rowIndex === rows }"
      ></span>
    </template>
  </div>
</template>

<script setup lang="ts">
import { computed } from "vue";

const props = withDefaults(
  defineProps<{
    variant?: "lines" | "table" | "card";
    rows?: number;
    columns?: number;
    label?: string;
  }>(),
  {
    variant: "lines",
    rows: 3,
    columns: 4,
    label: "Loading content",
  }
);

const tableTemplateColumns = computed(() => `repeat(${props.columns}, minmax(7rem, 1fr))`);
</script>
