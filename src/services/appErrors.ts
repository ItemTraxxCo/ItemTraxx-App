import { dispatchRecoverableAppError } from "./appErrorRecovery";

export type AppErrorCode =
  | "UNAUTHORIZED"
  | "RATE_LIMIT"
  | "NETWORK"
  | "TIMEOUT"
  | "MISSING_CONTEXT"
  | "TENANT_DISABLED"
  | "REQUEST_FAILED";

type AppErrorOptions = {
  status?: number;
  reportToSentry?: boolean;
  cause?: unknown;
};

export class AppError extends Error {
  code: AppErrorCode;
  status?: number;
  reportToSentry: boolean;

  constructor(code: AppErrorCode, message: string, options: AppErrorOptions = {}) {
    super(message);
    this.name = "AppError";
    this.code = code;
    this.status = options.status;
    this.reportToSentry = options.reportToSentry ?? true;
    if ("cause" in options) {
      this.cause = options.cause;
    }
  }
}

type EdgeLikeResult = {
  status: number;
  error: string;
};

const isRateLimitMessage = (message: string) => /rate limit|too many requests/i.test(message);
const isNetworkMessage = (message: string) => /network request failed/i.test(message);
const isTimeoutMessage = (message: string) => /timed out/i.test(message);
const isUnauthorizedMessage = (message: string) => message.trim().toLowerCase() === "unauthorized";

export const unauthorizedError = (message = "Your session expired. Sign in again.") =>
  (() => {
    dispatchRecoverableAppError({ code: "UNAUTHORIZED", message });
    return new AppError("UNAUTHORIZED", message, { status: 401, reportToSentry: false });
  })();

export const missingContextError = (message: string) =>
  new AppError("MISSING_CONTEXT", message, { status: 400, reportToSentry: false });

export const edgeFunctionError = (result: EdgeLikeResult, fallbackMessage: string) => {
  const message = (result.error || fallbackMessage).trim() || fallbackMessage;

  if (result.status === 401 || isUnauthorizedMessage(message)) {
    return unauthorizedError();
  }
  if (result.status === 429 || isRateLimitMessage(message)) {
    return new AppError("RATE_LIMIT", message, { status: 429, reportToSentry: false });
  }
  if (isTimeoutMessage(message)) {
    return new AppError("TIMEOUT", "Request timed out. Please try again.", {
      status: result.status,
      reportToSentry: false,
    });
  }
  if (isNetworkMessage(message)) {
    return new AppError("NETWORK", "Network request failed. Check your connection and try again.", {
      status: result.status,
      reportToSentry: false,
    });
  }
  if (/tenant disabled/i.test(message)) {
    return new AppError("TENANT_DISABLED", "Tenant is disabled. Access is blocked.", {
      status: result.status || 403,
      reportToSentry: false,
    });
  }

  return new AppError("REQUEST_FAILED", message, {
    status: result.status,
    reportToSentry: result.status >= 500,
  });
};

export const isUnauthorizedError = (error: unknown) =>
  error instanceof AppError
    ? error.code === "UNAUTHORIZED"
    : error instanceof Error && ["unauthorized", "unauthorized."].includes(error.message.trim().toLowerCase());


export const toUserFacingErrorMessage = (error: unknown, fallbackMessage: string) => {
  const rawMessage = error instanceof Error ? error.message.trim() : "";
  const normalized = rawMessage.toLowerCase();

  if (!rawMessage) return fallbackMessage;

  if (error instanceof AppError) {
    if (error.code === "UNAUTHORIZED") return "Your session expired. Sign in again.";
    if (error.code === "RATE_LIMIT") return "Too many requests right now. Please try again in a moment.";
    if (error.code === "NETWORK") return "Network issue. Check your connection and try again.";
    if (error.code === "TIMEOUT") return "Request timed out. Please try again.";
    if (error.code === "TENANT_DISABLED") return "This account cannot be used right now. Please contact support.";
    if (error.code === "REQUEST_FAILED") {
      if (normalized.includes("invalid barcode")) return "Invalid barcode. Please check it and try again.";
      if (normalized.includes("borrower not found")) return "Borrower not found. Please check the borrower ID and try again.";
      if (normalized.includes("missing tenant context")) return "Your session is missing required account information. Sign in again.";
      if (normalized.includes("rate limit")) return "Too many requests right now. Please try again in a moment.";
      if (normalized.includes("timed out")) return "Request timed out. Please try again.";
      return fallbackMessage;
    }
  }

  if (normalized === "unauthorized" || normalized === "unauthorized.") {
    return "Your session expired. Sign in again.";
  }
  if (normalized.includes("network request failed")) {
    return "Network issue. Check your connection and try again.";
  }
  if (normalized.includes("timed out")) {
    return "Request timed out. Please try again.";
  }
  if (normalized.includes("rate limit") || normalized.includes("too many requests")) {
    return "Too many requests right now. Please try again in a moment.";
  }
  if (normalized.includes("tenant disabled")) {
    return "This account cannot be used right now. Please contact support.";
  }
  if (normalized.includes("invalid barcode")) {
    return "Invalid barcode. Please check it and try again.";
  }
  if (normalized.includes("borrower not found")) {
    return "Borrower not found. Please check the borrower ID and try again.";
  }
  if (
    normalized.includes("session revoked") ||
    normalized.includes("session terminated") ||
    normalized.includes("session expired")
  ) {
    return "Your session expired. Sign in again.";
  }
  if (normalized.includes("missing tenant context")) {
    return "Your session is missing required account information. Sign in again.";
  }
  if (
    normalized.startsWith("unable to ") ||
    normalized.startsWith("failed to ") ||
    normalized.includes("schema cache") ||
    normalized.includes("pgrst") ||
    normalized.includes("column") ||
    normalized.includes("constraint")
  ) {
    return fallbackMessage;
  }

  return rawMessage;
};

export const shouldReportError = (error: unknown) =>
  error instanceof AppError ? error.reportToSentry : true;
