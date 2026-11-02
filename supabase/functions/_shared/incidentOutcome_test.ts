import { classifyIncidentOutcome } from "./incidentOutcome.ts";

const assertOutcome = (
  actual: ReturnType<typeof classifyIncidentOutcome>,
  exploitationStatus: string,
  securityOutcome: string,
  message: string,
) => {
  if (
    actual.exploitationStatus !== exploitationStatus ||
    actual.securityOutcome !== securityOutcome
  ) {
    throw new Error(
      `${message}: got ${actual.exploitationStatus} / ${actual.securityOutcome}`,
    );
  }
};

Deno.test("payload signatures are attempts until response evidence changes the outcome", () => {
  assertOutcome(
    classifyIncidentOutcome("sqli"),
    "ATTEMPTED EXPLOITATION",
    "UNKNOWN",
    "a missing status does not invent an outcome",
  );
  assertOutcome(
    classifyIncidentOutcome("xss", { httpStatus: 403 }),
    "ATTEMPTED EXPLOITATION",
    "BLOCKED",
    "a same-request rejection is visible as blocked at the observed layer",
  );
  assertOutcome(
    classifyIncidentOutcome("sqli", { httpStatus: 200 }),
    "SUSPECTED EXPLOITATION",
    "SUSPECTED SUCCESS",
    "a suspicious signature plus 200 remains suspected, never confirmed",
  );
  assertOutcome(
    classifyIncidentOutcome("xss", { httpStatus: 500 }),
    "ATTEMPTED EXPLOITATION",
    "UNKNOWN",
    "a server error does not prove either blocking or exploitation",
  );
});

Deno.test("tenant probes and enumeration require response evidence for success", () => {
  assertOutcome(
    classifyIncidentOutcome("rls_tenant_breach", { httpStatus: 200 }),
    "ATTEMPTED EXPLOITATION",
    "ATTEMPT DETECTED",
    "a denied cross-workspace target lookup is not a successful breach",
  );
  assertOutcome(
    classifyIncidentOutcome("idor_enumeration", { httpStatus: 200 }),
    "UNDETERMINED",
    "UNKNOWN",
    "a high-volume read tripwire can be legitimate and stays undetermined",
  );
});

Deno.test("only explicit server audit evidence can confirm unauthorized access", () => {
  assertOutcome(
    classifyIncidentOutcome("rls_tenant_breach", {
      httpStatus: 200,
      confirmedBy: "cross_workspace_item_in_upstream_response",
    }),
    "CONFIRMED EXPLOITATION",
    "CONFIRMED UNAUTHORIZED ACCESS",
    "a foreign target in the upstream response is explicit confirmation",
  );
  assertOutcome(
    classifyIncidentOutcome("sqli", {
      httpStatus: 200,
      confirmedBy: "cross_workspace_item_in_upstream_response",
    }),
    "SUSPECTED EXPLOITATION",
    "SUSPECTED SUCCESS",
    "confirmation evidence of the wrong type cannot confirm SQLi",
  );
});
