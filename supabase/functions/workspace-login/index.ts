import { serve } from "https://deno.land/std@0.177.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.108.2";
import { isAllowedOrigin, parseAllowedOrigins } from "../_shared/cors.ts";
import { readJsonBody } from "../_shared/requestBody.ts";
import { resolveClientFingerprint, resolveClientIp } from "../_shared/preloginGuards.ts";
import { requireTrustedEdgeIngress } from "../_shared/trustedIngress.ts";
import { optionalText, requireEmail, SLUG_PATTERN, ValidationError } from "../_shared/validation.ts";

type RateLimitResult={allowed:boolean};
const corsBase={"Access-Control-Allow-Headers":"authorization, x-client-info, apikey, content-type, x-request-id, aikido-scan-agent","Access-Control-Allow-Methods":"POST, OPTIONS",Vary:"Origin"};
const verifyTurnstile=async(secret:string,token:string,ip:string)=>{const body=new URLSearchParams({secret,response:token});if(ip)body.set("remoteip",ip);const response=await fetch("https://challenges.cloudflare.com/turnstile/v0/siteverify",{method:"POST",headers:{"Content-Type":"application/x-www-form-urlencoded"},body});return response.ok&&Boolean((await response.json() as {success?:boolean}).success);};
serve(async(req)=>{
  const requestId=req.headers.get("x-request-id")??crypto.randomUUID(); const origin=req.headers.get("origin"); const allowed=parseAllowedOrigins(Deno.env.get("ITX_ALLOWED_ORIGINS")??""); const originAllowed=!!origin&&isAllowedOrigin(origin,allowed); const headers={...corsBase,...(originAllowed?{"Access-Control-Allow-Origin":origin!}:{})};
  const json=(status:number,body:Record<string,unknown>)=>new Response(JSON.stringify(body),{status,headers:{...headers,"Content-Type":"application/json","x-request-id":requestId}});
  if(req.method==="OPTIONS")return originAllowed?new Response("ok",{headers}):new Response("Origin not allowed",{status:403,headers});
  if(origin&&!originAllowed)return json(403,{error:"Origin not allowed"}); const ingress=await requireTrustedEdgeIngress(req,"workspace-login",json);if(ingress)return ingress;
  try{
    const body=await readJsonBody(req,32*1024); const email=requireEmail(body.email); const password=typeof body.password==="string"?body.password:""; const workspaceSlug=optionalText(body.workspace_slug,{maxLen:63,pattern:SLUG_PATTERN,transform:"lowercase"})||null; const token=optionalText(body.turnstile_token,{maxLen:4096});
    if(!password||password.length>1024)return json(400,{error:"Invalid request"});
    const secret=Deno.env.get("ITX_TURNSTILE_SECRET")??"";if(!secret||!token)return json(400,{error:"Turnstile verification required"});if(!await verifyTurnstile(secret,token,resolveClientIp(req)))return json(403,{error:"Turnstile verification failed"});
    const url=Deno.env.get("ITX_SUPABASE_URL");const publishable=Deno.env.get("ITX_PUBLISHABLE_KEY");const service=Deno.env.get("ITX_SECRET_KEY");if(!url||!publishable||!service)return json(500,{error:"Server misconfiguration"});
    const admin=createClient(url,service,{auth:{persistSession:false,autoRefreshToken:false}});const fingerprint=await resolveClientFingerprint(req, origin, { trustProxyHeader: true });const rate=await admin.rpc("consume_rate_limit_prelogin",{p_key:fingerprint,p_scope:"workspace-login",p_limit:20,p_window_seconds:900});const rateRow=(Array.isArray(rate.data)?rate.data[0]:rate.data) as RateLimitResult|null;if(rate.error)return json(503,{error:"Rate limit check failed"});if(!rateRow?.allowed)return json(429,{error:"Too many attempts"});
    const auth=createClient(url,publishable,{auth:{persistSession:false,autoRefreshToken:false}});const signed=await auth.auth.signInWithPassword({email,password});if(signed.error||!signed.data.session||!signed.data.user)return json(401,{error:"Invalid credentials"});
    const profileResult=await admin.from("profiles").select("workspace_id,role,is_active,deleted_at").eq("id",signed.data.user.id).maybeSingle();const profile=profileResult.data as {workspace_id:string|null;role:string;is_active:boolean;deleted_at:string|null}|null;
    if(profileResult.error||!profile?.workspace_id||!profile.is_active||profile.deleted_at||!["tenant_account","workspace_admin"].includes(profile.role)){await auth.auth.signOut({scope:"local"});return json(401,{error:"Invalid credentials"});}
    const workspaceResult=await admin.from("workspaces").select("id,slug,status").eq("id",profile.workspace_id).maybeSingle();const workspace=workspaceResult.data as {id:string;slug:string;status:string}|null;
    if(workspaceResult.error||!workspace||workspace.status!=="active"){await auth.auth.signOut({scope:"local"});return json(403,{error:"Workspace disabled"});}
    if(workspaceSlug&&workspace.slug!==workspaceSlug){await auth.auth.signOut({scope:"local"});return json(401,{error:"Invalid credentials"});}
    return json(200,{access_token:signed.data.session.access_token,refresh_token:signed.data.session.refresh_token,workspace_slug:workspace.slug,role:profile.role});
  }catch(error){if(error instanceof ValidationError)return json(400,{error:"Invalid request"});console.error("workspace-login failed",{requestId,error:error instanceof Error?error.message:"unknown"});return json(500,{error:"Unable to sign in"});}
});
