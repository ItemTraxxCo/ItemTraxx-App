# First Sign-In Onboarding Spec

## Scope
Applies to tenant contexts only:
- checkout flow context
- admin flow context

## Behavior
- Blocking onboarding modal appears on first successful sign-in.
- 5-step guided flow.
- Close or finish marks onboarding complete.
- "Take tour" menu action replays onboarding.

## Persistence
- Local storage key format:
  - `itemtraxx:onboarding:v1:<context_or_role>`
- Value: ISO timestamp.
- If storage unavailable, app fails open and continues.

## Context Selection
Onboarding step content is selected by current route context, not only user role.

## UX Requirements
- Dialog with `aria-modal="true"`.
- Keyboard `Esc` closes.
- Next/Back/Skip/Finish actions.
- Focus management on open/close.

## Non-Goals
- No backend schema changes.
- No Supabase function dependency.
- No super-admin onboarding.
