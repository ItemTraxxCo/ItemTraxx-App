/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_SUPABASE_URL: string;
  readonly VITE_SUPABASE_ANON_KEY: string;
  readonly VITE_EDGE_PROXY_URL?: string;
  readonly VITE_SUPER_ADMIN_ACCESS_CODE?: string;
  readonly VITE_TENANT_LOGIN_FUNCTION?: string;
  readonly VITE_LOGO_URL?: string;
  readonly VITE_TERMS_URL?: string;
  readonly VITE_PRIVACY_URL?: string;
  readonly VITE_LEGAL_URL?: string;
  readonly VITE_GIT_COMMIT?: string;
  readonly VITE_STATUS_FUNCTION?: string;
  readonly VITE_TURNSTILE_SITE_KEY?: string;
}

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
