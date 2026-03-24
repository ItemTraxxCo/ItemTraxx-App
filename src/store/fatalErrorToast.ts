import { reactive } from "vue";
import { AppError } from "../services/appErrors";
import { sendClientErrorReport } from "../services/clientErrorReportService";

type FatalErrorToastState = {
  visible: boolean;
  title: string;
  message: string;
  reason: string;
  context: string;
  errorName: string;
  stack: string;
  isSending: boolean;
  sent: boolean;
  sendError: string;
  fingerprint: string;
};

const state = reactive<FatalErrorToastState>({
  visible: false,
  title: "",
  message: "",
  reason: "",
  context: "",
  errorName: "",
  stack: "",
  isSending: false,
  sent: false,
  sendError: "",
  fingerprint: "",
});

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

const deriveMessage = (error: unknown) => {
  if (error instanceof Error && error.message.trim()) {
    return error.message.trim();
  }
  return "Something went wrong. Please try again or report this issue to ItemTraxx.";
};

const createFingerprint = (error: unknown, context: string) => {
  const name = error instanceof Error ? error.name : "UnknownError";
  const message = deriveMessage(error);
  return `${name}:${message}:${context}`;
};

export const getFatalErrorToastState = () => state;

export const showFatalErrorToast = (error: unknown, context = "") => {
  const fingerprint = createFingerprint(error, context);
  if (state.visible && state.fingerprint === fingerprint) {
    return;
  }

  state.visible = true;
  state.title = "Unexpected error";
  state.message = deriveMessage(error);
  state.reason = deriveReason(error);
  state.context = context;
  state.errorName = error instanceof Error ? error.name : "UnknownError";
  state.stack = error instanceof Error ? error.stack ?? "" : "";
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
      message: state.message,
      reason: state.reason,
      error_name: state.errorName,
      stack: state.stack,
      context: state.context,
    });
    state.sent = true;
  } catch (error) {
    state.sendError = error instanceof Error ? error.message : "Unable to send error report.";
  } finally {
    state.isSending = false;
  }
};
