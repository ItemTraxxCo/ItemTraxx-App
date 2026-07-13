<template>
  <section class="feature-band reveal reveal-up">
    <div class="feature-band-copy reveal reveal-left">
      <p class="eyebrow">Simple usage</p>
      <h2>Simple UI keeps everything minimal, sleek, and easy to navigate.</h2>
      <p>
        Simple UI keeps everything minimal, sleek, and easy to navigate, confusion free.
      </p>
      <ul class="feature-checks">
        <li>Fast sign in and transaction flow</li>
        <li>Clean and clear user-facing workflow design</li>
        <li>Light and dark appearance modes available</li>
      </ul>
    </div>
    <div class="feature-band-visual reveal reveal-right reveal-delay-1">
      <picture>
        <source
          type="image/webp"
          :srcset="`${image800} 800w, ${image1200} 1200w, ${image1600} 1600w`"
          sizes="(max-width: 900px) 92vw, 700px"
        />
        <img
          class="feature-image"
          :src="imageFallback"
          alt="Admin interface preview"
          loading="lazy"
          decoding="async"
          width="1600"
          height="934"
        />
      </picture>
    </div>
  </section>

  <section class="ops-grid reveal reveal-up">
    <article class="ops-panel reveal reveal-left reveal-delay-1">
      <p class="eyebrow">Easy management</p>
      <h3>Management workflows without the spreadsheet sprawl.</h3>
      <p>
        With many useful features such as item management, user management, transaction logs,
        and more, keeping track of inventory has never been easier.
      </p>
    </article>
    <article class="ops-panel reveal reveal-up reveal-delay-2">
      <p class="eyebrow">Why it matters</p>
      <h3>Master your inventory.</h3>
      <p>
        ItemTraxx solves issues with keeping track of inventory: who has what item, when it was
        taken, when it was returned, and what items are currently out.
      </p>
    </article>
    <article class="ops-panel reveal reveal-right reveal-delay-3">
      <p class="eyebrow">Fit</p>
      <h3>Built for teams, organizations, and individual users.</h3>
      <p>
        ItemTraxx is flexible and scalable, making it a fit for schools, smaller and larger teams, and
        organizations of any size that need cleaner inventory operations. We also offer individual plans
        for single-user use.
      </p>
    </article>
  </section>
</template>

<script setup lang="ts">
defineProps<{
  imageFallback: string;
  image800: string;
  image1200: string;
  image1600: string;
}>();
</script>

<style scoped>
.feature-band,
.feature-band-copy,
.feature-band-visual,
.ops-grid,
.ops-panel {
  opacity: 0;
  filter: blur(12px);
  transition:
    opacity 0.8s cubic-bezier(0.22, 1, 0.36, 1),
    transform 0.8s cubic-bezier(0.22, 1, 0.36, 1),
    filter 0.8s cubic-bezier(0.22, 1, 0.36, 1);
  will-change: opacity, transform, filter;
}

.reveal-up {
  transform: translateY(42px) scale(0.985);
}

.reveal-left {
  transform: translateX(-48px) scale(0.985);
}

.reveal-right {
  transform: translateX(48px) scale(0.985);
}

.reveal.is-visible {
  opacity: 1;
  transform: translateY(0);
  filter: blur(0);
}

.reveal.is-visible.reveal-left,
.reveal.is-visible.reveal-right {
  transform: translateX(0) scale(1);
}

.reveal.is-visible.reveal-up {
  transform: translateY(0) scale(1);
}

.reveal-delay-1 { transition-delay: 0.14s; }
.reveal-delay-2 { transition-delay: 0.28s; }
.reveal-delay-3 { transition-delay: 0.42s; }

.feature-band,
.ops-panel {
  border: 1px solid rgba(74, 92, 116, 0.34);
  background: linear-gradient(180deg, rgba(20, 27, 37, 0.94) 0%, rgba(12, 17, 24, 0.98) 100%);
  box-shadow: 0 18px 44px rgba(0, 0, 0, 0.22);
}

.eyebrow {
  margin: 0 0 0.85rem;
  font-size: 0.78rem;
  font-weight: 700;
  letter-spacing: 0.16em;
  text-transform: uppercase;
  color: rgba(214, 237, 233, 0.72);
}

.feature-band-copy h2 {
  margin: 0;
  font-size: clamp(2.8rem, 5vw, 5.6rem);
  line-height: 0.98;
  letter-spacing: -0.06em;
}

.feature-band-copy p,
.ops-panel p,
.ops-panel li {
  color: rgba(222, 229, 238, 0.76);
}

.feature-band {
  display: grid;
  grid-template-columns: minmax(0, 0.95fr) minmax(20rem, 1.05fr);
  gap: 1.6rem;
  border-radius: 28px;
  padding: 1.85rem;
}

.feature-band-copy,
.feature-band-visual {
  border-radius: 22px;
  overflow: hidden;
}

.feature-checks {
  margin: 1.2rem 0 0;
  padding-left: 1.2rem;
  color: rgba(235, 240, 248, 0.84);
}

.feature-checks li + li {
  margin-top: 0.6rem;
}

.feature-image {
  display: block;
  width: 100%;
  height: auto;
  border-radius: 18px;
  border: 1px solid rgba(94, 113, 138, 0.22);
}

.ops-grid {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 1.2rem;
}

.ops-panel {
  border-radius: 22px;
  padding: 1.7rem;
}

.ops-panel h3 {
  margin: 0 0 0.8rem;
  font-size: 1.35rem;
  letter-spacing: -0.04em;
}

@media (max-width: 1100px) {
  .feature-band,
  .ops-grid {
    grid-template-columns: 1fr;
  }
}

@media (max-width: 720px) {
  .feature-band,
  .ops-panel {
    border-radius: 22px;
  }

  .feature-band {
    padding: 1.2rem;
  }

  .feature-band-copy h2 {
    font-size: clamp(2.2rem, 10vw, 3.25rem);
  }
}
</style>
