<template>
  <fieldset class="access-picker">
    <legend>Tenant Account access</legend>
    <div class="access-mode-toggle" role="group" aria-label="Tenant account access mode">
      <button
        type="button"
        class="access-mode-option"
        :class="{ active: accessMode === 'all' }"
        :aria-pressed="accessMode === 'all'"
        @click="setMode('all')"
      >
        All Tenant Accounts
      </button>
      <button
        type="button"
        class="access-mode-option"
        :class="{ active: accessMode === 'restricted' }"
        :aria-pressed="accessMode === 'restricted'"
        @click="setMode('restricted')"
      >
        Specific Tenant Accounts
      </button>
    </div>

    <div v-if="accessMode === 'restricted'" class="access-chip-list">
      <p v-if="accounts.length === 0" class="muted access-chip-empty">No tenant accounts available.</p>
      <button
        v-for="account in accounts"
        :key="account.id"
        type="button"
        class="access-chip"
        :class="{ selected: selectedIds.includes(account.id) }"
        :aria-pressed="selectedIds.includes(account.id)"
        @click="toggleAccount(account.id)"
      >
        <span class="access-chip-check" aria-hidden="true"></span>
        {{ account.auth_email }}
      </button>
    </div>
  </fieldset>
</template>

<script setup lang="ts">
const props = defineProps<{
  accessMode: "" | "all" | "restricted";
  selectedIds: string[];
  accounts: Array<{ id: string; auth_email: string }>;
}>();

const emit = defineEmits<{
  "update:accessMode": ["" | "all" | "restricted"];
  "update:selectedIds": [string[]];
}>();

const setMode = (mode: "all" | "restricted") => {
  emit("update:accessMode", mode);
  if (mode === "all") emit("update:selectedIds", []);
};

const toggleAccount = (id: string) => {
  const next = props.selectedIds.includes(id)
    ? props.selectedIds.filter((existing) => existing !== id)
    : [...props.selectedIds, id];
  emit("update:selectedIds", next);
};
</script>

<style scoped>
.access-picker {
  border: 1px solid var(--border);
  border-radius: 12px;
  padding: 0.9rem 1rem 1rem;
}

.access-picker legend {
  font-weight: 600;
  padding: 0 0.3rem;
}

.access-mode-toggle {
  display: flex;
  gap: 0.5rem;
  flex-wrap: wrap;
}

.access-mode-option {
  border: 1px solid var(--border);
  border-radius: 999px;
  padding: 0.4rem 0.9rem;
  font-size: 0.85rem;
  font-weight: 600;
  background: var(--surface-2);
  color: var(--muted);
}

.access-mode-option.active {
  background: var(--accent);
  border-color: var(--accent);
  color: #fff;
}

.access-chip-list {
  display: flex;
  flex-wrap: wrap;
  gap: 0.5rem;
  margin-top: 0.85rem;
}

.access-chip-empty {
  margin: 0;
}

.access-chip {
  display: inline-flex;
  align-items: center;
  gap: 0.4rem;
  border: 1px solid var(--border);
  border-radius: 999px;
  padding: 0.32rem 0.75rem 0.32rem 0.55rem;
  font-size: 0.82rem;
  background: var(--surface);
}

.access-chip-check {
  width: 0.85rem;
  height: 0.85rem;
  border-radius: 999px;
  border: 1px solid var(--border);
  background: transparent;
  flex-shrink: 0;
}

.access-chip.selected {
  border-color: var(--accent);
  background: color-mix(in srgb, var(--accent) 14%, transparent);
}

.access-chip.selected .access-chip-check {
  background: var(--accent);
  border-color: var(--accent);
}
</style>
