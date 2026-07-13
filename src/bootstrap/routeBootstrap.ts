import type { Router } from "vue-router";

export const isPublicBootstrapRoute = (router: Router, path: string): boolean =>
  router.resolve(path || "/").matched.some((record) => record.meta.public === true);

export const isAdminBootstrapRoute = (router: Router, path: string): boolean => {
  const resolved = router.resolve(path || "/");
  return resolved.path.startsWith("/tenant/admin") || resolved.path === "/district";
};
