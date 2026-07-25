import { clearWorkspaceState, setWorkspaceState } from "../store/workspaceState";

const getSupabaseClient = async () => (await import("./supabaseClient")).supabase;
const WORKSPACE_HOST_ROOT = "app.itemtraxx.com";
const RESERVED_SUBDOMAINS = new Set(["www", "internal", "status", "app"]);
const ROOT_HOSTS = new Set(["itemtraxx.com", "www.itemtraxx.com", WORKSPACE_HOST_ROOT]);
const LOCAL_HOSTS = new Set(["localhost", "127.0.0.1", "0.0.0.0"]);
const normalizeSlug = (value: string) => value.trim().toLowerCase().replace(/[^a-z0-9-]/g, "-").replace(/-+/g, "-").replace(/^-|-$/g, "");

export type ResolvedWorkspaceHost = { host: string; slug: string | null; isWorkspaceHost: boolean; baseHost: string | null };
type WorkspaceLookupRow = { id: string; name: string; slug: string; status?: string | null };

export const resolveWorkspaceHost = (hostname = typeof window !== "undefined" ? window.location.hostname : ""): ResolvedWorkspaceHost => {
  const host = hostname.trim().toLowerCase();
  if (!host || ROOT_HOSTS.has(host) || LOCAL_HOSTS.has(host)) return { host, slug: null, isWorkspaceHost: false, baseHost: host || null };
  const suffix = host.endsWith(`.${WORKSPACE_HOST_ROOT}`) ? `.${WORKSPACE_HOST_ROOT}` : host.endsWith(".localhost") ? ".localhost" : null;
  if (!suffix) return { host, slug: null, isWorkspaceHost: false, baseHost: host };
  const slug = normalizeSlug(host.slice(0, -suffix.length));
  const isWorkspaceHost = !!slug && !RESERVED_SUBDOMAINS.has(slug);
  return { host, slug: isWorkspaceHost ? slug : null, isWorkspaceHost, baseHost: suffix === ".localhost" ? "localhost" : WORKSPACE_HOST_ROOT };
};

const lookup = async (fn: string, args: Record<string, string>) => {
  const { data, error } = await (await getSupabaseClient()).rpc(fn, args);
  if (error) return null;
  const row = Array.isArray(data) ? data[0] as WorkspaceLookupRow | undefined : null;
  return row?.id && row.status !== "suspended" && row.status !== "archived" ? row : null;
};
export const lookupWorkspaceBySlug = (slug: string) => lookup("resolve_public_workspace_by_slug", { p_slug: slug });
export const lookupWorkspaceById = (workspaceId: string) => lookup("resolve_public_workspace_by_id", { p_id: workspaceId });
export const buildWorkspaceAppUrl = (slug: string, path: string) => `https://${slug}.${WORKSPACE_HOST_ROOT}${path.startsWith("/") ? path : `/${path}`}`;

export const initializeWorkspaceContext = async () => {
  if (typeof window === "undefined") return;
  const resolved = resolveWorkspaceHost(window.location.hostname);
  if (!resolved.host) return clearWorkspaceState();
  setWorkspaceState({ ...resolved, workspaceId: null, workspaceName: null, isKnownWorkspace: false, hostMismatch: false });
  if (!resolved.slug) { delete document.documentElement.dataset.workspaceSlug; return; }
  document.documentElement.dataset.workspaceSlug = resolved.slug;
  const workspace = await lookupWorkspaceBySlug(resolved.slug);
  setWorkspaceState({ workspaceId: workspace?.id ?? null, workspaceName: workspace?.name ?? null, isKnownWorkspace: !!workspace?.id });
};
