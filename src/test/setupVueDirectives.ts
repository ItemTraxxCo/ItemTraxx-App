import { config } from "@vue/test-utils";

// src/main.ts registers these directives on the real app. Component specs
// mount without main.ts, so Vue logged "Failed to resolve directive" for every
// template that uses them. No-op stubs keep the existing test behaviour (the
// directives never ran under test) while silencing the warnings. Specs that
// exercise the directives import them from src/directives directly, and a
// spec can still override these through `global.directives` when mounting.
config.global.directives = {
  ...config.global.directives,
  "app-toast-error": {},
  "app-toast-message": {},
};
