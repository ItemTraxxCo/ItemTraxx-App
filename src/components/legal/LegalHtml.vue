<template>
  <div ref="host" class="legal-html"></div>
</template>

<script setup lang="ts">
import { onMounted, ref, watch } from "vue";

// Mounts an already-sanitized DocumentFragment (see src/legal/markdown.ts).
// Cloning keeps the source fragment reusable across re-renders.
const props = defineProps<{ fragment: DocumentFragment | null }>();
const host = ref<HTMLElement | null>(null);

const mount = () => {
  if (!host.value) return;
  if (props.fragment) host.value.replaceChildren(props.fragment.cloneNode(true));
  else host.value.replaceChildren();
};

onMounted(mount);
watch(() => props.fragment, mount);
</script>
