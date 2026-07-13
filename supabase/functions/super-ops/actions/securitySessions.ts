import { createClient } from "https://esm.sh/@supabase/supabase-js@2.108.2";
import { optionalText, requireText } from "../../_shared/validation.ts";
import type { SuperOpsContext } from "../context.ts";

export const SECURITY_SESSION_ACTIONS = [
  "verify_password",
  "touch_session",
  "list_sessions",
  "revoke_session",
  "revoke_all_sessions",
] as const;

const isMissingRelation = (
  error: { code?: string; message?: string } | null,
  relation: string,
) => error?.code === "42P01" && (error.message ?? "").includes(relation);

const isMissingColumn = (
  error: { code?: string; message?: string } | null,
  column: string,
) => error?.code === "42703" && (error.message ?? "").includes(column);

const sanitizeText = (value: unknown, max = 255) =>
  optionalText(value, { maxLen: max });

const resolveGeneralLocation = (req: Request) => {
  const city = req.headers.get("cf-ipcity")?.trim();
  const region = req.headers.get("cf-region")?.trim();
  const country = req.headers.get("cf-ipcountry")?.trim();
  return [city, region, country].filter(Boolean).join(", ") || null;
};

export const handleSecuritySessionsAction = async (
  context: SuperOpsContext,
): Promise<Response | null> => {
  const {
    req,
    action,
    payload,
    adminClient,
    user,
    profile,
    accessToken,
    supabaseUrl,
    publishableKey,
    jsonResponse,
    writeAudit,
  } = context;

  if (action === "verify_password") {
    const password = typeof payload.password === "string"
      ? payload.password
      : "";
    const email = (profile.auth_email ?? user.email ?? "").trim()
      .toLowerCase();
    if (!password || !email) {
      return jsonResponse(400, { error: "Password is required." });
    }
    if (!publishableKey) {
      return jsonResponse(500, { error: "Server misconfiguration" });
    }

    const signInClient = createClient(supabaseUrl, publishableKey, {
      auth: { persistSession: false },
    });
    const signIn = await signInClient.auth.signInWithPassword({
      email,
      password,
    });
    const verifiedUserId = signIn.data.user?.id ??
      signIn.data.session?.user?.id ?? null;
    if (signIn.error || !verifiedUserId || verifiedUserId !== user.id) {
      return jsonResponse(401, { error: "Invalid password." });
    }

    await writeAudit(
      "super_admin_settings_password_verified",
      "super_admin_auth",
      user.id,
      {},
    );
    return jsonResponse(200, { data: { verified: true } });
  }

  if (action === "touch_session") {
    const deviceId = sanitizeText(payload.device_id, 128);
    const deviceLabel = sanitizeText(payload.device_label, 160) || null;
    const loginMethodRaw = sanitizeText(payload.login_method, 32);
    const loginLocationRaw = sanitizeText(payload.login_location, 32);
    const loginMethod =
      loginMethodRaw === "password" || loginMethodRaw === "passkey"
        ? loginMethodRaw
        : null;
    const loginLocation = loginLocationRaw === "super_auth" ||
        loginLocationRaw === "super_settings"
      ? loginLocationRaw
      : null;
    if (!deviceId) {
      return jsonResponse(400, { error: "Device session is required." });
    }

    const { data: claimsData, error: claimsError } = await adminClient.auth
      .getClaims(accessToken);
    if (claimsError || !claimsData?.claims) {
      return jsonResponse(401, { error: "Unauthorized" });
    }
    const jwtPayload = claimsData.claims as Record<string, unknown>;
    const authSessionId = typeof jwtPayload?.session_id === "string"
      ? jwtPayload.session_id
      : null;
    const authIssuedAt = typeof jwtPayload?.iat === "number"
      ? new Date(jwtPayload.iat * 1000).toISOString()
      : null;

    const now = new Date().toISOString();
    const upsertPayload = {
      profile_id: user.id,
      device_id: deviceId,
      device_label: deviceLabel,
      user_agent: sanitizeText(req.headers.get("user-agent"), 1024) || null,
      login_method: loginMethod,
      login_location: loginLocation,
      general_location: resolveGeneralLocation(req),
      auth_session_id: authSessionId,
      auth_token_issued_at: authIssuedAt,
      last_seen_at: now,
      revoked_at: null,
    };

    const existing = await adminClient
      .from("super_admin_sessions")
      .select("id")
      .eq("profile_id", user.id)
      .eq("device_id", deviceId)
      .is("revoked_at", null)
      .maybeSingle();

    if (
      existing.error &&
      isMissingRelation(existing.error, "super_admin_sessions")
    ) {
      return jsonResponse(400, {
        error: "Session controls unavailable. Run latest SQL setup.",
      });
    }
    if (existing.error) {
      return jsonResponse(400, { error: "Unable to update session." });
    }

    if (existing.data?.id) {
      const { error } = await adminClient
        .from("super_admin_sessions")
        .update(upsertPayload)
        .eq("id", existing.data.id);
      if (error) {
        return jsonResponse(400, { error: "Unable to update session." });
      }
    } else {
      const { error } = await adminClient
        .from("super_admin_sessions")
        .insert({ ...upsertPayload, created_at: now });
      if (error && isMissingRelation(error, "super_admin_sessions")) {
        return jsonResponse(400, {
          error: "Session controls unavailable. Run latest SQL setup.",
        });
      }
      if (error) {
        return jsonResponse(400, { error: "Unable to create session." });
      }
    }

    return jsonResponse(200, { data: { ok: true } });
  }

  if (action === "list_sessions") {
    const currentDeviceId = sanitizeText(payload.device_id, 128);

    let sessionQuery: {
      data: Array<Record<string, unknown>> | null;
      error: { code?: string; message?: string } | null;
    } = await adminClient
      .from("super_admin_sessions")
      .select(
        "id, device_id, device_label, user_agent, login_method, login_location, general_location, created_at, last_seen_at",
      )
      .eq("profile_id", user.id)
      .is("revoked_at", null)
      .order("last_seen_at", { ascending: false })
      .limit(100);

    if (
      sessionQuery.error &&
      isMissingColumn(sessionQuery.error, "login_method")
    ) {
      sessionQuery = await adminClient
        .from("super_admin_sessions")
        .select(
          "id, device_id, device_label, user_agent, created_at, last_seen_at",
        )
        .eq("profile_id", user.id)
        .is("revoked_at", null)
        .order("last_seen_at", { ascending: false })
        .limit(100);
    }

    if (
      sessionQuery.error &&
      isMissingRelation(sessionQuery.error, "super_admin_sessions")
    ) {
      return jsonResponse(400, {
        error: "Session controls unavailable. Run latest SQL setup.",
      });
    }
    if (sessionQuery.error) {
      return jsonResponse(400, { error: "Unable to load active sessions." });
    }

    const rows = (sessionQuery.data ?? []) as Array<Record<string, unknown>>;
    return jsonResponse(200, {
      data: {
        sessions: rows.map((row) => ({
          id: typeof row.id === "string" ? row.id : "",
          device_id: typeof row.device_id === "string" ? row.device_id : "",
          device_label: typeof row.device_label === "string"
            ? row.device_label
            : null,
          user_agent: typeof row.user_agent === "string"
            ? row.user_agent
            : null,
          login_method: typeof row.login_method === "string"
            ? row.login_method
            : null,
          login_location: typeof row.login_location === "string"
            ? row.login_location
            : null,
          general_location: typeof row.general_location === "string"
            ? row.general_location
            : null,
          created_at: typeof row.created_at === "string"
            ? row.created_at
            : null,
          last_seen_at: typeof row.last_seen_at === "string"
            ? row.last_seen_at
            : null,
          is_current: !!currentDeviceId &&
            typeof row.device_id === "string" &&
            row.device_id === currentDeviceId,
        })),
      },
    });
  }

  if (action === "revoke_session") {
    const sessionId = requireText(payload.session_id, { maxLen: 128 });
    const { data, error } = await adminClient
      .from("super_admin_sessions")
      .update({ revoked_at: new Date().toISOString(), revoked_by: user.id })
      .eq("id", sessionId)
      .eq("profile_id", user.id)
      .is("revoked_at", null)
      .select("id");
    if (error && isMissingRelation(error, "super_admin_sessions")) {
      return jsonResponse(400, {
        error: "Session controls unavailable. Run latest SQL setup.",
      });
    }
    if (error) {
      return jsonResponse(400, { error: "Unable to revoke session." });
    }
    if (!data?.length) {
      return jsonResponse(404, { error: "Session not found." });
    }
    return jsonResponse(200, { data: { revoked: true } });
  }

  if (action === "revoke_all_sessions") {
    const signOutCurrent = payload.sign_out_current === true;
    const currentDeviceId = sanitizeText(payload.device_id, 128);
    let query = adminClient
      .from("super_admin_sessions")
      .update({ revoked_at: new Date().toISOString(), revoked_by: user.id })
      .eq("profile_id", user.id)
      .is("revoked_at", null);
    if (!signOutCurrent && currentDeviceId) {
      query = query.neq("device_id", currentDeviceId);
    }
    const { data, error } = await query.select("id");
    if (error && isMissingRelation(error, "super_admin_sessions")) {
      return jsonResponse(400, {
        error: "Session controls unavailable. Run latest SQL setup.",
      });
    }
    if (error) {
      return jsonResponse(400, { error: "Unable to revoke sessions." });
    }
    return jsonResponse(200, { data: { revoked: (data ?? []).length } });
  }

  return null;
};
