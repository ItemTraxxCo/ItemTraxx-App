export type SecurityIncidentAttackType =
  | "sqli"
  | "xss"
  | "rls_tenant_breach"
  | "idor_enumeration";

export type IncidentExploitationStatus =
  | "ATTEMPTED EXPLOITATION"
  | "SUSPECTED EXPLOITATION"
  | "CONFIRMED EXPLOITATION"
  | "UNDETERMINED";

export type IncidentSecurityOutcome =
  | "ATTEMPT DETECTED"
  | "BLOCKED"
  | "SUSPECTED SUCCESS"
  | "CONFIRMED UNAUTHORIZED ACCESS"
  | "UNKNOWN";

export type IncidentEvidence =
  | "unknown"
  | "payload_signature"
  | "cross_workspace_target_requested"
  | "distinct_target_enumeration"
  | "cross_workspace_resource_returned";

export type TrustedIncidentConfirmation =
  "cross_workspace_item_in_upstream_response";

export type IncidentOutcomeClassification = {
  exploitationStatus: IncidentExploitationStatus;
  securityOutcome: IncidentSecurityOutcome;
  explanation: string;
};

const isObservedRejection = (status: number) =>
  status === 400 || status === 401 || status === 403 || status === 422 ||
  status === 429;

/**
 * Classify only evidence observed by the server. A successful HTTP status is
 * never sufficient to confirm an exploit; confirmation requires the explicit
 * trusted audit proof emitted when a foreign item ID was in the upstream body.
 */
export const classifyIncidentOutcome = (
  attackType: SecurityIncidentAttackType,
  evidence: {
    httpStatus?: number;
    confirmedBy?: TrustedIncidentConfirmation;
  } = {},
): IncidentOutcomeClassification => {
  if (
    attackType === "rls_tenant_breach" &&
    evidence.confirmedBy === "cross_workspace_item_in_upstream_response"
  ) {
    return {
      exploitationStatus: "CONFIRMED EXPLOITATION",
      securityOutcome: "CONFIRMED UNAUTHORIZED ACCESS",
      explanation:
        "A server-side tenant check found a foreign item ID in the upstream response.",
    };
  }

  const status = evidence.httpStatus;
  if (typeof status === "number" && isObservedRejection(status)) {
    return {
      exploitationStatus: "ATTEMPTED EXPLOITATION",
      securityOutcome: "BLOCKED",
      explanation:
        "The request was rejected at the observed layer; this does not rule out side effects elsewhere.",
    };
  }

  if (
    (attackType === "sqli" || attackType === "xss") &&
    typeof status === "number" && status >= 200 && status < 300
  ) {
    return {
      exploitationStatus: "SUSPECTED EXPLOITATION",
      securityOutcome: "SUSPECTED SUCCESS",
      explanation:
        "A payload signature coincided with a 2xx response; unauthorized execution is not confirmed.",
    };
  }

  if (status === undefined || status >= 500 || status < 200 || status >= 300) {
    if (attackType === "idor_enumeration") {
      return {
        exploitationStatus: "UNDETERMINED",
        securityOutcome: "UNKNOWN",
        explanation:
          "Available telemetry cannot determine the outcome of this enumeration signal.",
      };
    }
    return {
      exploitationStatus: "ATTEMPTED EXPLOITATION",
      securityOutcome: "UNKNOWN",
      explanation:
        "The attempt was detected, but available telemetry cannot determine its outcome.",
    };
  }

  if (
    attackType === "sqli" || attackType === "xss" ||
    attackType === "rls_tenant_breach"
  ) {
    return {
      exploitationStatus: "ATTEMPTED EXPLOITATION",
      securityOutcome: "ATTEMPT DETECTED",
      explanation:
        "A suspicious attempt was detected; no successful unauthorized access is established.",
    };
  }

  // A high-volume target-read tripwire can include legitimate bulk use. It is
  // intentionally left undetermined until stronger evidence is available.
  return {
    exploitationStatus: "UNDETERMINED",
    securityOutcome: "UNKNOWN",
    explanation:
      "Available telemetry cannot determine whether this activity was exploitative or successful.",
  };
};
