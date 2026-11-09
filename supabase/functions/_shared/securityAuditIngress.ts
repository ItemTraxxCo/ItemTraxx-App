/**
 * Trusted-ingress signing target for the security-audit Edge Function.
 *
 * The Worker's generic function proxy signs every browser-initiated request
 * with the routed function name as the target. The audit writer is called only
 * by the Worker itself, after it has observed a PostgREST response, and its
 * payload (item IDs, returned IDs, upstream status) is evidence the function
 * cannot re-derive. Signing that call with a target no routed function name can
 * equal lets the function tell a Worker-authored audit apart from a request a
 * signed-in user sent through the proxy.
 *
 * Shared by the Worker and the Edge Function so the two cannot drift. It has no
 * imports so it is safe to bundle into either runtime.
 */
export const SECURITY_AUDIT_INGRESS_TARGET = "security-audit:internal";
