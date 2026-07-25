import { getClientDiagnosticsSnapshot } from "./clientDiagnostics";
import { invokeEdgeFunction } from "./edgeFunctionClient";
import { getAuthState } from "../store/authState";
import { getWorkspaceState } from "../store/workspaceState";

export type FatalErrorReportDraft = {
  title: string;
  message: string;
  reason: string;
  error_name?: string;
  stack?: string;
  context?: string;
};

const truncate = (value: string | undefined, max: number) =>
  (value ?? "").trim().slice(0, max);

const getSafePageUrl = () => {
  if (typeof window === "undefined") return "";
  try {
    return `${window.location.origin}${window.location.pathname}`;
  } catch {
    return window.location.pathname || "";
  }
};

export const sendClientErrorReport = async (draft: FatalErrorReportDraft) => {
  const auth = getAuthState();
  const workspace = getWorkspaceState();
  const diagnostics = getClientDiagnosticsSnapshot();

  const result = await invokeEdgeFunction<{ accepted: boolean }>("client-error-report", {
    method: "POST",
    body: {
      title: truncate(draft.title, 160),
      message: truncate(draft.message, 2000),
      reason: truncate(draft.reason, 400),
      error_name: truncate(draft.error_name, 120),
      stack: truncate(draft.stack, 6000),
      context: truncate(draft.context, 400),
      page: {
        url: getSafePageUrl(),
        user_agent: typeof navigator !== "undefined" ? navigator.userAgent : "",
        environment: import.meta.env.VITE_SENTRY_ENVIRONMENT || import.meta.env.MODE,
        release: import.meta.env.VITE_GIT_COMMIT || "n/a",
      },
      auth: {
        is_authenticated: auth.isAuthenticated,
        role: auth.role,
        workspace_id: auth.workspaceContextId,
      },
      workspace: {
        is_workspace_host: workspace.isWorkspaceHost,
        workspace_id: workspace.workspaceId,
      },
      diagnostics,
    },
  });

  if (!result.ok) {
    throw new Error(result.error || "Unable to send error report. Please contact support directly via email: support@itemtraxx.com");
  }
};
