<template>
  <div class="submit-confirmation-page-shell">
    <div class="submit-confirmation-orb" aria-hidden="true"></div>

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
  --submit-page-bg:
    radial-gradient(circle at top, rgba(25, 194, 168, 0.16), transparent 34%),
    radial-gradient(circle at bottom right, rgba(25, 67, 155, 0.18), transparent 38%),
    linear-gradient(180deg, #11151c 0%, #090c12 100%);
  --submit-panel-bg: linear-gradient(180deg, #161b23 0%, #0d1117 100%);
  --submit-orb:
    radial-gradient(circle at 10% 25%, rgba(255, 255, 255, 0.08), transparent 26%),
    linear-gradient(160deg, rgba(25, 194, 168, 0.16), rgba(6, 9, 15, 0.92));
  --submit-border: rgba(70, 84, 101, 0.42);
  --submit-eyebrow: rgba(214, 237, 233, 0.72);
  --submit-copy: rgba(227, 234, 242, 0.82);
  --submit-button-text: #f8fbff;
  background: var(--submit-page-bg);
}

html[data-theme="light"] .submit-confirmation-page-shell {
  --submit-page-bg:
    radial-gradient(circle at top, rgba(25, 194, 168, 0.16), transparent 30%),
    radial-gradient(circle at bottom right, rgba(25, 67, 155, 0.14), transparent 34%),
    linear-gradient(180deg, #eef5f8 0%, #dde7ee 100%);
  --submit-panel-bg: linear-gradient(180deg, #fbfdff 0%, #edf3f7 100%);
  --submit-orb:
    radial-gradient(circle at 10% 25%, rgba(255, 255, 255, 0.18), transparent 26%),
    linear-gradient(160deg, rgba(25, 194, 168, 0.16), rgba(25, 67, 155, 0.22));
  --submit-border: rgba(148, 163, 184, 0.34);
  --submit-eyebrow: rgba(30, 41, 59, 0.64);
  --submit-copy: rgba(17, 24, 39, 0.78);
  --submit-button-text: #f8fbff;
  background: var(--submit-page-bg);
}

.submit-confirmation-orb {
  position: absolute;
  inset: auto -10% -12% 12%;
  height: 58%;
  border-radius: 999px;
  background: var(--submit-orb);
  filter: blur(2px);
  transform: rotate(-8deg);
  opacity: 0.9;
  pointer-events: none;
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
  border-radius: 24px;
  background: var(--submit-panel-bg);
  border: 1px solid var(--submit-border);
  box-shadow: 0 24px 60px rgba(0, 0, 0, 0.18);
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
  background-image: linear-gradient(90deg, #19c2a8 0%, #19439b 100%);
  box-shadow: 0 16px 28px rgba(25, 67, 155, 0.24);
  transition: transform 0.16s ease, box-shadow 0.16s ease, filter 0.16s ease;
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
