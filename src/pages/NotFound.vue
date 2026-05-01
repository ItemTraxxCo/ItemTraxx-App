<template>
  <main
    class="not-found-page"
    :class="{ 'not-found-page-dark': themeMode === 'dark' }"
    aria-labelledby="not-found-title"
  >
    <section class="not-found-panel">
      <p class="not-found-status">Page not found</p>
      <h1 id="not-found-title">404 Not Found</h1>
      <p class="not-found-message">
        The page you requested does not exist. Check the URL, go back to the previous page,
        or contact support from the menu in the top-right corner.
      </p>
      <p v-if="district.isDistrictHost && !district.districtId" class="not-found-message">
        This district URL is not recognized.
      </p>

      <dl class="not-found-details" aria-label="Error details">
        <div>
          <dt>URL</dt>
          <dd>{{ currentUrl }}</dd>
        </div>
        <div v-if="showDiagnosticInfo">
          <dt>Signed in</dt>
          <dd>{{ auth.isAuthenticated ? "Yes" : "No" }}</dd>
        </div>
        <div v-if="showDiagnosticInfo">
          <dt>Tenant ID</dt>
          <dd>{{ auth.tenantContextId || "-" }}</dd>
        </div>
        <div v-if="showDiagnosticInfo">
          <dt>Role</dt>
          <dd>{{ auth.role || "-" }}</dd>
        </div>
        <div v-if="showDiagnosticInfo">
          <dt>User</dt>
          <dd>{{ auth.email || "-" }}</dd>
        </div>
        <div>
          <dt>Local time</dt>
          <dd>{{ now }}</dd>
        </div>
        <div>
          <dt>Session age</dt>
          <dd>{{ sessionAge }}</dd>
        </div>
      </dl>

      <p class="not-found-support">Please attach a screenshot of this page to your support request.</p>

      <div class="not-found-actions">
        <button
          type="button"
          class="not-found-action not-found-action-primary"
          :disabled="!canGoBack"
          @click="goBack"
        >
          Go back
        </button>
        <button type="button" class="not-found-action" @click="goHome">
          Go back to home
        </button>
        <button
          v-if="auth.isAuthenticated"
          type="button"
          class="not-found-action"
          @click="goAdmin"
        >
          Open admin login
        </button>
      </div>
    </section>
  </main>
</template>

<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref } from "vue";
import { useRoute, useRouter } from "vue-router";
import { getAuthState } from "../store/authState";
import { getDistrictState } from "../store/districtState";

const auth = getAuthState();
const district = getDistrictState();
const route = useRoute();
const router = useRouter();
const now = ref("");
const currentUrl = ref(route.fullPath);
const themeMode = ref<"light" | "dark">("light");
const showDiagnosticInfo = import.meta.env.DEV;
let themeObserver: MutationObserver | null = null;
const canGoBack = computed(() => {
  if (typeof window === "undefined") return false;
  return window.history.length > 1;
});

const refreshNow = () => {
  now.value = new Date().toLocaleString();
  currentUrl.value = typeof window === "undefined" ? route.fullPath : window.location.href;
};

const sessionAge = computed(() => {
  if (!auth.signedInAt) return "-";
  const diffMs = Date.now() - new Date(auth.signedInAt).getTime();
  if (Number.isNaN(diffMs)) return "-";
  const minutes = Math.floor(diffMs / 60000);
  if (minutes < 1) return "Just now";
  if (minutes < 60) return `${minutes} min`;
  const hours = Math.floor(minutes / 60);
  return `${hours} hr`;
});

const goBack = () => {
  if (!canGoBack.value) return;
  router.back();
};

const goHome = () => {
  if (district.isDistrictHost) {
    window.location.assign("https://itemtraxx.com/");
    return;
  }
  router.push("/");
};

const goAdmin = () => {
  router.push("/tenant/admin-login");
};

onMounted(refreshNow);

onMounted(() => {
  const syncTheme = () => {
    themeMode.value = document.documentElement.getAttribute("data-theme") === "dark" ? "dark" : "light";
  };

  syncTheme();
  themeObserver = new MutationObserver(syncTheme);
  themeObserver.observe(document.documentElement, {
    attributes: true,
    attributeFilter: ["data-theme"],
  });
});

onUnmounted(() => {
  if (themeObserver) {
    themeObserver.disconnect();
    themeObserver = null;
  }
});
</script>

<style scoped>
.not-found-page {
  --not-found-bg: #f7f7f5;
  --not-found-text: #171717;
  --not-found-muted: #5f6368;
  --not-found-border: #d8d8d3;
  --not-found-action-bg: #ffffff;
  --not-found-action-hover: #f1f1ee;
  --not-found-primary-bg: #171717;
  --not-found-primary-text: #ffffff;

  align-items: center;
  background: var(--not-found-bg);
  box-sizing: border-box;
  color: var(--not-found-text);
  display: flex;
  justify-content: center;
  min-height: 100vh;
  padding: 48px 24px;
  width: 100%;
}

.not-found-page-dark {
  --not-found-bg: #101010;
  --not-found-text: #f3f3f0;
  --not-found-muted: #a7a7a0;
  --not-found-border: #2f2f2c;
  --not-found-action-bg: #151515;
  --not-found-action-hover: #20201d;
  --not-found-primary-bg: #f3f3f0;
  --not-found-primary-text: #101010;
}

.not-found-panel {
  margin-inline: auto;
  max-width: 680px;
  text-align: center;
  width: min(100%, 680px);
}

.not-found-status {
  color: var(--not-found-muted);
  font-size: 0.78rem;
  font-weight: 700;
  letter-spacing: 0.08em;
  margin: 0 0 14px;
  text-transform: uppercase;
}

.not-found-panel h1 {
  color: var(--not-found-text);
  font-size: clamp(2.2rem, 5vw, 3.4rem);
  line-height: 1.05;
  margin: 0;
}

.not-found-message,
.not-found-support {
  color: var(--not-found-muted);
  font-size: 1rem;
  line-height: 1.65;
  margin: 20px 0 0;
}

.not-found-details {
  border-bottom: 1px solid var(--not-found-border);
  border-top: 1px solid var(--not-found-border);
  display: grid;
  gap: 0;
  margin: 28px auto 0;
  max-width: 560px;
  padding: 12px 0;
  text-align: left;
}

.not-found-details div {
  display: grid;
  gap: 16px;
  grid-template-columns: minmax(96px, 0.45fr) 1fr;
  padding: 8px 0;
}

.not-found-details dt {
  color: var(--not-found-muted);
  font-size: 0.84rem;
  font-weight: 700;
}

.not-found-details dd {
  color: var(--not-found-text);
  font-size: 0.94rem;
  margin: 0;
  overflow-wrap: anywhere;
}

.not-found-actions {
  display: flex;
  flex-wrap: wrap;
  gap: 12px;
  justify-content: center;
  margin-top: 28px;
}

.not-found-action {
  align-items: center;
  background: var(--not-found-action-bg);
  border: 1px solid var(--not-found-border);
  border-radius: 999px;
  color: var(--not-found-text);
  cursor: pointer;
  display: inline-flex;
  font: inherit;
  font-size: 0.95rem;
  font-weight: 700;
  justify-content: center;
  min-height: 44px;
  padding: 0 18px;
}

.not-found-action:hover,
.not-found-action:focus-visible {
  background: var(--not-found-action-hover);
}

.not-found-action:disabled {
  background: var(--not-found-action-bg);
  border-color: var(--not-found-border);
  color: var(--not-found-muted);
  cursor: not-allowed;
  opacity: 0.55;
}

.not-found-action-primary {
  background: var(--not-found-primary-bg);
  border-color: var(--not-found-primary-bg);
  color: var(--not-found-primary-text);
}

.not-found-action-primary:hover,
.not-found-action-primary:focus-visible {
  background: var(--not-found-primary-bg);
}

@media (max-width: 560px) {
  .not-found-page {
    padding: 88px 20px 36px;
  }

  .not-found-details div {
    gap: 4px;
    grid-template-columns: 1fr;
  }

  .not-found-action {
    width: 100%;
  }
}
</style>
