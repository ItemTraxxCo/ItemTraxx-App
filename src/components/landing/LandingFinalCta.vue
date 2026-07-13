<template>
  <section class="final-strip reveal reveal-up">
    <div>
      <p class="eyebrow">Ready to simplify your inventory tracking?</p>
      <h2>Get started with ItemTraxx and advance your inventory management.</h2>
      <p>Simplify your inventory management with ItemTraxx today.</p>
      <div class="final-actions">
        <RouterLink class="cta-primary" :to="loginTo" @click="emit('cta', 'login', 'final')">
          Go to Login
        </RouterLink>
        <RouterLink class="cta-secondary" :to="pricingTo" @click="emit('cta', 'pricing', 'final')">
          Pricing
        </RouterLink>
      </div>
    </div>
  </section>
</template>

<script setup lang="ts">
defineProps<{
  loginTo: string;
  pricingTo: string;
}>();

const emit = defineEmits<{
  cta: [cta: "login" | "pricing", location: "final"];
}>();
</script>

<style scoped>
.final-strip {
  opacity: 0;
  filter: blur(12px);
  transition:
    opacity 0.8s cubic-bezier(0.22, 1, 0.36, 1),
    transform 0.8s cubic-bezier(0.22, 1, 0.36, 1),
    filter 0.8s cubic-bezier(0.22, 1, 0.36, 1);
  will-change: opacity, transform, filter;
  transform: translateY(42px) scale(0.985);
  border: 1px solid rgba(74, 92, 116, 0.34);
  background: linear-gradient(180deg, rgba(20, 27, 37, 0.94) 0%, rgba(12, 17, 24, 0.98) 100%);
  box-shadow: 0 18px 44px rgba(0, 0, 0, 0.22);
  border-radius: 28px;
  padding: 2.1rem;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 1.5rem;
}

.final-strip.is-visible {
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

.final-strip h2 {
  margin: 0;
  font-size: clamp(2.8rem, 5vw, 5.6rem);
  line-height: 0.98;
  letter-spacing: -0.06em;
}

.final-strip p {
  color: rgba(222, 229, 238, 0.76);
}

.final-actions {
  display: flex;
  gap: 0.95rem;
  flex-wrap: wrap;
  margin-top: 1.9rem;
}

.cta-secondary,
.cta-primary {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  min-height: 2.15rem;
  padding: 0.42rem 0.85rem;
  border-radius: 10px;
  text-decoration: none;
  font-weight: 600;
  transition: transform 0.16s ease, box-shadow 0.16s ease, background-color 0.16s ease;
}

.cta-secondary {
  background:
    linear-gradient(180deg, rgba(31, 40, 54, 0.94) 0%, rgba(17, 23, 32, 0.98) 100%);
  border: 1px solid rgba(77, 97, 122, 0.4);
  color: #f5f7fb;
  box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.04);
}

.cta-primary,
.cta-secondary:hover,
.cta-primary:hover {
  box-shadow: 0 16px 32px rgba(25, 67, 155, 0.18);
  transform: translateY(-1px);
}

.cta-primary {
  background-image: linear-gradient(90deg, #19c2a8 0%, #19439b 100%);
  background-repeat: no-repeat;
  background-size: 100% 100%;
  background-origin: border-box;
  color: #f7fbff;
  border: 1px solid transparent;
}

.cta-secondary:hover {
  border-color: rgba(39, 196, 172, 0.58);
  background:
    linear-gradient(180deg, rgba(29, 66, 75, 0.98) 0%, rgba(16, 37, 48, 1) 100%);
  box-shadow:
    inset 0 1px 0 rgba(115, 255, 233, 0.08),
    0 16px 32px rgba(25, 194, 168, 0.14);
  color: #e9fffb;
}

@media (max-width: 1100px) {
  .final-strip {
    grid-template-columns: 1fr;
    align-items: flex-start;
    flex-direction: column;
  }
}

@media (max-width: 720px) {
  .final-strip {
    border-radius: 22px;
    padding: 1.2rem;
  }

  .cta-secondary,
  .cta-primary {
    min-height: 1.7rem;
    padding: 0.26rem 0.58rem;
    border-radius: 999px;
  }

  .final-strip h2 {
    font-size: clamp(2.2rem, 10vw, 3.25rem);
  }
}
</style>
