<template>
  <div v-if="visible" class="toast toast-persist toast-bottom-left" :title="tooltip" role="status" aria-live="polite">
    <div class="toast-title">{{ title }}</div>
    <div class="toast-body">{{ message }}</div>
  </div>
</template>

<script setup lang="ts">
import { computed, onScopeDispose, ref, watch } from "vue";

const props = defineProps<{
  enabled: boolean;
  count: number;
  syncingCount: number;
  reviewCount: number;
  tooltip: string;
}>();

const completedCount = ref(0);
let completionTimer: number | null = null;
const visible = computed(() => props.enabled && (props.count > 0 || completedCount.value > 0));
const title = computed(() => {
  if (props.syncingCount > 0) return "Syncing offline queue";
  if (props.reviewCount > 0) return "Offline queue needs review";
  if (completedCount.value > 0) return "Offline queue synced";
  return "Offline Queue";
});
const message = computed(() => {
  if (props.syncingCount > 0) return `Syncing ${props.syncingCount} transaction${props.syncingCount === 1 ? "" : "s"} to ItemTraxx Servers.`;
  if (props.reviewCount > 0) {
    const pendingCount = Math.max(props.count - props.reviewCount, 0);
    const reviewMessage = `${props.reviewCount} transaction${props.reviewCount === 1 ? "" : "s"} need review before they can be replayed. Re-enter the work manually if it is still needed.`;
    return pendingCount > 0 ? `${reviewMessage} ${pendingCount} other transaction${pendingCount === 1 ? "" : "s"} remain waiting to sync.` : reviewMessage;
  }
  if (completedCount.value > 0) return `${completedCount.value} transaction${completedCount.value === 1 ? "" : "s"} synced to ItemTraxx Servers.`;
  return `${props.count} transaction${props.count === 1 ? "" : "s"} waiting to sync.`;
});

watch(() => props.syncingCount, (syncing, previousSyncing) => {
  if (syncing > 0) {
    if (completionTimer) window.clearTimeout(completionTimer);
    completedCount.value = 0;
    return;
  }
  if (previousSyncing > 0 && props.count === 0) {
    completedCount.value = previousSyncing;
    if (completionTimer) window.clearTimeout(completionTimer);
    completionTimer = window.setTimeout(() => { completedCount.value = 0; }, 6_000);
  }
});

watch(() => props.enabled, (enabled) => {
  if (enabled) return;
  completedCount.value = 0;
  if (completionTimer) window.clearTimeout(completionTimer);
  completionTimer = null;
});

onScopeDispose(() => {
  if (completionTimer) window.clearTimeout(completionTimer);
});
</script>
