<template>
  <div
    class="skeleton-loader"
    :class="`skeleton-loader-${variant}`"
    role="status"
    aria-live="polite"
    aria-busy="true"
    :aria-label="label"
  >
    <span class="sr-only">{{ label }}</span>

    <template v-if="variant === 'table'">
      <div class="skeleton-table">
        <div
          class="skeleton-table-row skeleton-table-header"
          :style="{ gridTemplateColumns: tableTemplateColumns }"
          aria-hidden="true"
        >
          <span
            v-for="columnIndex in columns"
            :key="`skeleton-table-header-${columnIndex}`"
            class="skeleton-line skeleton-line-header"
            :style="tableBoneStyle(0, columnIndex)"
          ></span>
        </div>
        <div
          v-for="rowIndex in rows"
          :key="`skeleton-table-row-${rowIndex}`"
          class="skeleton-table-row"
          :style="{ gridTemplateColumns: tableTemplateColumns }"
          aria-hidden="true"
        >
          <div
            v-for="columnIndex in columns"
            :key="`skeleton-table-cell-${rowIndex}-${columnIndex}`"
            class="skeleton-table-cell"
          >
            <span
              class="skeleton-line"
              :class="{
                'skeleton-line-action': actionColumn && columnIndex === columns,
                'skeleton-line-short': !actionColumn && columnIndex === columns,
              }"
              :style="tableBoneStyle(rowIndex, columnIndex)"
            ></span>
          </div>
        </div>
      </div>
    </template>

    <template v-else-if="variant === 'card'">
      <div
        v-for="rowIndex in rows"
        :key="`skeleton-card-${rowIndex}`"
        class="skeleton-card"
        aria-hidden="true"
      >
        <div class="skeleton-card-heading">
          <span class="skeleton-avatar"></span>
          <span class="skeleton-line skeleton-line-title"></span>
        </div>
        <span class="skeleton-line"></span>
        <span class="skeleton-line skeleton-line-short"></span>
      </div>
    </template>

    <template v-else>
      <span
        v-for="rowIndex in rows"
        :key="`skeleton-line-${rowIndex}`"
        class="skeleton-line"
        :class="{
          'skeleton-line-title': rowIndex === 1 && rows > 1,
          'skeleton-line-short': rowIndex === rows,
        }"
        :style="lineStyle(rowIndex)"
        aria-hidden="true"
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
    actionColumn?: boolean;
    label?: string;
  }>(),
  {
    variant: "lines",
    rows: 3,
    columns: 4,
    actionColumn: false,
    label: "Loading content",
  }
);

const tableTemplateColumns = computed(() => `repeat(${props.columns}, minmax(0, 1fr))`);

const tableColumnBaselines = computed(() => {
  const presets: Record<number, number[]> = {
    3: [84, 68, 48],
    4: [82, 68, 78, 46],
    5: [72, 56, 72, 80, 78],
  };

  return presets[props.columns] ?? Array.from({ length: props.columns }, (_, index) =>
    index === props.columns - 1 ? 56 : 76
  );
});

const tableCellWidth = (rowIndex: number, columnIndex: number) => {
  const baseline = tableColumnBaselines.value[columnIndex - 1] ?? 72;
  if (rowIndex === 0) {
    return `${Math.max(34, baseline - 18)}%`;
  }

  // A small, deterministic variation keeps the bones from looking stamped out
  // while preserving the proportions of the eventual table content.
  const variation = ((rowIndex * 13 + columnIndex * 7) % 13) - 6;
  return `${Math.max(32, Math.min(94, baseline + variation))}%`;
};

const tableBoneStyle = (rowIndex: number, columnIndex: number) => ({
  width:
    rowIndex > 0 && props.actionColumn && columnIndex === props.columns
      ? "var(--skeleton-action-width, 4.5rem)"
      : tableCellWidth(rowIndex, columnIndex),
  "--skeleton-delay": `${rowIndex * 65 + columnIndex * 18}ms`,
});

const lineStyle = (rowIndex: number) => ({
  "--skeleton-delay": `${rowIndex * 70}ms`,
});
</script>
