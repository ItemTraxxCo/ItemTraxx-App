<template>
  <section class="faq-section reveal reveal-up">
    <div class="faq-header">
      <p class="eyebrow">Frequently asked questions</p>
      <h2>Answers to the common stuff.</h2>
    </div>
    <div class="faq-list">
      <article v-for="(item, index) in items" :key="item.q" class="faq-item">
        <button
          type="button"
          class="faq-toggle"
          :id="`landing-new-faq-toggle-${index}`"
          :aria-expanded="openIndex === index"
          :aria-controls="`landing-new-faq-answer-${index}`"
          @click="emit('toggle-faq', index)"
        >
          <span>{{ item.q }}</span>
          <span class="faq-symbol" aria-hidden="true">{{ openIndex === index ? "−" : "+" }}</span>
        </button>
        <div
          :id="`landing-new-faq-answer-${index}`"
          class="faq-answer"
          :class="{ 'is-open': openIndex === index }"
          role="region"
          :aria-labelledby="`landing-new-faq-toggle-${index}`"
        >
          <p>{{ item.a }}</p>
        </div>
      </article>
    </div>
  </section>
</template>

<script setup lang="ts">
defineProps<{
  items: readonly Readonly<{ q: string; a: string }>[];
  openIndex: number | null;
}>();

const emit = defineEmits<{
  "toggle-faq": [index: number];
}>();
</script>

<style scoped>
.faq-section {
  opacity: 0;
  filter: blur(12px);
  transition:
    opacity 0.8s cubic-bezier(0.22, 1, 0.36, 1),
    transform 0.8s cubic-bezier(0.22, 1, 0.36, 1),
    filter 0.8s cubic-bezier(0.22, 1, 0.36, 1);
  will-change: opacity, transform, filter;
  transform: translateY(42px) scale(0.985);
  display: grid;
  gap: 1.25rem;
}

.faq-section.is-visible {
  opacity: 1;
  transform: translateY(0) scale(1);
  filter: blur(0);
}

.eyebrow {
  margin: 0 0 0.85rem;
  font-size: 0.78rem;
  font-weight: 700;
  letter-spacing: 0.16em;
  text-transform: uppercase;
  color: rgba(214, 237, 233, 0.72);
}

.faq-header h2 {
  margin: 0;
  font-size: clamp(2rem, 4vw, 3rem);
  line-height: 1.02;
  letter-spacing: -0.05em;
}

.faq-list {
  display: grid;
  gap: 1rem;
}

.faq-item {
  border-radius: 18px;
  border: 1px solid rgba(74, 92, 116, 0.34);
  background: linear-gradient(180deg, rgba(20, 27, 37, 0.94) 0%, rgba(12, 17, 24, 0.98) 100%);
  overflow: hidden;
}

.faq-toggle {
  width: 100%;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 1rem;
  padding: 1.15rem 1.3rem;
  background: transparent;
  border: 0;
  color: #f6f7fb;
  text-align: left;
  font: inherit;
  cursor: pointer;
}

.faq-toggle:hover,
.faq-toggle:focus-visible {
  background: linear-gradient(180deg, rgba(24, 33, 46, 0.98) 0%, rgba(14, 20, 29, 0.98) 100%);
  box-shadow: none;
}

.faq-symbol {
  font-size: 1.4rem;
  color: rgba(126, 232, 219, 0.9);
}

.faq-answer {
  display: grid;
  grid-template-rows: 0fr;
  transition: grid-template-rows 0.2s ease;
}

.faq-answer > p {
  overflow: hidden;
  margin: 0;
  padding: 0 1.3rem 0;
  color: rgba(222, 229, 238, 0.78);
  line-height: 1.72;
}

.faq-answer.is-open {
  grid-template-rows: 1fr;
}

.faq-answer.is-open > p {
  padding-bottom: 1rem;
}
</style>
