<template>
  <Analytics :before-send="sanitizeVercelAnalyticsEvent" />
</template>

<script setup lang="ts">
import { Analytics } from "@vercel/analytics/vue";
import { sanitizeVercelAnalyticsEvent } from "../services/analyticsService";
</script>
