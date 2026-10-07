import { reactive } from "vue";

export type AppToastKind = "error" | "success" | "info";

const defaultTitleForKind: Record<AppToastKind, string> = {
  error: "Error",
  success: "Success",
  info: "Information",
};

const state = reactive({
  visible: false,
  id: 0,
  kind: "error" as AppToastKind,
  title: "",
  message: "",
});

let pendingTitle = "Error";
let pendingKind: AppToastKind = "error";
let pendingMessages: string[] = [];
let flushTimer: number | null = null;
let dismissTimer: number | null = null;

const clearTimer = (timer: number | null) => {
  if (timer !== null && typeof window !== "undefined") {
    window.clearTimeout(timer);
  }
};

const flushPendingToast = () => {
  flushTimer = null;
  if (!pendingMessages.length) return;

  state.title = pendingTitle;
  state.kind = pendingKind;
  state.message = pendingMessages.join("\n");
  state.id += 1;
  state.visible = true;
  pendingTitle = "Error";
  pendingKind = "error";
  pendingMessages = [];

  clearTimer(dismissTimer);
  dismissTimer = window.setTimeout(() => {
    state.visible = false;
    dismissTimer = null;
  }, 4000);
};

export const getAppToastState = () => state;

export const showAppToast = (title: string, message: string, kind: AppToastKind = "error") => {
  if (typeof window === "undefined") return;
  const normalizedMessage = message.trim();
  if (!normalizedMessage) return;

  const normalizedTitle = title.trim() || defaultTitleForKind[kind];
  if (pendingMessages.length === 0) {
    pendingTitle = normalizedTitle;
    pendingKind = kind;
  } else if (pendingKind !== kind) {
    // If different outcomes arrive in one tick, keep the most urgent tone.
    const priority: Record<AppToastKind, number> = { info: 0, success: 1, error: 2 };
    if (priority[kind] > priority[pendingKind]) {
      pendingKind = kind;
    }
    pendingTitle = defaultTitleForKind[pendingKind];
  } else if (pendingTitle !== normalizedTitle) {
    pendingTitle = defaultTitleForKind[kind];
  }
  if (!pendingMessages.includes(normalizedMessage)) {
    pendingMessages.push(normalizedMessage);
  }

  if (flushTimer === null) {
    flushTimer = window.setTimeout(flushPendingToast, 0);
  }
};
