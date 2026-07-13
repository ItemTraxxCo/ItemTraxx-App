<template>
  <header class="landing-header shell">
    <RouterLink class="brand-mark" :to="homeTo">
      <img class="brand-mark-full" :src="brandLogoUrl" alt="ItemTraxx Co" />
    </RouterLink>
    <nav class="landing-nav" aria-label="Primary">
      <RouterLink :to="pricingTo">Pricing</RouterLink>
      <RouterLink :to="supportTo">Support</RouterLink>
      <a
        class="status-pill"
        :href="statusHref"
        target="_blank"
        rel="noreferrer"
        aria-label="Open system status page"
      >
        <span class="status-dot" :class="statusClass" aria-hidden="true"></span>
        {{ statusLabel }}
      </a>
      <RouterLink class="nav-cta" :to="loginTo" @click="emit('cta', 'login', 'header')">
        Login
      </RouterLink>
    </nav>
  </header>
</template>

<script setup lang="ts">
defineProps<{
  brandLogoUrl: string;
  homeTo: string;
  pricingTo: string;
  supportTo: string;
  loginTo: string;
  statusHref: string;
  statusLabel: string;
  statusClass: string;
}>();

const emit = defineEmits<{
  cta: [cta: "login", location: "header"];
}>();
</script>

<style scoped>
.landing-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 1rem;
  padding: calc(0.6rem + env(safe-area-inset-top, 0px)) 0 1.8rem;
}

.brand-mark {
  display: inline-flex;
  align-items: center;
  text-decoration: none;
}

.brand-mark-full {
  height: 4.5rem;
  width: auto;
  object-fit: contain;
  flex-shrink: 0;
  display: block;
  transform: translateY(-2px);
}

.landing-nav {
  display: flex;
  align-items: center;
  gap: 0.7rem;
  flex-wrap: wrap;
}

.landing-nav a {
  color: rgba(235, 239, 244, 0.82);
  text-decoration: none;
}

.status-pill,
.nav-cta {
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

.status-pill {
  gap: 0.55rem;
  background: rgba(255, 255, 255, 0.05);
  border: 1px solid rgba(255, 255, 255, 0.08);
  white-space: nowrap;
}

.nav-cta {
  background:
    linear-gradient(180deg, rgba(31, 40, 54, 0.94) 0%, rgba(17, 23, 32, 0.98) 100%);
  border: 1px solid rgba(77, 97, 122, 0.4);
  color: #f5f7fb;
  box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.04);
}

.nav-cta:hover {
  border-color: rgba(39, 196, 172, 0.58);
  background:
    linear-gradient(180deg, rgba(29, 66, 75, 0.98) 0%, rgba(16, 37, 48, 1) 100%);
  box-shadow:
    inset 0 1px 0 rgba(115, 255, 233, 0.08),
    0 16px 32px rgba(25, 194, 168, 0.14);
  transform: translateY(-1px);
  color: #e9fffb;
}

.status-dot {
  width: 0.6rem;
  height: 0.6rem;
  border-radius: 999px;
  display: inline-block;
}

.status-ok { background: #2fd17c; }
.status-warn { background: #f5b642; }
.status-down { background: #f35f6f; }
.status-unknown { background: #7b8698; }

@media (max-width: 720px) {
  .landing-header {
    align-items: center;
    flex-direction: row;
    gap: 0.7rem;
    padding: calc(0.35rem + env(safe-area-inset-top, 0px)) 0 1.25rem;
  }

  .landing-nav {
    flex: 1;
    justify-content: flex-end;
    flex-wrap: nowrap;
    gap: 0.5rem;
    min-width: 0;
    overflow-x: auto;
    scrollbar-width: none;
    padding-left: 0.15rem;
  }

  .landing-nav::-webkit-scrollbar {
    display: none;
  }

  .brand-mark {
    flex-shrink: 0;
  }

  .brand-mark-full {
    height: 3rem;
  }

  .landing-nav a,
  .status-pill,
  .nav-cta {
    font-size: 0.74rem;
  }

  .status-pill,
  .nav-cta {
    min-height: 1.7rem;
    padding: 0.26rem 0.58rem;
    border-radius: 999px;
  }

  .status-pill {
    gap: 0.38rem;
    padding-inline: 0.52rem 0.62rem;
  }

  .status-dot {
    width: 0.45rem;
    height: 0.45rem;
  }
}
</style>
