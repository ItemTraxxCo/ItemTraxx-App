import { describe, expect, it } from "vitest";
// @ts-expect-error edgeSchemas.mjs is untyped JavaScript source consumed by schema generators.
import { generatedEdgeSchemas } from "./edgeSchemas.mjs";

describe("edge device_id length bounds", () => {
  it("bounds admin-ops request device IDs at 128 characters", () => {
    const schema = generatedEdgeSchemas.adminOpsRequest;
    const parse = (id: string) => schema.safeParse({
      action: "get_notifications",
      payload: { device_id: id, device_label: "Test device" },
    });

    expect(parse("a".repeat(128)).success).toBe(true);
    expect(parse("a".repeat(129)).success).toBe(false);
  });

  it("bounds optional super-ops device IDs and required touch-session IDs", () => {
    const listSessions = (id: string) => generatedEdgeSchemas.superOpsRequest.safeParse({
      action: "list_sessions",
      payload: { device_id: id },
    });
    const touchSession = (id: string) => generatedEdgeSchemas.superOpsRequest.safeParse({
      action: "touch_session",
      payload: { device_id: id },
    });

    for (const parse of [listSessions, touchSession]) {
      expect(parse("a".repeat(128)).success).toBe(true);
      expect(parse("a".repeat(129)).success).toBe(false);
    }
  });

  it("bounds session response device IDs at 128 characters", () => {
    const tenantSession = generatedEdgeSchemas.adminOpsResponses.shape.list_sessions;
    const superSession = generatedEdgeSchemas.superOpsResponses.shape.list_sessions;
    const session = (id: string) => ({
      id: "session-id",
      device_id: id,
      device_label: null,
      user_agent: null,
      login_method: null,
      login_location: null,
      general_location: null,
      created_at: "2026-11-27T00:00:00.000Z",
      last_seen_at: "2026-11-27T00:00:00.000Z",
      is_current: false,
    });

    for (const schema of [tenantSession, superSession]) {
      const parse = (id: string) => schema.safeParse({ data: { sessions: [session(id)] }, ok: true });
      expect(parse("a".repeat(128)).success).toBe(true);
      expect(parse("a".repeat(129)).success).toBe(false);
    }
  });
});
