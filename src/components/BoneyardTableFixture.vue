<template>
  <div class="table-wrap" aria-hidden="true">
    <table class="table">
      <thead>
        <tr>
          <th v-for="header in headers" :key="header">{{ header }}</th>
        </tr>
      </thead>
      <tbody>
        <tr v-for="rowIndex in rows" :key="`boneyard-fixture-row-${rowIndex}`">
          <td v-for="(header, columnIndex) in headers" :key="`${header}-${columnIndex}`">
            <button
              v-if="actionColumn && columnIndex === headers.length - 1"
              type="button"
              tabindex="-1"
            >
              Details
            </button>
            <span v-else>{{ fixtureValue(columnIndex, rowIndex) }}</span>
          </td>
        </tr>
      </tbody>
    </table>
  </div>
</template>

<script setup lang="ts">
withDefaults(
  defineProps<{
    headers: string[];
    rows?: number;
    actionColumn?: boolean;
  }>(),
  {
    rows: 6,
    actionColumn: false,
  }
);

const fixtureValues = [
  ["Morgan Ellis", "BR-0142", "All", "Details", "2026-08-22 09:14"],
  ["Jordan Lee", "BR-0189", "team@north.example", "Details", "2026-08-22 09:06"],
  ["Sam Rivera", "BR-0217", "All", "Details", "2026-08-22 08:48"],
  ["Taylor Brooks", "BR-0244", "No tenant accounts", "Details", "2026-08-21 16:33"],
  ["Avery Chen", "BR-0291", "All", "Details", "2026-08-21 15:57"],
  ["Casey Patel", "BR-0310", "library@example.com", "Details", "2026-08-21 15:21"],
] as const;

const fixtureValue = (columnIndex: number, rowIndex: number) =>
  fixtureValues[(rowIndex - 1) % fixtureValues.length]?.[columnIndex] ?? "Sample value";
</script>
