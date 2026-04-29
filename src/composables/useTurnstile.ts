import { onMounted, onUnmounted, ref, type Ref } from "vue";
import {
  AIKIDO_TURNSTILE_BYPASS_TOKEN,
  isAikidoPentestUserAgent,
  shouldBypassTurnstileForAikido,
} from "../utils/aikidoPentest";

type RenderOptions = {
  sitekey: string;
  callback?: (token: string) => void;
  "error-callback"?: () => void;
  "expired-callback"?: () => void;
  theme?: "auto" | "light" | "dark";
};

type TurnstileApi = {
  render: (container: string | HTMLElement, options: RenderOptions) => string;
  reset: (widgetId?: string) => void;
  remove: (widgetId?: string) => void;
};

const TURNSTILE_SCRIPT_SRC = "https://challenges.cloudflare.com/turnstile/v0/api.js";
let turnstileScriptPromise: Promise<void> | null = null;

const ensureTurnstileScript = () => {
  if (window.turnstile) {
    return Promise.resolve();
  }
  if (turnstileScriptPromise) {
    return turnstileScriptPromise;
  }

  turnstileScriptPromise = new Promise<void>((resolve, reject) => {
    const existingScript = document.querySelector<HTMLScriptElement>(
      `script[src="${TURNSTILE_SCRIPT_SRC}"]`
    );
    if (existingScript) {
      existingScript.remove();
    }

    const script = document.createElement("script");
    script.src = TURNSTILE_SCRIPT_SRC;
    script.async = true;
    script.defer = true;
    script.onload = () => resolve();
    script.onerror = () => reject(new Error("Failed to load Turnstile script."));
    document.head.appendChild(script);
  }).catch((error) => {
    turnstileScriptPromise = null;
    throw error;
  });

  return turnstileScriptPromise;
};

export const useTurnstile = (siteKey?: string) => {
  const containerRef = ref<HTMLElement | null>(null);
  const token = ref("");
  const isReady = ref(false);
  const loadError = ref("");
  let isBypassed = isAikidoPentestUserAgent();
  let widgetId: string | null = null;
  let bootTimer: number | null = null;

  const clearBootTimer = () => {
    if (bootTimer) {
      window.clearInterval(bootTimer);
      bootTimer = null;
    }
  };

  const mountWidget = () => {
    if (!siteKey || !containerRef.value || widgetId) {
      return;
    }

    const api = window.turnstile as TurnstileApi | undefined;
    if (!api) {
      return;
    }

    try {
      widgetId = api.render(containerRef.value, {
        sitekey: siteKey,
        theme: "auto",
        callback: (nextToken) => {
          token.value = nextToken;
          loadError.value = "";
        },
        "expired-callback": () => {
          token.value = "";
        },
        "error-callback": () => {
          token.value = "";
          loadError.value = "Security check failed to load correctly. Refresh and try again.";
        },
      });
      isReady.value = true;
      loadError.value = "";
    } catch {
      loadError.value = "Unable to initialize the security check. Refresh and try again.";
    }
  };

  const reset = () => {
    if (!widgetId || !window.turnstile) {
      token.value = isBypassed ? AIKIDO_TURNSTILE_BYPASS_TOKEN : "";
      return;
    }
    try {
      window.turnstile.reset(widgetId);
    } catch {
      // Keep login flow resilient even if Turnstile script glitches.
    }
    token.value = isBypassed ? AIKIDO_TURNSTILE_BYPASS_TOKEN : "";
  };

  const applyBypass = () => {
    isBypassed = true;
    token.value = AIKIDO_TURNSTILE_BYPASS_TOKEN;
    isReady.value = true;
    loadError.value = "";
  };

  const loadWidget = () => {
    if (!siteKey) {
      return;
    }
    loadError.value = "";
    void ensureTurnstileScript()
      .then(() => {
        mountWidget();
        if (!widgetId) {
          let attempts = 0;
          bootTimer = window.setInterval(() => {
            mountWidget();
            if (widgetId) {
              clearBootTimer();
            }
            attempts += 1;
            if (!widgetId && attempts >= 20) {
              loadError.value = "Security check did not finish loading. Refresh and try again.";
              clearBootTimer();
            }
          }, 250);
        }
      })
      .catch(() => {
        token.value = "";
        loadError.value = "Unable to load the security check. Check your connection and try again.";
      });
  };

  onMounted(() => {
    if (isBypassed) {
      applyBypass();
      return;
    }

    void shouldBypassTurnstileForAikido().then((shouldBypass) => {
      if (shouldBypass) {
        applyBypass();
        return;
      }
      loadWidget();
    });
  });

  onUnmounted(() => {
    clearBootTimer();
    if (widgetId && window.turnstile) {
      window.turnstile.remove(widgetId);
    }
    widgetId = null;
  });

  return {
    containerRef: containerRef as Ref<HTMLElement | null>,
    token,
    isReady,
    loadError,
    isBypassed,
    reset,
  };
};
