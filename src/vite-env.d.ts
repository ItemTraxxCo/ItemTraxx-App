/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_SUPABASE_URL: string;
  readonly VITE_SUPABASE_ANON_KEY: string;
  readonly VITE_SUPER_ADMIN_ACCESS_CODE?: string;
  readonly VITE_TENANT_LOGIN_FUNCTION?: string;
  readonly VITE_LOGO_URL?: string;
  readonly VITE_TERMS_URL?: string;
  readonly VITE_PRIVACY_URL?: string;
  readonly VITE_GIT_COMMIT?: string;
  readonly VITE_STATUS_FUNCTION?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
