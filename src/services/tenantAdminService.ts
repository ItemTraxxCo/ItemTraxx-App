import { supabase } from "./supabaseClient";

type CreateTenantAdminPayload = {
  new_email: string;
  new_password: string;
  current_password: string;
};

export type TenantAdminSummary = {
  id: string;
  auth_email: string | null;
  created_at: string | null;
};

export const fetchTenantAdmins = async () => {
  const { data, error } = await supabase
    .from("profiles")
    .select("id, auth_email, created_at")
    .eq("role", "tenant_admin")
    .order("created_at", { ascending: false });

  if (error) {
    throw new Error("Unable to load tenant admins.");
  }

  return (data ?? []) as TenantAdminSummary[];
};

export const createTenantAdmin = async (payload: CreateTenantAdminPayload) => {
  const { data: sessionData } = await supabase.auth.getSession();
  let session = sessionData.session ?? null;
  const { data: refreshData } = await supabase.auth.refreshSession();
  if (refreshData?.session) {
    session = refreshData.session;
  }

  if (!session?.access_token) {
    throw new Error("Unauthorized.");
  }

  const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined;
  const accessToken = session.access_token;
  const { data, error } = await supabase.functions.invoke(
    "create-tenant-admin",
    {
      body: payload,
      headers: {
        Authorization: `Bearer ${accessToken}`,
        apikey: anonKey ?? "",
      },
    }
  );

  if (error) {
    const message =
      typeof error === "object" && error && "message" in error
        ? String((error as { message?: string }).message ?? "")
        : "";
    if (message.toLowerCase().includes("credentials")) {
      throw new Error("Invalid credentials.");
    }
    throw new Error("Unable to create admin.");
  }

  return data as { success: boolean; user_id?: string };
};
