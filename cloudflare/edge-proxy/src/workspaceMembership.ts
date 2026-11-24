export async function ensureWorkspaceAdminMembership(
  read: () => Promise<{ id: string; role: string } | null>,
  promote: (id: string) => Promise<boolean>,
): Promise<void> {
  const membership = await read();
  if (!membership?.id) throw new Error("Workspace admin membership could not be synchronized");
  if (membership.role === "admin") return;
  if (membership.role === "workspace_admin" && await promote(membership.id)) return;
  throw new Error("Workspace admin membership could not be synchronized");
}
