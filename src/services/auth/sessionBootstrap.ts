import { withTimeout } from "../asyncUtils";
import { clearAdminVerification, clearAuthState, getAuthState, getPersistedAdminVerification, setAuthStateFromBackend } from "../../store/authState";
import { clearSessionTermination } from "../../store/sessionTermination";
import { lookupWorkspaceById } from "../workspaceService";
import { fetchHttpSessionSummary } from "../httpSessionService";
import { signOutLocalSupabaseSession } from "../supabaseAuthSession";
import { authenticatedRpc, authenticatedSelect } from "../authenticatedDataClient";
import { toKnownRole, type ProfileRow, type WorkspaceRow } from "./types";
const AUTH_QUERY_TIMEOUT_MS=15000;
const timed=<T>(promise:Promise<T>,label:string)=>withTimeout(promise,AUTH_QUERY_TIMEOUT_MS,label);
export const fetchCurrentRoleAndWorkspace=async()=>{
  const [role,workspaceId]=await Promise.all([
    timed(authenticatedRpc<string|null>("current_user_role",{},{suppressUnauthorizedRecovery:true}),"Role lookup timed out."),
    timed(authenticatedRpc<string|null>("current_workspace_id",{},{suppressUnauthorizedRecovery:true}),"Workspace lookup timed out.")
  ]); return {role:toKnownRole(role),workspaceId:typeof workspaceId==="string"?workspaceId:null};
};
export const fetchProfile=async(userId:string):Promise<ProfileRow|null>=>{
  try { const rows=await timed(authenticatedSelect<ProfileRow[]>("profiles",{select:"id,role,workspace_id,auth_email,is_active,deleted_at",id:`eq.${userId}`,limit:"1"},{suppressUnauthorizedRecovery:true}),"Profile lookup timed out."); return rows[0]??null; }
  catch { const fallback=await fetchCurrentRoleAndWorkspace(); return fallback.role||fallback.workspaceId?{id:userId,role:fallback.role,workspace_id:fallback.workspaceId,auth_email:null}:null; }
};
export const fetchWorkspaceContext=async(workspaceId:string):Promise<WorkspaceRow|null>=>{
  try { const rows=await timed(authenticatedSelect<WorkspaceRow[]>("workspaces",{select:"id,status,slug",id:`eq.${workspaceId}`,limit:"1"},{suppressUnauthorizedRecovery:true}),"Workspace lookup timed out."); return rows[0]??null; } catch{return null;}
};
export const resolveWorkspaceSlug=async(workspaceId:string|null)=>workspaceId?(await lookupWorkspaceById(workspaceId))?.slug?.trim()||null:null;
export type ApplyHttpSessionSummaryOptions = { isCurrent?: () => boolean };
const terminateSuspended=async(profile:ProfileRow|null,isCurrent=()=>true)=>{ if(!profile?.workspace_id||profile.role==="super_admin") return false; const workspace=await fetchWorkspaceContext(profile.workspace_id); if(!isCurrent()) return true; if(workspace?.status&&workspace.status!=="active"){await signOutLocalSupabaseSession();clearAdminVerification();clearAuthState(true);return true;}return false; };
export const applyHttpSessionSummary=async(summary:Awaited<ReturnType<typeof fetchHttpSessionSummary>>,options:ApplyHttpSessionSummaryOptions={})=>{
  const isCurrent=options.isCurrent??(()=>true);
  if(!isCurrent()) return;
  if(!summary.authenticated||!summary.user){clearAuthState(true);return;}
  const profile:ProfileRow|null=summary.profile?{id:summary.user.id,role:summary.profile.role,workspace_id:summary.profile.workspace_id,auth_email:summary.profile.auth_email,is_active:summary.profile.is_active}:null;
  if(await terminateSuspended(profile,isCurrent)) return;
  if(!isCurrent()) return;
  const current=getAuthState(); const same=current.userId===summary.user.id; const role=profile?.role??(same?current.role:null); const workspaceId=profile?.workspace_id??(same?current.sessionWorkspaceId:null);
  setAuthStateFromBackend({isInitialized:true,isAuthenticated:true,userId:summary.user.id,email:summary.user.email,signedInAt:summary.user.last_sign_in_at,role,sessionWorkspaceId:workspaceId,workspaceContextId:workspaceId,hasSecondaryAuth:same&&role==="super_admin"?current.hasSecondaryAuth:false,superVerifiedAt:same&&role==="super_admin"?current.superVerifiedAt:null,adminVerifiedAt:(same?current.adminVerifiedAt:null)??(role==="workspace_admin"?(getPersistedAdminVerification(summary.user.id)??summary.password_authenticated_at):null)}); clearSessionTermination();
};
export const refreshAuthFromSession=async()=>{try{await applyHttpSessionSummary(await timed(fetchHttpSessionSummary(),"Session refresh timed out."));}catch{clearAuthState(true);}};
export const initAuthListener=()=>{};
