import { computed, ref } from "vue";

const STORAGE_KEY = "itemtraxx-theme";

const readStoredTheme = (): "light" | "dark" => {
  try {
    const saved = localStorage.getItem(STORAGE_KEY);
    return saved === "dark" || saved === "light" ? saved : "light";
  } catch {
    // Ignore localStorage failures (private mode / blocked storage).
    return "light";
  }
};

// Module-level singleton: theme and themeLabel are intentionally declared at module scope
// so that every useTheme() call site shares the exact same reactive state (tested in useTheme.spec.ts).
const theme = ref<"light" | "dark">(readStoredTheme());
const themeLabel = computed(() => (theme.value === "dark" ? "Light Mode" : "Dark Mode"));

const setTheme = (next: "light" | "dark") => {
  theme.value = next;
  document.documentElement.setAttribute("data-theme", next);
  try {
    localStorage.setItem(STORAGE_KEY, next);
  } catch {
    // Ignore localStorage failures (private mode / blocked storage).
  }
};

const toggleTheme = () => setTheme(theme.value === "dark" ? "light" : "dark");

export const useTheme = () => ({ theme, themeLabel, setTheme, toggleTheme });
