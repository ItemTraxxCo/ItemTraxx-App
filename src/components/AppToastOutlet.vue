<template>
  <div v-if="toast.visible" :key="toast.id" class="toast app-toast-outlet" role="alert" aria-live="assertive">
    <div class="toast-title">{{ toast.title }}</div>
    <div class="toast-body" data-session-replay-mask>{{ toast.message }}</div>
  </div>
</template>

<script setup lang="ts">
import { computed } from "vue";
import { getAppToastState } from "../store/appToast";

const toast = computed(() => getAppToastState());
</script>
