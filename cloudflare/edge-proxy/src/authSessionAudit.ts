type AdminAuditProfile = {
  id: string;
  better_auth_user_id: string | null;
  workspace_id: string | null;
  role: string;
  is_active: boolean;
  deleted_at: string | null;
};

type BetterAuthSessionIdentity = {
  id: string;
  userId: string;
};

export const buildAdminLoginAuditRecord = (
  profile: AdminAuditProfile,
  session: BetterAuthSessionIdentity,
) => {
  if (
    profile.better_auth_user_id !== session.userId ||
    !profile.workspace_id ||
    !profile.is_active ||
    profile.deleted_at !== null ||
    (profile.role !== "workspace_admin" && profile.role !== "individual_account")
  ) {
    return null;
  }

  return {
    workspace_id: profile.workspace_id,
    actor_id: profile.id,
    action_type: "admin_login",
    entity_type: "auth_session",
    entity_id: session.id,
    metadata: {
      source: "better_auth_session_create",
      role: profile.role,
    },
  };
};
