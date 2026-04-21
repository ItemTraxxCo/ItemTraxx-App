import { reactive } from "vue";
import { AppError } from "../services/appErrors";
import { sendClientErrorReport } from "../services/clientErrorReportService";

type FatalErrorToastState = {
  visible: boolean;
  title: string;
  message: string;
  reportMessage: string;
  reason: string;
  context: string;
  errorName: string;
  reportStack: string;
  isSending: boolean;
  sent: boolean;
  sendError: string;
  fingerprint: string;
};

const state = reactive<FatalErrorToastState>({
  visible: false,
  title: "",
  message: "",
  reportMessage: "",
  reason: "",
  context: "",
  errorName: "",
  reportStack: "",
  isSending: false,
  sent: false,
  sendError: "",
  fingerprint: "",
});

const redactSensitiveText = (input: string) => {
  let value = input;

  // JWT-like tokens
  value = value.replace(/\beyJ[a-zA-Z0-9_-]{10,}\.[a-zA-Z0-9_-]{10,}\.[a-zA-Z0-9_-]{10,}\b/g, "[redacted_jwt]");

  // Authorization headers / bearer tokens
  value = value.replace(/(authorization:\s*bearer\s+)[^\s]+/gi, "$1[redacted]");
  value = value.replace(/(bearer\s+)[A-Za-z0-9._~+/=-]{16,}/gi, "$1[redacted]");

  // Common token/query patterns
  value = value.replace(/([?&](?:access_token|refresh_token|token|apikey|api_key)=)[^&\s]+/gi, "$1[redacted]");

  // Emails (avoid leaking PII)
  value = value.replace(/\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi, "[redacted_email]");

  return value;
};

const deriveReason = (error: unknown) => {
  if (error instanceof AppError) {
    switch (error.code) {
      case "REQUEST_FAILED":
        return "A backend request failed unexpectedly. Please try again.";
      case "NETWORK":
        return "ItemTraxx could not reach the network. Please check your connection and try again.";
      case "TIMEOUT":
        return "The request took too long and timed out. Please check your connection and try again.";
      default:
        return "ItemTraxx hit an unexpected error. Please try again.";
    }
  }
  return "ItemTraxx hit an unexpected error. Please try again.";
};

// Never show raw exception strings to users (they may contain sensitive info).
const deriveUserFacingMessage = () => "Something went wrong. Please try again.";

const deriveReportMessage = (error: unknown) => {
  if (error instanceof Error && error.message.trim()) {
    return redactSensitiveText(error.message.trim());
  }
  return "Unknown error.";
};

const deriveReportStack = (error: unknown) => {
  if (!(error instanceof Error)) return "";
  const stack = (error.stack ?? "").trim();
  return stack ? redactSensitiveText(stack) : "";
};

const createFingerprint = (error: unknown, context: string) => {
  // Avoid raw error.message in fingerprints (may contain secrets or PII).
  const name = error instanceof Error ? error.name : "UnknownError";
  const appErrorCode = error instanceof AppError ? error.code : "";
  return `${name}:${appErrorCode}:${context}`;
};

export const getFatalErrorToastState = () => state;

export const showFatalErrorToast = (error: unknown, context = "") => {
  const fingerprint = createFingerprint(error, context);
  if (state.visible && state.fingerprint === fingerprint) {
    return;
  }

  state.visible = true;
  state.title = "Unexpected error";
  state.message = deriveUserFacingMessage();
  state.reportMessage = deriveReportMessage(error);
  state.reason = deriveReason(error);
  state.context = context;
  state.errorName = error instanceof Error ? error.name : "UnknownError";
  state.reportStack = deriveReportStack(error);
  state.isSending = false;
  state.sent = false;
  state.sendError = "";
  state.fingerprint = fingerprint;
};

export const dismissFatalErrorToast = () => {
  state.visible = false;
};

export const sendFatalErrorToastReport = async () => {
  if (state.isSending || !state.visible) {
    return;
  }

  state.isSending = true;
  state.sendError = "";

  try {
    await sendClientErrorReport({
      title: state.title,
      message: state.reportMessage,
      reason: state.reason,
      error_name: state.errorName,
      stack: state.reportStack,
      context: state.context,
    });
    state.sent = true;
  } catch (error) {
    state.sendError = error instanceof Error ? error.message : "Unable to send error report.";
  } finally {
    state.isSending = false;
  }
};
