import { expect, test, type Page } from "@playwright/test";
import {
  mockAdminOps,
  mockSystemStatus,
  mockUnauthenticatedSession,
  setTenantAdminSession,
} from "./helpers/testHarness";

type GuardScenario =
  | { kind: "step_up_required"; status: 403; error: "Admin verification required." }
  | { kind: "session_revoked"; status: 401; error: "Your session has expired. Please sign in again." }
  | { kind: "inactive_admin"; status: 403; error: "Access denied" }
  | { kind: "ok"; status: 200; error: null };

const guardScenarios: GuardScenario[] = [
  { kind: "step_up_required", status: 403, error: "Admin verification required." },
  { kind: "session_revoked", status: 401, error: "Your session has expired. Please sign in again." },
  { kind: "inactive_admin", status: 403, error: "Access denied" },
  { kind: "ok", status: 200, error: null },
];

const callAdminMutation = async (
  page: Page,
  fnName: "invokeAdminGearCreate" | "invokeAdminStudentCreate",
  payload: Record<string, unknown>
) => {
  await page.waitForFunction(
    (name) => typeof (window.__itemtraxxTest as Record<string, unknown> | undefined)?.[name] === "function",
    fnName
  );
  return await page.evaluate(
    async ({ fnName, payload }) => {
      try {
        const fn = window.__itemtraxxTest?.[fnName] as
          | ((input: Record<string, unknown>) => Promise<unknown>)
          | undefined;
        if (!fn) {
          return { ok: false, message: "missing-test-helper" };
        }
        const data = await fn(payload);
        return { ok: true, data };
      } catch (error) {
        const message =
          error instanceof Error
            ? error.message
            : typeof error === "string"
              ? error
              : "unknown-error";
        return { ok: false, message };
      }
    },
    { fnName, payload }
  );
};

test.describe("tenant-admin mutation guard coverage", () => {
  for (const scenario of guardScenarios) {
    test(`admin-gear-mutate + admin-student-mutate: ${scenario.kind}`, async ({ page }) => {
      await mockSystemStatus(page);
      await mockUnauthenticatedSession(page);
      await mockAdminOps(page);

      const capturedDeviceIds: string[] = [];
      const respond = async (route: Parameters<Parameters<typeof page.route>[1]>[0]) => {
        const body = (route.request().postDataJSON() as {
          action?: string;
          payload?: Record<string, unknown>;
        }) ?? { action: "", payload: {} };
        const action = body.action ?? "";
        const payload = body.payload ?? {};
        const deviceId =
          typeof payload.device_id === "string" ? payload.device_id.trim() : "";

        if (action === "create" || action === "bulk_create") {
          capturedDeviceIds.push(deviceId);
        }

        if (scenario.status !== 200) {
          await route.fulfill({
            status: scenario.status,
            contentType: "application/json",
            body: JSON.stringify({ error: scenario.error }),
          });
          return;
        }

        if (action === "create" && (payload.name || payload.username)) {
          const isGearCreate = typeof payload.name === "string";
          await route.fulfill({
            status: 200,
            contentType: "application/json",
            body: JSON.stringify({
              data: isGearCreate
                ? {
                    id: "gear-1",
                    tenant_id: "tenant-e2e",
                    name: payload.name,
                    barcode: payload.barcode,
                    serial_number: null,
                    status: payload.status,
                    notes: payload.notes ?? null,
                  }
                : {
                    id: "student-1",
                    tenant_id: "tenant-e2e",
                    username: payload.username ?? "BorrowerOne",
                    student_id: payload.student_id ?? "1234AB",
                  },
            }),
          });
          return;
        }

        await route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify({ data: {} }),
        });
      };

      await page.route(/\/functions(?:\/v1)?\/admin-gear-mutate(?:\?.*)?$/, respond);
      await page.route(/\/functions(?:\/v1)?\/admin-student-mutate(?:\?.*)?$/, respond);

      await page.goto("/");
      await page.evaluate(() => {
        window.localStorage.setItem("itemtraxx-device-id", "device-guard-test");
        window.localStorage.setItem("itemtraxx-device-label", "Test device");
        window.localStorage.setItem("itemtraxx:onboarding:v1:tenant_user", new Date().toISOString());
        window.localStorage.setItem("itemtraxx:onboarding:v1:tenant_admin", new Date().toISOString());
        window.localStorage.setItem(
          "itemtraxx-cookie-consent",
          JSON.stringify({
            version: 2,
            preferences: { analytics: true, diagnostics: true },
            updatedAt: new Date().toISOString(),
          })
        );
      });
      await setTenantAdminSession(page, "tenant-e2e");

      const gearResult = await callAdminMutation(page, "invokeAdminGearCreate", {
        tenant_id: "tenant-e2e",
        name: "Camera A",
        barcode: "CAM-1",
        status: "available",
      });

      const studentResult = await callAdminMutation(page, "invokeAdminStudentCreate", {
        tenant_id: "tenant-e2e",
        username: "BorrowerOne",
        student_id: "1234AB",
      });

      expect(capturedDeviceIds).toEqual(["device-guard-test", "device-guard-test"]);

      if (scenario.status === 200) {
        expect(gearResult.ok).toBe(true);
        expect(studentResult.ok).toBe(true);
      } else {
        expect(gearResult.ok).toBe(false);
        expect(studentResult.ok).toBe(false);
        expect((gearResult as { message: string }).message).toContain(scenario.error as string);
        expect((studentResult as { message: string }).message).toContain(scenario.error as string);
      }
    });
  }
});
