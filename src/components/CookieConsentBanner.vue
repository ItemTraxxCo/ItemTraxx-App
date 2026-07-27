<template>
  <Teleport to="body">
    <div class="cookie-consent-banner" role="dialog" aria-live="polite" aria-label="Cookie preferences">
      <h2 class="cookie-consent-title">Cookie preferences</h2>
      <p class="cookie-consent-body">
        Essential cookies keep sign-in and security working. Optional analytics and diagnostics help us fix issues
        and improve the product.
      </p>
      <p class="cookie-consent-legal">
        See <RouterLink to="/privacy">Privacy Policy</RouterLink> and <RouterLink to="/cookies">Cookies Notice</RouterLink>.
      </p>

      <div class="cookie-consent-actions">
        <button type="button" class="button-link cookie-consent-primary" @click="$emit('accept-all')">
          Accept all
        </button>
        <div class="cookie-consent-row">
          <button type="button" class="button-link" @click="$emit('essential-only')">Essential only</button>
        </div>
      </div>

      <div class="cookie-consent-prefs">
        <button
          type="button"
          class="cookie-consent-prefs-toggle"
          :aria-expanded="expanded"
          @click="expanded = !expanded"
        >
          Manage preferences <span class="cookie-consent-chev">▾</span>
        </button>
        <div class="cookie-consent-collapse" :class="{ 'is-open': expanded }">
          <div class="cookie-consent-panel">
            <div class="cookie-consent-panel-inner">
              <div class="cookie-consent-option">
                <span class="cookie-consent-option-name">Analytics</span>
                <label class="cookie-consent-switch">
                  <input v-model="analytics" type="checkbox" />
                  <span class="cookie-consent-switch-track"></span>
                  <span class="cookie-consent-switch-thumb"></span>
                </label>
              </div>
              <div class="cookie-consent-option">
                <span class="cookie-consent-option-name">Diagnostics</span>
                <label class="cookie-consent-switch">
                  <input v-model="diagnostics" type="checkbox" />
                  <span class="cookie-consent-switch-track"></span>
                  <span class="cookie-consent-switch-thumb"></span>
                </label>
              </div>
              <div class="cookie-consent-panel-actions">
                <button
                  type="button"
                  class="button-link cookie-consent-primary"
                  @click="$emit('save-preferences', { analytics, diagnostics })"
                >
                  Save choices
                </button>
              </div>
            </div>
          </div>
        </div>
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
const expanded = ref(false);
</script>

<style scoped>
.cookie-consent-banner {
  position: fixed;
  right: 1.25rem;
  bottom: 1.25rem;
  width: min(360px, calc(100vw - 2rem));
  box-sizing: border-box;
  z-index: 1200;
  padding: 1.25rem;
  border: 1px solid var(--border);
  border-radius: 18px;
  background: var(--surface);
  box-shadow: 0 16px 48px rgba(0, 0, 0, 0.32);
}

.cookie-consent-title {
  margin: 0 0 0.6rem;
  font-size: 0.98rem;
  font-weight: 600;
}

.cookie-consent-body {
  margin: 0 0 0.9rem;
  font-size: 0.87rem;
  line-height: 1.55;
  color: var(--muted);
}

.cookie-consent-legal {
  margin: 0 0 1rem;
  font-size: 0.8rem;
  color: var(--muted);
}

.cookie-consent-actions {
  display: flex;
  flex-direction: column;
  gap: 0.5rem;
}

.cookie-consent-actions .button-link {
  width: 100%;
}

.cookie-consent-row {
  display: flex;
  gap: 0.5rem;
}

.cookie-consent-row .button-link {
  flex: 1;
}

.cookie-consent-prefs {
  margin-top: 0.9rem;
  border-top: 1px solid var(--border);
}

.cookie-consent-prefs-toggle {
  width: 100%;
  cursor: pointer;
  padding: 0.7rem 0 0.1rem;
  font-size: 0.82rem;
  color: var(--muted);
  display: flex;
  align-items: center;
  justify-content: space-between;
  background: none;
  border: none;
  border-radius: 6px;
  font-family: inherit;
  outline: none;
}

.cookie-consent-prefs-toggle:focus-visible {
  outline: 2px solid var(--accent);
  outline-offset: 2px;
}

.cookie-consent-chev {
  transition: transform 0.25s ease;
  display: inline-block;
}

.cookie-consent-prefs-toggle[aria-expanded="true"] .cookie-consent-chev {
  transform: rotate(180deg);
}

.cookie-consent-collapse {
  display: grid;
  grid-template-rows: 0fr;
  transition: grid-template-rows 0.28s ease;
}

.cookie-consent-collapse.is-open {
  grid-template-rows: 1fr;
}

.cookie-consent-panel {
  overflow: hidden;
  min-height: 0;
}

.cookie-consent-option {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 0.55rem 0;
  border-bottom: 1px solid var(--border);
}

.cookie-consent-option:last-of-type {
  border-bottom: none;
}

.cookie-consent-option-name {
  font-size: 0.85rem;
}

.cookie-consent-switch {
  position: relative;
  width: 2.4rem;
  height: 1.4rem;
  flex-shrink: 0;
}

.cookie-consent-switch input {
  opacity: 0;
  width: 100%;
  height: 100%;
  margin: 0;
  position: absolute;
  cursor: pointer;
}

.cookie-consent-switch-track {
  position: absolute;
  inset: 0;
  border-radius: 999px;
  background: var(--surface-3);
  border: 1px solid var(--border);
  transition: background 0.2s;
}

.cookie-consent-switch-thumb {
  position: absolute;
  top: 2px;
  left: 2px;
  width: 1rem;
  height: 1rem;
  border-radius: 50%;
  background: var(--muted);
  transition: transform 0.2s, background 0.2s;
}

.cookie-consent-switch input:checked ~ .cookie-consent-switch-track {
  background: var(--accent);
  border-color: var(--accent);
}

.cookie-consent-switch input:checked ~ .cookie-consent-switch-thumb {
  transform: translateX(1rem);
  background: var(--button-primary-text);
}

.cookie-consent-panel-actions {
  margin-top: 0.7rem;
}

.cookie-consent-panel-actions .button-link {
  width: 100%;
}

@media (max-width: 480px) {
  .cookie-consent-banner {
    left: 0.6rem;
    right: 0.6rem;
    bottom: 0.6rem;
    width: auto;
    padding: 0.9rem;
    border-radius: 14px;
  }

  .cookie-consent-title {
    font-size: 0.88rem;
    margin-bottom: 0.45rem;
  }

  .cookie-consent-body {
    font-size: 0.8rem;
    line-height: 1.45;
    margin-bottom: 0.7rem;
  }

  .cookie-consent-legal {
    font-size: 0.74rem;
    margin-bottom: 0.75rem;
  }

  .cookie-consent-actions .button-link {
    min-height: 2.25rem;
    font-size: 0.85rem;
  }

  .cookie-consent-prefs-toggle {
    padding: 0.55rem 0 0.1rem;
    font-size: 0.78rem;
  }

  .cookie-consent-option-name {
    font-size: 0.8rem;
  }
}
</style>
