import { onMounted, onUnmounted } from "vue";
import { systemStatusState } from "../store/systemStatusState";

export const useSystemStatus = () => {
  onMounted(systemStatusState.acquire);
  onUnmounted(systemStatusState.release);
  return systemStatusState;
};
