<template>
  <div
    v-if="maintenanceVisible"
    ref="maintenanceBannerRef"
    class="maintenance-top-banner"
    role="alert"
    aria-live="assertive"
  >
    <strong>Maintenance Mode</strong>
    <span>{{ maintenanceMessage }}</span>
  </div>
  <slot />
  <div
    v-if="broadcast && broadcastVisible"
    ref="broadcastBannerRef"
    class="broadcast-top-banner"
    role="status"
    aria-live="polite"
  >
    <div class="broadcast-content">
      <strong class="broadcast-title">Broadcast</strong>
      <span class="broadcast-message">{{ broadcast.message }}</span>
    </div>
    <button
      type="button"
      class="broadcast-dismiss"
      aria-label="Dismiss broadcast"
      @click="emit('dismissBroadcast')"
    >
      ×
    </button>
  </div>
  <div
    v-if="incident && incidentVisible"
    ref="incidentBannerRef"
    class="broadcast-banner incident-banner"
    :class="incident.level === 'down' ? 'broadcast-critical' : 'broadcast-warning'"
    role="status"
    aria-live="polite"
  >
    <div class="broadcast-content">
      <strong class="broadcast-title">{{ incidentTitle }}</strong>
      <span class="broadcast-message">{{ incident.message }}</span>
      <span class="broadcast-meta">{{ incidentSlaLine }}</span>
    </div>
    <a
      class="broadcast-link"
      href="https://status.itemtraxx.com/?ref=bcastlink"
      target="_blank"
      rel="noreferrer"
    >
      View status
    </a>
    <button type="button" class="broadcast-dismiss" @click="emit('dismissIncident')">
      x
    </button>
  </div>
</template>

<script setup lang="ts">
import { nextTick, onBeforeUnmount, onMounted, onUpdated, ref } from "vue";
import type { TopBannerElements } from "../../composables/useTopBannerLayout";

type BroadcastBanner = {
  message: string;
};

type IncidentBanner = {
  message: string;
  level: "degraded" | "down";
};

defineProps<{
  maintenanceVisible: boolean;
  maintenanceMessage: string;
  broadcast: BroadcastBanner | null;
  broadcastVisible: boolean;
  incident: IncidentBanner | null;
  incidentVisible: boolean;
  incidentTitle: string;
  incidentSlaLine: string;
}>();

const emit = defineEmits<{
  dismissBroadcast: [];
  dismissIncident: [];
  elements: [elements: TopBannerElements];
}>();

const maintenanceBannerRef = ref<HTMLElement | null>(null);
const broadcastBannerRef = ref<HTMLElement | null>(null);
const incidentBannerRef = ref<HTMLElement | null>(null);

const emitElements = () => {
  emit("elements", {
    maintenance: maintenanceBannerRef.value,
    broadcast: broadcastBannerRef.value,
    incident: incidentBannerRef.value,
  });
};

const emitElementsAfterRender = () => {
  void nextTick(emitElements);
};

onMounted(emitElementsAfterRender);
onUpdated(emitElementsAfterRender);
onBeforeUnmount(() => {
  emit("elements", { maintenance: null, broadcast: null, incident: null });
});
</script>
