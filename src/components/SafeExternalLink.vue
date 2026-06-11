<template>
  <a
    v-if="safeHref"
    ref="anchorRef"
    target="_blank"
    rel="noopener noreferrer"
  >
    <slot />
  </a>
</template>

<script setup lang="ts">
import { computed, ref, watchEffect } from "vue";
import { safeExternalUrl } from "../utils/safeUrl";

const props = defineProps<{
  url: string | null | undefined;
}>();

const safeHref = computed(() => safeExternalUrl(props.url));
const anchorRef = ref<HTMLAnchorElement | null>(null);

watchEffect(() => {
  if (!anchorRef.value) return;
  anchorRef.value.href = safeHref.value;
});
</script>
