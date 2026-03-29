import { expect, test } from "@playwright/test";
import type { BrowserContext, Page, Route } from "@playwright/test";

type SessionRow = {
  id: string;
  device_id: string;
  device_label: string | null;
  user_agent: string | null;
  created_at: string;
  last_seen_at: string;
};

type AdminOpsState = {
  sessions: SessionRow[];
  revoked: Set<string>;
  nextId: number;
};

const DEVICE_ID_KEY = "itemtraxx-device-id";
const DEVICE_LABEL_KEY = "itemtraxx-device-label";

const createState = (): AdminOpsState => ({
  sessions: [],
  revoked: new Set<string>(),
  nextId: 1,
});

const installSystemStatusMock = async (context: BrowserContext) => {
  await context.route(/\/functions(?:\/v1)?\/system-status(?:\?.*)?$/, async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        status: "operational",
        checks: { config: "ok", db: "ok", incident_io: "ok" },
        incident_summary: "All systems operational.",
        checked_at: new Date().toISOString(),
        maintenance: { enabled: false, message: "" },
      }),
    });
  });
};

const installAdminOpsMock = async (context: BrowserContext, state: AdminOpsState) => {
  await context.route(/\/functions(?:\/v1)?\/admin-ops(?:\?.*)?$/, async (route: Route) => {
    if (route.request().method() !== "POST") {
      await route.fulfill({
        status: 405,
        contentType: "application/json",
        body: JSON.stringify({ error: "Method not allowed" }),
      });
      return;
    }

    const body = (route.request().postDataJSON() as
      | { action?: string; payload?: Record<string, unknown> }
      | undefined) ?? { action: "", payload: {} };
    const action = body.action ?? "";
    const payload = body.payload ?? {};
    const deviceId = typeof payload.device_id === "string" ? payload.device_id : "";
    const deviceLabel = typeof payload.device_label === "string" ? payload.device_label : null;
    const now = new Date().toISOString();

    const ok = async (data: unknown) => {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ data }),
      });
    };

    if (action === "touch_session") {
      if (!deviceId) {
        await route.fulfill({
          status: 400,
          contentType: "application/json",
          body: JSON.stringify({ error: "Device session is required." }),
        });
        return;
      }
      if (state.revoked.has(deviceId)) {
        await route.fulfill({
          status: 401,
          contentType: "application/json",
          body: JSON.stringify({ error: "Session revoked" }),
        });
        return;
      }
      const existing = state.sessions.find((session) => session.device_id === deviceId);
      if (existing) {
        existing.last_seen_at = now;
        existing.device_label = deviceLabel;
      } else {
        state.sessions.push({
          id: `session-${state.nextId++}`,
          device_id: deviceId,
          device_label: deviceLabel,
          user_agent: null,
          created_at: now,
          last_seen_at: now,
        });
      }
      await ok({ ok: true });
      return;
    }

    if (action === "validate_session") {
      await ok({ valid: !!deviceId && state.sessions.some((session) => session.device_id === deviceId) });
      return;
    }

    if (action === "list_sessions") {
      await ok({
        sessions: state.sessions.map((session) => ({
          ...session,
          is_current: !!deviceId && session.device_id === deviceId,
        })),
      });
      return;
    }

    if (action === "revoke_session") {
      const sessionId = typeof payload.session_id === "string" ? payload.session_id : "";
      const match = state.sessions.find((session) => session.id === sessionId);
      if (!match) {
        await route.fulfill({
          status: 404,
          contentType: "application/json",
          body: JSON.stringify({ error: "Session not found." }),
        });
        return;
      }
      state.revoked.add(match.device_id);
      state.sessions = state.sessions.filter((session) => session.id !== sessionId);
      await ok({ revoked: true });
      return;
    }

    await ok({});
  });
};

const seedTenantAdminState = async (page: Page, deviceId: string, deviceLabel: string) => {
  await page.goto("/");
  await page.waitForFunction(() => typeof window.__itemtraxxTest?.setTenantAdminSession === "function");
  await page.evaluate(
    ({ tenantId, deviceId: id, deviceLabel: label, deviceIdKey, deviceLabelKey }) => {
      localStorage.setItem(deviceIdKey, id);
      localStorage.setItem(deviceLabelKey, label);
      window.__itemtraxxTest?.setTenantAdminSession(tenantId);
    },
    {
      tenantId: "tenant-e2e",
      deviceId,
      deviceLabel,
      deviceIdKey: DEVICE_ID_KEY,
      deviceLabelKey: DEVICE_LABEL_KEY,
    }
  );
};

const callAdminOps = async <T>(page: Page, action: string, payload: Record<string, unknown> = {}) => {
  return await page.evaluate(async ({ action, payload }) => {
    const response = await fetch("/functions/admin-ops", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action, payload }),
    });
    const body = await response.json();
    return { status: response.status, body };
  }, { action, payload }) as { status: number; body: { data?: T; error?: string } };
};

test.describe("tenant admin device revocation", () => {
  test("revoked device cannot silently reappear as active, but a rotated device can sign in cleanly", async ({ browser }) => {
    const state = createState();
    const contextA = await browser.newContext();
    const contextB = await browser.newContext();
    await installSystemStatusMock(contextA);
    await installSystemStatusMock(contextB);
    await installAdminOpsMock(contextA, state);
    await installAdminOpsMock(contextB, state);

    const pageA = await contextA.newPage();
    const pageB = await contextB.newPage();

    await seedTenantAdminState(pageA, "device-a", "Mac");
    await seedTenantAdminState(pageB, "device-b", "iPhone");

    const touchA = await callAdminOps<{ ok: boolean }>(pageA, "touch_session", {
      device_id: "device-a",
      device_label: "Mac",
    });
    const touchB = await callAdminOps<{ ok: boolean }>(pageB, "touch_session", {
      device_id: "device-b",
      device_label: "iPhone",
    });
    expect(touchA.status).toBe(200);
    expect(touchB.status).toBe(200);

    const listBefore = await callAdminOps<{ sessions: SessionRow[] }>(pageA, "list_sessions", {
      device_id: "device-a",
      device_label: "Mac",
    });
    expect(listBefore.status).toBe(200);
    expect(listBefore.body.data?.sessions).toHaveLength(2);
    const deviceBSession = listBefore.body.data?.sessions.find((session) => session.device_id === "device-b");
    expect(deviceBSession?.id).toBeTruthy();

    const revoke = await callAdminOps<{ revoked: boolean }>(pageA, "revoke_session", {
      session_id: deviceBSession?.id,
      device_id: "device-a",
      device_label: "Mac",
    });
    expect(revoke.status).toBe(200);

    const touchRevoked = await callAdminOps(pageB, "touch_session", {
      device_id: "device-b",
      device_label: "iPhone",
    });
    expect(touchRevoked.status).toBe(401);
    expect(touchRevoked.body.error).toBe("Session revoked");

    const listAfterRevocation = await callAdminOps<{ sessions: SessionRow[] }>(pageA, "list_sessions", {
      device_id: "device-a",
      device_label: "Mac",
    });
    expect(listAfterRevocation.body.data?.sessions.map((session) => session.device_id)).toEqual(["device-a"]);

    await pageB.evaluate(
      ({ deviceIdKey, deviceLabelKey }) => {
        localStorage.setItem(deviceIdKey, "device-b-rotated");
        localStorage.setItem(deviceLabelKey, "iPhone");
      },
      { deviceIdKey: DEVICE_ID_KEY, deviceLabelKey: DEVICE_LABEL_KEY }
    );

    const touchRotated = await callAdminOps<{ ok: boolean }>(pageB, "touch_session", {
      device_id: "device-b-rotated",
      device_label: "iPhone",
    });
    expect(touchRotated.status).toBe(200);

    const listAfterRelogin = await callAdminOps<{ sessions: SessionRow[] }>(pageA, "list_sessions", {
      device_id: "device-a",
      device_label: "Mac",
    });
    expect(listAfterRelogin.body.data?.sessions.map((session) => session.device_id).sort()).toEqual([
      "device-a",
      "device-b-rotated",
    ]);

    await contextA.close();
    await contextB.close();
  });
});
