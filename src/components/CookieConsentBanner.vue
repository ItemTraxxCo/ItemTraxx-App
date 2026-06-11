<template>
  <Teleport to="body">
    <div class="cookie-consent-banner" role="dialog" aria-live="polite" aria-label="Cookie preferences">
      <div class="cookie-consent-copy">
        <p class="cookie-consent-eyebrow">Cookie Preferences</p>
        <p>
          ItemTraxx uses essential cookies for sign-in and security. With your consent, we may also use analytics and diagnostics
          (for example PostHog and Sentry) to understand usage, performance, and reliability.
        </p>
        <div class="cookie-consent-options" aria-label="Optional cookie categories">
          <label><input v-model="analytics" type="checkbox" /> Analytics</label>
          <label><input v-model="diagnostics" type="checkbox" /> Diagnostics and error monitoring</label>
        </div>
        <p class="cookie-consent-legal">See the <RouterLink to="/privacy">Privacy Policy</RouterLink> and <RouterLink to="/cookies">Cookies Notice</RouterLink>.</p>
      </div>
      <div class="cookie-consent-actions">
        <button type="button" class="button-link cookie-consent-secondary" @click="$emit('essential-only')">
          Essential only
        </button>
        <button type="button" class="button-link cookie-consent-secondary" @click="$emit('save-preferences', { analytics, diagnostics })">
          Save choices
        </button>
        <button type="button" class="button-primary cookie-consent-primary" @click="$emit('accept-all')">
          Accept all
        </button>
      </div>
    </div>
  </Teleport>
</template>

<script setup lang="ts">
import { ref, Teleport } from "vue";
import { RouterLink } from "vue-router";

defineEmits<{
  (e: "essential-only"): void;
  (e: "accept-all"): void;
  (e: "save-preferences", preferences: { analytics: boolean; diagnostics: boolean }): void;
}>();

const analytics = ref(false);
const diagnostics = ref(false);
</script>

<style scoped>
.cookie-consent-banner {
  position: fixed;
  left: 50%;
  bottom: 1rem;
  width: min(1280px, calc(100vw - 2rem));
  box-sizing: border-box;
  transform: translateX(-50%);
  z-index: 1200;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 1.5rem;
  padding: 1.15rem 1.35rem;
  border: 1px solid color-mix(in srgb, var(--border) 78%, var(--accent) 22%);
  border-radius: 18px;
  background: color-mix(in srgb, var(--surface) 92%, rgba(5, 10, 18, 0.92) 8%);
}

.cookie-consent-copy {
  max-width: 58rem;
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

.cookie-consent-options {
  display: flex;
  gap: 0.75rem;
  margin-top: 1rem;
  flex-wrap: wrap;
}

.cookie-consent-options label {
  display: inline-flex;
  align-items: center;
  gap: 0.6rem;
  min-height: 2.75rem;
  padding: 0.6rem 0.8rem;
  border: 1px solid var(--border);
  border-radius: 10px;
  background: color-mix(in srgb, var(--surface) 88%, var(--accent) 12%);
}

.cookie-consent-options input {
  width: 1rem;
  height: 1rem;
  margin: 0;
}

.cookie-consent-actions {
  display: grid;
  grid-template-columns: repeat(2, minmax(9rem, 1fr));
  gap: 0.75rem;
  width: min(30rem, 34vw);
  min-width: 21rem;
  align-self: center;
}

.cookie-consent-secondary,
.cookie-consent-primary {
  justify-content: center;
  white-space: nowrap;
}

.cookie-consent-primary {
  grid-column: 1 / -1;
  grid-row: 1;
}

@media (max-width: 760px) {
  .cookie-consent-banner {
    left: 0.75rem;
    right: 0.75rem;
    bottom: 0.75rem;
    width: auto;
    flex-direction: column;
    align-items: stretch;
    transform: none;
  }

  .cookie-consent-actions {
    display: flex;
    min-width: 0;
    flex-wrap: wrap;
    justify-content: stretch;
  }

  .cookie-consent-actions > * {
    flex: 1 1 auto;
    justify-content: center;
  }
}
</style>
