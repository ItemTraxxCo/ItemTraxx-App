import { computed, onMounted, onScopeDispose, ref, toValue, watch, type MaybeRefOrGetter } from "vue";

export const useOfflineQueueCount = (isTenantScopedRoute: MaybeRefOrGetter<boolean>) => {
  const count = ref(0);
  const syncingCount = ref(0);
  const reviewCount = ref(0);
  let pollTimer: number | null = null;
  const tooltip = computed(
    () =>
      "Offline Queue stores checkout/return requests when internet is unavailable and auto-syncs them when connection is restored.",
  );

  const stop = () => {
    if (pollTimer) window.clearInterval(pollTimer);
    pollTimer = null;
  };

  const refresh = async () => {
    if (!toValue(isTenantScopedRoute)) {
      count.value = 0;
      syncingCount.value = 0;
      reviewCount.value = 0;
      return;
    }
    try {
      const [{ getOfflineQueueSummary }, { getOfflineWorkflowSummary }] = await Promise.all([
        import("../services/offlineCheckoutQueue"),
        import("../services/offlineCheckoutWorkflow"),
      ]);
      const [legacy, workflow] = await Promise.all([
        getOfflineQueueSummary(),
        getOfflineWorkflowSummary(),
      ]);
      count.value = legacy.totalCount + workflow.pendingCount + workflow.reviewCount;
      syncingCount.value = workflow.syncingCount;
      reviewCount.value = legacy.reviewCount + workflow.reviewCount;
    } catch {
      count.value = 0;
      syncingCount.value = 0;
      reviewCount.value = 0;
    }
  };

  const start = () => {
    if (!toValue(isTenantScopedRoute) || document.visibilityState === "hidden") {
      stop();
      count.value = 0;
      syncingCount.value = 0;
      reviewCount.value = 0;
      return;
    }
    void refresh();
    if (pollTimer) return;
    pollTimer = window.setInterval(() => void refresh(), 10_000);
  };

  const handleStorage = (event: StorageEvent) => {
    if (!event.key || event.key.startsWith("itemtraxx:checkout-offline-buffer:")) {
      void refresh();
    }
  };

  const handleVisibility = () => {
    if (document.visibilityState === "hidden") stop();
    else start();
  };

  const handleWorkflowChange = () => {
    void refresh();
  };

  watch(() => toValue(isTenantScopedRoute), start);

  onMounted(() => {
    window.addEventListener("storage", handleStorage);
    window.addEventListener("itemtraxx:offline-queue-changed", handleWorkflowChange);
    window.addEventListener("itemtraxx:offline-workflow-changed", handleWorkflowChange);
    document.addEventListener("visibilitychange", handleVisibility);
    start();
  });

  onScopeDispose(() => {
    stop();
    window.removeEventListener("storage", handleStorage);
    window.removeEventListener("itemtraxx:offline-queue-changed", handleWorkflowChange);
    window.removeEventListener("itemtraxx:offline-workflow-changed", handleWorkflowChange);
    document.removeEventListener("visibilitychange", handleVisibility);
  });

  return { count, syncingCount, reviewCount, refresh, start, stop, tooltip };
};
