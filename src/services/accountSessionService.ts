import { touchAccountSession } from "./adminOpsService";

/**
 * Establishes the server-side device/session binding required by protected
 * workspace operations. The admin-ops implementation is shared by tenant
 * accounts and workspace administrators; this small boundary keeps callers
 * from depending on the feature-specific service name.
 */
export const ensureAccountSessionReady = () => touchAccountSession();
