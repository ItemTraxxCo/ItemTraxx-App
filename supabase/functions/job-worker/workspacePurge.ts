export type WorkspacePurgeClaim = {
  id: string;
  name: string;
  slug: string | null;
  better_auth_organization_id: string | null;
};

export type WorkspacePurgeProfile = {
  id: string;
  better_auth_user_id: string | null;
};

/** Side effects the purge needs, injected so the orchestration is unit-testable. */
export type WorkspacePurgeDeps = {
  claim: (limit: number) => Promise<WorkspacePurgeClaim[]>;
  listProfiles: (workspaceId: string) => Promise<WorkspacePurgeProfile[]>;
  deleteBetterAuthUser: (profileId: string, betterAuthUserId: string | null) => Promise<void>;
  deleteBetterAuthOrganization: (organizationId: string) => Promise<void>;
  listSupportAttachmentPaths: (workspaceId: string) => Promise<string[]>;
  removeSupportAttachments: (paths: string[]) => Promise<void>;
  purgeData: (workspaceId: string, externalCleanup: Record<string, number>) => Promise<unknown>;
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
          await deps.deleteBetterAuthUser(profile.id, profile.better_auth_user_id);
        } catch (error) {
          // A profile with no Better Auth user (already removed) is fine.
          if (!isNotFound(error)) throw error;
        }
      }
      if (workspace.better_auth_organization_id) {
        await deps.deleteBetterAuthOrganization(workspace.better_auth_organization_id);
      }

      const attachmentPaths = await deps.listSupportAttachmentPaths(workspace.id);
      if (attachmentPaths.length > 0) await deps.removeSupportAttachments(attachmentPaths);

      await deps.purgeData(workspace.id, {
        better_auth_users: profiles.length,
        support_attachment_files: attachmentPaths.length,
        organization_logo: workspace.better_auth_organization_id ? 1 : 0,
      });
      purged += 1;
      deps.log("workspace purged", { workspace_id: workspace.id });
    } catch (error) {
      failed += 1;
      deps.log("workspace purge failed", {
        workspace_id: workspace.id,
        error: error instanceof Error ? error.message : String(error),
      });
      await deps.release(workspace.id).catch(() => undefined);
    }
  }

  return { claimed: claimed.length, purged, failed };
};
