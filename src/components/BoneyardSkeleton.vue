<template>
  <Skeleton
    :name="name"
    :loading="loading"
    :aria-busy="loading"
    :animate="effectiveAnimate"
    :stagger="reducedMotion ? false : 35"
    :transition="reducedMotion ? false : 220"
    :color="color"
    :dark-color="darkColor"
    :class="theme === 'dark' ? 'boneyard-skeleton dark' : 'boneyard-skeleton'"
    role="status"
    aria-live="polite"
    :aria-label="label"
  >
    <slot />

    <template #fixture>
      <slot name="fixture" />
    </template>

    <template #fallback>
      <SkeletonLoader
        :variant="variant"
        :rows="rows"
        :columns="columns"
        :action-column="actionColumn"
        :label="label"
      />
    </template>
  </Skeleton>
</template>

<script setup lang="ts">
import { onMounted, onScopeDispose, ref } from "vue";
import { computed } from "vue";
import Skeleton from "boneyard-js/vue";
import SkeletonLoader from "./SkeletonLoader.vue";

type SkeletonVariant = "lines" | "table" | "card";
type AnimationStyle = "pulse" | "shimmer" | "solid";

const props = withDefaults(
  defineProps<{
    loading: boolean;
    name: string;
    variant?: SkeletonVariant;
    rows?: number;
    columns?: number;
    actionColumn?: boolean;
    label?: string;
    animate?: AnimationStyle;
    color?: string;
    darkColor?: string;
  }>(),
  {
    variant: "lines",
    rows: 3,
    columns: 4,
    actionColumn: false,
    label: "Loading content",
    animate: "shimmer",
    color: "#e9e9e3",
    darkColor: "#282824",
  }
);

const theme = ref<"light" | "dark">(
  document.documentElement.getAttribute("data-theme") === "dark" ? "dark" : "light"
);
const reducedMotion = ref(false);
const effectiveAnimate = computed<AnimationStyle>(() =>
  reducedMotion.value ? "solid" : props.animate
);
let themeObserver: MutationObserver | null = null;
let motionQuery: MediaQueryList | null = null;
let motionChangeHandler: ((event: MediaQueryListEvent) => void) | null = null;

onMounted(() => {
  themeObserver = new MutationObserver(() => {
    theme.value = document.documentElement.getAttribute("data-theme") === "dark" ? "dark" : "light";
  });
  themeObserver.observe(document.documentElement, {
    attributes: true,
    attributeFilter: ["data-theme"],
  });

  if (typeof window.matchMedia !== "function") return;
  motionQuery = window.matchMedia("(prefers-reduced-motion: reduce)");
  reducedMotion.value = motionQuery.matches;
  motionChangeHandler = (event) => {
    reducedMotion.value = event.matches;
  };
  motionQuery.addEventListener("change", motionChangeHandler);
});

onScopeDispose(() => {
  themeObserver?.disconnect();
  if (motionQuery && motionChangeHandler) {
    motionQuery.removeEventListener("change", motionChangeHandler);
  }
});
</script>
