import { computed, nextTick, onMounted, onScopeDispose, ref } from "vue";

export type TopBannerElements = {
  maintenance: HTMLElement | null;
  broadcast: HTMLElement | null;
  incident: HTMLElement | null;
};

export const useTopBannerLayout = () => {
  const elements = ref<TopBannerElements>({
    maintenance: null,
    broadcast: null,
    incident: null,
  });
  const maintenanceHeight = ref(0);
  const broadcastHeight = ref(0);
  const incidentHeight = ref(0);
  let resizeObserver: ResizeObserver | null = null;

  const measure = () => {
    maintenanceHeight.value = elements.value.maintenance?.offsetHeight ?? 0;
    broadcastHeight.value = elements.value.broadcast?.offsetHeight ?? 0;
    incidentHeight.value = elements.value.incident?.offsetHeight ?? 0;
  };

  const observeElements = () => {
    resizeObserver?.disconnect();
    if (typeof ResizeObserver === "undefined") return;
    resizeObserver = new ResizeObserver(measure);
    for (const element of Object.values(elements.value)) {
      if (element) resizeObserver.observe(element);
    }
  };

  const setElements = (next: TopBannerElements) => {
    elements.value = next;
    observeElements();
    void nextTick(measure);
  };

  const topOffsetPx = computed(() => {
    const total = maintenanceHeight.value + broadcastHeight.value + incidentHeight.value;
    return total > 0 ? `${total}px` : "0px";
  });
  const appShellStyle = computed<Record<string, string>>(() => ({
    "--top-banner-offset": topOffsetPx.value,
  }));

  onMounted(() => {
    window.addEventListener("resize", measure);
    void nextTick(measure);
  });

  onScopeDispose(() => {
    window.removeEventListener("resize", measure);
    resizeObserver?.disconnect();
    resizeObserver = null;
  });

  return {
    appShellStyle,
    measure,
    setElements,
    topOffsetPx,
  };
};
