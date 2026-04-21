import type { App } from "vue";
import { shouldReportError } from "./appErrors";
import { showFatalErrorToast } from "../store/fatalErrorToast";

const isCspUnsafeEvalError = (error: unknown) => {
  const message = error instanceof Error ? error.message : "";
  if (!message) return false;
  return (
    message.includes("Refused to evaluate a string as JavaScript") &&
    message.includes("unsafe-eval") &&
    message.includes("Content Security Policy")
  );
};

export const installGlobalErrorHandling = (app: App) => {
  const previousErrorHandler = app.config.errorHandler;
  app.config.errorHandler = (error, instance, info) => {
    if (isCspUnsafeEvalError(error)) {
      // Strict CSP intentionally blocks unsafe-eval. Never surface this to end users.
      console.warn("[app][csp] blocked unsafe-eval; ignoring user toast.");
      return;
    }

    if (!shouldReportError(error)) {
      console.warn("[app]", error instanceof Error ? error.message : "Request failed.", info, instance?.$options?.name);
      return;
    }

    showFatalErrorToast(error, typeof info === "string" ? info : "Vue error handler");

    if (previousErrorHandler) {
      previousErrorHandler(error, instance, info);
      return;
    }

    console.error(error);
  };

  window.addEventListener("unhandledrejection", (event) => {
    if (isCspUnsafeEvalError(event.reason)) {
      console.warn("[app][csp] blocked unsafe-eval; ignoring user toast.");
      event.preventDefault();
      return;
    }

    if (!shouldReportError(event.reason)) {
      console.warn("[app]", event.reason instanceof Error ? event.reason.message : "Request failed.");
      event.preventDefault();
      return;
    }

    showFatalErrorToast(event.reason, "Unhandled promise rejection");
  });
};
