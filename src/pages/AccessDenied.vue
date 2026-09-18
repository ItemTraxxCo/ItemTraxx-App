<template>
  <main
    class="access-denied-page"
    :class="{ 'access-denied-page-dark': themeMode === 'dark' }"
    aria-labelledby="access-denied-title"
  >
    <section class="access-denied-panel">
      <p class="access-denied-status">Access denied</p>
      <h1 id="access-denied-title">You don’t have access to this page.</h1>
      <p class="access-denied-message">
        Your account is signed in, but it is not authorized for this workspace or path.
        Contact your workspace administrator if you think this is a mistake.
      </p>

      <div class="access-denied-actions">
        <button type="button" class="access-denied-action access-denied-action-primary" @click="goToWorkspace">
          Go to my workspace
        </button>
        <button type="button" class="access-denied-action" @click="switchAccount">
          Sign in with a different account
        </button>
      </div>
    </section>
  </main>
</template>

<script setup lang="ts">
import { onMounted, onUnmounted, ref } from "vue";
import { useRoute, useRouter } from "vue-router";
import { sanitizeReturnTo } from "../router/returnTo";

const router = useRouter();
const route = useRoute();
const themeMode = ref<"light" | "dark">(
  document.documentElement.getAttribute("data-theme") === "light" ? "light" : "dark",
);
let themeObserver: MutationObserver | null = null;

const goToWorkspace = () => {
  void router.push("/");
};

const switchAccount = () => {
  const raw = route.query.redirect;
  const redirect = sanitizeReturnTo(Array.isArray(raw) ? raw[0] : raw);
  void router.push(
    redirect
      ? { name: "public-login", query: { redirect } }
      : { name: "public-login" },
  );
};

onMounted(() => {
  const syncTheme = () => {
    themeMode.value = document.documentElement.getAttribute("data-theme") === "light" ? "light" : "dark";
  };
  syncTheme();
  themeObserver = new MutationObserver(syncTheme);
  themeObserver.observe(document.documentElement, {
    attributes: true,
    attributeFilter: ["data-theme"],
  });
});

onUnmounted(() => {
  themeObserver?.disconnect();
  themeObserver = null;
});
</script>

<style scoped>
.access-denied-page {
  --access-denied-bg: #f7f7f5;
  --access-denied-text: #171717;
  --access-denied-muted: #5f6368;
  --access-denied-border: #d8d8d3;
  --access-denied-action-bg: #ffffff;
  --access-denied-action-hover: #f1f1ee;
  --access-denied-primary-bg: #171717;
  --access-denied-primary-text: #ffffff;

  align-items: center;
  background: var(--access-denied-bg);
  box-sizing: border-box;
  color: var(--access-denied-text);
  display: flex;
  justify-content: center;
  min-height: 100vh;
  padding: 48px 24px;
  width: 100%;
}

.access-denied-page-dark {
  --access-denied-bg: #101010;
  --access-denied-text: #f3f3f0;
  --access-denied-muted: #a7a7a0;
  --access-denied-border: #2f2f2c;
  --access-denied-action-bg: #151515;
  --access-denied-action-hover: #20201d;
  --access-denied-primary-bg: #f3f3f0;
  --access-denied-primary-text: #101010;
}

.access-denied-panel {
  border: 1px solid var(--access-denied-border);
  max-width: 620px;
  padding: 40px;
  width: 100%;
}

.access-denied-status {
  color: var(--access-denied-muted);
  font-size: 0.8rem;
  letter-spacing: 0.12em;
  margin: 0 0 12px;
  text-transform: uppercase;
}

.access-denied-panel h1 {
  font-size: clamp(2rem, 4vw, 3rem);
  line-height: 1.05;
  margin: 0;
}

.access-denied-message {
  color: var(--access-denied-muted);
  line-height: 1.6;
  margin: 20px 0 0;
}

.access-denied-actions {
  display: flex;
  flex-wrap: wrap;
  gap: 12px;
  margin-top: 28px;
}

.access-denied-action {
  background: var(--access-denied-action-bg);
  border: 1px solid var(--access-denied-border);
  color: var(--access-denied-text);
  cursor: pointer;
  font: inherit;
  padding: 12px 16px;
}

.access-denied-action:hover,
.access-denied-action:focus-visible {
  background: var(--access-denied-action-hover);
}

.access-denied-action-primary {
  background: var(--access-denied-primary-bg);
  border-color: var(--access-denied-primary-bg);
  color: var(--access-denied-primary-text);
}

@media (max-width: 640px) {
  .access-denied-page {
    padding: 24px 16px;
  }

  .access-denied-panel {
    padding: 28px 24px;
  }

  .access-denied-action {
    width: 100%;
  }
}
</style>
