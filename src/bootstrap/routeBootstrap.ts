import type { Router } from "vue-router";

export const isPublicBootstrapRoute = (router: Router, path: string): boolean =>
  router.resolve(path || "/").matched.some((record) => record.meta.public === true);
