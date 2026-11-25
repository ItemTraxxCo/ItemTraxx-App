import { invokeEdgeFunction } from "./edgeFunctionClient";
import { getAuthState } from "../store/authState";
import { getOrCreateDeviceSession } from "../utils/deviceSession";
import { edgeFunctionError, missingContextError } from "./appErrors";

export async function isEncryptedBorrowerDirectoryEnabled(): Promise<boolean> {
  const workspaceId = getAuthState().workspaceContextId;
  const userId = getAuthState().userId;
  if (!workspaceId) throw missingContextError("Missing workspace context. Please try again or contact support.");
  if (import.meta.env.DEV && import.meta.env.VITE_ENCRYPTED_BORROWERS_LOCAL === "true") return true;
  const { deviceId } = getOrCreateDeviceSession();
  const response = await invokeEdgeFunction<{ data: { encrypted: boolean } }>("crypto-broker", {
    method: "POST", body: { action: "mode", device_id: deviceId },
  });
  if (!response.ok || typeof response.data?.data?.encrypted !== "boolean" || getAuthState().workspaceContextId !== workspaceId || getAuthState().userId !== userId || !getAuthState().isAuthenticated) {
    throw edgeFunctionError(response, "Unable to determine borrower encryption status.");
  }
  return response.data.data.encrypted;
}
