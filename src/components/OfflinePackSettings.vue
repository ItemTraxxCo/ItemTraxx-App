<template>
  <section class="card admin-section-card offline-pack-settings" aria-labelledby="offline-pack-settings-title">
    <div class="admin-section-header">
      <div>
        <h2 id="offline-pack-settings-title">Offline downloads</h2>
        <p class="admin-section-copy">
          Choose when this account downloads its encrypted offline pack on this device.
        </p>
      </div>
    </div>

    <fieldset class="offline-pack-preference-options">
      <legend>Automatic downloads</legend>
      <label
        v-for="option in preferenceOptions"
        :key="option.value"
        class="offline-pack-preference-option"
        :class="{ 'is-selected': preference === option.value }"
      >
        <input
          v-model="preference"
          class="offline-pack-preference-input"
          type="radio"
          name="offline-pack-download-preference"
          :value="option.value"
        />
        <span class="offline-pack-preference-check" aria-hidden="true">
          <svg viewBox="0 0 20 20" focusable="false">
            <path d="m4 10 4 4 8-8" />
          </svg>
        </span>
        <span class="offline-pack-preference-copy">
          <strong>{{ option.title }}</strong>
          <small>{{ option.description }}</small>
        </span>
      </label>
    </fieldset>

    <div class="offline-pack-preference-save">
      <span v-if="hasUnsavedPreference" class="offline-pack-preference-status" role="status" aria-live="polite">
        Unsaved changes
      </span>
      <span v-else-if="preferenceFeedback" class="offline-pack-preference-status" role="status" aria-live="polite" v-app-toast-message>
        {{ preferenceFeedback }}
      </span>
      <button
        type="button"
        class="button-primary offline-pack-preference-save-button"
        :disabled="!hasUnsavedPreference"
        @click="savePreference"
      >
        Save preference
      </button>
    </div>

    <div class="offline-pack-settings-actions">
      <button type="button" class="button-primary" :disabled="isDownloading" @click="downloadNow">
        {{ isDownloading ? "Preparing offline pack…" : "Download offline pack now" }}
      </button>
      <span v-if="packSummary" class="muted">{{ packSummary }}</span>
    </div>
    <p v-if="error" class="error" role="alert" v-app-toast-error>{{ error }}</p>
    <p v-if="success" class="success" role="status" v-app-toast-message>{{ success }}</p>
  </section>
</template>

<script setup lang="ts">
import { computed, onMounted, onScopeDispose, ref, watch } from "vue";
import { toUserFacingErrorMessage } from "../services/appErrors";
import {
  getOfflineWorkflowSummary,
  OfflinePackDownloadCancelledError,
  prepareOfflineCheckoutPack,
} from "../services/offlineCheckoutWorkflow";
import {
  getOfflinePackDownloadPreference,
  setOfflinePackDownloadPreference,
  type OfflinePackDownloadPreference,
} from "../services/offlineCheckoutPreferences";
import { getAuthState } from "../store/authState";

const auth = getAuthState();
const preference = ref<OfflinePackDownloadPreference>("ask");
const savedPreference = ref<OfflinePackDownloadPreference>("ask");
const preferenceFeedback = ref("");
const isDownloading = ref(false);
const error = ref("");
const success = ref("");
const summary = ref<Awaited<ReturnType<typeof getOfflineWorkflowSummary>> | null>(null);
let activeScopeKey = "";

const preferenceOptions: {
  value: OfflinePackDownloadPreference;
  title: string;
  description: string;
}[] = [
  {
    value: "manual",
    title: "Only when I start a download",
    description: "Offline packs will not download automatically.",
  },
  {
    value: "ask",
    title: "Ask me at each sign-in",
    description: "If you do not choose in the prompt, the pack will not download.",
  },
  {
    value: "always",
    title: "Always download at sign-in",
    description: "Large packs still ask you to confirm before downloading.",
  },
];

const hasUnsavedPreference = computed(() => preference.value !== savedPreference.value);

const packSummary = computed(() => {
  const pack = summary.value?.pack;
  if (!pack) return "No offline pack is stored on this device.";
  if (summary.value?.packExpired) return "The stored offline pack has expired.";
  return `Ready until ${new Date(pack.expires_at).toLocaleString()} · ${pack.items.length.toLocaleString()} items · ${pack.borrowers.length.toLocaleString()} borrowers`;
});

const loadAccountSettings = async () => {
  if (!auth.workspaceContextId || !auth.userId) return;
  const nextScopeKey = `${auth.workspaceContextId}:${auth.userId}`;
  if (nextScopeKey !== activeScopeKey) {
    activeScopeKey = nextScopeKey;
    const currentPreference = getOfflinePackDownloadPreference({
      workspaceId: auth.workspaceContextId,
      profileId: auth.userId,
    });
    preference.value = currentPreference;
    savedPreference.value = currentPreference;
    preferenceFeedback.value = "";
  }
  summary.value = await getOfflineWorkflowSummary();
};

const savePreference = () => {
  if (!auth.workspaceContextId || !auth.userId || !hasUnsavedPreference.value) return;
  setOfflinePackDownloadPreference(
    { workspaceId: auth.workspaceContextId, profileId: auth.userId },
    preference.value,
  );
  savedPreference.value = preference.value;
  preferenceFeedback.value = "Preference saved on this device.";
};

watch(preference, () => { preferenceFeedback.value = ""; });

const downloadNow = async () => {
  if (isDownloading.value) return;
  isDownloading.value = true;
  error.value = "";
  success.value = "";
  try {
    const pack = await prepareOfflineCheckoutPack();
    success.value = `Offline pack ready: ${pack.items.length.toLocaleString()} items and ${pack.borrowers.length.toLocaleString()} borrowers.`;
    await loadAccountSettings();
  } catch (cause) {
    if (!(cause instanceof OfflinePackDownloadCancelledError)) {
      error.value = toUserFacingErrorMessage(cause, "Unable to prepare an offline pack.");
    }
  } finally {
    isDownloading.value = false;
  }
};

watch(
  () => [auth.workspaceContextId, auth.userId] as const,
  () => void loadAccountSettings(),
);

onMounted(() => {
  void loadAccountSettings();
  window.addEventListener("itemtraxx:offline-workflow-changed", loadAccountSettings);
});

onScopeDispose(() => {
  window.removeEventListener("itemtraxx:offline-workflow-changed", loadAccountSettings);
});
</script>

<style scoped>
.offline-pack-preference-options {
  display: grid;
  gap: 0.45rem;
  width: 100%;
  max-width: 680px;
  margin: 0;
  padding: 0;
  border: 0;
}
.offline-pack-preference-options legend {
  margin-bottom: 0.2rem;
  font-weight: 650;
  font-size: 0.9rem;
}
.offline-pack-preference-option {
  position: relative;
  display: grid;
  grid-template-columns: 1.1rem minmax(0, 1fr);
  align-items: center;
  gap: 0.65rem;
  min-width: 0;
  padding: 0.58rem 0.7rem;
  border: 1px solid var(--border);
  border-radius: 10px;
  background: var(--surface);
  cursor: pointer;
  transition: border-color 0.16s ease, background-color 0.16s ease;
}
.offline-pack-preference-option:hover {
  border-color: color-mix(in srgb, var(--accent) 42%, var(--border));
}
.offline-pack-preference-option.is-selected {
  border-color: color-mix(in srgb, var(--accent) 48%, var(--border));
  background: color-mix(in srgb, var(--surface-2) 86%, var(--accent) 14%);
}
.offline-pack-preference-input {
  position: absolute;
  width: 1px;
  height: 1px;
  padding: 0;
  margin: -1px;
  overflow: hidden;
  clip: rect(0, 0, 0, 0);
  white-space: nowrap;
  border: 0;
}
.offline-pack-preference-input:focus-visible + .offline-pack-preference-check {
  outline: 2px solid var(--focus-ring);
  outline-offset: 3px;
}
.offline-pack-preference-check {
  display: grid;
  place-items: center;
  width: 1.05rem;
  height: 1.05rem;
  border: 1px solid var(--border);
  border-radius: 4px;
  background: var(--surface);
  color: transparent;
  transition: background-color 0.16s ease, border-color 0.16s ease, color 0.16s ease;
}
.offline-pack-preference-check svg {
  width: 0.78rem;
  height: 0.78rem;
  fill: none;
  stroke: currentColor;
  stroke-width: 2.4;
  stroke-linecap: round;
  stroke-linejoin: round;
}
.offline-pack-preference-option.is-selected .offline-pack-preference-check {
  border-color: var(--accent);
  background: var(--accent);
  color: var(--button-primary-text);
}
.offline-pack-preference-copy { display: grid; gap: 0.08rem; }
.offline-pack-preference-copy strong { font-size: 0.88rem; line-height: 1.3; }
.offline-pack-preference-copy small { color: var(--muted); font-size: 0.78rem; line-height: 1.35; }
.offline-pack-preference-save {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 0.75rem;
  width: 100%;
  max-width: 680px;
  min-height: 2.35rem;
  margin-top: -0.45rem;
}
.offline-pack-preference-status { color: var(--muted); font-size: 0.8rem; }
.offline-pack-preference-save-button { min-height: 2.15rem; margin-left: auto; padding: 0.3rem 0.75rem; font-size: 0.86rem; }
.offline-pack-settings-actions {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 0.75rem;
  margin-top: 1rem;
}

@media (max-width: 520px) {
  .offline-pack-preference-save { align-items: flex-start; }
}
</style>
