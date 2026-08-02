import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { App } from "vue";
import { installGlobalErrorHandling } from "./globalErrorHandling";
import { dismissFatalErrorToast, getFatalErrorToastState } from "../store/fatalErrorToast";
import { AppError } from "./appErrors";

const buildApp = (previousErrorHandler?: App["config"]["errorHandler"]) =>
  ({ config: { errorHandler: previousErrorHandler } }) as unknown as App;

// installGlobalErrorHandling wires a real `window.addEventListener("unhandledrejection", ...)`
// listener with no way to reach the handler by dispatching a real PromiseRejectionEvent
// in jsdom, so capture the registered callback directly off a spied addEventListener,
// mirroring how appErrorRecovery.spec.ts captures router.onError/afterEach callbacks.
const captureUnhandledRejectionListener = () => {
  let handler: ((event: { reason: unknown; preventDefault: () => void }) => void) | undefined;
  const spy = vi
    .spyOn(window, "addEventListener")
    .mockImplementation(((type: string, listener: EventListenerOrEventListenerObject) => {
      if (type === "unhandledrejection") {
        handler = listener as never;
      }
    }) as typeof window.addEventListener);
  return {
    getHandler: () => handler,
    restore: () => spy.mockRestore(),
  };
};

describe("installGlobalErrorHandling", () => {
  let warnSpy: ReturnType<typeof vi.spyOn>;
  let errorSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    dismissFatalErrorToast();
    warnSpy = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    errorSpy = vi.spyOn(console, "error").mockImplementation(() => undefined);
  });

  afterEach(() => {
    warnSpy.mockRestore();
    errorSpy.mockRestore();
  });

  describe("app.config.errorHandler", () => {
    it("silently ignores a CSP unsafe-eval error without a toast or calling the previous handler", () => {
      const previousHandler = vi.fn();
      const app = buildApp(previousHandler);
      installGlobalErrorHandling(app);

      const cspError = new Error(
        "Refused to evaluate a string as JavaScript because 'unsafe-eval' is not an allowed source of script in the following Content Security Policy directive"
      );
      app.config.errorHandler?.(cspError, null, "render");

      expect(warnSpy).toHaveBeenCalled();
      expect(getFatalErrorToastState().visible).toBe(false);
      expect(previousHandler).not.toHaveBeenCalled();
    });

    it("logs and skips the toast for a non-reportable AppError", () => {
      const app = buildApp();
      installGlobalErrorHandling(app);

      const nonReportable = new AppError("MISSING_CONTEXT", "context missing", { reportToSentry: false });
      app.config.errorHandler?.(nonReportable, null, "setup");

      expect(warnSpy).toHaveBeenCalled();
      expect(getFatalErrorToastState().visible).toBe(false);
    });

    it("shows the fatal error toast and delegates to a previous handler for a reportable error", () => {
      const previousHandler = vi.fn();
      const app = buildApp(previousHandler);
      installGlobalErrorHandling(app);

      const error = new Error("boom");
      const instance = { $options: { name: "MyComponent" } };
      app.config.errorHandler?.(error, instance as never, "render function");

      expect(getFatalErrorToastState().visible).toBe(true);
      expect(getFatalErrorToastState().context).toBe("render function");
      expect(previousHandler).toHaveBeenCalledWith(error, instance, "render function");
    });

    it("falls back to console.error when there is no previous handler", () => {
      const app = buildApp(undefined);
      installGlobalErrorHandling(app);

      const error = new Error("boom");
      app.config.errorHandler?.(error, null, "render");

      expect(getFatalErrorToastState().visible).toBe(true);
      expect(errorSpy).toHaveBeenCalledWith(error);
    });

    it("falls back to a generic context message when info is not a string", () => {
      const app = buildApp();
      installGlobalErrorHandling(app);

      app.config.errorHandler?.(new Error("boom"), null, undefined as never);

      expect(getFatalErrorToastState().context).toBe("Vue error. Please contact support.");
    });
  });

  describe("unhandledrejection listener", () => {
    it("ignores a CSP unsafe-eval rejection and prevents the default handling", () => {
      const { getHandler, restore } = captureUnhandledRejectionListener();
      installGlobalErrorHandling(buildApp());
      const preventDefault = vi.fn();
      const cspError = new Error(
        "Refused to evaluate a string as JavaScript because 'unsafe-eval' is not an allowed source of script in the following Content Security Policy directive"
      );

      getHandler()?.({ reason: cspError, preventDefault });

      expect(preventDefault).toHaveBeenCalledTimes(1);
      expect(getFatalErrorToastState().visible).toBe(false);
      restore();
    });

    it("ignores a non-reportable rejection and prevents the default handling", () => {
      const { getHandler, restore } = captureUnhandledRejectionListener();
      installGlobalErrorHandling(buildApp());
      const preventDefault = vi.fn();
      const nonReportable = new AppError("MISSING_CONTEXT", "context missing", { reportToSentry: false });

      getHandler()?.({ reason: nonReportable, preventDefault });

      expect(preventDefault).toHaveBeenCalledTimes(1);
      expect(getFatalErrorToastState().visible).toBe(false);
      restore();
    });

    it("shows the fatal error toast for a reportable rejection without preventing default", () => {
      const { getHandler, restore } = captureUnhandledRejectionListener();
      installGlobalErrorHandling(buildApp());
      const preventDefault = vi.fn();

      getHandler()?.({ reason: new Error("unhandled boom"), preventDefault });

      expect(preventDefault).not.toHaveBeenCalled();
      expect(getFatalErrorToastState().visible).toBe(true);
      restore();
    });

    it("handles a non-Error rejection reason without throwing", () => {
      const { getHandler, restore } = captureUnhandledRejectionListener();
      installGlobalErrorHandling(buildApp());
      const preventDefault = vi.fn();

      expect(() => getHandler()?.({ reason: "plain string rejection", preventDefault })).not.toThrow();
      expect(getFatalErrorToastState().visible).toBe(true);
      restore();
    });
  });
});
