import { invokeEdgeFunction } from "../edgeFunctionClient";
import { getWorkspaceState } from "../../store/workspaceState";
import { getAuthState, setWorkspaceContext } from "../../store/authState";
import { exchangeHttpSession, fetchHttpSessionSummary } from "../httpSessionService";
import { rotateDeviceSession } from "../../utils/deviceSession";
import { touchAccountSession } from "../adminOpsService";
import { applyHttpSessionSummary, resolveWorkspaceSlug } from "./sessionBootstrap";
import { normalizeFunctionTarget, type LoginNotificationLocation } from "./types";
const loginFunction=()=>normalizeFunctionTarget(import.meta.env.VITE_WORKSPACE_LOGIN_FUNCTION,"workspace-login");
export const sendLoginNotification=(accessToken:string|null,options:{loginLocation?:LoginNotificationLocation|null}={})=>{if(accessToken) void invokeEdgeFunction("login-notify",{method:"POST",accessToken,body:{login_location:options.loginLocation??null}});};
export const clearLocalSession=async()=>{};
export const workspaceLogin=async(email:string,password:string,turnstileToken?:string)=>{
  const host=getWorkspaceState();
  const result=await invokeEdgeFunction<{access_token?:string;refresh_token?:string;workspace_slug?:string},{email:string;password:string;turnstile_token?:string;workspace_slug?:string}>(loginFunction(),{method:"POST",body:{email:email.trim().toLowerCase(),password,...(turnstileToken?{turnstile_token:turnstileToken}:{}),...(host.slug?{workspace_slug:host.slug}:{})}});
  if(!result.ok){if(result.status===503)throw new Error("LIMITER_UNAVAILABLE");if(result.status===403&&result.error.includes("Turnstile"))throw new Error("TURNSTILE_FAILED");if(result.status===403&&result.error.includes("disabled"))throw new Error("WORKSPACE_DISABLED");throw new Error("Invalid email or password.");}
  if(!result.data?.access_token||!result.data.refresh_token)throw new Error("Invalid email or password.");
  const summary=await exchangeHttpSession({access_token:result.data.access_token,refresh_token:result.data.refresh_token}).catch(()=>fetchHttpSessionSummary());
  await applyHttpSessionSummary(summary); const current=getAuthState(); setWorkspaceContext(current.sessionWorkspaceId);
  if(current.role!=="super_admin"){rotateDeviceSession();await touchAccountSession({loginMethod:"password",loginLocation:current.role==="workspace_admin"?"admin_login":"regular_login"}).catch(()=>undefined);}
  sendLoginNotification(result.data.access_token,{loginLocation:current.role==="workspace_admin"?"workspace_admin_login":"account_login"});
  return {workspaceId:current.workspaceContextId,workspaceSlug:result.data.workspace_slug??await resolveWorkspaceSlug(current.workspaceContextId),role:current.role};
};
