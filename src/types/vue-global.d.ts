import type { appToastErrorDirective, appToastMessageDirective } from "../directives/appToastError";

declare module "vue" {
  interface GlobalDirectives {
    vAppToastError: typeof appToastErrorDirective;
    vAppToastMessage: typeof appToastMessageDirective;
  }
}

export {};
