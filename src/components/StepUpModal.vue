<template>
  <div v-if="visible" class="stepup-overlay" @click.self="$emit('cancel')">
    <div class="stepup-modal">
      <h3>{{ title }}</h3>
      <p class="muted">{{ message }}</p>
      <label>
        Confirm phrase
        <input
          v-model="confirmPhrase"
          type="text"
          placeholder="Type CONFIRM"
          autocomplete="off"
        />
      </label>
      <label>
        Super Admin Password
        <input
          v-model="superPassword"
          type="password"
          placeholder="Enter super admin password"
          autocomplete="off"
        />
      </label>
      <div class="actions">
        <button type="button" @click="$emit('cancel')">Cancel</button>
        <button
          type="button"
          class="button-primary"
          :disabled="!canConfirm"
          @click="submit"
        >
          {{ confirmLabel }}
        </button>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, ref, watch } from "vue";

const props = defineProps<{
  visible: boolean;
  title: string;
  message: string;
  confirmLabel?: string;
}>();

const emit = defineEmits<{
  (e: "cancel"): void;
  (e: "confirm", payload: { superPassword: string; confirmPhrase: string }): void;
}>();

const confirmPhrase = ref("");
const superPassword = ref("");

watch(
  () => props.visible,
  (value) => {
    if (value) {
      confirmPhrase.value = "";
      superPassword.value = "";
    }
  }
);

const canConfirm = computed(
  () => confirmPhrase.value.trim() === "CONFIRM" && superPassword.value.trim().length > 0
);

const submit = () => {
  if (!canConfirm.value) return;
  emit("confirm", {
    superPassword: superPassword.value,
    confirmPhrase: confirmPhrase.value.trim(),
  });
};
</script>

<style scoped>
.stepup-overlay {
  position: fixed;
  inset: 0;
  background: rgba(5, 10, 20, 0.48);
  display: grid;
  place-items: center;
  z-index: 60;
}

.stepup-modal {
  width: min(480px, 92vw);
  background: var(--surface);
  color: var(--text);
  border: 1px solid var(--border);
  border-radius: 12px;
  padding: 1rem;
  display: grid;
  gap: 0.75rem;
  box-shadow: 0 14px 32px rgba(0, 0, 0, 0.22);
}

.actions {
  display: flex;
  gap: 0.5rem;
  justify-content: flex-end;
}
</style>
