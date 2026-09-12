import { hashPassword } from "better-auth/crypto";

type DataClient = {
  schema: (schema: string) => any;
};

type Profile = {
  better_auth_user_id: string | null;
  auth_email: string | null;
  role: string | null;
  workspace_id: string | null;
  is_active: boolean | null;
  deleted_at: string | null;
};

type BetterAuthUser = {
  id: string;
  email: string;
  role?: string | null;
};

type Membership = {
  id: string;
  organizationId: string;
  role: string;
};

export type InternalAuthAdminTarget = {
  user_id: string;
  email: string;
};

const normalizeEmail = (value: unknown) =>
  typeof value === "string" ? value.trim().toLowerCase() : "";

const isSupportedProfileRole = (
  role: string | null,
): role is "tenant_account" | "workspace_admin" | "super_admin" =>
  role === "tenant_account" || role === "workspace_admin" ||
  role === "super_admin";

const expectedGlobalRole = (profileRole: string) =>
  profileRole === "super_admin" ? "super_admin" : "user";

const isGlobalRoleCompatible = (
  profileRole: string,
  userRole: string | null | undefined,
) => {
  const expected = expectedGlobalRole(profileRole);
  // Better Auth's default user role may be omitted on older rows. Treat that
  // as the ordinary user role, but never link a global admin to a non-admin
  // ItemTraxx profile (or vice versa).
  const actual = userRole?.trim() || "user";
  return actual === expected;
};

const bootstrapPassword = () => {
  // The password is never returned or logged. It only exists long enough for
  // Better Auth to hash it before the administrator sends a reset link.
  return `${crypto.randomUUID()}-${crypto.randomUUID()}Aa1!`;
};

const findUserById = async (dataClient: DataClient, userId: string) => {
  const { data, error } = await dataClient.schema("better_auth").from("user")
    .select("id,email,role").eq("id", userId).maybeSingle();
  if (error) throw error;
  return (data as BetterAuthUser | null) ?? null;
};

const findUserByEmail = async (dataClient: DataClient, email: string) => {
  const { data, error } = await dataClient.schema("better_auth").from("user")
    // Email is normalized before this lookup. Use equality rather than an
    // ILIKE pattern so a valid address containing `%` or `_` cannot match a
    // different account during legacy mapping repair.
    .select("id,email,role").eq("email", email).maybeSingle();
  if (error) throw error;
  return (data as BetterAuthUser | null) ?? null;
};

const assertUserIsNotLinkedElsewhere = async (
  dataClient: DataClient,
  profileId: string,
  userId: string,
) => {
  const { data, error } = await dataClient.schema("public").from("profiles")
    .select("id").eq("better_auth_user_id", userId).maybeSingle();
  if (error) throw error;
  if (data?.id && data.id !== profileId) {
    throw new Error(
      "Better Auth user is already linked to another ItemTraxx profile",
    );
  }
};

const ensureMembership = async (
  dataClient: DataClient,
  profile: Profile,
  userId: string,
) => {
  if (profile.role === "super_admin") return;
  if (!profile.workspace_id) {
    throw new Error("Workspace profile is missing its workspace");
  }

  const { data: workspace, error: workspaceError } = await dataClient.schema(
    "public",
  )
    .from("workspaces").select("better_auth_organization_id")
    .eq("id", profile.workspace_id).maybeSingle();
  if (workspaceError) throw workspaceError;
  const organizationId = workspace?.better_auth_organization_id;
  if (!organizationId) throw new Error("Workspace organization is missing");

  const { data: memberships, error: membershipsError } = await dataClient
    .schema("better_auth")
    .from("member").select("id,organizationId,role").eq("userId", userId);
  if (membershipsError) throw membershipsError;
  const rows = (memberships ?? []) as Membership[];
  if (rows.some((row) => row.organizationId !== organizationId)) {
    throw new Error(
      "Better Auth user is already a member of another ItemTraxx workspace",
    );
  }

  const expectedRole = profile.role === "workspace_admin"
    ? "workspace_admin"
    : "tenant_account";
  const membership = rows.find((row) => row.organizationId === organizationId);
  if (membership) {
    if (membership.role !== expectedRole) {
      const { error } = await dataClient.schema("better_auth").from("member")
        .update({ role: expectedRole }).eq("id", membership.id);
      if (error) throw error;
    }
    return;
  }

  const { error } = await dataClient.schema("better_auth").from("member")
    .insert({
      id: crypto.randomUUID(),
      organizationId,
      userId,
      role: expectedRole,
      createdAt: new Date().toISOString(),
    });
  if (error) throw error;
};

const linkExistingUser = async (
  dataClient: DataClient,
  profileId: string,
  profile: Profile,
  user: BetterAuthUser,
) => {
  if (
    !isSupportedProfileRole(profile.role) ||
    !isGlobalRoleCompatible(profile.role, user.role)
  ) {
    throw new Error(
      "Better Auth user role does not match the ItemTraxx profile",
    );
  }
  await assertUserIsNotLinkedElsewhere(dataClient, profileId, user.id);
  // Validate and repair the Better Auth membership before linking the profile.
  // A foreign membership must fail without ever writing the ItemTraxx
  // profile mapping, otherwise a rejected repair could leave a cross-workspace
  // identity attached to the profile.
  await ensureMembership(dataClient, profile, user.id);

  const { error: linkError } = await dataClient.schema("public").from(
    "profiles",
  )
    .update({
      better_auth_user_id: user.id,
      auth_email: normalizeEmail(user.email),
    })
    .eq("id", profileId).is("better_auth_user_id", null);
  if (linkError) throw linkError;

  const { data: linked, error: reloadError } = await dataClient.schema("public")
    .from("profiles")
    .select("better_auth_user_id").eq("id", profileId).maybeSingle();
  if (reloadError) throw reloadError;
  if (linked?.better_auth_user_id !== user.id) {
    throw new Error(
      "ItemTraxx profile mapping changed while it was being repaired",
    );
  }
  return { user_id: user.id, email: normalizeEmail(user.email) };
};

const createUserForProfile = async (
  dataClient: DataClient,
  profileId: string,
  profile: Profile,
  email: string,
) => {
  if (!isSupportedProfileRole(profile.role)) {
    throw new Error("Unsupported ItemTraxx profile role");
  }
  const userId = crypto.randomUUID();
  const passwordHash = await hashPassword(bootstrapPassword());
  const { error } = await dataClient.schema("public").rpc(
    "better_auth_create_user",
    {
      p_profile_id: profileId,
      p_user_id: userId,
      p_account_id: crypto.randomUUID(),
      p_email: email,
      p_name: email,
      p_global_role: expectedGlobalRole(profile.role),
      p_password_hash: passwordHash,
      p_workspace_id: profile.workspace_id,
      p_member_id: profile.workspace_id ? crypto.randomUUID() : null,
      p_member_role: profile.workspace_id && profile.role !== "super_admin"
        ? profile.role
        : null,
    },
  );
  if (error) throw error;
  return { user_id: userId, email };
};

/**
 * Resolves an internal Better Auth administration target. Profiles created
 * before the Better Auth migration can have no mapping; password-reset is the
 * one privileged operation that is allowed to repair that mapping because it
 * immediately provisions a random credential and sends a single-use reset
 * link. The profile's ItemTraxx role and workspace remain authoritative.
 */
export const resolveInternalAuthAdminTarget = async ({
  dataClient,
  action,
  profileId,
  explicitBetterAuthUserId,
}: {
  dataClient: DataClient;
  action: string;
  profileId: string;
  explicitBetterAuthUserId?: string;
}): Promise<InternalAuthAdminTarget | null> => {
  const { data: profileRow, error: profileError } = await dataClient.schema(
    "public",
  )
    .from("profiles")
    .select(
      "better_auth_user_id,auth_email,role,workspace_id,is_active,deleted_at",
    )
    .eq("id", profileId).maybeSingle();
  if (profileError) throw profileError;
  const profile = (profileRow as Profile | null) ?? null;

  const mappedId = profile?.better_auth_user_id ?? explicitBetterAuthUserId ??
    "";
  if (mappedId) {
    const mappedUser = await findUserById(dataClient, mappedId);
    if (mappedUser) return { user_id: mappedUser.id, email: mappedUser.email };
  }

  if (action !== "request_password_reset" || !profile || profile.deleted_at) {
    return null;
  }
  const email = normalizeEmail(profile.auth_email);
  if (!email || !isSupportedProfileRole(profile.role)) return null;

  const existingUser = await findUserByEmail(dataClient, email);
  if (existingUser) {
    return linkExistingUser(dataClient, profileId, profile, existingUser);
  }

  try {
    return await createUserForProfile(dataClient, profileId, profile, email);
  } catch (cause) {
    // A concurrent repair can win the unique Better Auth email race. Resolve
    // that winner by email rather than creating a second account or returning
    // a misleading success response.
    const racedUser = await findUserByEmail(dataClient, email);
    if (racedUser) {
      return linkExistingUser(dataClient, profileId, profile, racedUser);
    }
    throw cause;
  }
};
