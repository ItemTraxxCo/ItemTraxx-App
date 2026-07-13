<template>
  <div class="hero-copy reveal reveal-left">
    <p class="eyebrow">Inventory tracking made simple</p>
    <h1>ItemTraxx</h1>
    <p class="hero-body">
      Losing track of where stuff goes? ItemTraxx is the right service for you.
    </p>
    <p class="hero-support">
      Contact us to start mastering your inventory with ItemTraxx's
      checkout, returns, and admin management.
    </p>
    <div class="hero-actions">
      <RouterLink class="cta-primary" :to="pricingTo" @click="emit('cta', 'pricing', 'hero')">
        Pricing
      </RouterLink>
      <RouterLink class="cta-secondary" :to="demoTo" @click="emit('cta', 'demo', 'hero')">
        Request Demo
      </RouterLink>
    </div>
    <ul class="hero-points" aria-label="Key product benefits">
      <li>Secure sign-ins and protected admin access</li>
      <li>Clear transaction history and audit visibility</li>
      <li>Easy item and user management features</li>
      <li>Designed for teams, organizations, and individual users</li>
      <li>Built to scale with your inventory and operations</li>
      <li>Avoid common inventory management fails</li>
    </ul>
  </div>
</template>

<script setup lang="ts">
defineProps<{
  pricingTo: string;
  demoTo: string;
}>();

const emit = defineEmits<{
  cta: [cta: "pricing" | "demo", location: "hero"];
}>();
</script>

<style scoped>
.hero-copy {
  opacity: 0;
  filter: blur(12px);
  transition:
    opacity 0.8s cubic-bezier(0.22, 1, 0.36, 1),
    transform 0.8s cubic-bezier(0.22, 1, 0.36, 1),
    filter 0.8s cubic-bezier(0.22, 1, 0.36, 1);
  will-change: opacity, transform, filter;
  transform: translateX(-48px) scale(0.985);
  border: 1px solid rgba(74, 92, 116, 0.34);
  background: linear-gradient(180deg, rgba(20, 27, 37, 0.94) 0%, rgba(12, 17, 24, 0.98) 100%);
  box-shadow: 0 18px 44px rgba(0, 0, 0, 0.22);
  border-radius: 28px;
  padding: 3rem;
  display: grid;
  align-content: center;
}

.hero-copy.is-visible {
  opacity: 1;
  transform: translateX(0) scale(1);
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

.hero-copy h1 {
  margin: 0;
  font-size: clamp(2.8rem, 5vw, 5.6rem);
  line-height: 0.98;
  letter-spacing: -0.06em;
}

.hero-body,
.hero-points li {
  color: rgba(222, 229, 238, 0.76);
}

.hero-body {
  margin: 1.35rem 0 0;
  max-width: 37rem;
  font-size: 1.4rem;
  line-height: 1.5;
  color: rgba(241, 245, 251, 0.9);
}

.hero-support {
  margin: 1.2rem 0 0;
  max-width: 36rem;
  font-size: 1rem;
  line-height: 1.8;
  color: rgba(222, 229, 238, 0.72);
}

.hero-actions {
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

.hero-points {
  margin: 1.7rem 0 0;
  padding-left: 1.2rem;
  display: grid;
  gap: 0.6rem;
}

.hero-points li {
  line-height: 1.5;
}

@media (max-width: 720px) {
  .hero-copy {
    border-radius: 22px;
    padding: 1.2rem;
  }

  .cta-secondary,
  .cta-primary {
    min-height: 1.7rem;
    padding: 0.26rem 0.58rem;
    border-radius: 999px;
  }

  .hero-copy h1 {
    font-size: clamp(2.2rem, 10vw, 3.25rem);
  }
}
</style>
