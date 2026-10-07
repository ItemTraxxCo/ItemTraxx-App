import { nextTick, type ObjectDirective } from "vue";
import { showAppToast, type AppToastKind } from "../store/appToast";

export type AppToastDirectiveOptions = {
  enabled?: boolean;
  title?: string;
  suppressMessage?: string;
  kind?: AppToastKind;
};

export type AppToastDirectiveValue = boolean | AppToastDirectiveOptions | undefined;

const previousDisplay = new WeakMap<HTMLElement, string>();
const previousMessage = new WeakMap<HTMLElement, string>();
const suppressedMessage = new WeakMap<HTMLElement, string>();

const optionsFrom = (value: AppToastDirectiveValue, defaultKind: AppToastKind): AppToastDirectiveOptions => {
  if (typeof value === "boolean") return { enabled: value, kind: defaultKind };
  return { ...value, kind: value?.kind ?? defaultKind };
};

const isAlreadyShownInToast = (message: string) => {
  const toasts = document.querySelectorAll<HTMLElement>(".toast");
  return Array.from(toasts).some((toast) => {
    if (toast.classList.contains("app-toast-outlet")) return false;
    const bodies = Array.from(toast.querySelectorAll<HTMLElement>(".toast-body"));
    return bodies.some((body) => {
      const text = (body.textContent ?? "").trim();
      return text === message || text.split("\n").some((line) => line.trim() === message);
    });
  });
};

const notifyToast = (element: HTMLElement, message: string, options: AppToastDirectiveOptions) => {
  const suppression = options.suppressMessage?.trim();
  if (suppression && suppression.split("\n").some((line) => line.trim() === message)) {
    suppressedMessage.set(element, message);
    return;
  }
  if (isAlreadyShownInToast(message)) {
    suppressedMessage.set(element, message);
    return;
  }
  suppressedMessage.set(element, message);
  const kind = options.kind ?? "error";
  const defaultTitle = kind === "error" ? "Error" : kind === "success" ? "Success" : "Information";
  showAppToast(options.title ?? defaultTitle, message, kind);
};

const createAppToastDirective = (defaultKind: AppToastKind): ObjectDirective<HTMLElement, AppToastDirectiveValue> => {
  const updateAppToast = (element: HTMLElement, value: AppToastDirectiveValue) => {
    const options = optionsFrom(value, defaultKind);
    if (options.enabled === false) {
      element.style.display = previousDisplay.get(element) ?? "";
      element.removeAttribute("aria-hidden");
      previousMessage.set(element, "");
      suppressedMessage.set(element, "");
      return;
    }

    if (!previousDisplay.has(element)) {
      previousDisplay.set(element, element.style.display);
    }
    element.style.display = "none";
    element.setAttribute("aria-hidden", "true");

    const message = (element.textContent ?? "").trim();
    if (!message) {
      previousMessage.set(element, "");
      suppressedMessage.set(element, "");
      return;
    }
    if (previousMessage.get(element) === message) {
      if (suppressedMessage.get(element) === message) return;
      void nextTick(() => {
        notifyToast(element, message, options);
      });
      return;
    }
    previousMessage.set(element, message);
    suppressedMessage.set(element, "");

    void nextTick(() => {
      notifyToast(element, message, options);
    });
  };

  return {
    mounted(element, binding) {
      updateAppToast(element, binding.value);
    },
    updated(element, binding) {
      updateAppToast(element, binding.value);
    },
  };
};

export const appToastErrorDirective = createAppToastDirective("error");
export const appToastMessageDirective = createAppToastDirective("success");
