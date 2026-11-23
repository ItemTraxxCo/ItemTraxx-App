import { readonly, shallowRef } from "vue";
import { STATUS_PAGE_URL } from "../utils/statusPageMessage";

export type EdgeDowntimeMode = "killswitch" | "maintenance";

export type EdgeDowntime = {
  mode: EdgeDowntimeMode;
  message: string;
  statusPageUrl: string;
};

const currentDowntime = shallowRef<EdgeDowntime | null>(null);

export const edgeDowntimeState = readonly(currentDowntime);

export const observeEdgeDowntimePayload = (
  status: number,
  value: unknown,
) => {
  if (status !== 503 || !value || typeof value !== "object") return false;

  const payload = value as Record<string, unknown>;
  if (
    payload.status !== "unavailable" ||
    (payload.mode !== "killswitch" && payload.mode !== "maintenance") ||
    typeof payload.message !== "string"
  ) {
    return false;
  }

  currentDowntime.value = {
    mode: payload.mode,
    message: payload.message,
    statusPageUrl: STATUS_PAGE_URL,
  };
  return true;
};

export const observeEdgeDowntimeResponse = async (response: Response) => {
  if (response.status !== 503) return false;
  try {
    return observeEdgeDowntimePayload(response.status, await response.clone().json());
  } catch {
    return false;
  }
};

export const clearEdgeDowntimeState = () => {
  currentDowntime.value = null;
};
