/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_APP_URL?: string;
  readonly VITE_SUPABASE_URL: string;
  readonly VITE_SUPABASE_ANON_KEY: string;
  readonly VITE_EDGE_PROXY_URL?: string;
  readonly VITE_TENANT_LOGIN_FUNCTION?: string;
  readonly VITE_LOGO_URL?: string;
  readonly VITE_BRAND_LOGO_LIGHT_URL?: string;
  readonly VITE_BRAND_LOGO_DARK_URL?: string;
  readonly VITE_TERMS_URL?: string;
  readonly VITE_PRIVACY_URL?: string;
  readonly VITE_LEGAL_URL?: string;
  readonly VITE_GIT_COMMIT?: string;
  readonly VITE_STATUS_FUNCTION?: string;
  readonly VITE_TURNSTILE_SITE_KEY?: string;
  readonly VITE_SENTRY_DSN?: string;
  readonly VITE_SENTRY_ENVIRONMENT?: string;
  readonly VITE_SENTRY_TRACES_SAMPLE_RATE?: string;
  readonly VITE_SENTRY_REPLAYS_SESSION_SAMPLE_RATE?: string;
  readonly VITE_SENTRY_REPLAYS_ON_ERROR_SAMPLE_RATE?: string;
  readonly VITE_POSTHOG_PROJECT_TOKEN?: string;
  readonly VITE_POSTHOG_HOST?: string;
}

declare module "posthog-js/dist/recorder";

interface ImportMeta {
  readonly env: ImportMetaEnv;
}

interface Window {
  turnstile?: {
    render: (
      container: string | HTMLElement,
      options: {
        sitekey: string;
        callback?: (token: string) => void;
        "error-callback"?: () => void;
        "expired-callback"?: () => void;
        theme?: "auto" | "light" | "dark";
      }
    ) => string;
    reset: (widgetId?: string) => void;
    remove: (widgetId?: string) => void;
  };
}
