<template>
  <div
    v-if="toast.visible"
    :key="toast.id"
    class="toast app-toast-outlet"
    :class="`app-toast-outlet--${toast.kind}`"
    :role="toast.kind === 'error' ? 'alert' : 'status'"
    :aria-live="toast.kind === 'error' ? 'assertive' : 'polite'"
    aria-atomic="true"
  >
    <div class="toast-title">{{ toast.title }}</div>
    <div class="toast-body" data-session-replay-mask>{{ toast.message }}</div>
  </div>
</template>

<script setup lang="ts">
import { computed } from "vue";
import { getAppToastState } from "../store/appToast";

const toast = computed(() => getAppToastState());
</script>
