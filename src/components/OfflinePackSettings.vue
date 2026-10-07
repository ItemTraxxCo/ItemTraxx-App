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

    <fieldset class="offline-pack-preference-options" :disabled="isSaving">
      <legend>Automatic downloads</legend>
      <label>
        <input v-model="preference" type="radio" value="manual" @change="savePreference" />
        <span>
          <strong>Only when I start a download</strong>
          <small>Offline packs will not download automatically.</small>
        </span>
      </label>
      <label>
        <input v-model="preference" type="radio" value="ask" @change="savePreference" />
        <span>
          <strong>Ask me at each sign-in</strong>
          <small>If you do not choose in the prompt, the pack will not download.</small>
        </span>
      </label>
      <label>
        <input v-model="preference" type="radio" value="always" @change="savePreference" />
        <span>
          <strong>Always download at sign-in</strong>
          <small>Large packs still ask you to confirm before downloading.</small>
        </span>
      </label>
    </fieldset>

    <div class="offline-pack-settings-actions">
      <button type="button" class="button-primary" :disabled="isDownloading" @click="downloadNow">
        {{ isDownloading ? "Preparing offline pack…" : "Download offline pack now" }}
      </button>
      <span v-if="packSummary" class="muted">{{ packSummary }}</span>
    </div>
    <p v-if="error" class="error" role="alert">{{ error }}</p>
    <p v-if="success" class="success" role="status">{{ success }}</p>
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
const isSaving = ref(false);
const isDownloading = ref(false);
const error = ref("");
const success = ref("");
const summary = ref<Awaited<ReturnType<typeof getOfflineWorkflowSummary>> | null>(null);
let activeScopeKey = "";

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
    preference.value = getOfflinePackDownloadPreference({
      workspaceId: auth.workspaceContextId,
      profileId: auth.userId,
    });
  }
  summary.value = await getOfflineWorkflowSummary();
};

const savePreference = () => {
  if (!auth.workspaceContextId || !auth.userId) return;
  isSaving.value = true;
  setOfflinePackDownloadPreference(
    { workspaceId: auth.workspaceContextId, profileId: auth.userId },
    preference.value,
  );
  window.setTimeout(() => { isSaving.value = false; }, 0);
};

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
  gap: 0.75rem;
  margin: 0;
  padding: 0;
  border: 0;
}
.offline-pack-preference-options legend {
  margin-bottom: 0.65rem;
  font-weight: 650;
}
.offline-pack-preference-options label {
  display: flex;
  align-items: flex-start;
  gap: 0.65rem;
  padding: 0.7rem 0.8rem;
  border: 1px solid var(--border);
  border-radius: 12px;
  cursor: pointer;
}
.offline-pack-preference-options input { margin-top: 0.25rem; }
.offline-pack-preference-options span { display: grid; gap: 0.16rem; }
.offline-pack-preference-options small { color: var(--muted); }
.offline-pack-settings-actions {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 0.75rem;
  margin-top: 1rem;
}
</style>
