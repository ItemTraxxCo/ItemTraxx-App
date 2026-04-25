<template>
  <div class="submit-confirmation-page-shell">
    <main class="submit-confirmation-layout">
      <section class="submit-confirmation-panel">
        <p class="submit-confirmation-eyebrow">Submission received</p>
        <div class="submit-confirmation-copy">
          <h1>Thanks for reaching out.</h1>
          <p>Our team will review your submission and get back to you as soon as possible.</p>
        </div>

        <div class="submit-confirmation-actions">
          <RouterLink class="submit-confirmation-home" to="/" @click="clearSubmissionConfirmation">
            Back to homepage
          </RouterLink>
        </div>
      </section>
    </main>
  </div>
</template>

<script setup lang="ts">
import { RouterLink } from "vue-router";
import { clearSubmissionConfirmation } from "../services/submissionConfirmation";
</script>

<style>
.submit-confirmation-page-shell {
  box-sizing: border-box;
  min-height: 100vh;
  min-height: 100dvh;
  width: 100%;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: calc(2rem + env(safe-area-inset-top, 0px)) 1.25rem calc(2rem + env(safe-area-inset-bottom, 0px));
  overflow: hidden;
  position: relative;
}

html[data-theme="dark"] .submit-confirmation-page-shell {
  --submit-page-bg: #101010;
  --submit-panel-bg: transparent;
  --submit-border: #2f2f2c;
  --submit-eyebrow: #a7a7a0;
  --submit-copy: #a7a7a0;
  --submit-button-bg: #f3f3f0;
  --submit-button-text: #101010;
  background: var(--submit-page-bg);
  color: #f3f3f0;
}

html[data-theme="light"] .submit-confirmation-page-shell {
  --submit-page-bg: #f7f7f5;
  --submit-panel-bg: transparent;
  --submit-border: #d8d8d3;
  --submit-eyebrow: #5f6368;
  --submit-copy: #5f6368;
  --submit-button-bg: #171717;
  --submit-button-text: #ffffff;
  background: var(--submit-page-bg);
  color: #171717;
}

.submit-confirmation-layout {
  position: relative;
  z-index: 1;
  width: min(100%, 32rem);
  max-width: 100%;
}

.submit-confirmation-layout,
.submit-confirmation-panel,
.submit-confirmation-home {
  box-sizing: border-box;
}

.submit-confirmation-panel {
  display: grid;
  gap: 1rem;
  padding: 1.55rem;
  border-radius: 0;
  background: var(--submit-panel-bg);
  border: 0;
}

.submit-confirmation-eyebrow {
  margin: 0;
  font-size: 0.8rem;
  letter-spacing: 0.14em;
  text-transform: uppercase;
  color: var(--submit-eyebrow);
}

.submit-confirmation-copy {
  display: grid;
  gap: 0.7rem;
}

.submit-confirmation-copy h1 {
  margin: 0;
  font-size: clamp(1.7rem, 3.6vw, 2.1rem);
  line-height: 1.08;
  letter-spacing: -0.02em;
}

.submit-confirmation-copy p {
  margin: 0;
  font-size: 1rem;
  line-height: 1.65;
  color: var(--submit-copy);
}

.submit-confirmation-actions {
  display: flex;
}

.submit-confirmation-home {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  min-height: 2.1rem;
  padding: 0.45rem 0.85rem;
  border-radius: 999px;
  text-decoration: none;
  font-size: 0.88rem;
  font-weight: 600;
  color: var(--submit-button-text);
  background: var(--submit-button-bg);
  transition: transform 0.16s ease, filter 0.16s ease;
}

.submit-confirmation-home:hover {
  text-decoration: none;
  transform: translateY(-1px);
  filter: brightness(1.05);
}

@media (max-width: 720px) {
  .submit-confirmation-page-shell {
    padding-inline: max(0.9rem, env(safe-area-inset-left, 0px));
  }

  .submit-confirmation-layout {
    width: 100%;
  }

  .submit-confirmation-panel {
    width: 100%;
    padding: 1.2rem;
    border-radius: 20px;
  }

  .submit-confirmation-copy p {
    font-size: 0.95rem;
  }
}
</style>
