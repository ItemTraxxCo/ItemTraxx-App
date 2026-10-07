import { reactive } from "vue";

const state = reactive({
  visible: false,
  id: 0,
  title: "",
  message: "",
});

let pendingTitle = "Error";
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
  state.message = pendingMessages.join("\n");
  state.id += 1;
  state.visible = true;
  pendingTitle = "Error";
  pendingMessages = [];

  clearTimer(dismissTimer);
  dismissTimer = window.setTimeout(() => {
    state.visible = false;
    dismissTimer = null;
  }, 4000);
};

export const getAppToastState = () => state;

export const showAppToast = (title: string, message: string) => {
  if (typeof window === "undefined") return;
  const normalizedMessage = message.trim();
  if (!normalizedMessage) return;

  const normalizedTitle = title.trim() || "Error";
  if (pendingMessages.length === 0) {
    pendingTitle = normalizedTitle;
  } else if (pendingTitle !== normalizedTitle) {
    pendingTitle = "Error";
  }
  if (!pendingMessages.includes(normalizedMessage)) {
    pendingMessages.push(normalizedMessage);
  }

  if (flushTimer === null) {
    flushTimer = window.setTimeout(flushPendingToast, 0);
  }
};
