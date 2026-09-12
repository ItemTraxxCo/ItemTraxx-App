# Super Admin shell redesign

## Goal

The Super Admin area (`/super-admin/*`) has no real navigation — 15 pages are reachable only via a flat row of pill links baked into `SuperAdminHome.vue`, plus a global top-right dropdown menu (`AuthenticatedNavigation.vue`) that is mostly inert for this role (its "My Account" link never applies to `super_admin`). This spec replaces that with a persistent, grouped left sidebar (in the style of PostHog's sidebar) and folds the top-right menu into it, and gives the Home page a real dashboard layout instead of a pill-nav + raw report tables.

## Scope

**In scope (this spec):**
- A new sidebar + shell layout wrapping every `/super-admin/*` route.
- Integrating the top-right menu (theme toggle, sign out) into the sidebar.
- Redesigning `SuperAdminHome.vue`'s top section (stats, quick actions, needs-attention) and restyling — but not restructuring — Control Center and the report tables.

**Explicitly out of scope (future, separate spec/PR each):**
- Redesigning the internal content of individual pages (`Workspaces.vue`, `SuperItems.vue`, `Admins.vue`, etc. — their tables/forms/cards stay as they are).
- `/internal` (Internal Ops) page's own UI — it keeps its current look; the sidebar only links to it.
- Mobile/responsive layout beyond "doesn't break" — this is an internal tool, desktop-first.

This was a deliberate split, agreed with the user up front: shell first, page-content redesigns as follow-ups once the shell exists.

## Sidebar structure

Grouped by function (regrouped from the current 4 dashboard cards — "Commercial" was mixing support tickets with sales/CRM, and Logs/Internal Ops are both system-visibility tools rather than "Inventory Data" or "Platform"):

| Group | Items | Route names |
|---|---|---|
| *(ungrouped)* | Home | `super-admin-home` |
| Organizations | Workspaces, Workspace Admins, Tenant Accounts, Super Admins | `super-admin-workspaces`, `super-admin-admins`, `super-admin-tenant-accounts`, `super-admin-super-admins` |
| Inventory Data | Items, Borrowers, Broadcasts | `super-admin-items`, `super-admin-borrowers`, `super-admin-broadcasts` |
| Monitoring | Logs, Internal Ops | `super-admin-logs`, `internal-ops` (external to the new shell — see below) |
| Customers | Support Requests, Sales Leads, Customers | `super-admin-support-requests`, `super-admin-sales-leads`, `super-admin-customers` |
| Platform | Settings | `super-admin-settings` (SSO settings page stays reachable as a sub-link from Settings, as today) |

Approved via mockup with the user (Option B of two grouping choices).

**Internal Ops** is a link to `/internal`, not a route rendered inside the new layout — it has its own secondary-auth gate (`InternalAuth.vue`) and is a genuinely separate subsystem. Clicking it in the sidebar navigates away from the super-admin shell entirely, same as today.

**Super Auth** (`/super-auth`, the 2FA gate) is not part of the sidebar — it renders before the shell, as today.

## Layout & navigation architecture

- **Router**: convert the current flat list of `/super-admin/*` route records in `src/router/index.ts` into a single parent route (`path: "/super-admin"`) with `component: SuperAdminLayout` and the existing pages as `children`. Route `name`s, `path`s, redirects (`/super-admin/gear` → `/super-admin/items`, `/super-admin/students` → `/super-admin/borrowers`), and all `meta` (`requiresSession`, `requiresRole: "super_admin"`, `requiresSuperAuth`) are preserved exactly — this is a structural regrouping of existing route records, not a behavior change.
- **`src/components/superadmin/SuperAdminLayout.vue`** (new): renders `SuperAdminSidebar` + a content area with `<router-view />`. Owns the collapse state (see below).
- **`src/components/superadmin/SuperAdminSidebar.vue`** (new): renders the group/item list from a static config array (`{ icon, label, routeName, group }[]`) so adding/removing/reordering a nav item is a one-line data change, not a template edit. Highlights the active item via `route.name`.
- **`src/components/superadmin/SuperAdminProfileMenu.vue`** (new): the bottom-of-sidebar avatar block (initials avatar, name, role) that opens a small popover with **Dark/Light Mode** and **Sign out** — the two items from `AuthenticatedNavigation.vue` that actually apply to `super_admin`. "My Account" is dropped (it's gated to `tenant_account` today and was never reachable here).
- **`src/components/superadmin/icons.ts`** (new): a small map of icon-name → SVG path data for the icons this sidebar needs, plus a tiny `SuperAdminIcon.vue` that renders `viewBox="0 0 24 24"` with `fill:none; stroke:currentColor; stroke-width:1.8` — matching the existing `.menu-item-icon` convention in `app-shell.css` exactly, so the new icons look native rather than imported. No new npm dependency; the app has never used an icon library, always hand-rolled inline SVG.
- **Theme state refactor**: `theme` is currently a local `ref` inside `App.vue`, passed down to `AuthenticatedNavigation` via props. Since `SuperAdminLayout` is now rendered by the router (nested under `App.vue`'s `<router-view>`, not a direct child of `App.vue`), it can't receive that ref via props without threading it through the router. Extract the existing logic into `src/composables/useTheme.ts` (same `ref`, `applyTheme`, `themeLabel`, `toggleTheme`, initialized from the same `localStorage` key) and have both `App.vue` and `SuperAdminProfileMenu.vue` call it — single source of truth, no behavior change to theme persistence or the `data-theme` attribute mechanism.
- **`App.vue` top-menu suppression**: `showTopMenu` currently returns `true` for all non-`hiddenMenuRoutes` names. Add a check mirroring the existing pattern at `App.vue:226` (`!name.startsWith("super-admin-")`) so the global top bar doesn't render over the new sidebar's own profile menu for any `/super-admin/*` route.

## Collapse behavior

- Toggle button at the top of the sidebar collapses it to a 64px icon-only rail (icons + active-state bar only, no labels, no group headers) or expands it back to ~230px with labels and group headers.
- Collapsed state persists in `localStorage` (new key, e.g. `super-admin-sidebar-collapsed`), read on mount — same persistence pattern the app already uses for theme.
- Collapsed icons get a native `title` attribute (tooltip) with the item's label — no new tooltip library needed for that.

## Home page (`SuperAdminHome.vue`)

Removes the `.workspace-actions` pill-nav row entirely (superseded by the sidebar) and restructures the top of the page into:

1. **Stats row** — the same 6 metrics already computed on this page today (Total workspaces, Active workspaces, Disabled workspaces, Workspace Admins, Active alerts, Pending approvals — all from `SuperDashboard`), restyled as a card grid instead of the current inline stat blocks.
2. **Quick actions row** — 4 shortcuts that are plain navigation, not new functionality: New Workspace and New Broadcast route to `Workspaces.vue` / `Broadcasts.vue` (both already have their own create flows — the shortcut just gets the admin there faster), View Logs and Support Requests route to those pages directly.
3. **Needs-attention card** — merges `alert_events` (by `severity`), the suspended-workspace count, `pending_approvals.length`, and failed entries from `jobs` into one glanceable list, each linking to the relevant page/table further down. All fields already exist on `SuperDashboard`; nothing new is fetched.
4. **Recent privileged actions card** — a compact restyle of the existing `recent_actions` list.

**Unchanged, restyled only**: the Control Center panel (System Status Override, Maintenance Mode, Alert Rules, Emergency Controls) and the report-grid tables (Active Alert Events, Pending Approvals, Tenant Activity 7d, Recent Privileged Actions, Recent Jobs) keep their exact current fields, actions, and behavior — they just adopt the new card/typography styling so the page reads as one system instead of two.

Approved via mockup with the user.

## Styling

No new dependency (no Tailwind/component library today, and this doesn't introduce one). New components use scoped `<style>` blocks referencing the existing CSS-variable tokens (`--surface`, `--surface-2`, `--surface-3`, `--border`, `--muted`, `--accent`, `--text`, `--page-bg`, `--danger`, `--warning`) from `src/styles/tokens.css`, so light/dark mode work automatically via the existing `data-theme` attribute mechanism — no hardcoded hex. The active-nav-item indicator and any "primary" accents use `var(--accent)`, not a new brand color, to stay consistent with the app's current monochrome-plus-accent palette (the mockup's blue was a placeholder for visualization only).

## Testing

- New components (`SuperAdminSidebar`, `SuperAdminProfileMenu`, `SuperAdminLayout`, `useTheme`) get colocated `.spec.ts` unit tests, matching the project's existing convention (e.g. `superAdminService.spec.ts`): nav config renders all groups/items, active-item highlighting follows `route.name`, collapse toggle persists to `localStorage`, profile menu emits theme-toggle/logout correctly.
- Router change (flat → nested children) verified by confirming every existing `/super-admin/*` path, name, redirect, and `meta` still resolves identically — no route should change its public URL or auth requirements.
- Manual verification in the dev server: sidebar navigation, collapse/expand, profile menu, Home page's new sections, both light and dark theme, before calling this done.
