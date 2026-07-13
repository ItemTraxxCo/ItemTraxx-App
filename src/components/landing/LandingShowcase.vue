<template>
  <div class="hero-showcase">
    <article class="showcase-card showcase-primary reveal reveal-right reveal-delay-1">
      <div class="showcase-header">
        <p class="showcase-label">{{ showcase.label }}</p>
        <span class="showcase-pill">{{ showcase.pill }}</span>
      </div>
      <h2>{{ showcase.title }}</h2>
      <p>{{ showcase.body }}</p>
      <ul class="showcase-points">
        <li v-for="point in showcase.points" :key="point">{{ point }}</li>
      </ul>
    </article>

    <article class="showcase-card showcase-secondary reveal reveal-up reveal-delay-2">
      <p class="showcase-label">Checkout and return preview</p>
      <picture>
        <source
          type="image/webp"
          :srcset="`${image800} 800w, ${image1200} 1200w, ${image1600} 1600w`"
          sizes="(max-width: 900px) 92vw, 640px"
        />
        <img
          class="showcase-image"
          :src="imageFallback"
          alt="Checkout and return interface preview"
          loading="lazy"
          decoding="async"
          width="1600"
          height="810"
        />
      </picture>
    </article>
  </div>
</template>

<script setup lang="ts">
defineProps<{
  showcase: Readonly<{
    label: string;
    pill: string;
    title: string;
    body: string;
    points: readonly string[];
  }>;
  imageFallback: string;
  image800: string;
  image1200: string;
  image1600: string;
}>();
</script>

<style scoped>
.hero-showcase {
  display: grid;
  gap: 1.3rem;
}

.showcase-card {
  opacity: 0;
  filter: blur(12px);
  transition:
    opacity 0.8s cubic-bezier(0.22, 1, 0.36, 1),
    transform 0.8s cubic-bezier(0.22, 1, 0.36, 1),
    filter 0.8s cubic-bezier(0.22, 1, 0.36, 1);
  will-change: opacity, transform, filter;
  border-radius: 24px;
  padding: 1.75rem;
  border: 1px solid rgba(74, 92, 116, 0.34);
  background: linear-gradient(180deg, rgba(20, 27, 37, 0.94) 0%, rgba(12, 17, 24, 0.98) 100%);
}

.reveal-right {
  transform: translateX(48px) scale(0.985);
}

.reveal-up {
  transform: translateY(42px) scale(0.985);
}

.reveal.is-visible {
  opacity: 1;
  transform: translateY(0);
  filter: blur(0);
}

.reveal.is-visible.reveal-right {
  transform: translateX(0) scale(1);
}

.reveal.is-visible.reveal-up {
  transform: translateY(0) scale(1);
}

.reveal-delay-1 { transition-delay: 0.14s; }
.reveal-delay-2 { transition-delay: 0.28s; }

.showcase-primary {
  display: grid;
  gap: 1.1rem;
}

.showcase-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 0.8rem;
}

.showcase-label {
  margin: 0 0 0.85rem;
  font-size: 0.78rem;
  font-weight: 700;
  letter-spacing: 0.16em;
  text-transform: uppercase;
  color: rgba(214, 237, 233, 0.72);
}

.showcase-pill {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  padding: 0.35rem 0.75rem;
  border-radius: 999px;
  font-size: 0.78rem;
  font-weight: 600;
  background: rgba(25, 194, 168, 0.11);
  color: #85efe1;
  border: 1px solid rgba(25, 194, 168, 0.24);
}

.showcase-primary h2 {
  margin: 0;
  font-size: clamp(1.8rem, 3vw, 2.65rem);
  line-height: 1.12;
  letter-spacing: -0.05em;
  padding: 0.08em 0 0 0.04em;
}

.showcase-card p {
  color: rgba(222, 229, 238, 0.76);
}

.showcase-points {
  margin: 0;
  padding-left: 1.1rem;
  color: rgba(232, 238, 246, 0.84);
}

.showcase-points li + li {
  margin-top: 0.6rem;
}

.showcase-secondary {
  overflow: hidden;
}

.showcase-image {
  display: block;
  width: 100%;
  height: auto;
  border-radius: 18px;
  border: 1px solid rgba(94, 113, 138, 0.22);
}

@media (max-width: 720px) {
  .showcase-card {
    border-radius: 22px;
  }
}
</style>
