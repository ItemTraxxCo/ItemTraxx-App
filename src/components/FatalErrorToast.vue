<template>
  <div v-if="toast.visible" class="toast toast-persist">
    <div class="toast-title">{{ toast.title }}</div>
    <div class="toast-body">{{ toast.message }}</div>
    <div class="toast-body fatal-error-reason">{{ toast.reason }}</div>
    <div v-if="toast.sendError" class="toast-body fatal-error-send">{{ toast.sendError }}</div>
    <div v-else-if="toast.sent" class="toast-body fatal-error-send">Report sent to ItemTraxx.</div>
    <div class="toast-actions">
      <button
        type="button"
        class="toast-action-button"
        :disabled="toast.isSending || toast.sent"
        @click="sendReport"
      >
        {{ toast.sent ? "Report sent" : toast.isSending ? "Sending..." : "Send error to ItemTraxx" }}
      </button>
      <button type="button" class="toast-action-button" @click="dismiss">
        Dismiss
      </button>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed } from "vue";
import {
  dismissFatalErrorToast,
  getFatalErrorToastState,
  sendFatalErrorToastReport,
} from "../store/fatalErrorToast";

const toast = computed(() => getFatalErrorToastState());

const dismiss = () => {
  dismissFatalErrorToast();
};

const sendReport = async () => {
  await sendFatalErrorToastReport();
};
</script>

<style scoped>
.fatal-error-reason {
  margin-top: 0.35rem;
  opacity: 0.86;
}

.fatal-error-send {
  margin-top: 0.35rem;
  font-size: 0.82rem;
}
</style>
