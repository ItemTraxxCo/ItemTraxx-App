import { computed, onMounted, onScopeDispose, ref, toValue, watch, type MaybeRefOrGetter } from "vue";

export const useOfflineQueueCount = (isTenantScopedRoute: MaybeRefOrGetter<boolean>) => {
  const count = ref(0);
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
      return;
    }
    try {
      const { getBufferedCheckoutCount } = await import("../services/offlineCheckoutQueue");
      count.value = await getBufferedCheckoutCount();
    } catch {
      count.value = 0;
    }
  };

  const start = () => {
    if (!toValue(isTenantScopedRoute) || document.visibilityState === "hidden") {
      stop();
      count.value = 0;
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

  watch(() => toValue(isTenantScopedRoute), start);

  onMounted(() => {
    window.addEventListener("storage", handleStorage);
    document.addEventListener("visibilitychange", handleVisibility);
    start();
  });

  onScopeDispose(() => {
    stop();
    window.removeEventListener("storage", handleStorage);
    document.removeEventListener("visibilitychange", handleVisibility);
  });

  return { count, refresh, start, stop, tooltip };
};
