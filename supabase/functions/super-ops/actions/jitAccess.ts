import {
  optionalInteger,
  optionalText,
  requireText,
  requireUuid,
  ValidationError,
} from "../../_shared/validation.ts";
import {
  hashClientIp,
  resolveJitSigningConfig,
  resolveJitTtlConfig,
  signJitTicket,
  type JitSigningConfig,
} from "../../_shared/jitTicket.ts";
import {
  dispatchJitSecurityEvent,
  type JitWebhookDispatchDeps,
  type JitWebhookPayload,
} from "../../_shared/jitWebhooks.ts";
import type { SuperOpsContext } from "../context.ts";

export const JIT_ACCESS_ACTIONS = [
  "request_jit_ticket",
  "invoke_break_glass",
  "revoke_jit_ticket",
  "list_jit_tickets",
  "list_jit_audit_logs",
] as const;

export type JitActionDeps = {
  signingConfig?: JitSigningConfig;
  webhookDeps?: JitWebhookDispatchDeps;
  getEnv?: (name: string) => string | undefined;
};

const clientContextFromRequest = async (
  req: Request,
  getEnv?: (name: string) => string | undefined,
) => ({
  ipHash: await hashClientIp(req, getEnv),
  userAgent: req.headers.get("user-agent")?.slice(0, 512) ?? null,
  requestId: req.headers.get("x-request-id")?.slice(0, 128) ?? crypto.randomUUID(),
});

export const handleJitAccessAction = async (
  context: SuperOpsContext,
  deps: JitActionDeps = {},
): Promise<Response | null> => {
  const { action, payload, adminClient, user, profile, req, jsonResponse } = context;
  const actorEmail = profile.auth_email ?? user.email ?? null;
  const getEnv = deps.getEnv ?? ((name: string) => Deno.env.get(name));

  if (action === "request_jit_ticket") {
    const workspaceId = requireUuid(payload.workspace_id);
    const reason = requireText(payload.reason, { minLen: 3, maxLen: 1000 });
    const externalTicketId = requireText(payload.external_ticket_id, {
      minLen: 1,
      maxLen: 128,
    });
    const { defaultMinutes, maxMinutes } = resolveJitTtlConfig(getEnv);
    const ttlMinutes = optionalInteger(
      payload.ttl_minutes,
      1,
      maxMinutes,
      defaultMinutes,
    );

    const clientCtx = await clientContextFromRequest(req, getEnv);
    const tokenJti = crypto.randomUUID();

    // Emit requested webhook before issuance.
    const requestedEvent: JitWebhookPayload = {
      event_id: crypto.randomUUID(),
      event_type: "jit.ticket.requested",
      timestamp_utc: new Date().toISOString(),
      actor: { id: user.id, email: actorEmail },
      target_workspace_id: workspaceId,
      ticket_id: null,
      scope: "read_only",
      action: "request_jit_ticket",
      reason,
      client: {
        ip_hash: clientCtx.ipHash,
        user_agent: clientCtx.userAgent,
        request_id: clientCtx.requestId,
      },
      metadata: {
        external_ticket_id: externalTicketId,
        ttl_minutes: ttlMinutes,
      },
    };
    const requestedDispatch = await dispatchJitSecurityEvent(
      { payload: requestedEvent, adminClient, isBreakGlass: false },
      deps.webhookDeps,
    );

    await adminClient.rpc("append_jit_audit_log", {
      p_event_type: "jit.ticket.requested",
      p_actor_id: user.id,
      p_actor_email: actorEmail,
      p_target_workspace_id: workspaceId,
      p_ticket_id: null,
      p_scope: "read_only",
      p_action: "request_jit_ticket",
      p_reason: reason,
      p_client_ip_hash: clientCtx.ipHash,
      p_user_agent: clientCtx.userAgent,
      p_request_id: clientCtx.requestId,
      p_metadata: {
        external_ticket_id: externalTicketId,
        ttl_minutes: ttlMinutes,
      },
      p_event_signature: requestedDispatch.eventSignature,
    });

    const { data: ticket, error } = await adminClient.rpc("issue_jit_support_ticket", {
      p_admin_user_id: user.id,
      p_workspace_id: workspaceId,
      p_reason: reason,
      p_external_ticket_id: externalTicketId,
      p_ttl_minutes: ttlMinutes,
      p_token_jti: tokenJti,
      p_client_ip_hash: clientCtx.ipHash,
      p_user_agent: clientCtx.userAgent,
      p_request_id: clientCtx.requestId,
      p_event_signature: requestedDispatch.eventSignature,
    });

    if (error || !ticket || typeof ticket !== "object") {
      return jsonResponse(400, { error: "Unable to issue JIT support ticket." });
    }

    const row = ticket as {
      id: string;
      admin_user_id: string;
      workspace_id: string;
      scope: "read_only" | "break_glass";
      status: string;
      reason: string;
      external_ticket_id: string | null;
      ttl_minutes: number;
      token_jti: string;
      issued_at: string;
      expires_at: string;
    };

    const iatSec = Math.floor(Date.parse(row.issued_at) / 1000);
    const expSec = Math.floor(Date.parse(row.expires_at) / 1000);
    const token = await signJitTicket(
      {
        jti: row.token_jti,
        tid: row.id,
        sub: row.admin_user_id,
        ws: row.workspace_id,
        scope: "read_only",
        rsn: row.external_ticket_id ?? reason.slice(0, 64),
        iat: iatSec,
        exp: expSec,
      },
      deps.signingConfig ?? resolveJitSigningConfig(getEnv),
    );

    const grantedEvent: JitWebhookPayload = {
      event_id: crypto.randomUUID(),
      event_type: "jit.ticket.granted",
      timestamp_utc: row.issued_at,
      actor: { id: user.id, email: actorEmail },
      target_workspace_id: row.workspace_id,
      ticket_id: row.id,
      scope: "read_only",
      action: "request_jit_ticket",
      reason: row.reason,
      client: {
        ip_hash: clientCtx.ipHash,
        user_agent: clientCtx.userAgent,
        request_id: clientCtx.requestId,
      },
      metadata: {
        external_ticket_id: row.external_ticket_id,
        ttl_minutes: row.ttl_minutes,
        expires_at: row.expires_at,
      },
    };
    await dispatchJitSecurityEvent(
      { payload: grantedEvent, adminClient, isBreakGlass: false },
      deps.webhookDeps,
    );

    return jsonResponse(200, {
      data: {
        ticket: {
          id: row.id,
          admin_user_id: row.admin_user_id,
          workspace_id: row.workspace_id,
          scope: row.scope,
          status: row.status,
          reason: row.reason,
          external_ticket_id: row.external_ticket_id,
          ttl_minutes: row.ttl_minutes,
          issued_at: row.issued_at,
          expires_at: row.expires_at,
        },
        token,
      },
    });
  }

  if (action === "invoke_break_glass") {
    const workspaceId = requireUuid(payload.workspace_id);
    const justification = requireText(payload.justification, {
      minLen: 10,
      maxLen: 2000,
    });
    const acknowledgedBy = requireText(payload.acknowledged_by, {
      minLen: 2,
      maxLen: 256,
    });
    const incidentId = optionalText(payload.incident_id, { maxLen: 128 }) || null;
    const externalTicketId = optionalText(payload.external_ticket_id, { maxLen: 128 }) || null;
    const { defaultMinutes, maxMinutes } = resolveJitTtlConfig(getEnv);
    const ttlMinutes = optionalInteger(
      payload.ttl_minutes,
      1,
      maxMinutes,
      defaultMinutes,
    );

    const clientCtx = await clientContextFromRequest(req, getEnv);
    const tokenJti = crypto.randomUUID();
    const nowIso = new Date().toISOString();

    // Synchronous multi-channel alerting BEFORE granting break-glass access.
    const alertPayload: JitWebhookPayload = {
      event_id: crypto.randomUUID(),
      event_type: "jit.break_glass.invoked",
      timestamp_utc: nowIso,
      actor: { id: user.id, email: actorEmail },
      target_workspace_id: workspaceId,
      ticket_id: null,
      scope: "break_glass",
      action: "invoke_break_glass",
      reason: justification,
      incident_id: incidentId,
      acknowledged_by: acknowledgedBy,
      client: {
        ip_hash: clientCtx.ipHash,
        user_agent: clientCtx.userAgent,
        request_id: clientCtx.requestId,
      },
      metadata: {
        external_ticket_id: externalTicketId,
        ttl_minutes: ttlMinutes,
      },
    };

    const dispatch = await dispatchJitSecurityEvent(
      { payload: alertPayload, adminClient, isBreakGlass: true },
      deps.webhookDeps,
    );

    if (!dispatch.quorumMet) {
      await adminClient.rpc("append_jit_audit_log", {
        p_event_type: "jit.break_glass.alert_failed",
        p_actor_id: user.id,
        p_actor_email: actorEmail,
        p_target_workspace_id: workspaceId,
        p_ticket_id: null,
        p_scope: "break_glass",
        p_action: "invoke_break_glass",
        p_reason: justification,
        p_incident_id: incidentId,
        p_acknowledged_by: acknowledgedBy,
        p_client_ip_hash: clientCtx.ipHash,
        p_user_agent: clientCtx.userAgent,
        p_request_id: clientCtx.requestId,
        p_metadata: {
          attempted_channels: dispatch.attemptedChannels,
          delivered_channels: dispatch.deliveredChannels,
          queued_retries: dispatch.queuedRetries,
        },
        p_event_signature: dispatch.eventSignature,
      });

      return jsonResponse(503, {
        error: "Break-glass blocked: synchronous security alert delivery could not be confirmed on any channel.",
      });
    }

    const { data: invokedRows, error } = await adminClient.rpc("invoke_break_glass_access", {
      p_admin_user_id: user.id,
      p_workspace_id: workspaceId,
      p_justification: justification,
      p_acknowledged_by: acknowledgedBy,
      p_incident_id: incidentId,
      p_external_ticket_id: externalTicketId,
      p_ttl_minutes: ttlMinutes,
      p_token_jti: tokenJti,
      p_client_ip_hash: clientCtx.ipHash,
      p_user_agent: clientCtx.userAgent,
      p_request_id: clientCtx.requestId,
      p_event_signature: dispatch.eventSignature,
      p_alert_channels_attempted: dispatch.attemptedChannels,
      p_alert_channels_delivered: dispatch.deliveredChannels,
      p_alert_delivery_status: dispatch.deliveryStatus,
    });

    const invoked = Array.isArray(invokedRows) ? invokedRows[0] : invokedRows;
    if (error || !invoked || typeof invoked !== "object") {
      return jsonResponse(400, { error: "Unable to invoke break-glass access." });
    }

    const row = invoked as {
      ticket_id: string;
      break_glass_event_id: string;
      token_jti: string;
      issued_at: string;
      expires_at: string;
    };

    const iatSec = Math.floor(Date.parse(row.issued_at) / 1000);
    const expSec = Math.floor(Date.parse(row.expires_at) / 1000);
    const token = await signJitTicket(
      {
        jti: row.token_jti,
        tid: row.ticket_id,
        sub: user.id,
        ws: workspaceId,
        scope: "break_glass",
        rsn: incidentId ?? externalTicketId ?? "break_glass",
        iat: iatSec,
        exp: expSec,
      },
      deps.signingConfig ?? resolveJitSigningConfig(getEnv),
    );

    return jsonResponse(200, {
      data: {
        ticket: {
          id: row.ticket_id,
          admin_user_id: user.id,
          workspace_id: workspaceId,
          scope: "break_glass",
          status: "active",
          reason: justification,
          external_ticket_id: externalTicketId ?? incidentId,
          ttl_minutes: ttlMinutes,
          issued_at: row.issued_at,
          expires_at: row.expires_at,
        },
        break_glass_event_id: row.break_glass_event_id,
        alert_delivery: {
          status: dispatch.deliveryStatus,
          attempted_channels: dispatch.attemptedChannels,
          delivered_channels: dispatch.deliveredChannels,
          queued_retries: dispatch.queuedRetries,
        },
        token,
      },
    });
  }

  if (action === "revoke_jit_ticket") {
    const ticketId = requireUuid(payload.ticket_id);
    const revokeReason = optionalText(payload.reason, { maxLen: 500 }) || null;
    const clientCtx = await clientContextFromRequest(req, getEnv);

    const { data: revoked, error } = await adminClient.rpc("revoke_jit_support_ticket", {
      p_ticket_id: ticketId,
      p_actor_id: user.id,
      p_revoke_reason: revokeReason,
      p_client_ip_hash: clientCtx.ipHash,
      p_user_agent: clientCtx.userAgent,
      p_request_id: clientCtx.requestId,
      p_event_signature: "",
    });

    if (error) {
      return jsonResponse(400, { error: "Unable to revoke JIT ticket." });
    }
    if (!revoked || !(revoked as { id?: string }).id) {
      return jsonResponse(404, { error: "Active JIT ticket not found." });
    }

    const row = revoked as {
      id: string;
      workspace_id: string;
      scope: "read_only" | "break_glass";
      status: string;
      reason: string;
      revoked_at: string;
      expires_at: string;
    };

    const revokedEvent: JitWebhookPayload = {
      event_id: crypto.randomUUID(),
      event_type: "jit.ticket.revoked",
      timestamp_utc: row.revoked_at ?? new Date().toISOString(),
      actor: { id: user.id, email: actorEmail },
      target_workspace_id: row.workspace_id,
      ticket_id: row.id,
      scope: row.scope,
      action: "revoke_jit_ticket",
      reason: revokeReason ?? row.reason,
      client: {
        ip_hash: clientCtx.ipHash,
        user_agent: clientCtx.userAgent,
        request_id: clientCtx.requestId,
      },
      metadata: {
        original_expires_at: row.expires_at,
      },
    };
    await dispatchJitSecurityEvent(
      { payload: revokedEvent, adminClient, isBreakGlass: false },
      deps.webhookDeps,
    );

    return jsonResponse(200, {
      data: {
        ticket: {
          id: row.id,
          workspace_id: row.workspace_id,
          scope: row.scope,
          status: row.status,
          revoked_at: row.revoked_at,
        },
      },
    });
  }

  if (action === "list_jit_tickets") {
    const workspaceFilter = optionalText(payload.workspace_id, { maxLen: 36 });
    const statusFilter = optionalText(payload.status, { maxLen: 20 });
    const limit = optionalInteger(payload.limit, 1, 100, 50);

    if (workspaceFilter && workspaceFilter !== "all") {
      requireUuid(workspaceFilter);
    }
    if (
      statusFilter &&
      statusFilter !== "all" &&
      !["active", "revoked", "expired"].includes(statusFilter)
    ) {
      throw new ValidationError("Invalid ticket status filter.");
    }

    let query = adminClient
      .from("jit_support_tickets")
      .select(
        "id, admin_user_id, workspace_id, scope, status, reason, external_ticket_id, ttl_minutes, issued_at, expires_at, revoked_at, revoked_by, revoke_reason",
      )
      .order("issued_at", { ascending: false })
      .limit(limit);

    if (workspaceFilter && workspaceFilter !== "all") {
      query = query.eq("workspace_id", workspaceFilter);
    }
    if (statusFilter && statusFilter !== "all") {
      query = query.eq("status", statusFilter);
    }

    const { data, error } = await query;
    if (error) {
      return jsonResponse(400, { error: "Unable to load JIT tickets." });
    }
    return jsonResponse(200, { data: { tickets: data ?? [] } });
  }

  if (action === "list_jit_audit_logs") {
    const workspaceFilter = optionalText(payload.workspace_id, { maxLen: 36 });
    const ticketFilter = optionalText(payload.ticket_id, { maxLen: 36 });
    const limit = optionalInteger(payload.limit, 1, 100, 50);

    if (workspaceFilter && workspaceFilter !== "all") {
      requireUuid(workspaceFilter);
    }
    if (ticketFilter) {
      requireUuid(ticketFilter);
    }

    let query = adminClient
      .from("jit_audit_log")
      .select(
        "id, event_type, occurred_at, actor_id, actor_email, target_workspace_id, ticket_id, scope, action, reason, incident_id, acknowledged_by, request_id, metadata",
      )
      .order("occurred_at", { ascending: false })
      .limit(limit);

    if (workspaceFilter && workspaceFilter !== "all") {
      query = query.eq("target_workspace_id", workspaceFilter);
    }
    if (ticketFilter) {
      query = query.eq("ticket_id", ticketFilter);
    }

    const { data, error } = await query;
    if (error) {
      return jsonResponse(400, { error: "Unable to load JIT audit logs." });
    }
    return jsonResponse(200, { data: { logs: data ?? [] } });
  }

  return null;
};
