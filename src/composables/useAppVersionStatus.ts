import { onMounted, onScopeDispose, ref, toValue, type MaybeRefOrGetter } from "vue";

const GITHUB_HEAD_COMMIT_API =
  "https://api.github.com/repos/ItemTraxxCo/ItemTraxx-App/commits/main";

type AppVersionStatusOptions = {
  appVersion: string;
  isDevHost: MaybeRefOrGetter<boolean>;
  isNonMainBuild: boolean;
};

export const useAppVersionStatus = (options: AppVersionStatusOptions) => {
  const isOutdated = ref(false);
  const latestVersion = ref<string | null>(null);
  const forceUpdateOverlay = ref(false);
  let versionTimer: number | null = null;
  let deferredTimer: number | null = null;
  const requestControllers = new Set<AbortController>();
  const requestTimeouts = new Set<number>();

  const refresh = async () => {
    if (toValue(options.isDevHost) || options.isNonMainBuild) {
      isOutdated.value = false;
      latestVersion.value = null;
      return;
    }
    if (!options.appVersion || options.appVersion === "n/a") {
      isOutdated.value = false;
      return;
    }

    const requestController = new AbortController();
    requestControllers.add(requestController);
    const requestTimeout = window.setTimeout(() => requestController.abort(), 4000);
    requestTimeouts.add(requestTimeout);
    try {
      const response = await fetch(GITHUB_HEAD_COMMIT_API, {
        method: "GET",
        signal: requestController.signal,
      });
      if (!response.ok) return;
      const payload = (await response.json().catch(() => ({}))) as { sha?: string };
      const latestSha = typeof payload.sha === "string" ? payload.sha : "";
      if (latestSha.length < 7) return;
      latestVersion.value = latestSha.slice(0, 7);
      isOutdated.value = latestVersion.value !== options.appVersion;
    } catch {
      // Keep current state on network/API errors.
    } finally {
      window.clearTimeout(requestTimeout);
      requestTimeouts.delete(requestTimeout);
      requestControllers.delete(requestController);
    }
  };

  const stop = () => {
    if (versionTimer) window.clearInterval(versionTimer);
    versionTimer = null;
  };

  const start = () => {
    if (versionTimer || document.visibilityState === "hidden") return;
    versionTimer = window.setInterval(() => void refresh(), 120_000);
  };

  const handleVisibility = () => {
    if (document.visibilityState === "hidden") {
      stop();
      return;
    }
    void refresh();
    start();
  };

  onMounted(() => {
    forceUpdateOverlay.value =
      import.meta.env.DEV &&
      new URLSearchParams(window.location.search).get("force-update-overlay") === "1";
    deferredTimer = window.setTimeout(() => {
      deferredTimer = null;
      void refresh();
      start();
    }, 750);
    document.addEventListener("visibilitychange", handleVisibility);
  });

  onScopeDispose(() => {
    stop();
    if (deferredTimer) window.clearTimeout(deferredTimer);
    for (const timeout of requestTimeouts) window.clearTimeout(timeout);
    requestTimeouts.clear();
    for (const controller of requestControllers) controller.abort();
    requestControllers.clear();
    document.removeEventListener("visibilitychange", handleVisibility);
  });

  return {
    forceUpdateOverlay,
    isOutdated,
    latestVersion,
    refresh,
    start,
    stop,
  };
};
