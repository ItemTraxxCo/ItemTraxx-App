<!-- src/components/superadmin/SuperAdminIcon.vue -->
<template>
  <svg class="sa-icon" viewBox="0 0 24 24" aria-hidden="true">
    <path v-for="(d, i) in spec.paths ?? []" :key="`p${i}`" :d="d" />
    <circle v-for="(c, i) in spec.circles ?? []" :key="`c${i}`" :cx="c.cx" :cy="c.cy" :r="c.r" />
    <rect
      v-for="(r, i) in spec.rects ?? []"
      :key="`r${i}`"
      :x="r.x"
      :y="r.y"
      :width="r.width"
      :height="r.height"
      :rx="r.rx ?? 0"
    />
  </svg>
</template>

<script setup lang="ts">
import { computed } from "vue";
import { ICONS, type IconName } from "./icons";

const props = defineProps<{ name: IconName }>();
const spec = computed(() => ICONS[props.name]);
</script>

<style scoped>
.sa-icon {
  width: 18px;
  height: 18px;
  flex-shrink: 0;
  fill: none;
  stroke: currentColor;
  stroke-width: 1.8;
  stroke-linecap: round;
  stroke-linejoin: round;
}
</style>
