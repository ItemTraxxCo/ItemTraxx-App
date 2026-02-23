import { defineConfig, devices } from "@playwright/test";

const isCI = !!process.env.CI;
const port = Number(process.env.E2E_PORT || 4173);
const baseURL = `http://127.0.0.1:${port}`;
const e2eSupabaseUrl =
  process.env.VITE_SUPABASE_URL || "https://example.supabase.co";
const e2eSupabaseAnonKey =
  process.env.VITE_SUPABASE_ANON_KEY ||
  "sb_publishable_dummy_for_e2e_tests_only";

export default defineConfig({
  testDir: "./tests/e2e",
  fullyParallel: true,
  forbidOnly: isCI,
  retries: isCI ? 2 : 0,
  workers: isCI ? 2 : undefined,
  reporter: isCI ? [["github"], ["html", { open: "never" }]] : [["list"]],
  use: {
    baseURL,
    trace: "on-first-retry",
    screenshot: "only-on-failure",
    video: "retain-on-failure",
  },
  webServer: {
    command: `npm run dev -- --host 127.0.0.1 --port ${port}`,
    env: {
      ...process.env,
      VITE_E2E_TEST_UTILS: "true",
      VITE_SUPABASE_URL: e2eSupabaseUrl,
      VITE_SUPABASE_ANON_KEY: e2eSupabaseAnonKey,
    },
    url: baseURL,
    timeout: 120_000,
    reuseExistingServer: !isCI,
  },
  projects: [
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"] },
    },
  ],
});
