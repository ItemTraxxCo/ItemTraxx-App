import { callSuperOps } from "./client";
import {
  clearActiveJitSession,
  setActiveJitSession,
  type JitSupportTicketRecord,
  type JitTicketScope,
} from "../../store/jitAccessState";

export type JitAuditLogRecord = {
  id: string;
  event_type: string;
  occurred_at: string;
  actor_id: string;
  actor_email: string | null;
  target_workspace_id: string | null;
  ticket_id: string | null;
  scope: JitTicketScope | null;
  action: string;
  reason: string | null;
  incident_id: string | null;
  acknowledged_by: string | null;
  request_id: string | null;
  metadata: Record<string, unknown>;
};

export type RequestJitTicketResult = {
  ticket: JitSupportTicketRecord;
  token: string;
};

export type InvokeBreakGlassResult = {
  ticket: JitSupportTicketRecord;
  break_glass_event_id: string;
  alert_delivery: {
    status: "delivered" | "partial" | "failed";
    attempted_channels: string[];
    delivered_channels: string[];
    queued_retries: number;
  };
  token: string;
};

export const requestJitSupportTicket = async (payload: {
  workspace_id: string;
  reason: string;
  external_ticket_id: string;
  ttl_minutes?: number;
}) => {
  const result = await callSuperOps<RequestJitTicketResult>({
    action: "request_jit_ticket",
    payload,
  });
  setActiveJitSession({ ticket: result.ticket, token: result.token });
  return result;
};

export const invokeBreakGlassAccess = async (payload: {
  workspace_id: string;
  justification: string;
  acknowledged_by: string;
  incident_id?: string | null;
  external_ticket_id?: string | null;
  ttl_minutes?: number;
}) => {
  const result = await callSuperOps<InvokeBreakGlassResult>({
    action: "invoke_break_glass",
    payload,
  });
  setActiveJitSession({ ticket: result.ticket, token: result.token });
  return result;
};

export const revokeJitSupportTicket = async (
  ticketId: string,
  reason?: string,
) => {
  const result = await callSuperOps<{
    ticket: Pick<JitSupportTicketRecord, "id" | "workspace_id" | "scope" | "status" | "revoked_at">;
  }>({
    action: "revoke_jit_ticket",
    payload: {
      ticket_id: ticketId,
      ...(reason ? { reason } : {}),
    },
  });
  clearActiveJitSession();
  return result.ticket;
};

export const listJitSupportTickets = async (filters: {
  workspace_id?: string;
  status?: "all" | "active" | "revoked" | "expired";
  limit?: number;
} = {}) => {
  const result = await callSuperOps<{ tickets: JitSupportTicketRecord[] }>({
    action: "list_jit_tickets",
    payload: filters,
  });
  return result.tickets ?? [];
};

export const listJitAuditLogs = async (filters: {
  workspace_id?: string;
  ticket_id?: string;
  limit?: number;
} = {}) => {
  const result = await callSuperOps<{ logs: JitAuditLogRecord[] }>({
    action: "list_jit_audit_logs",
    payload: filters,
  });
  return result.logs ?? [];
};
