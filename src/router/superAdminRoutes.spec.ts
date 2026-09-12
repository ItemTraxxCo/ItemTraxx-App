import { describe, expect, it } from "vitest";
import router from "./index";

const EXPECTED = [
  ["/super-admin", "super-admin-home"],
  ["/super-admin/settings", "super-admin-settings"],
  ["/super-admin/settings/sso", "super-admin-sso"],
  ["/super-admin/workspaces", "super-admin-workspaces"],
  ["/super-admin/admins", "super-admin-admins"],
  ["/super-admin/tenant-accounts", "super-admin-tenant-accounts"],
  ["/super-admin/super-admins", "super-admin-super-admins"],
  ["/super-admin/items", "super-admin-items"],
  ["/super-admin/borrowers", "super-admin-borrowers"],
  ["/super-admin/logs", "super-admin-logs"],
  ["/super-admin/broadcasts", "super-admin-broadcasts"],
  ["/super-admin/sales-leads", "super-admin-sales-leads"],
  ["/super-admin/customers", "super-admin-customers"],
  ["/super-admin/support-requests", "super-admin-support-requests"],
] as const;

describe("super-admin route nesting", () => {
  it.each(EXPECTED)("resolves %s to the %s route with super_admin meta intact", (path, name) => {
    const resolved = router.resolve(path);
    expect(resolved.name).toBe(name);
    expect(resolved.meta.requiresRole).toBe("super_admin");
    expect(resolved.meta.requiresSession).toBe(true);
  });

  it("still redirects legacy aliases", () => {
    // router.resolve() does not follow redirects (Vue Router only resolves them
    // during navigation, via push/beforeEach), so we assert on the matched
    // route record's `redirect` target rather than `.name`.
    const gear = router.resolve("/super-admin/gear");
    const gearRedirect = gear.matched[gear.matched.length - 1]?.redirect;
    expect(gearRedirect).toEqual({ name: "super-admin-items" });

    const students = router.resolve("/super-admin/students");
    const studentsRedirect = students.matched[students.matched.length - 1]?.redirect;
    expect(studentsRedirect).toEqual({ name: "super-admin-borrowers" });
  });
});
