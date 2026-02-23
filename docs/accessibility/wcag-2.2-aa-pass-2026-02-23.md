# WCAG 2.2 AA Pass (2026-02-23)

## Areas Reviewed
- Global shell banners/menu (`/src/App.vue`)
- Landing page content and interactions (`/src/pages/PublicHome.vue`)
- Tenant notifications dropdown (`/src/components/NotificationBell.vue`)

## Fixes Applied
- Added explicit menu semantics for top-right app menu:
  - `aria-haspopup`, `aria-expanded`, `aria-controls`, `role="menu"`, `role="menuitem"`.
- Added explicit dialog semantics for notifications panel:
  - `aria-haspopup="dialog"`, `aria-expanded`, `aria-controls`, panel `role="dialog"`.
- Added skip link on landing page for keyboard users.
- Added FAQ accessible relationships:
  - unique toggle IDs
  - `aria-controls` / `aria-labelledby`
  - answer regions now `role="region"`.

## Manual Verification Checklist
- Keyboard-only navigation reaches skip link, header links, primary CTAs, FAQ controls.
- Visible focus indicator present on skip link and interactive controls.
- FAQ expanded state announced correctly by screen readers.
- Menu and notification controls expose expanded/collapsed state.

## Remaining Work (Next Sweep)
- Add full form-level error association (`aria-describedby`) for all auth forms.
- Add color contrast snapshot checks to CI (axe + visual baseline).
- Add screen-reader smoke script for core flows.
