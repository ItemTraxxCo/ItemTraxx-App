<template>
  <div v-if="count > 0" class="toast toast-persist toast-bottom-left" :title="tooltip">
    <div class="toast-title">Offline Queue</div>
    <div class="toast-body">{{ count }} checkout{{ count === 1 ? "" : "s" }} waiting to sync.</div>
  </div>
</template>

<script setup lang="ts">
defineProps<{
  count: number;
  tooltip: string;
}>();
</script>
