import { getClientDiagnosticsSnapshot } from "./clientDiagnostics";
import { invokeEdgeFunction } from "./edgeFunctionClient";
import { getAuthState } from "../store/authState";
import { getDistrictState } from "../store/districtState";

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

export const sendClientErrorReport = async (draft: FatalErrorReportDraft) => {
  const auth = getAuthState();
  const district = getDistrictState();
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
        url: typeof window !== "undefined" ? window.location.href : "",
        user_agent: typeof navigator !== "undefined" ? navigator.userAgent : "",
        environment: import.meta.env.VITE_SENTRY_ENVIRONMENT || import.meta.env.MODE,
        release: import.meta.env.VITE_GIT_COMMIT || "n/a",
      },
      auth: {
        is_authenticated: auth.isAuthenticated,
        role: auth.role,
        tenant_context_id: auth.tenantContextId,
        district_context_id: auth.districtContextId,
      },
      district: {
        is_district_host: district.isDistrictHost,
        district_id: district.districtId,
      },
      diagnostics,
    },
  });

  if (!result.ok) {
    throw new Error(result.error || "Unable to send error report.");
  }
};
