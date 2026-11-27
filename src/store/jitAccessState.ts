import { computed, ref } from "vue";

export type JitTicketScope = "read_only" | "break_glass";

export type JitSupportTicketRecord = {
  id: string;
  admin_user_id: string;
  workspace_id: string;
  scope: JitTicketScope;
  status: string;
  reason: string;
  external_ticket_id: string | null;
  ttl_minutes: number;
  issued_at: string;
  expires_at: string;
  revoked_at?: string | null;
  revoked_by?: string | null;
  revoke_reason?: string | null;
};

export type ActiveJitSession = {
  ticket: JitSupportTicketRecord;
  token: string;
};

// Kept strictly in memory so ephemeral JIT credentials are never written to
// localStorage or sessionStorage and clear immediately on reload/logout/expiry.
const activeSession = ref<ActiveJitSession | null>(null);
let expiryTimer: ReturnType<typeof setTimeout> | null = null;
const clearListeners = new Set<() => void>();

const notifyCleared = () => {
  for (const listener of clearListeners) {
    listener();
  }
};

export const clearActiveJitSession = () => {
  if (expiryTimer !== null) {
    clearTimeout(expiryTimer);
    expiryTimer = null;
  }
  const hadSession = activeSession.value !== null;
  activeSession.value = null;
  if (hadSession) notifyCleared();
};

export const setActiveJitSession = (session: ActiveJitSession) => {
  if (expiryTimer !== null) {
    clearTimeout(expiryTimer);
    expiryTimer = null;
  }
  const expiresAtMs = Date.parse(session.ticket.expires_at);
  const remainingMs = expiresAtMs - Date.now();
  if (!Number.isFinite(remainingMs) || remainingMs <= 0) {
    clearActiveJitSession();
    return;
  }
  activeSession.value = session;
  expiryTimer = setTimeout(() => {
    clearActiveJitSession();
  }, remainingMs);
};

export const getActiveJitSession = () => {
  const current = activeSession.value;
  if (!current) return null;
  const expiresAtMs = Date.parse(current.ticket.expires_at);
  if (!Number.isFinite(expiresAtMs) || Date.now() >= expiresAtMs) {
    clearActiveJitSession();
    return null;
  }
  return current;
};

export const getActiveJitTokenForWorkspace = (
  workspaceId: string,
  requiredScope: JitTicketScope = "read_only",
): string | null => {
  const current = getActiveJitSession();
  if (!current) return null;
  if (current.ticket.workspace_id.toLowerCase() !== workspaceId.toLowerCase()) {
    return null;
  }
  if (requiredScope === "break_glass" && current.ticket.scope !== "break_glass") {
    return null;
  }
  return current.token;
};

export const onJitSessionCleared = (listener: () => void) => {
  clearListeners.add(listener);
  return () => {
    clearListeners.delete(listener);
  };
};

export const useActiveJitSession = () => ({
  activeJitSession: computed(() => activeSession.value),
});
