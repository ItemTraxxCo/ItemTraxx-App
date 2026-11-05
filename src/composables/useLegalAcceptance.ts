import { computed, ref } from "vue";
import {
  acceptLegalDocument,
  fetchPendingLegalDocuments,
  type PendingLegalDocument,
} from "../services/legalAcceptanceService";

/**
 * Drives a "please accept the updated terms" prompt. `refresh()` loads the
 * outstanding documents; `acceptCurrent()` records the first one and advances.
 * UI is intentionally separate so any shell (workspace, internal, super) can
 * render it.
 */
export const useLegalAcceptance = () => {
  const pending = ref<PendingLegalDocument[]>([]);
  const isLoading = ref(false);
  const isSubmitting = ref(false);
  const errorMessage = ref("");

  const current = computed(() => pending.value[0] ?? null);
  const requiresAcceptance = computed(() => pending.value.length > 0);

  const refresh = async () => {
    isLoading.value = true;
    errorMessage.value = "";
    try {
      pending.value = await fetchPendingLegalDocuments();
    } catch (error) {
      // Never block the app on a status lookup failure; surface it for UI/log.
      errorMessage.value = error instanceof Error ? error.message : "Unable to load legal documents.";
    } finally {
      isLoading.value = false;
    }
  };

  const acceptCurrent = async () => {
    const document = current.value;
    if (!document || isSubmitting.value) return false;
    isSubmitting.value = true;
    errorMessage.value = "";
    try {
      await acceptLegalDocument(document);
      pending.value = pending.value.filter(
        (item) =>
          item.document_type !== document.document_type ||
          item.document_version !== document.document_version,
      );
      return true;
    } catch (error) {
      errorMessage.value = error instanceof Error ? error.message : "Unable to record your acceptance.";
      return false;
    } finally {
      isSubmitting.value = false;
    }
  };

  return { pending, current, requiresAcceptance, isLoading, isSubmitting, errorMessage, refresh, acceptCurrent };
};
