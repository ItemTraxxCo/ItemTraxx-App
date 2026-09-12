import { authClient } from "../../auth/client";
import { getWorkspaceState } from "../../store/workspaceState";
import { getAuthState, markAdminVerified, setWorkspaceContext } from "../../store/authState";
import { fetchHttpSessionSummary } from "../httpSessionService";
import { logAdminAction } from "../auditLogService";
import { applyHttpSessionSummary, resolveWorkspaceSlug } from "./sessionBootstrap";
import type { LoginNotificationLocation } from "./types";
import { invokeEdgeFunction } from "../edgeFunctionClient";
import { registerPrivilegedAdminStepUp } from "../privilegedStepUpService";
export const sendLoginNotification=(_accessToken:string|null,options:{loginLocation?:LoginNotificationLocation|null}={})=>{
  // This endpoint is cookie-authenticated. Keep the notification request
  // CORS-simple so Cloudflare's managed challenge cannot block its OPTIONS
  // preflight before the Worker can enforce the session and trusted ingress.
  void invokeEdgeFunction("login-notify",{
    method:"POST",
    body:{login_location:options.loginLocation??"regular_login"},
    avoidCorsPreflight:true,
  });
};
export const clearLocalSession=async()=>{};
export const workspaceLogin=async(email:string,password:string,turnstileToken?:string)=>{
  void getWorkspaceState();
  const normalizedEmail=email.trim().toLowerCase();
  const result=await authClient.signIn.email({email:normalizedEmail,password},{
    headers: turnstileToken ? {"x-captcha-response":turnstileToken} : undefined,
  });
  if(result.error)throw new Error(result.error.message??"Invalid email or password.");
  const summary=await fetchHttpSessionSummary();
  await applyHttpSessionSummary(summary); const current=getAuthState(); setWorkspaceContext(current.sessionWorkspaceId);
  if(current.sessionWorkspaceId) await authClient.organization.setActive({organizationId:current.sessionWorkspaceId});
  if(current.role==="workspace_admin"){
    await registerPrivilegedAdminStepUp();
    markAdminVerified();
    // Do not register an account_sessions row here: workspace_admin logins
    // that aren't already on the workspace's subdomain get a full-page
    // redirect (see Login.vue) to {slug}.app.itemtraxx.com, a different
    // origin with its own localStorage device_id. Touching the session on
    // this (pre-redirect) origin would create an orphan row that's never
    // touched again, sharing the same auth_session_id as the real device
    // row created on the destination page via its login_ctx handling.
    try{await logAdminAction({action_type:"admin_login",metadata:{email:email.trim()}});}catch{
      // Audit logging must not block a successful sign in.
    }
  }
  sendLoginNotification(null,{loginLocation:current.role==="workspace_admin"?"workspace_admin_login":"account_login"});
  return {workspaceId:current.workspaceContextId,workspaceSlug:await resolveWorkspaceSlug(current.workspaceContextId),role:current.role};
};
