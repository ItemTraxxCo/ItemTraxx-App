<wizard-report>
# PostHog post-wizard report

The wizard has completed a deep integration of PostHog into the ItemTraxx Vue 3 application. PostHog is initialized consent-gated (tied to the existing `allowsAnalytics` cookie consent check, matching the Sentry/Vercel analytics pattern). A new `posthogService.ts` provides safe no-op wrappers so all capture calls are harmless before consent is granted. The Vue global error handler is chained to call `capturePostHogException` for automatic error tracking. Users are identified on login (tenant and admin flows) and PostHog state is reset on sign-out.

| Event | Description | File |
|---|---|---|
| `tenant_login_succeeded` | A tenant user successfully signed in | `src/pages/Login.vue` |
| `tenant_login_failed` | A tenant user's sign-in attempt failed | `src/pages/Login.vue` |
| `admin_login_succeeded` | A tenant/district admin successfully signed in | `src/pages/tenant/admin/AdminLogin.vue` |
| `admin_login_failed` | An admin sign-in attempt failed | `src/pages/tenant/admin/AdminLogin.vue` |
| `checkout_transaction_completed` | A checkout/return transaction was processed | `src/pages/tenant/Checkout.vue` |
| `checkout_transaction_failed` | A checkout/return transaction failed | `src/pages/tenant/Checkout.vue` |
| `checkout_transaction_buffered` | A transaction was saved offline for later sync | `src/pages/tenant/Checkout.vue` |
| `gear_item_created` | A new inventory item was created by an admin | `src/pages/tenant/admin/Gear.vue` |
| `gear_bulk_import_completed` | A bulk CSV import of items completed | `src/pages/tenant/admin/GearImport.vue` |
| `quick_return_completed` | An admin completed a quick return | `src/pages/tenant/admin/QuickReturn.vue` |
| `onboarding_completed` | A user finished all onboarding steps | `src/components/OnboardingModal.vue` |
| `onboarding_skipped` | A user dismissed the onboarding flow | `src/components/OnboardingModal.vue` |
| `landing_cta_clicked` | A visitor clicked a CTA on the landing page | `src/pages/LandingPageNew.vue` |

## Next steps

We've built some insights and a dashboard for you to keep an eye on user behavior, based on the events we just instrumented:

- [Analytics basics dashboard](https://us.posthog.com/project/382681/dashboard/1469311)
- [Daily Checkout Transactions](https://us.posthog.com/project/382681/insights/d5WxjloP)
- [Checkout Conversion Funnel](https://us.posthog.com/project/382681/insights/tMzGfUQL)
- [Transaction Outcomes (completed / failed / buffered)](https://us.posthog.com/project/382681/insights/Z5T7QAjV)
- [Admin Login Activity](https://us.posthog.com/project/382681/insights/OaztrOP6)
- [Onboarding Completion vs Skip](https://us.posthog.com/project/382681/insights/6egpyC4F)

### Agent skill

We've left an agent skill folder in your project. You can use this context for further agent development when using Claude Code. This will help ensure the model provides the most up-to-date approaches for integrating PostHog.

</wizard-report>
