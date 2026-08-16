export type WorkspaceStatusRow = {
  status?: string | null;
} | null | undefined;

export type WorkspaceAccessResult =
  | { allowed: true; reason: "active" }
  | { allowed: false; reason: "disabled" | "unavailable" };

/**
 * Resolve the workspace authorization boundary without treating missing or
 * unreadable status data as an active workspace.
 */
export const resolveWorkspaceAccess = (
  row: WorkspaceStatusRow,
  error: unknown,
): WorkspaceAccessResult => {
  if (error || !row || row.status == null) {
    return { allowed: false, reason: "unavailable" };
  }

  if (row.status !== "active") {
    return { allowed: false, reason: "disabled" };
  }

  return { allowed: true, reason: "active" };
};
