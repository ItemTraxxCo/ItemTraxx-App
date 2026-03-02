<template>
  <div
    v-if="visible"
    class="onboarding-overlay"
    role="dialog"
    aria-modal="true"
    :aria-label="`ItemTraxx onboarding step ${currentStepIndex + 1} of ${steps.length}`"
  >
    <div class="onboarding-modal">
      <div class="onboarding-header">
        <p class="onboarding-step-label">Step {{ currentStepIndex + 1 }} of {{ steps.length }}</p>
        <button
          ref="closeButtonRef"
          type="button"
          class="onboarding-close"
          aria-label="Close onboarding"
          @click="emitClose"
        >
          ×
        </button>
      </div>

      <h3>{{ currentStep.title }}</h3>
      <p class="muted onboarding-body">{{ currentStep.body }}</p>

      <div class="onboarding-progress" aria-hidden="true">
        <span
          v-for="(_, idx) in steps"
          :key="idx"
          class="onboarding-dot"
          :class="{ active: idx === currentStepIndex }"
        ></span>
      </div>

      <div class="onboarding-actions">
        <button type="button" @click="emitClose">Skip</button>
        <div class="onboarding-nav">
          <button type="button" :disabled="currentStepIndex === 0" @click="goBack">
            Back
          </button>
          <button
            v-if="currentStepIndex < steps.length - 1"
            type="button"
            class="button-primary"
            @click="goNext"
          >
            Next
          </button>
          <button v-else type="button" class="button-primary" @click="emitComplete">
            Finish
          </button>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, nextTick, onMounted, onUnmounted, ref, watch } from "vue";

type OnboardingStep = { title: string; body: string };
type OnboardingVariant = "tenant_checkout" | "tenant_admin";

const props = defineProps<{
  visible: boolean;
  variant: OnboardingVariant;
}>();

const emit = defineEmits<{
  (e: "close"): void;
  (e: "complete"): void;
}>();

const currentStepIndex = ref(0);
const closeButtonRef = ref<HTMLButtonElement | null>(null);
let previousActiveElement: HTMLElement | null = null;

const tenantUserSteps: OnboardingStep[] = [
  {
    title: "Welcome to the checkout page",
    body: "This is your fast lane for checking gear in and out.",
  },
  {
    title: "Scan or enter a student ID",
    body: "Start each transaction by entering the student's ID so ItemTraxx, and you know who is receiving gear.",
  },
  {
    title: "Scan item barcodes",
    body: "Add one or many items to the cart by scanning barcodes or typing them in manually. ItemTraxx supports multi checkout, so you can check out multiple items in a single transaction and also return items at the same time.",
  },
  {
    title: "Submit checkout or return",
    body: "Use the complete transaction button to complete the transaction and immediately update item status and log the transaction. After each transaction, you can download the transaction receipt which includes a summary of the transaction.",
  },
  {
    title: "Need help later?",
    body: "Open the top-right menu any time and select 'Take tour' to replay these steps. If you need help or have questions, contact ItemTraxx support by clicking the menu in the top right and then 'Contact Support'.",
  },
];

const tenantAdminSteps: OnboardingStep[] = [
  {
    title: "Welcome to the admin panel",
    body: "This area gives you control over students, gear, logs, and admin-level operations of your app.",
  },
  {
    title: "Manage students",
    body: "Use the Students page to add, import, and review student information.",
  },
  {
    title: "Track item and activity",
    body: "Use the Items Page and Item Logs Page to monitor inventory and view who has what items.",
  },
  {
    title: "Security and settings",
    body: "Use Settings for device sessions, notification policies, and other security-sensitive controls.",
  },
  {
    title: "Support and replay",
    body: "From the top-right menu, use 'Take tour' to replay onboarding.  If you need help or have questions, contact ItemTraxx support by clicking the menu in the top right and then 'Contact Support'.",
  },
];

const steps = computed(() =>
  props.variant === "tenant_admin" ? tenantAdminSteps : tenantUserSteps
);

const currentStep = computed<OnboardingStep>(
  () =>
    steps.value[currentStepIndex.value] ??
    steps.value[0] ?? { title: "", body: "" }
);

const goBack = () => {
  currentStepIndex.value = Math.max(0, currentStepIndex.value - 1);
};

const goNext = () => {
  currentStepIndex.value = Math.min(steps.value.length - 1, currentStepIndex.value + 1);
};

const emitClose = () => {
  emit("close");
};

const emitComplete = () => {
  emit("complete");
};

const restoreFocus = () => {
  if (previousActiveElement) {
    previousActiveElement.focus();
  }
  previousActiveElement = null;
};

watch(
  () => props.visible,
  async (visible) => {
    if (visible) {
      currentStepIndex.value = 0;
      previousActiveElement = document.activeElement as HTMLElement | null;
      await nextTick();
      closeButtonRef.value?.focus();
      return;
    }
    restoreFocus();
  }
);

watch(
  () => props.variant,
  () => {
    currentStepIndex.value = 0;
  }
);

const handleKeydown = (event: KeyboardEvent) => {
  if (!props.visible) return;
  if (event.key === "Escape") {
    event.preventDefault();
    emitClose();
  }
};

onMounted(() => {
  window.addEventListener("keydown", handleKeydown);
});

onUnmounted(() => {
  window.removeEventListener("keydown", handleKeydown);
});
</script>

<style scoped>
.onboarding-overlay {
  position: fixed;
  inset: 0;
  background: rgba(5, 10, 20, 0.55);
  display: grid;
  place-items: center;
  z-index: 80;
  padding: 1rem;
}

.onboarding-modal {
  width: min(560px, 96vw);
  border-radius: 14px;
  border: 1px solid var(--border);
  background: var(--surface);
  color: var(--text);
  padding: 1rem;
  box-shadow: 0 18px 40px rgba(0, 0, 0, 0.28);
  display: grid;
  gap: 0.8rem;
}

.onboarding-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 0.75rem;
}

.onboarding-step-label {
  margin: 0;
  font-size: 0.82rem;
  font-weight: 700;
  letter-spacing: 0.02em;
  color: var(--muted);
}

.onboarding-close {
  width: 2rem;
  height: 2rem;
  border-radius: 999px;
  border: 1px solid var(--border);
  font-size: 1.1rem;
  line-height: 1;
  padding: 0;
}

.onboarding-body {
  margin-top: -0.15rem;
}

.onboarding-progress {
  display: flex;
  align-items: center;
  gap: 0.4rem;
}

.onboarding-dot {
  width: 0.52rem;
  height: 0.52rem;
  border-radius: 999px;
  background: var(--border);
}

.onboarding-dot.active {
  background: var(--accent);
}

.onboarding-actions {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 0.8rem;
}

.onboarding-nav {
  display: flex;
  align-items: center;
  gap: 0.5rem;
}
</style>
