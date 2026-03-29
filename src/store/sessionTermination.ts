import { reactive } from "vue";
import type { RouteLocationRaw } from "vue-router";

type SessionTerminationState = {
  visible: boolean;
  title: string;
  message: string;
  recoveryRoute: RouteLocationRaw | null;
};

const state = reactive<SessionTerminationState>({
  visible: false,
  title: "This session has been terminated.",
  message: "Please sign in again.",
  recoveryRoute: null,
});

export const getSessionTerminationState = () => state;

export const showSessionTermination = (recoveryRoute: RouteLocationRaw, options?: {
  title?: string;
  message?: string;
}) => {
  state.visible = true;
  state.title = options?.title?.trim() || "This session has been terminated.";
  state.message = options?.message?.trim() || "Please sign in again.";
  state.recoveryRoute = recoveryRoute;
};

export const clearSessionTermination = () => {
  state.visible = false;
  state.title = "This session has been terminated.";
  state.message = "Please sign in again.";
  state.recoveryRoute = null;
};
