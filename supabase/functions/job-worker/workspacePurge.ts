export type WorkspacePurgeClaim = {
  id: string;
  better_auth_organization_id: string | null;
};

export type WorkspacePurgeProfile = {
  id: string;
};

/** Side effects the purge needs, injected so the orchestration is unit-testable. */
export type WorkspacePurgeDeps = {
  claim: (limit: number) => Promise<WorkspacePurgeClaim[]>;
  listProfiles: (workspaceId: string) => Promise<WorkspacePurgeProfile[]>;
  deleteBetterAuthUser: (profileId: string, workspaceId: string) => Promise<void>;
  deleteBetterAuthOrganization: (organizationId: string) => Promise<void>;
  listSupportAttachmentPaths: (workspaceId: string) => Promise<string[]>;
  removeSupportAttachments: (paths: string[]) => Promise<void>;
  purgeData: (
    workspaceId: string,
    externalCleanup: Record<string, number>,
  ) => Promise<{ purged_at?: string } | null>;
  release: (workspaceId: string) => Promise<void>;
  log: (message: string, details: Record<string, unknown>) => void;
};

export type WorkspacePurgeResult = {
  claimed: number;
  purged: number;
  failed: number;
};

const isNotFound = (error: unknown) =>
  error instanceof Error && /not found/i.test(error.message);

const safeErrorCode = (error: unknown) => {
  if (error instanceof Error && (error.name === "AbortError" || error.name === "TimeoutError")) {
    return error.name.toLowerCase();
  }
  return "external_cleanup_failed";
};

/**
 * Purges workspaces whose archive grace period has elapsed. Order matters:
 * external systems (Better Auth, storage) first, database last, so a failure
 * before the final transaction leaves the workspace claimable for retry. Every
 * step is idempotent, and a failed workspace is released back to `grace`.
 */
export const purgeExpiredWorkspaces = async (
  deps: WorkspacePurgeDeps,
  limit = 3,
): Promise<WorkspacePurgeResult> => {
  const claimed = await deps.claim(limit);
  let purged = 0;
  let failed = 0;

  for (const workspace of claimed) {
    try {
      const profiles = await deps.listProfiles(workspace.id);
      for (const profile of profiles) {
        try {
          await deps.deleteBetterAuthUser(profile.id, workspace.id);
        } catch (error) {
          // Keep compatibility with a 404 from an already-removed auth user.
          if (!isNotFound(error)) throw error;
        }
      }
      if (workspace.better_auth_organization_id) {
        try {
          await deps.deleteBetterAuthOrganization(workspace.better_auth_organization_id);
        } catch (error) {
          // A previous attempt may have removed the organization before a
          // later storage/database step failed. Treat its absence as success.
          if (!isNotFound(error)) throw error;
        }
      }

      const attachmentPaths = await deps.listSupportAttachmentPaths(workspace.id);
      if (attachmentPaths.length > 0) await deps.removeSupportAttachments(attachmentPaths);

      const receipt = await deps.purgeData(workspace.id, {
        better_auth_users: profiles.length,
        support_attachment_files: attachmentPaths.length,
        organization_logo: workspace.better_auth_organization_id ? 1 : 0,
      });
      purged += 1;
      deps.log("workspace purged", {
        workspace_id: workspace.id,
        purged_at: receipt?.purged_at ?? new Date().toISOString(),
      });
    } catch (error) {
      failed += 1;
      deps.log("workspace purge failed", {
        workspace_id: workspace.id,
        purge_attempted_at: new Date().toISOString(),
        error_code: safeErrorCode(error),
      });
      await deps.release(workspace.id).catch(() => undefined);
    }
  }

  return { claimed: claimed.length, purged, failed };
};
