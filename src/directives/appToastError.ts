import { nextTick, type ObjectDirective } from "vue";
import { showAppToast } from "../store/appToast";

export type AppToastErrorOptions = {
  enabled?: boolean;
  title?: string;
  suppressMessage?: string;
};

export type AppToastErrorValue = boolean | AppToastErrorOptions | undefined;

const previousDisplay = new WeakMap<HTMLElement, string>();
const previousMessage = new WeakMap<HTMLElement, string>();
const suppressedMessage = new WeakMap<HTMLElement, string>();

const optionsFrom = (value: AppToastErrorValue): AppToastErrorOptions => {
  if (typeof value === "boolean") return { enabled: value };
  return value ?? {};
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

const notifyToast = (element: HTMLElement, message: string, options: AppToastErrorOptions) => {
  const suppression = options.suppressMessage?.trim();
  if (suppression && suppression.split("\n").some((line) => line.trim() === message)) {
    suppressedMessage.set(element, message);
    return;
  }
  if (isAlreadyShownInToast(message)) {
    suppressedMessage.set(element, message);
    return;
  }
  showAppToast(options.title ?? "Error", message);
};

const updateErrorToast = (element: HTMLElement, value: AppToastErrorValue) => {
  const options = optionsFrom(value);
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

export const appToastErrorDirective: ObjectDirective<HTMLElement, AppToastErrorValue> = {
  mounted(element, binding) {
    updateErrorToast(element, binding.value);
  },
  updated(element, binding) {
    updateErrorToast(element, binding.value);
  },
};
