<template>
  <div class="app-shell">
    <div class="top-menu">
      <button type="button" class="menu-button" @click="toggleMenu" aria-label="Open menu">
        <span class="menu-icon" aria-hidden="true">
          <span></span>
          <span></span>
          <span></span>
        </span>
      </button>
      <div v-if="menuOpen" class="menu-dropdown">
        <button type="button" class="menu-item" @click="toggleTheme">
          {{ themeLabel }}
        </button>
        <button type="button" class="menu-item" @click="openAdminPanel">
          Open Admin Panel
        </button>
        <button type="button" class="menu-item danger" @click="logoutTenant">
          Log Out User
        </button>
        <div class="menu-item muted">Version: n/a</div>
        <a class="menu-item" href="mailto:suport@itemtraxx.com">
          Contact Support
        </a>
        <div class="menu-item muted">System Status: n/a</div>
      </div>
    </div>
    <div v-if="!auth.isInitialized" class="page">
      <h1>bye bye 👋</h1>
      <p>Please press Cmd+shift+R (macOS), or Ctrl+Shift+R (Windows) to finish signing out.</p>
    </div>
    <router-view v-else />
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, ref } from "vue";
import { useRouter } from "vue-router";
import { signOut } from "./services/authService";
import { getAuthState } from "./store/authState";

const auth = getAuthState();
const router = useRouter();
const menuOpen = ref(false);
const theme = ref<"light" | "dark">("dark");

const themeLabel = computed(() =>
  theme.value === "dark" ? "Light Mode" : "Dark Mode"
);

const applyTheme = (next: "light" | "dark") => {
  theme.value = next;
  document.documentElement.setAttribute("data-theme", next);
  localStorage.setItem("itemtraxx-theme", next);
};

const toggleTheme = () => {
  applyTheme(theme.value === "dark" ? "light" : "dark");
  menuOpen.value = false;
};

const toggleMenu = () => {
  menuOpen.value = !menuOpen.value;
};

const openAdminPanel = async () => {
  menuOpen.value = false;
  await router.push("/tenant/admin-login");
};

const logoutTenant = async () => {
  menuOpen.value = false;
  await signOut();
  await router.push("/");
};

onMounted(() => {
  const saved = localStorage.getItem("itemtraxx-theme");
  if (saved === "light" || saved === "dark") {
    applyTheme(saved);
  } else {
    applyTheme("dark");
  }
});
</script>
