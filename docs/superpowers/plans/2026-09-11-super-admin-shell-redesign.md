# Super Admin Shell Redesign Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the Super Admin area's flat pill-nav + inert top-right menu with a grouped, collapsible left sidebar (PostHog-style) that also hosts the theme toggle and sign-out, and give `SuperAdminHome.vue` a real dashboard top section (stats, quick actions, needs-attention).

**Architecture:** A new `SuperAdminLayout.vue` becomes the parent route component for a nested `/super-admin/*` route tree (converted from today's flat route list, same names/paths/meta). It composes a new `SuperAdminSidebar.vue` (data-driven nav list) and `SuperAdminProfileMenu.vue` (avatar + theme/sign-out popover) around a `<router-view>`. Theme state and the sign-out flow are extracted from `App.vue` into shared composables (`useTheme`, `useLogout`) so both the global top bar and the new sidebar read/write the same state. `App.vue` stops rendering its top bar on `/super-admin/*` routes.

**Tech Stack:** Vue 3 `<script setup>`, Vue Router (nested routes), Vitest + `@vue/test-utils`. No new dependency — icons are hand-rolled inline SVG matching the app's existing `.menu-item-icon` convention, styled entirely with the app's existing CSS-variable tokens (`--surface`, `--surface-2`, `--surface-3`, `--border`, `--muted`, `--accent`, `--text`, `--page-bg`, `--danger`, `--warning`).

**Spec:** `docs/superpowers/specs/2026-09-11-super-admin-shell-redesign-design.md`

---

### Task 1: `useTheme` composable

**Files:**
- Create: `src/composables/useTheme.ts`
- Test: `src/composables/useTheme.spec.ts`

Extracts the theme `ref`/localStorage logic that today lives only inside `App.vue` (`App.vue:137-138`, `250`, `266-272`) into a module-level singleton so both `App.vue` and the new sidebar's profile menu read/write the exact same reactive state.

- [ ] **Step 1: Write the failing test**

```ts
// src/composables/useTheme.spec.ts
import { beforeEach, describe, expect, it } from "vitest";
import { useTheme } from "./useTheme";

describe("useTheme", () => {
  beforeEach(() => {
    useTheme().setTheme("light");
  });

  it("shares theme state across every call site", () => {
    const a = useTheme();
    const b = useTheme();
    a.setTheme("dark");
    expect(b.theme.value).toBe("dark");
    expect(b.themeLabel.value).toBe("Light Mode");
  });

  it("persists the chosen theme to localStorage and the DOM", () => {
    useTheme().setTheme("dark");
    expect(localStorage.getItem("itemtraxx-theme")).toBe("dark");
    expect(document.documentElement.getAttribute("data-theme")).toBe("dark");
  });

  it("toggleTheme flips between light and dark", () => {
    useTheme().setTheme("light");
    useTheme().toggleTheme();
    expect(useTheme().theme.value).toBe("dark");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/composables/useTheme.spec.ts`
Expected: FAIL — `Cannot find module './useTheme'`

- [ ] **Step 3: Write the implementation**

```ts
// src/composables/useTheme.ts
import { computed, ref } from "vue";

const STORAGE_KEY = "itemtraxx-theme";

const readStoredTheme = (): "light" | "dark" => {
  const saved = localStorage.getItem(STORAGE_KEY);
  return saved === "dark" || saved === "light" ? saved : "light";
};

const theme = ref<"light" | "dark">(readStoredTheme());
const themeLabel = computed(() => (theme.value === "dark" ? "Light Mode" : "Dark Mode"));

const setTheme = (next: "light" | "dark") => {
  theme.value = next;
  document.documentElement.setAttribute("data-theme", next);
  localStorage.setItem(STORAGE_KEY, next);
};

const toggleTheme = () => setTheme(theme.value === "dark" ? "light" : "dark");

export const useTheme = () => ({ theme, themeLabel, setTheme, toggleTheme });
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/composables/useTheme.spec.ts`
Expected: PASS (3 tests)

- [ ] **Step 5: Commit**

```bash
git add src/composables/useTheme.ts src/composables/useTheme.spec.ts
git commit -m "feat(super-admin): add shared useTheme composable"
```

---

### Task 2: `useLogout` composable

**Files:**
- Create: `src/composables/useLogout.ts`
- Test: `src/composables/useLogout.spec.ts`

Extracts the confirm-dialog + sign-out + redirect logic that today lives only inside `App.vue`'s `logoutTenant` (`App.vue:276-288`), so the new sidebar's profile menu can trigger the identical flow without duplicating it.

- [ ] **Step 1: Write the failing test**

```ts
// src/composables/useLogout.spec.ts
import { beforeEach, describe, expect, it, vi } from "vitest";
import { mount } from "@vue/test-utils";
import { createMemoryHistory, createRouter, type Router } from "vue-router";
import { useLogout } from "./useLogout";

vi.mock("../services/authService", () => ({
  getPostSignOutUrl: vi.fn(() => "/login"),
  signOut: vi.fn(async () => ({ ok: true })),
}));

const mountLogout = async (): Promise<{ logout: () => Promise<void>; router: Router }> => {
  const router = createRouter({
    history: createMemoryHistory(),
    routes: [
      { path: "/", name: "root", component: { template: "<div />" } },
      { path: "/login", name: "login", component: { template: "<div />" } },
    ],
  });
  await router.isReady();
  let logout!: () => Promise<void>;
  mount(
    {
      setup() {
        logout = useLogout().logout;
        return () => null;
      },
    },
    { global: { plugins: [router] } },
  );
  return { logout, router };
};

describe("useLogout", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("does nothing if the confirm dialog is dismissed", async () => {
    vi.spyOn(window, "confirm").mockReturnValue(false);
    const { logout } = await mountLogout();
    const authService = await import("../services/authService");
    await logout();
    expect(authService.signOut).not.toHaveBeenCalled();
  });

  it("signs out and redirects to a relative post-sign-out URL via the router", async () => {
    vi.spyOn(window, "confirm").mockReturnValue(true);
    const { logout, router } = await mountLogout();
    const pushSpy = vi.spyOn(router, "push");
    await logout();
    expect(pushSpy).toHaveBeenCalledWith("/login");
  });

  it("alerts and does not redirect when sign-out fails", async () => {
    vi.spyOn(window, "confirm").mockReturnValue(true);
    const alertSpy = vi.spyOn(window, "alert").mockImplementation(() => {});
    const authService = await import("../services/authService");
    vi.mocked(authService.signOut).mockResolvedValueOnce({ ok: false } as Awaited<ReturnType<typeof authService.signOut>>);
    const { logout, router } = await mountLogout();
    const pushSpy = vi.spyOn(router, "push");
    await logout();
    expect(alertSpy).toHaveBeenCalled();
    expect(pushSpy).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/composables/useLogout.spec.ts`
Expected: FAIL — `Cannot find module './useLogout'`

- [ ] **Step 3: Write the implementation**

```ts
// src/composables/useLogout.ts
import { useRouter } from "vue-router";

export const useLogout = () => {
  const router = useRouter();

  const logout = async () => {
    if (!window.confirm("Are you sure you want to log out?")) return;
    const { getPostSignOutUrl, signOut } = await import("../services/authService");
    const nextUrl = getPostSignOutUrl();
    const result = await signOut();
    if (!result.ok) {
      window.alert("Unable to complete logout. Please try again.");
      return;
    }
    if (nextUrl.startsWith("http")) window.location.assign(nextUrl);
    else await router.push(nextUrl);
  };

  return { logout };
};
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/composables/useLogout.spec.ts`
Expected: PASS (3 tests)

- [ ] **Step 5: Commit**

```bash
git add src/composables/useLogout.ts src/composables/useLogout.spec.ts
git commit -m "feat(super-admin): add shared useLogout composable"
```

---

### Task 3: Icon set + `SuperAdminIcon.vue`

**Files:**
- Create: `src/components/superadmin/icons.ts`
- Create: `src/components/superadmin/SuperAdminIcon.vue`
- Test: `src/components/superadmin/SuperAdminIcon.spec.ts`

No new dependency — matches the app's existing hand-rolled inline-SVG convention (`.menu-item-icon` in `src/styles/app-shell.css:946-955`: 24x24 viewBox, `stroke: currentColor`, `stroke-width: 1.8`, round caps/joins).

- [ ] **Step 1: Write the failing test**

```ts
// src/components/superadmin/SuperAdminIcon.spec.ts
import { describe, expect, it } from "vitest";
import { mount } from "@vue/test-utils";
import SuperAdminIcon from "./SuperAdminIcon.vue";

describe("SuperAdminIcon", () => {
  it("renders a path for a path-based icon", () => {
    const wrapper = mount(SuperAdminIcon, { props: { name: "home" } });
    expect(wrapper.find("path").exists()).toBe(true);
  });

  it("renders a circle for an icon with a circle segment", () => {
    const wrapper = mount(SuperAdminIcon, { props: { name: "user" } });
    expect(wrapper.find("circle").exists()).toBe(true);
  });

  it("renders a rect for an icon with a rect segment", () => {
    const wrapper = mount(SuperAdminIcon, { props: { name: "idCard" } });
    expect(wrapper.find("rect").exists()).toBe(true);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/components/superadmin/SuperAdminIcon.spec.ts`
Expected: FAIL — `Cannot find module './SuperAdminIcon.vue'`

- [ ] **Step 3: Write `icons.ts`**

```ts
// src/components/superadmin/icons.ts
export type IconName =
  | "home"
  | "building"
  | "user"
  | "idCard"
  | "shield"
  | "package"
  | "graduationCap"
  | "megaphone"
  | "fileText"
  | "wrench"
  | "lifeBuoy"
  | "trendingUp"
  | "users"
  | "settings"
  | "chevronLeft"
  | "chevronRight"
  | "chevronDown"
  | "theme"
  | "logout"
  | "plus";

export type IconSpec = {
  paths?: string[];
  circles?: { cx: number; cy: number; r: number }[];
  rects?: { x: number; y: number; width: number; height: number; rx?: number }[];
};

export const ICONS: Record<IconName, IconSpec> = {
  home: { paths: ["M3 9.5 12 3l9 6.5V21a1 1 0 0 1-1 1h-4a1 1 0 0 1-1-1v-5H9v5a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1z"] },
  building: {
    paths: [
      "M6 22V4a1 1 0 0 1 1-1h9a1 1 0 0 1 1 1v18",
      "M2 22h20",
      "M9 6h1M9 10h1M9 14h1M14 6h1M14 10h1M14 14h1",
    ],
  },
  user: {
    paths: ["M4 21c0-4.4 3.6-7 8-7s8 2.6 8 7"],
    circles: [{ cx: 12, cy: 8, r: 4 }],
  },
  idCard: {
    paths: ["M2 10h20"],
    rects: [{ x: 2, y: 5, width: 20, height: 14, rx: 2 }],
  },
  shield: { paths: ["M12 2 4 5v6c0 5 3.5 9 8 11 4.5-2 8-6 8-11V5z"] },
  package: {
    paths: ["M21 8 12 3 3 8l9 5 9-5Z", "M3 8v9l9 5 9-5V8", "M12 13v9"],
  },
  graduationCap: {
    paths: ["M22 10 12 5 2 10l10 5 10-5Z", "M6 12.5V17c0 1.7 2.7 3 6 3s6-1.3 6-3v-4.5"],
  },
  megaphone: {
    paths: [
      "M3 11v3a1 1 0 0 0 1 1h2l4 4v-13l-4 4H4a1 1 0 0 0-1 1Z",
      "M15 8a4 4 0 0 1 0 8",
      "M18 5a8 8 0 0 1 0 14",
    ],
  },
  fileText: {
    paths: [
      "M14 3v4a1 1 0 0 0 1 1h4",
      "M6 3h8l5 5v12a1 1 0 0 1-1 1H6a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1Z",
      "M9 13h6M9 17h6",
    ],
  },
  wrench: { paths: ["M14.7 6.3a4 4 0 1 0-5.4 5.4L3 18l3 3 6.3-6.3a4 4 0 0 0 5.4-5.4l-2.8 2.8-2-2Z"] },
  lifeBuoy: {
    paths: ["m8.5 8.5-3-3M15.5 8.5l3-3M15.5 15.5l3 3M8.5 15.5l-3 3"],
    circles: [
      { cx: 12, cy: 12, r: 9 },
      { cx: 12, cy: 12, r: 4 },
    ],
  },
  trendingUp: { paths: ["M3 17l6-6 4 4 8-8", "M15 7h6v6"] },
  users: {
    paths: ["M2 21v-2a5 5 0 0 1 5-5h4a5 5 0 0 1 5 5v2", "M23 21v-1.5a4 4 0 0 0-3-3.9"],
    circles: [
      { cx: 9, cy: 7, r: 4 },
      { cx: 17, cy: 7, r: 3 },
    ],
  },
  settings: {
    paths: [
      "M19.4 15a1.7 1.7 0 0 0 .3 1.9l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.9-.3 1.7 1.7 0 0 0-1 1.6V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1-1.6 1.7 1.7 0 0 0-1.9.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.9 1.7 1.7 0 0 0-1.6-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.6-1 1.7 1.7 0 0 0-.3-1.9l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.9.3H9a1.7 1.7 0 0 0 1-1.6V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.6 1.7 1.7 0 0 0 1.9-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.9V9a1.7 1.7 0 0 0 1.6 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.6 1Z",
    ],
    circles: [{ cx: 12, cy: 12, r: 3 }],
  },
  chevronLeft: { paths: ["M15 18l-6-6 6-6"] },
  chevronRight: { paths: ["M9 18l6-6-6-6"] },
  chevronDown: { paths: ["M6 9l6 6 6-6"] },
  theme: {
    paths: [
      "M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4",
    ],
    circles: [{ cx: 12, cy: 12, r: 4 }],
  },
  logout: { paths: ["M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4", "M16 17l5-5-5-5", "M21 12H9"] },
  plus: { paths: ["M12 5v14M5 12h14"] },
};
```

- [ ] **Step 4: Write `SuperAdminIcon.vue`**

```vue
<!-- src/components/superadmin/SuperAdminIcon.vue -->
<template>
  <svg class="sa-icon" viewBox="0 0 24 24" aria-hidden="true">
    <path v-for="(d, i) in spec.paths ?? []" :key="`p${i}`" :d="d" />
    <circle v-for="(c, i) in spec.circles ?? []" :key="`c${i}`" :cx="c.cx" :cy="c.cy" :r="c.r" />
    <rect
      v-for="(r, i) in spec.rects ?? []"
      :key="`r${i}`"
      :x="r.x"
      :y="r.y"
      :width="r.width"
      :height="r.height"
      :rx="r.rx ?? 0"
    />
  </svg>
</template>

<script setup lang="ts">
import { computed } from "vue";
import { ICONS, type IconName } from "./icons";

const props = defineProps<{ name: IconName }>();
const spec = computed(() => ICONS[props.name]);
</script>

<style scoped>
.sa-icon {
  width: 18px;
  height: 18px;
  flex-shrink: 0;
  fill: none;
  stroke: currentColor;
  stroke-width: 1.8;
  stroke-linecap: round;
  stroke-linejoin: round;
}
</style>
```

- [ ] **Step 5: Run test to verify it passes**

Run: `npx vitest run src/components/superadmin/SuperAdminIcon.spec.ts`
Expected: PASS (3 tests)

- [ ] **Step 6: Commit**

```bash
git add src/components/superadmin/icons.ts src/components/superadmin/SuperAdminIcon.vue src/components/superadmin/SuperAdminIcon.spec.ts
git commit -m "feat(super-admin): add inline icon set matching existing icon style"
```

---

### Task 4: `SuperAdminSidebar.vue`

**Files:**
- Create: `src/components/superadmin/SuperAdminSidebar.vue`
- Test: `src/components/superadmin/SuperAdminSidebar.spec.ts`

Renders the approved Group-B nav structure from a static config array. Highlights the current route. Self-contained collapsed styling (via its own `collapsed` prop), so it doesn't depend on reaching across a parent component's scoped CSS.

- [ ] **Step 1: Write the failing test**

```ts
// src/components/superadmin/SuperAdminSidebar.spec.ts
import { describe, expect, it } from "vitest";
import { mount } from "@vue/test-utils";
import { createMemoryHistory, createRouter } from "vue-router";
import SuperAdminSidebar from "./SuperAdminSidebar.vue";

const routes = [
  { path: "/super-admin", name: "super-admin-home", component: { template: "<div />" } },
  { path: "/super-admin/workspaces", name: "super-admin-workspaces", component: { template: "<div />" } },
  { path: "/super-admin/admins", name: "super-admin-admins", component: { template: "<div />" } },
  { path: "/super-admin/tenant-accounts", name: "super-admin-tenant-accounts", component: { template: "<div />" } },
  { path: "/super-admin/super-admins", name: "super-admin-super-admins", component: { template: "<div />" } },
  { path: "/super-admin/items", name: "super-admin-items", component: { template: "<div />" } },
  { path: "/super-admin/borrowers", name: "super-admin-borrowers", component: { template: "<div />" } },
  { path: "/super-admin/broadcasts", name: "super-admin-broadcasts", component: { template: "<div />" } },
  { path: "/super-admin/logs", name: "super-admin-logs", component: { template: "<div />" } },
  { path: "/internal", name: "internal-ops", component: { template: "<div />" } },
  { path: "/super-admin/support-requests", name: "super-admin-support-requests", component: { template: "<div />" } },
  { path: "/super-admin/sales-leads", name: "super-admin-sales-leads", component: { template: "<div />" } },
  { path: "/super-admin/customers", name: "super-admin-customers", component: { template: "<div />" } },
  { path: "/super-admin/settings", name: "super-admin-settings", component: { template: "<div />" } },
];

const mountSidebar = async (initialRouteName: string, collapsed = false) => {
  const router = createRouter({ history: createMemoryHistory(), routes });
  router.push({ name: initialRouteName });
  await router.isReady();
  return mount(SuperAdminSidebar, { props: { collapsed }, global: { plugins: [router] } });
};

describe("SuperAdminSidebar", () => {
  it("renders every group label when expanded", async () => {
    const wrapper = await mountSidebar("super-admin-home");
    expect(wrapper.text()).toContain("Organizations");
    expect(wrapper.text()).toContain("Inventory Data");
    expect(wrapper.text()).toContain("Monitoring");
    expect(wrapper.text()).toContain("Customers");
    expect(wrapper.text()).toContain("Platform");
  });

  it("hides group labels when collapsed", async () => {
    const wrapper = await mountSidebar("super-admin-home", true);
    expect(wrapper.text()).not.toContain("Organizations");
  });

  it("marks the current route's item active", async () => {
    const wrapper = await mountSidebar("super-admin-workspaces");
    const active = wrapper.find(".sa-item.active");
    expect(active.text()).toContain("Workspaces");
  });

  it("links Internal Ops to the internal-ops route", async () => {
    const wrapper = await mountSidebar("super-admin-home");
    const link = wrapper.findAll("a").find((a) => a.text().includes("Internal Ops"));
    expect(link?.attributes("href")).toBe("/internal");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/components/superadmin/SuperAdminSidebar.spec.ts`
Expected: FAIL — `Cannot find module './SuperAdminSidebar.vue'`

- [ ] **Step 3: Write the implementation**

```vue
<!-- src/components/superadmin/SuperAdminSidebar.vue -->
<template>
  <nav class="sa-nav" :class="{ collapsed }" aria-label="Super admin navigation">
    <template v-for="group in NAV_GROUPS" :key="group.name ?? '_ungrouped'">
      <div v-if="group.name" class="sa-group-label">{{ group.name }}</div>
      <RouterLink
        v-for="item in group.items"
        :key="item.routeName"
        :to="{ name: item.routeName }"
        class="sa-item"
        :class="{ active: route.name === item.routeName }"
        :title="collapsed ? item.label : undefined"
      >
        <SuperAdminIcon :name="item.icon" />
        <span class="sa-item-label">{{ item.label }}</span>
      </RouterLink>
    </template>
  </nav>
</template>

<script setup lang="ts">
import { useRoute, RouterLink } from "vue-router";
import SuperAdminIcon from "./SuperAdminIcon.vue";
import type { IconName } from "./icons";

defineProps<{ collapsed: boolean }>();

type NavItem = { icon: IconName; label: string; routeName: string };
type NavGroup = { name: string | null; items: NavItem[] };

const NAV_GROUPS: NavGroup[] = [
  { name: null, items: [{ icon: "home", label: "Home", routeName: "super-admin-home" }] },
  {
    name: "Organizations",
    items: [
      { icon: "building", label: "Workspaces", routeName: "super-admin-workspaces" },
      { icon: "user", label: "Workspace Admins", routeName: "super-admin-admins" },
      { icon: "idCard", label: "Tenant Accounts", routeName: "super-admin-tenant-accounts" },
      { icon: "shield", label: "Super Admins", routeName: "super-admin-super-admins" },
    ],
  },
  {
    name: "Inventory Data",
    items: [
      { icon: "package", label: "Items", routeName: "super-admin-items" },
      { icon: "graduationCap", label: "Borrowers", routeName: "super-admin-borrowers" },
      { icon: "megaphone", label: "Broadcasts", routeName: "super-admin-broadcasts" },
    ],
  },
  {
    name: "Monitoring",
    items: [
      { icon: "fileText", label: "Logs", routeName: "super-admin-logs" },
      { icon: "wrench", label: "Internal Ops", routeName: "internal-ops" },
    ],
  },
  {
    name: "Customers",
    items: [
      { icon: "lifeBuoy", label: "Support Requests", routeName: "super-admin-support-requests" },
      { icon: "trendingUp", label: "Sales Leads", routeName: "super-admin-sales-leads" },
      { icon: "users", label: "Customers", routeName: "super-admin-customers" },
    ],
  },
  {
    name: "Platform",
    items: [{ icon: "settings", label: "Settings", routeName: "super-admin-settings" }],
  },
];

const route = useRoute();
</script>

<style scoped>
.sa-nav {
  flex: 1;
  min-height: 0;
  overflow-y: auto;
  padding: 0.6rem 0.5rem;
  display: flex;
  flex-direction: column;
}

.sa-nav.collapsed {
  padding: 0.6rem 0;
  align-items: center;
}

.sa-group-label {
  font-size: 0.68rem;
  letter-spacing: 0.06em;
  text-transform: uppercase;
  color: var(--muted);
  padding: 0.85rem 0.6rem 0.35rem;
}

.sa-nav.collapsed .sa-group-label {
  display: none;
}

.sa-item {
  display: flex;
  align-items: center;
  gap: 0.6rem;
  padding: 0.45rem 0.6rem;
  border-radius: 8px;
  color: var(--text);
  text-decoration: none;
  white-space: nowrap;
}

.sa-nav.collapsed .sa-item {
  justify-content: center;
  width: 2.25rem;
  padding: 0.5rem;
}

.sa-nav.collapsed .sa-item-label {
  display: none;
}

.sa-item:hover {
  background: var(--surface-2);
  text-decoration: none;
}

.sa-item.active {
  background: var(--surface-3);
  font-weight: 600;
  position: relative;
}

.sa-item.active::before {
  content: "";
  position: absolute;
  left: -0.5rem;
  top: 0.35rem;
  bottom: 0.35rem;
  width: 3px;
  border-radius: 2px;
  background: var(--accent);
}

.sa-nav.collapsed .sa-item.active::before {
  left: 0;
}
</style>
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/components/superadmin/SuperAdminSidebar.spec.ts`
Expected: PASS (4 tests)

- [ ] **Step 5: Commit**

```bash
git add src/components/superadmin/SuperAdminSidebar.vue src/components/superadmin/SuperAdminSidebar.spec.ts
git commit -m "feat(super-admin): add grouped sidebar navigation"
```

---

### Task 5: `SuperAdminProfileMenu.vue`

**Files:**
- Create: `src/components/superadmin/SuperAdminProfileMenu.vue`
- Test: `src/components/superadmin/SuperAdminProfileMenu.spec.ts`

The bottom-of-sidebar avatar block that replaces the global top-right dropdown for `/super-admin/*` routes: theme toggle + sign out, using the shared composables from Tasks 1-2. "My Account" is dropped — it's gated to `tenant_account` in `AuthenticatedNavigation.vue:79` and was never reachable for `super_admin`.

- [ ] **Step 1: Write the failing test**

```ts
// src/components/superadmin/SuperAdminProfileMenu.spec.ts
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mount } from "@vue/test-utils";
import { createMemoryHistory, createRouter } from "vue-router";
import SuperAdminProfileMenu from "./SuperAdminProfileMenu.vue";
import { getAuthState } from "../../store/authState";
import { useTheme } from "../../composables/useTheme";

const mountMenu = async (collapsed = false) => {
  const router = createRouter({
    history: createMemoryHistory(),
    routes: [{ path: "/", name: "root", component: { template: "<div />" } }],
  });
  await router.isReady();
  return mount(SuperAdminProfileMenu, { props: { collapsed }, global: { plugins: [router] } });
};

describe("SuperAdminProfileMenu", () => {
  beforeEach(() => {
    getAuthState().email = "dennis@itemtraxx.com";
    useTheme().setTheme("light");
  });

  afterEach(() => {
    getAuthState().email = null;
    vi.restoreAllMocks();
  });

  it("shows the signed-in admin's email when expanded", async () => {
    const wrapper = await mountMenu(false);
    expect(wrapper.text()).toContain("dennis@itemtraxx.com");
  });

  it("opens the popover with theme toggle and sign out on click", async () => {
    const wrapper = await mountMenu(false);
    expect(wrapper.find(".sa-popover").exists()).toBe(false);
    await wrapper.find(".sa-profile-trigger").trigger("click");
    expect(wrapper.find(".sa-popover").exists()).toBe(true);
    expect(wrapper.text()).toContain("Sign out");
    expect(wrapper.text()).toContain("Dark Mode");
  });

  it("toggles theme and closes the popover", async () => {
    const wrapper = await mountMenu(false);
    await wrapper.find(".sa-profile-trigger").trigger("click");
    await wrapper.findAll(".sa-popover-item")[0].trigger("click");
    expect(document.documentElement.getAttribute("data-theme")).toBe("dark");
    expect(wrapper.find(".sa-popover").exists()).toBe(false);
  });

  it("asks for confirmation before signing out", async () => {
    const confirmSpy = vi.spyOn(window, "confirm").mockReturnValue(false);
    const wrapper = await mountMenu(false);
    await wrapper.find(".sa-profile-trigger").trigger("click");
    await wrapper.findAll(".sa-popover-item")[1].trigger("click");
    expect(confirmSpy).toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/components/superadmin/SuperAdminProfileMenu.spec.ts`
Expected: FAIL — `Cannot find module './SuperAdminProfileMenu.vue'`

- [ ] **Step 3: Write the implementation**

```vue
<!-- src/components/superadmin/SuperAdminProfileMenu.vue -->
<template>
  <div class="sa-profile" :class="{ collapsed }">
    <button
      type="button"
      class="sa-profile-trigger"
      aria-haspopup="menu"
      :aria-expanded="open"
      @click="open = !open"
    >
      <span class="sa-avatar">{{ initials }}</span>
      <span v-if="!collapsed" class="sa-profile-meta">
        <span class="sa-profile-name">{{ auth.email || "Super Admin" }}</span>
        <span class="sa-profile-role">Super Admin</span>
      </span>
      <SuperAdminIcon v-if="!collapsed" name="chevronDown" />
    </button>
    <Transition name="sa-popover">
      <div v-if="open" class="sa-popover" role="menu">
        <button type="button" class="sa-popover-item" role="menuitem" @click="handleToggleTheme">
          <SuperAdminIcon name="theme" />
          {{ themeLabel }}
        </button>
        <div class="sa-popover-divider"></div>
        <button type="button" class="sa-popover-item danger" role="menuitem" @click="handleLogout">
          <SuperAdminIcon name="logout" />
          Sign out
        </button>
      </div>
    </Transition>
  </div>
</template>

<script setup lang="ts">
import { computed, ref } from "vue";
import SuperAdminIcon from "./SuperAdminIcon.vue";
import { useTheme } from "../../composables/useTheme";
import { useLogout } from "../../composables/useLogout";
import { getAuthState } from "../../store/authState";

defineProps<{ collapsed: boolean }>();

const auth = getAuthState();
const { themeLabel, toggleTheme } = useTheme();
const { logout } = useLogout();
const open = ref(false);

const initials = computed(() => (auth.email || "SA").slice(0, 2).toUpperCase());

const handleToggleTheme = () => {
  toggleTheme();
  open.value = false;
};

const handleLogout = async () => {
  await logout();
  open.value = false;
};
</script>

<style scoped>
.sa-profile {
  position: relative;
  border-top: 1px solid var(--border);
  padding: 0.6rem;
  width: 100%;
}

.sa-profile.collapsed {
  display: flex;
  justify-content: center;
}

.sa-profile-trigger {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  width: 100%;
  background: transparent;
  border: none;
  padding: 0.3rem;
  border-radius: 8px;
  cursor: pointer;
  color: var(--text);
  font: inherit;
  text-align: left;
}

.sa-profile.collapsed .sa-profile-trigger {
  width: auto;
}

.sa-profile-trigger:hover {
  background: var(--surface-2);
}

.sa-avatar {
  width: 28px;
  height: 28px;
  border-radius: 50%;
  background: var(--surface-3);
  color: var(--text);
  display: flex;
  align-items: center;
  justify-content: center;
  font-weight: 700;
  font-size: 0.7rem;
  flex-shrink: 0;
}

.sa-profile-meta {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
}

.sa-profile-name {
  font-weight: 600;
  font-size: 0.8rem;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.sa-profile-role {
  font-size: 0.7rem;
  color: var(--muted);
}

.sa-popover {
  position: absolute;
  bottom: calc(100% + 0.4rem);
  left: 0.6rem;
  right: 0.6rem;
  background: var(--surface);
  border: 1px solid var(--border);
  border-radius: 10px;
  padding: 0.35rem;
  box-shadow: 0 8px 24px rgba(0, 0, 0, 0.18);
  z-index: 20;
}

.sa-profile.collapsed .sa-popover {
  left: 0.6rem;
  right: auto;
  width: 180px;
}

.sa-popover-item {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  width: 100%;
  background: transparent;
  border: none;
  padding: 0.5rem 0.6rem;
  border-radius: 6px;
  color: var(--text);
  font: inherit;
  text-align: left;
  cursor: pointer;
}

.sa-popover-item:hover {
  background: var(--surface-2);
}

.sa-popover-item.danger {
  color: var(--danger);
}

.sa-popover-divider {
  height: 1px;
  background: var(--border);
  margin: 0.3rem 0.2rem;
}

.sa-popover-enter-active,
.sa-popover-leave-active {
  transition: opacity 0.12s ease, transform 0.12s ease;
}

.sa-popover-enter-from,
.sa-popover-leave-to {
  opacity: 0;
  transform: translateY(4px);
}
</style>
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/components/superadmin/SuperAdminProfileMenu.spec.ts`
Expected: PASS (4 tests)

- [ ] **Step 5: Commit**

```bash
git add src/components/superadmin/SuperAdminProfileMenu.vue src/components/superadmin/SuperAdminProfileMenu.spec.ts
git commit -m "feat(super-admin): add sidebar profile menu with theme toggle and sign out"
```

---

### Task 6: `SuperAdminLayout.vue`

**Files:**
- Create: `src/components/superadmin/SuperAdminLayout.vue`
- Test: `src/components/superadmin/SuperAdminLayout.spec.ts`

The shell: brand header, collapse toggle, sidebar, profile menu, and the routed page content. Owns the collapse state and its `localStorage` persistence.

- [ ] **Step 1: Write the failing test**

```ts
// src/components/superadmin/SuperAdminLayout.spec.ts
import { beforeEach, describe, expect, it } from "vitest";
import { mount } from "@vue/test-utils";
import { createMemoryHistory, createRouter } from "vue-router";
import SuperAdminLayout from "./SuperAdminLayout.vue";

const buildRouter = () =>
  createRouter({
    history: createMemoryHistory(),
    routes: [
      {
        path: "/super-admin",
        component: SuperAdminLayout,
        children: [
          { path: "", name: "super-admin-home", component: { template: "<div class='stub'>Home content</div>" } },
          { path: "workspaces", name: "super-admin-workspaces", component: { template: "<div />" } },
          { path: "admins", name: "super-admin-admins", component: { template: "<div />" } },
          { path: "tenant-accounts", name: "super-admin-tenant-accounts", component: { template: "<div />" } },
          { path: "super-admins", name: "super-admin-super-admins", component: { template: "<div />" } },
          { path: "items", name: "super-admin-items", component: { template: "<div />" } },
          { path: "borrowers", name: "super-admin-borrowers", component: { template: "<div />" } },
          { path: "broadcasts", name: "super-admin-broadcasts", component: { template: "<div />" } },
          { path: "logs", name: "super-admin-logs", component: { template: "<div />" } },
          { path: "support-requests", name: "super-admin-support-requests", component: { template: "<div />" } },
          { path: "sales-leads", name: "super-admin-sales-leads", component: { template: "<div />" } },
          { path: "customers", name: "super-admin-customers", component: { template: "<div />" } },
          { path: "settings", name: "super-admin-settings", component: { template: "<div />" } },
        ],
      },
      { path: "/internal", name: "internal-ops", component: { template: "<div />" } },
    ],
  });

const mountAt = async (routeName: string) => {
  const router = buildRouter();
  router.push({ name: routeName });
  await router.isReady();
  return mount({ template: "<router-view />" }, { global: { plugins: [router] } });
};

describe("SuperAdminLayout", () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it("renders the sidebar and the matched child route", async () => {
    const wrapper = await mountAt("super-admin-home");
    expect(wrapper.find(".sa-side").exists()).toBe(true);
    expect(wrapper.text()).toContain("Home content");
  });

  it("starts expanded by default and collapses on toggle, persisting the choice", async () => {
    const wrapper = await mountAt("super-admin-home");
    expect(wrapper.find(".sa-side").classes()).not.toContain("collapsed");
    await wrapper.find(".sa-toggle").trigger("click");
    expect(wrapper.find(".sa-side").classes()).toContain("collapsed");
    expect(localStorage.getItem("super-admin-sidebar-collapsed")).toBe("true");
  });

  it("restores a previously collapsed state from localStorage", async () => {
    localStorage.setItem("super-admin-sidebar-collapsed", "true");
    const wrapper = await mountAt("super-admin-home");
    expect(wrapper.find(".sa-side").classes()).toContain("collapsed");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/components/superadmin/SuperAdminLayout.spec.ts`
Expected: FAIL — `Cannot find module './SuperAdminLayout.vue'`

- [ ] **Step 3: Write the implementation**

```vue
<!-- src/components/superadmin/SuperAdminLayout.vue -->
<template>
  <div class="sa-shell">
    <div class="sa-side" :class="{ collapsed }">
      <RouterLink :to="{ name: 'super-admin-home' }" class="sa-brand">
        <SuperAdminIcon name="shield" />
        <span v-if="!collapsed">ItemTraxx Admin</span>
      </RouterLink>
      <button
        type="button"
        class="sa-toggle"
        :aria-label="collapsed ? 'Expand sidebar' : 'Collapse sidebar'"
        @click="toggleCollapsed"
      >
        <SuperAdminIcon :name="collapsed ? 'chevronRight' : 'chevronLeft'" />
      </button>
      <SuperAdminSidebar :collapsed="collapsed" />
      <SuperAdminProfileMenu :collapsed="collapsed" />
    </div>
    <div class="sa-content">
      <router-view />
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref } from "vue";
import { RouterLink } from "vue-router";
import SuperAdminIcon from "./SuperAdminIcon.vue";
import SuperAdminSidebar from "./SuperAdminSidebar.vue";
import SuperAdminProfileMenu from "./SuperAdminProfileMenu.vue";

const STORAGE_KEY = "super-admin-sidebar-collapsed";

const readStoredCollapsed = () => {
  try {
    return localStorage.getItem(STORAGE_KEY) === "true";
  } catch {
    return false;
  }
};

const collapsed = ref(readStoredCollapsed());

const toggleCollapsed = () => {
  collapsed.value = !collapsed.value;
  try {
    localStorage.setItem(STORAGE_KEY, String(collapsed.value));
  } catch {
    /* best effort only */
  }
};
</script>

<style scoped>
.sa-shell {
  display: flex;
  min-height: 100vh;
  background: var(--page-bg);
  color: var(--text);
}

.sa-side {
  display: flex;
  flex-direction: column;
  width: 240px;
  flex-shrink: 0;
  background: var(--surface);
  border-right: 1px solid var(--border);
}

.sa-side.collapsed {
  width: 64px;
  align-items: center;
}

.sa-brand {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  padding: 1rem;
  font-weight: 700;
  color: var(--text);
  text-decoration: none;
  border-bottom: 1px solid var(--border);
  white-space: nowrap;
  width: 100%;
  box-sizing: border-box;
}

.sa-side.collapsed .sa-brand {
  padding: 1rem 0;
  justify-content: center;
}

.sa-brand:hover {
  text-decoration: none;
}

.sa-toggle {
  align-self: flex-end;
  margin: 0.5rem 0.75rem 0;
  width: 28px;
  height: 28px;
  border-radius: 8px;
  border: 1px solid var(--border);
  background: var(--surface-2);
  color: var(--muted);
  display: flex;
  align-items: center;
  justify-content: center;
  cursor: pointer;
}

.sa-side.collapsed .sa-toggle {
  align-self: center;
  margin: 0.5rem 0 0;
}

.sa-content {
  flex: 1;
  min-width: 0;
  padding: 2rem;
}
</style>
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/components/superadmin/SuperAdminLayout.spec.ts`
Expected: PASS (3 tests)

- [ ] **Step 5: Commit**

```bash
git add src/components/superadmin/SuperAdminLayout.vue src/components/superadmin/SuperAdminLayout.spec.ts
git commit -m "feat(super-admin): add sidebar shell layout"
```

---

### Task 7: Nest the `/super-admin/*` routes under `SuperAdminLayout`

**Files:**
- Modify: `src/router/index.ts:402-566`

Converts the flat route list into one parent route with `SuperAdminLayout` as `component` and the existing pages as `children`. Every route `name`, `path`, redirect target, and `meta` object is preserved byte-for-byte — only the nesting changes. Vue Router merges child `meta` into `to.meta` automatically (the parent route below defines no `meta` of its own), so `router.beforeEach` at `router/index.ts:754` needs no changes.

- [ ] **Step 1: Replace the flat route block with the nested version**

Find this exact block in `src/router/index.ts` (currently lines 402-566, right after the `/super-auth` and `/internal` route entries and right before the `not-found` catch-all route):

```ts
  {
    path: "/super-admin",
    name: "super-admin-home",
    component: () => import("../pages/super/SuperAdminHome.vue"),
    meta: {
      requiresSession: true,
      requiresRole: "super_admin",
      requiresSuperAuth: true,
    
      title: "Super Admin | ItemTraxx",
    },
  },
  {
    path: "/super-admin/settings",
    name: "super-admin-settings",
    component: () => import("../pages/super/Settings.vue"),
    meta: {
      requiresSession: true,
      requiresRole: "super_admin",
      requiresSuperAuth: true,
      title: "Super Admin Settings | ItemTraxx",
    },
  },
  {
    path: "/super-admin/settings/sso",
    name: "super-admin-sso",
    component: () => import("../pages/EnterpriseSsoSettings.vue"),
    meta: { requiresSession: true, requiresRole: "super_admin", requiresSuperAuth: true, title: "Enterprise SSO | ItemTraxx" },
  },
  {
    path: "/super-admin/workspaces",
    name: "super-admin-workspaces",
    component: () => import("../pages/super/Workspaces.vue"),
    meta: {
      requiresSession: true,
      requiresRole: "super_admin",
      requiresSuperAuth: true,
    
      title: "Super Admin Workspaces | ItemTraxx",
    },
  },
  {
    path: "/super-admin/admins",
    name: "super-admin-admins",
    component: () => import("../pages/super/Admins.vue"),
    meta: {
      requiresSession: true,
      requiresRole: "super_admin",
      requiresSuperAuth: true,
    
      title: "Super Admin Admins | ItemTraxx",
    },
  },
  {
    path: "/super-admin/tenant-accounts",
    name: "super-admin-tenant-accounts",
    component: () => import("../pages/super/TenantAccounts.vue"),
    meta: {
      requiresSession: true,
      requiresRole: "super_admin",
      title: "Tenant Accounts | ItemTraxx",
    },
  },
  {
    path: "/super-admin/super-admins",
    name: "super-admin-super-admins",
    component: () => import("../pages/super/SuperAdmins.vue"),
    meta: {
      requiresSession: true,
      requiresRole: "super_admin",
      requiresSuperAuth: true,
      title: "Super Admins | ItemTraxx",
    },
  },
  {
    path: "/super-admin/gear",
    redirect: "/super-admin/items",
  },
  {
    path: "/super-admin/items",
    name: "super-admin-items",
    component: () => import("../pages/super/SuperItems.vue"),
    meta: {
      requiresSession: true,
      requiresRole: "super_admin",
      requiresSuperAuth: true,
    
      title: "Super Admin Item | ItemTraxx",
    },
  },
  {
    path: "/super-admin/borrowers",
    name: "super-admin-borrowers",
    component: () => import("../pages/super/SuperBorrowers.vue"),
    meta: {
      requiresSession: true,
      requiresRole: "super_admin",
      requiresSuperAuth: true,
    
      title: "Super Admin Borrowers | ItemTraxx",
    },
  },
  {
    path: "/super-admin/students",
    redirect: "/super-admin/borrowers",
  },
  {
    path: "/super-admin/logs",
    name: "super-admin-logs",
    component: () => import("../pages/super/SuperLogs.vue"),
    meta: {
      requiresSession: true,
      requiresRole: "super_admin",
      requiresSuperAuth: true,
    
      title: "Super Admin Logs | ItemTraxx",
    },
  },
  {
    path: "/super-admin/broadcasts",
    name: "super-admin-broadcasts",
    component: () => import("../pages/super/Broadcasts.vue"),
    meta: {
      requiresSession: true,
      requiresRole: "super_admin",
      requiresSuperAuth: true,
    
      title: "Broadcasts | ItemTraxx",
    },
  },
  {
    path: "/super-admin/sales-leads",
    name: "super-admin-sales-leads",
    component: () => import("../pages/super/SalesLeads.vue"),
    meta: {
      requiresSession: true,
      requiresRole: "super_admin",
      requiresSuperAuth: true,
    
      title: "Sales Leads | ItemTraxx",
    },
  },
  {
    path: "/super-admin/customers",
    name: "super-admin-customers",
    component: () => import("../pages/super/Customers.vue"),
    meta: {
      requiresSession: true,
      requiresRole: "super_admin",
      requiresSuperAuth: true,
    
      title: "Customers | ItemTraxx",
    },
  },
  {
    path: "/super-admin/support-requests",
    name: "super-admin-support-requests",
    component: () => import("../pages/super/SupportRequests.vue"),
    meta: {
      requiresSession: true,
      requiresRole: "super_admin",
      requiresSuperAuth: true,
      title: "Support Requests | ItemTraxx",
    },
  },
```

Replace it with:

```ts
  {
    path: "/super-admin",
    component: () => import("../components/superadmin/SuperAdminLayout.vue"),
    children: [
      {
        path: "",
        name: "super-admin-home",
        component: () => import("../pages/super/SuperAdminHome.vue"),
        meta: {
          requiresSession: true,
          requiresRole: "super_admin",
          requiresSuperAuth: true,

          title: "Super Admin | ItemTraxx",
        },
      },
      {
        path: "settings",
        name: "super-admin-settings",
        component: () => import("../pages/super/Settings.vue"),
        meta: {
          requiresSession: true,
          requiresRole: "super_admin",
          requiresSuperAuth: true,
          title: "Super Admin Settings | ItemTraxx",
        },
      },
      {
        path: "settings/sso",
        name: "super-admin-sso",
        component: () => import("../pages/EnterpriseSsoSettings.vue"),
        meta: { requiresSession: true, requiresRole: "super_admin", requiresSuperAuth: true, title: "Enterprise SSO | ItemTraxx" },
      },
      {
        path: "workspaces",
        name: "super-admin-workspaces",
        component: () => import("../pages/super/Workspaces.vue"),
        meta: {
          requiresSession: true,
          requiresRole: "super_admin",
          requiresSuperAuth: true,

          title: "Super Admin Workspaces | ItemTraxx",
        },
      },
      {
        path: "admins",
        name: "super-admin-admins",
        component: () => import("../pages/super/Admins.vue"),
        meta: {
          requiresSession: true,
          requiresRole: "super_admin",
          requiresSuperAuth: true,

          title: "Super Admin Admins | ItemTraxx",
        },
      },
      {
        path: "tenant-accounts",
        name: "super-admin-tenant-accounts",
        component: () => import("../pages/super/TenantAccounts.vue"),
        meta: {
          requiresSession: true,
          requiresRole: "super_admin",
          title: "Tenant Accounts | ItemTraxx",
        },
      },
      {
        path: "super-admins",
        name: "super-admin-super-admins",
        component: () => import("../pages/super/SuperAdmins.vue"),
        meta: {
          requiresSession: true,
          requiresRole: "super_admin",
          requiresSuperAuth: true,
          title: "Super Admins | ItemTraxx",
        },
      },
      {
        path: "gear",
        redirect: { name: "super-admin-items" },
      },
      {
        path: "items",
        name: "super-admin-items",
        component: () => import("../pages/super/SuperItems.vue"),
        meta: {
          requiresSession: true,
          requiresRole: "super_admin",
          requiresSuperAuth: true,

          title: "Super Admin Item | ItemTraxx",
        },
      },
      {
        path: "borrowers",
        name: "super-admin-borrowers",
        component: () => import("../pages/super/SuperBorrowers.vue"),
        meta: {
          requiresSession: true,
          requiresRole: "super_admin",
          requiresSuperAuth: true,

          title: "Super Admin Borrowers | ItemTraxx",
        },
      },
      {
        path: "students",
        redirect: { name: "super-admin-borrowers" },
      },
      {
        path: "logs",
        name: "super-admin-logs",
        component: () => import("../pages/super/SuperLogs.vue"),
        meta: {
          requiresSession: true,
          requiresRole: "super_admin",
          requiresSuperAuth: true,

          title: "Super Admin Logs | ItemTraxx",
        },
      },
      {
        path: "broadcasts",
        name: "super-admin-broadcasts",
        component: () => import("../pages/super/Broadcasts.vue"),
        meta: {
          requiresSession: true,
          requiresRole: "super_admin",
          requiresSuperAuth: true,

          title: "Broadcasts | ItemTraxx",
        },
      },
      {
        path: "sales-leads",
        name: "super-admin-sales-leads",
        component: () => import("../pages/super/SalesLeads.vue"),
        meta: {
          requiresSession: true,
          requiresRole: "super_admin",
          requiresSuperAuth: true,

          title: "Sales Leads | ItemTraxx",
        },
      },
      {
        path: "customers",
        name: "super-admin-customers",
        component: () => import("../pages/super/Customers.vue"),
        meta: {
          requiresSession: true,
          requiresRole: "super_admin",
          requiresSuperAuth: true,

          title: "Customers | ItemTraxx",
        },
      },
      {
        path: "support-requests",
        name: "super-admin-support-requests",
        component: () => import("../pages/super/SupportRequests.vue"),
        meta: {
          requiresSession: true,
          requiresRole: "super_admin",
          requiresSuperAuth: true,
          title: "Support Requests | ItemTraxx",
        },
      },
    ],
  },
```

- [ ] **Step 2: Add a route-resolution regression test**

```ts
// src/router/superAdminRoutes.spec.ts
import { describe, expect, it } from "vitest";
import router from "./index";

const EXPECTED = [
  ["/super-admin", "super-admin-home"],
  ["/super-admin/settings", "super-admin-settings"],
  ["/super-admin/settings/sso", "super-admin-sso"],
  ["/super-admin/workspaces", "super-admin-workspaces"],
  ["/super-admin/admins", "super-admin-admins"],
  ["/super-admin/tenant-accounts", "super-admin-tenant-accounts"],
  ["/super-admin/super-admins", "super-admin-super-admins"],
  ["/super-admin/items", "super-admin-items"],
  ["/super-admin/borrowers", "super-admin-borrowers"],
  ["/super-admin/logs", "super-admin-logs"],
  ["/super-admin/broadcasts", "super-admin-broadcasts"],
  ["/super-admin/sales-leads", "super-admin-sales-leads"],
  ["/super-admin/customers", "super-admin-customers"],
  ["/super-admin/support-requests", "super-admin-support-requests"],
] as const;

describe("super-admin route nesting", () => {
  it.each(EXPECTED)("resolves %s to the %s route with super_admin meta intact", (path, name) => {
    const resolved = router.resolve(path);
    expect(resolved.name).toBe(name);
    expect(resolved.meta.requiresRole).toBe("super_admin");
    expect(resolved.meta.requiresSession).toBe(true);
  });

  it("still redirects legacy aliases", () => {
    expect(router.resolve("/super-admin/gear").name).toBe("super-admin-items");
    expect(router.resolve("/super-admin/students").name).toBe("super-admin-borrowers");
  });
});
```

- [ ] **Step 3: Run test to verify it passes**

Run: `npx vitest run src/router/superAdminRoutes.spec.ts`
Expected: PASS (15 tests)

- [ ] **Step 4: Commit**

```bash
git add src/router/index.ts src/router/superAdminRoutes.spec.ts
git commit -m "refactor(super-admin): nest routes under SuperAdminLayout"
```

---

### Task 8: Wire the shared composables into `App.vue`, hide the top bar on `/super-admin/*`

**Files:**
- Modify: `src/App.vue`

- [ ] **Step 1: Import the composables**

In `src/App.vue`, find:

```ts
import { useCookieConsentTelemetry } from "./composables/useCookieConsentTelemetry";
import { useIntercom } from "./composables/useIntercom";
import { useOfflineQueueCount } from "./composables/useOfflineQueueCount";
```

Replace with:

```ts
import { useCookieConsentTelemetry } from "./composables/useCookieConsentTelemetry";
import { useIntercom } from "./composables/useIntercom";
import { useLogout } from "./composables/useLogout";
import { useOfflineQueueCount } from "./composables/useOfflineQueueCount";
```

Find:

```ts
import { useSystemStatus } from "./composables/useSystemStatus";
import { useTopBannerLayout } from "./composables/useTopBannerLayout";
```

Replace with:

```ts
import { useSystemStatus } from "./composables/useSystemStatus";
import { useTheme } from "./composables/useTheme";
import { useTopBannerLayout } from "./composables/useTopBannerLayout";
```

- [ ] **Step 2: Replace the local theme ref with the shared composable**

Find:

```ts
const menuOpen = ref(false);
const initialSavedTheme = localStorage.getItem("itemtraxx-theme");
const theme = ref<"light" | "dark">(initialSavedTheme === "dark" || initialSavedTheme === "light" ? initialSavedTheme : "light");
```

Replace with:

```ts
const menuOpen = ref(false);
const { theme, themeLabel, setTheme } = useTheme();
```

- [ ] **Step 3: Suppress the top bar for `/super-admin/*` routes**

Find:

```ts
const showTopMenu = computed(() => !hiddenMenuRoutes.has(String(route.name)));
```

Replace with:

```ts
const showTopMenu = computed(() => !hiddenMenuRoutes.has(String(route.name)) && !String(route.name || "").startsWith("super-admin-"));
```

- [ ] **Step 4: Remove the now-duplicate `themeLabel` computed**

Find:

```ts
const isRouteNavigating = computed(() => routeLoading.isLoading);
const themeLabel = computed(() => theme.value === "dark" ? "Light Mode" : "Dark Mode");
const brandLogoUrl = computed(() => theme.value === "light" ? lightBrandLogoUrl || darkBrandLogoUrl || "" : darkBrandLogoUrl || lightBrandLogoUrl || "");
```

Replace with:

```ts
const isRouteNavigating = computed(() => routeLoading.isLoading);
const brandLogoUrl = computed(() => theme.value === "light" ? lightBrandLogoUrl || darkBrandLogoUrl || "" : darkBrandLogoUrl || lightBrandLogoUrl || "");
```

- [ ] **Step 5: Make `applyTheme` delegate its core state to the composable**

Find:

```ts
const applyTheme = (next: "light" | "dark") => {
  theme.value = next;
  document.documentElement.setAttribute("data-theme", isLandingRoute.value ? "dark" : next);
  localStorage.setItem("itemtraxx-theme", next);
  updateBrowserChromeColor();
};
```

Replace with:

```ts
const applyTheme = (next: "light" | "dark") => {
  setTheme(next);
  document.documentElement.setAttribute("data-theme", isLandingRoute.value ? "dark" : next);
  updateBrowserChromeColor();
};
```

- [ ] **Step 6: Replace the inline sign-out logic with the shared composable**

Find:

```ts
const showAccountPanel = computed(() => auth.role === "tenant_account");
const logoutTenant = async () => {
  if (!window.confirm("Are you sure you want to log out?")) return;
  menuOpen.value = false;
  const { getPostSignOutUrl, signOut } = await import("./services/authService");
  const nextUrl = getPostSignOutUrl();
  const result = await signOut();
  if (!result.ok) {
    window.alert("Unable to complete logout. Please try again.");
    return;
  }
  if (nextUrl.startsWith("http")) window.location.assign(nextUrl);
  else await router.push(nextUrl);
};
```

Replace with:

```ts
const showAccountPanel = computed(() => auth.role === "tenant_account");
const { logout } = useLogout();
const logoutTenant = async () => {
  await logout();
  menuOpen.value = false;
};
```

- [ ] **Step 7: Run the full unit test suite to check for regressions**

Run: `npx vitest run`
Expected: PASS — no test references the removed local `theme`/`themeLabel` internals directly, since `App.vue` has no dedicated spec file.

- [ ] **Step 8: Typecheck**

Run: `npx vue-tsc -b --noEmit`
Expected: no new type errors.

- [ ] **Step 9: Commit**

```bash
git add src/App.vue
git commit -m "refactor(app): source theme/logout from shared composables, hide top bar on super-admin routes"
```

---

### Task 9: Redesign `SuperAdminHome.vue`

**Files:**
- Modify: `src/pages/super/SuperAdminHome.vue`

Removes the pill-nav row and the 4 group cards (both now redundant with the sidebar). Adds a quick-actions row and a needs-attention / recent-actions pair of cards, using data the page already fetches. Control Center and the report tables are untouched functionally — only their surrounding CSS in this same file's `<style scoped>` block stays as-is (it already uses tokens and isn't part of what's being removed).

- [ ] **Step 1: Remove the pill-nav actions row from the hero**

Find:

```html
    <div class="workspace-hero card">
      <div class="workspace-copy">
        <p class="workspace-eyebrow">Platform Control Center</p>
        <h1>Super Admin</h1>
        <p class="workspace-summary">
          Manage workspaces, runtime controls, and platform health from a smaller set of
          focused entry points.
        </p>
      </div>
      <div class="workspace-actions">
        <RouterLink class="button-link" to="/super-admin/workspaces">Workspaces</RouterLink>
        <RouterLink class="button-link" to="/super-admin/admins">Workspace Admins</RouterLink>
        <RouterLink class="button-link" to="/super-admin/tenant-accounts">Tenant Accounts</RouterLink>
        <RouterLink class="button-link" to="/super-admin/super-admins">Super Admins</RouterLink>
        <RouterLink class="button-link" to="/super-admin/settings">Settings</RouterLink>
        <RouterLink class="button-link" to="/super-admin/support-requests">Support Requests</RouterLink>
        <RouterLink class="button-link" to="/internal">Internal Ops</RouterLink>
        <button type="button" class="button-link" @click="handleSignOut">Sign out</button>
      </div>
    </div>
```

Replace with:

```html
    <div class="workspace-hero card">
      <div class="workspace-copy">
        <p class="workspace-eyebrow">Platform Control Center</p>
        <h1>Super Admin</h1>
        <p class="workspace-summary">
          Manage workspaces, runtime controls, and platform health from a smaller set of
          focused entry points.
        </p>
      </div>
    </div>
```

- [ ] **Step 2: Remove the 4 redundant group-card sections**

Find the entire block starting with `<div class="section-grid">` and ending at its matching `</div>` (the 4 `section-card` sections for Tenant Operations / Inventory Data / Commercial / Platform Controls), and delete it — the sidebar now covers this navigation. This is the block immediately after the `.admin-grid` stats block and before `<div id="control-center" class="card">`.

- [ ] **Step 3: Add the quick-actions row and needs-attention / recent-actions cards**

Find:

```html
    <div id="control-center" class="card">
      <h2>Control Center</h2>
```

Replace with:

```html
    <div class="quick-actions">
      <RouterLink class="quick-action" to="/super-admin/workspaces">
        <SuperAdminIcon name="plus" />
        New Workspace
      </RouterLink>
      <RouterLink class="quick-action" to="/super-admin/broadcasts">
        <SuperAdminIcon name="megaphone" />
        New Broadcast
      </RouterLink>
      <RouterLink class="quick-action" to="/super-admin/logs">
        <SuperAdminIcon name="fileText" />
        View Logs
      </RouterLink>
      <RouterLink class="quick-action" to="/super-admin/support-requests">
        <SuperAdminIcon name="lifeBuoy" />
        Support Requests
      </RouterLink>
    </div>

    <div class="attention-grid">
      <section class="card attention-card">
        <h2>Needs attention</h2>
        <p v-if="attentionItems.length === 0" class="muted">Nothing needs attention right now.</p>
        <ul v-else class="attention-list">
          <li v-for="item in attentionItems" :key="item.id" class="attention-item">
            <span class="attention-dot" :class="`attention-dot-${item.tone}`"></span>
            {{ item.label }}
          </li>
        </ul>
      </section>

      <section class="card attention-card">
        <h2>Recent privileged actions</h2>
        <p v-if="(dashboard?.recent_actions?.length ?? 0) === 0" class="muted">No recent actions.</p>
        <ul v-else class="attention-list">
          <li v-for="item in (dashboard?.recent_actions ?? []).slice(0, 5)" :key="item.id" class="attention-item">
            {{ item.actor_email || item.actor_id }} {{ item.action_type }}
          </li>
        </ul>
      </section>
    </div>

    <div id="control-center" class="card">
      <h2>Control Center</h2>
```

- [ ] **Step 4: Import `SuperAdminIcon` and add the `attentionItems` computed**

Find:

```ts
import { onMounted, onUnmounted, ref } from "vue";
import { RouterLink, useRouter } from "vue-router";
import { signOut } from "../../services/authService";
import { fetchSuperDashboard, type SuperDashboard } from "../../services/superAuditService";
```

Replace with:

```ts
import { computed, onMounted, onUnmounted, ref } from "vue";
import { RouterLink } from "vue-router";
import SuperAdminIcon from "../../components/superadmin/SuperAdminIcon.vue";
import { fetchSuperDashboard, type SuperDashboard } from "../../services/superAuditService";
```

Find:

```ts
const router = useRouter();
const dashboard = ref<SuperDashboard | null>(null);
```

Replace with:

```ts
const dashboard = ref<SuperDashboard | null>(null);
```

Find:

```ts
const formatDateTime = (value: string) => {
```

Insert immediately before it:

```ts
type AttentionTone = "critical" | "warning" | "info";
type AttentionItem = { id: string; label: string; tone: AttentionTone };

const attentionItems = computed<AttentionItem[]>(() => {
  const items: AttentionItem[] = [];
  for (const alert of dashboard.value?.alert_events ?? []) {
    items.push({
      id: `alert-${alert.id}`,
      label: `${alert.name}: ${alert.current} (threshold ${alert.threshold})`,
      tone: alert.severity === "critical" ? "critical" : "warning",
    });
  }
  const suspended = dashboard.value?.suspended_workspaces ?? 0;
  if (suspended > 0) {
    items.push({
      id: "suspended-workspaces",
      label: `${suspended} workspace${suspended === 1 ? "" : "s"} suspended`,
      tone: "warning",
    });
  }
  const pendingApprovals = controlCenter.value?.approvals?.filter((item) => item.status === "pending").length ?? 0;
  if (pendingApprovals > 0) {
    items.push({
      id: "pending-approvals",
      label: `${pendingApprovals} pending approval${pendingApprovals === 1 ? "" : "s"}`,
      tone: "info",
    });
  }
  const failedJobs = controlCenter.value?.jobs?.filter((job) => job.status === "failed").length ?? 0;
  if (failedJobs > 0) {
    items.push({
      id: "failed-jobs",
      label: `${failedJobs} job${failedJobs === 1 ? "" : "s"} failed`,
      tone: "critical",
    });
  }
  return items;
});

```

- [ ] **Step 5: Remove the now-dead `handleSignOut` function**

Find:

```ts
const handleSignOut = async () => {
  const result = await signOut();
  if (!result.ok) {
    showToast("Sign out failed", "Unable to complete logout. Please try again.");
    return;
  }
  await router.push("/");
};

onMounted(() => {
```

Replace with:

```ts
onMounted(() => {
```

- [ ] **Step 6: Update the scoped styles — drop dead rules, simplify the hero, add the new blocks**

Find:

```css
.workspace-hero {
  display: flex;
  justify-content: space-between;
  gap: 1rem;
  align-items: flex-start;
  margin-bottom: 1rem;
}
```

Replace with:

```css
.workspace-hero {
  margin-bottom: 1rem;
}
```

Find:

```css
.workspace-actions {
  display: flex;
  flex-wrap: wrap;
  gap: 0.5rem;
  justify-content: flex-end;
}

.section-grid {
  display: grid;
  gap: 1rem;
  grid-template-columns: repeat(auto-fit, minmax(240px, 1fr));
  margin: 1rem 0;
}

.report-grid {
```

Replace with:

```css
.quick-actions {
  display: flex;
  flex-wrap: wrap;
  gap: 0.6rem;
  margin: 1rem 0 1.5rem;
}

.quick-action {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  border: 1px solid var(--border);
  border-radius: 10px;
  padding: 0.55rem 0.9rem;
  background: var(--surface-2);
  color: inherit;
  text-decoration: none;
  font-weight: 600;
  font-size: 0.9rem;
}

.quick-action:hover {
  border-color: var(--accent);
  text-decoration: none;
}

.attention-grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(280px, 1fr));
  gap: 1rem;
  margin-bottom: 1.5rem;
}

.attention-card h2 {
  margin: 0 0 0.75rem;
  font-size: 1.05rem;
}

.attention-list {
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: 0.5rem;
}

.attention-item {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  font-size: 0.9rem;
  padding-bottom: 0.5rem;
  border-bottom: 1px solid var(--border);
}

.attention-item:last-child {
  border-bottom: none;
  padding-bottom: 0;
}

.attention-dot {
  width: 7px;
  height: 7px;
  border-radius: 50%;
  flex-shrink: 0;
  background: var(--muted);
}

.attention-dot-critical {
  background: var(--danger);
}

.attention-dot-warning {
  background: var(--warning);
}

.attention-dot-info {
  background: var(--accent);
}

.report-grid {
```

Find:

```css
.section-card {
  display: flex;
  flex-direction: column;
  gap: 1rem;
}

.section-header {
  display: flex;
  flex-direction: column;
  gap: 0.25rem;
}

.section-header h2 {
  margin: 0;
}

.section-links {
  display: grid;
  gap: 0.65rem;
}

.section-link {
  display: flex;
  flex-direction: column;
  gap: 0.2rem;
  border: 1px solid var(--border);
  border-radius: 12px;
  padding: 0.8rem 0.9rem;
  background: var(--surface-2);
  color: inherit;
  text-decoration: none;
  transition: border-color 0.2s ease, transform 0.15s ease, background 0.2s ease;
}

.section-link:hover {
  border-color: var(--accent);
  background: color-mix(in srgb, var(--surface-2) 85%, var(--accent) 15%);
  transform: translateY(-1px);
  text-decoration: none;
}

.section-link-title {
  font-weight: 700;
  line-height: 1.2;
}

.section-link-meta {
  font-size: 0.84rem;
  color: var(--muted);
  line-height: 1.3;
}

.control-grid {
```

Replace with:

```css
.control-grid {
```

Find:

```css
@media (max-width: 900px) {
  .workspace-hero {
    flex-direction: column;
  }

  .workspace-actions {
    justify-content: flex-start;
  }

  .report-grid {
```

Replace with:

```css
@media (max-width: 900px) {
  .report-grid {
```

- [ ] **Step 7: Run the existing behavioral checks**

There's no dedicated `SuperAdminHome.spec.ts` today. Confirm the file still compiles and the rest of the suite is unaffected:

Run: `npx vue-tsc -b --noEmit`
Expected: no new type errors (in particular, no leftover reference to `signOut`, `useRouter`, or `handleSignOut`).

Run: `npx vitest run`
Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add src/pages/super/SuperAdminHome.vue
git commit -m "feat(super-admin): redesign Home with stats, quick actions, and a needs-attention panel"
```

---

### Task 10: Manual verification in the dev server

**Files:** none (verification only)

- [ ] **Step 1: Start the dev server and open `/super-admin`**

Run: `npm run dev`, sign in as a `super_admin` account, navigate to `/super-admin`.

- [ ] **Step 2: Check the sidebar**

- All 6 groups render (Home ungrouped, Organizations, Inventory Data, Monitoring, Customers, Platform) with icons, no emoji.
- Clicking every item navigates to the right page and highlights correctly (including the two redirects: `/super-admin/gear` → Items, `/super-admin/students` → Borrowers).
- Internal Ops navigates to `/internal` and leaves the sidebar (its own page, no shell).
- Collapse toggle shrinks to icon-only with tooltips, and the choice survives a page reload (localStorage).

- [ ] **Step 3: Check the profile menu**

- Shows the signed-in admin's email.
- Opens a popover with "Dark Mode"/"Light Mode" and "Sign out".
- Toggling theme flips the whole app's theme (not just the sidebar) and persists across reload.
- Global top-right menu (hamburger) no longer renders anywhere under `/super-admin/*`.
- Sign out asks for confirmation and behaves like it does today elsewhere in the app.

- [ ] **Step 4: Check the Home page**

- Stats row shows the same 6 numbers as before.
- Quick actions route to the right pages.
- Needs-attention list reflects real alert/approval/job data (or the empty state if there's none).
- Control Center and the report tables below still work exactly as before (save actions, approve button, etc.) — restyled, not rebroken.

- [ ] **Step 5: Check both themes**

Toggle light/dark from the sidebar and confirm the sidebar, profile popover, and Home page's new cards all read correctly in both — no invisible text, no hardcoded colors fighting the token system.

- [ ] **Step 6: Final full-suite check**

Run: `npx vitest run`
Expected: PASS, all new and existing tests green.

Run: `npx vue-tsc -b --noEmit`
Expected: no type errors.
