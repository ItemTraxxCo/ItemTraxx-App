<template>
  <Teleport to="body">
    <div class="cookie-consent-banner" role="dialog" aria-live="polite" aria-label="Cookie preferences">
      <div class="cookie-consent-copy">
        <p class="cookie-consent-eyebrow">Cookie Preferences</p>
        <p>
          ItemTraxx uses essential cookies for sign-in and security. We also use analytics tools to
          understand site usage and performance. See <RouterLink to="/cookies">Cookies</RouterLink> for details.
        </p>
        <p class="cookie-consent-legal">
          By continuing, you agree to the <RouterLink to="/privacy">Privacy Policy</RouterLink> and
          <RouterLink to="/legal">Terms of Use</RouterLink>.
        </p>
      </div>
      <div class="cookie-consent-actions">
        <button type="button" class="button-link cookie-consent-secondary" @click="$emit('essential-only')">
          Essential only
        </button>
        <button type="button" class="button-primary cookie-consent-primary" @click="$emit('accept-all')">
          Accept all
        </button>
      </div>
    </div>
  </Teleport>
</template>

<script setup lang="ts">
import { Teleport } from "vue";
import { RouterLink } from "vue-router";

defineEmits<{
  (e: "essential-only"): void;
  (e: "accept-all"): void;
}>();
</script>

<style scoped>
.cookie-consent-banner {
  position: fixed;
  left: 50%;
  bottom: 1rem;
  width: min(1100px, calc(100vw - 1rem));
  transform: translateX(-50%);
  z-index: 1200;
  display: flex;
  align-items: flex-end;
  justify-content: space-between;
  gap: 1rem;
  padding: 1rem 1.1rem;
  border: 1px solid color-mix(in srgb, var(--border) 78%, var(--accent) 22%);
  border-radius: 18px;
  background: color-mix(in srgb, var(--surface) 92%, rgba(5, 10, 18, 0.92) 8%);
  box-shadow: 0 24px 60px rgba(0, 0, 0, 0.28);
  backdrop-filter: blur(18px);
}

.cookie-consent-copy {
  max-width: 46rem;
}

.cookie-consent-eyebrow {
  margin: 0 0 0.35rem;
  font-size: 0.78rem;
  letter-spacing: 0.14em;
  text-transform: uppercase;
  color: var(--muted);
}

.cookie-consent-copy p:last-child {
  margin: 0;
  color: var(--text);
}

.cookie-consent-legal {
  margin-top: 0.55rem;
  font-size: 0.92rem;
  color: var(--muted);
}

.cookie-consent-actions {
  display: flex;
  align-items: center;
  gap: 0.75rem;
  flex-wrap: wrap;
}

.cookie-consent-secondary,
.cookie-consent-primary {
  white-space: nowrap;
}

@media (max-width: 760px) {
  .cookie-consent-banner {
    flex-direction: column;
    align-items: stretch;
  }

  .cookie-consent-actions {
    justify-content: stretch;
  }

  .cookie-consent-actions > * {
    flex: 1 1 auto;
    justify-content: center;
  }
}
</style>
