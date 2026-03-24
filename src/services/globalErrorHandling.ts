import type { App } from "vue";
import { shouldReportError } from "./appErrors";
import { showFatalErrorToast } from "../store/fatalErrorToast";

export const installGlobalErrorHandling = (app: App) => {
  const previousErrorHandler = app.config.errorHandler;
  app.config.errorHandler = (error, instance, info) => {
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
    if (!shouldReportError(event.reason)) {
      console.warn("[app]", event.reason instanceof Error ? event.reason.message : "Request failed.");
      event.preventDefault();
      return;
    }

    showFatalErrorToast(event.reason, "Unhandled promise rejection");
  });
};
