import type { appToastErrorDirective } from "../directives/appToastError";

declare module "vue" {
  interface GlobalDirectives {
    vAppToastError: typeof appToastErrorDirective;
  }
}

export {};
