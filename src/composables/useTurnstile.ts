import { onMounted, onUnmounted, ref, type Ref } from "vue";

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
      existingScript.addEventListener("load", () => resolve(), { once: true });
      existingScript.addEventListener(
        "error",
        () => reject(new Error("Failed to load Turnstile script.")),
        { once: true }
      );
      return;
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

    widgetId = api.render(containerRef.value, {
      sitekey: siteKey,
      theme: "auto",
      callback: (nextToken) => {
        token.value = nextToken;
      },
      "expired-callback": () => {
        token.value = "";
      },
      "error-callback": () => {
        token.value = "";
      },
    });
    isReady.value = true;
  };

  const reset = () => {
    if (!widgetId || !window.turnstile) {
      token.value = "";
      return;
    }
    try {
      window.turnstile.reset(widgetId);
    } catch {
      // Keep login flow resilient even if Turnstile script glitches.
    }
    token.value = "";
  };

  onMounted(() => {
    if (!siteKey) {
      return;
    }
    void ensureTurnstileScript()
      .then(() => {
        mountWidget();
        if (!widgetId) {
          bootTimer = window.setInterval(() => {
            mountWidget();
            if (widgetId) {
              clearBootTimer();
            }
          }, 250);
        }
      })
      .catch(() => {
        token.value = "";
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
    reset,
  };
};
