import { supabase } from "../supabaseClient";
import { invokeEdgeFunction } from "../edgeFunctionClient";
import { getDistrictState } from "../../store/districtState";
import {
  exchangeHttpSession,
  type HttpSessionSummary,
} from "../httpSessionService";
import { clearLocalSession, sendLoginNotification } from "./tenantLogin";
import {
  normalizeFunctionTarget,
  normalizeLoginNotificationLocation,
  type LoginNotificationLocation,
} from "./types";

const getDistrictHandoffFunctionName = () =>
  normalizeFunctionTarget(import.meta.env.VITE_DISTRICT_HANDOFF_FUNCTION, "district-handoff");

const DISTRICT_HANDOFF_MARKER_KEY = "itemtraxx:district-handoff-at";
const RAW_HANDOFF_TOKEN_PARAMS = ["itx_at", "itx_rt"];

export const consumeDistrictSessionHandoff = async (): Promise<
  | false
  | {
      accessToken: string;
      refreshToken: string;
      sessionSummary: HttpSessionSummary | null;
      loginMethod: "password" | "magic_link" | "session_handoff" | null;
      loginLocation: LoginNotificationLocation | null;
    }
> => {
  if (typeof window === "undefined" || !window.location.hash) {
    return false;
  }

  const hash = window.location.hash.startsWith("#")
    ? window.location.hash.slice(1)
    : window.location.hash;
  const params = new URLSearchParams(hash);
  const handoffCode = params.get("itx_hc");
  const tokenHash = params.get("itx_th");
  const hasRawTokenParams = RAW_HANDOFF_TOKEN_PARAMS.some((key) => params.has(key));
  const rawLoginMethod = params.get("itx_lm");
  const rawLoginLocation = params.get("itx_ll");
  const loginMethod =
    rawLoginMethod === "password" ||
    rawLoginMethod === "magic_link" ||
    rawLoginMethod === "session_handoff"
      ? rawLoginMethod
      : null;
  const loginLocation = normalizeLoginNotificationLocation(rawLoginLocation);

  if (!handoffCode && !tokenHash && !hasRawTokenParams) {
    return false;
  }

  params.delete("itx_hc");
  params.delete("itx_th");
  RAW_HANDOFF_TOKEN_PARAMS.forEach((key) => params.delete(key));
  params.delete("itx_lm");
  params.delete("itx_ll");
  const nextHash = params.toString();
  const nextUrl = `${window.location.pathname}${window.location.search}${nextHash ? `#${nextHash}` : ""}`;
  window.history.replaceState({}, document.title, nextUrl);

  if (!handoffCode && !tokenHash) {
    console.warn("Ignored deprecated raw district handoff token parameters. Please contact support.");
    return false;
  }

  let finalAccessToken: string | null = null;
  let finalRefreshToken: string | null = null;

  if (tokenHash) {
    const verifyResult = await supabase.auth.verifyOtp({
      token_hash: tokenHash,
      type: "magiclink",
    });

    if (
      verifyResult.error ||
      !verifyResult.data.session?.access_token ||
      !verifyResult.data.session.refresh_token
    ) {
      throw new Error("Unable to complete workspace sign-in.");
    }

    const verifiedAccessToken = verifyResult.data.session.access_token;
    const verifiedRefreshToken = verifyResult.data.session.refresh_token;

    const exchangedSessionSummary = await exchangeHttpSession({
      access_token: verifiedAccessToken,
      refresh_token: verifiedRefreshToken,
    });
    await clearLocalSession();
    sendLoginNotification(verifiedAccessToken, { loginLocation });

    try {
      window.sessionStorage.setItem(
        DISTRICT_HANDOFF_MARKER_KEY,
        String(Date.now())
      );
    } catch {
      // Ignore sessionStorage failures.
    }

    return {
      accessToken: verifiedAccessToken,
      refreshToken: verifiedRefreshToken,
      sessionSummary: exchangedSessionSummary ?? null,
      loginMethod,
      loginLocation,
    };
  } else if (handoffCode) {
    const result = await invokeEdgeFunction<
      { access_token?: string; refresh_token?: string },
      { action: "consume"; code: string }
    >(getDistrictHandoffFunctionName(), {
      method: "POST",
      body: {
        action: "consume",
        code: handoffCode,
      },
    });

    if (!result.ok || !result.data?.access_token || !result.data?.refresh_token) {
      if (result.status === 410) {
        const { data: sessionData } = await supabase.auth.getSession();
        if (sessionData.session?.access_token && sessionData.session?.refresh_token) {
          return false;
        }
      }
      throw new Error("Unable to complete workspace sign-in.");
    }

    finalAccessToken = result.data.access_token;
    finalRefreshToken = result.data.refresh_token;
  }

  if (!finalAccessToken || !finalRefreshToken) {
    throw new Error("Unable to complete workspace sign-in.");
  }

  const exchangedSessionSummary = await exchangeHttpSession({
    access_token: finalAccessToken,
    refresh_token: finalRefreshToken,
  });
  await clearLocalSession();

  sendLoginNotification(finalAccessToken, { loginLocation });

  try {
    window.sessionStorage.setItem(
      DISTRICT_HANDOFF_MARKER_KEY,
      String(Date.now())
    );
  } catch {
    // Ignore sessionStorage failures.
  }
  return {
    accessToken: finalAccessToken,
    refreshToken: finalRefreshToken,
    sessionSummary: exchangedSessionSummary ?? null,
    loginMethod,
    loginLocation,
  };
};

export const createDistrictSessionHandoff = async (districtSlug: string) => {
  const result = await invokeEdgeFunction<
    { hashed_token?: string },
    { action: "create"; district_slug: string }
  >(getDistrictHandoffFunctionName(), {
    method: "POST",
    body: {
      action: "create",
      district_slug: districtSlug,
    },
  });

  if (!result.ok || !result.data?.hashed_token) {
    throw new Error("Unable to prepare workspace sign-in.");
  }

  await clearLocalSession();
  return {
    tokenHash: result.data.hashed_token,
  };
};

export const createDistrictAdminSessionHandoff = async (
  email: string,
  password: string,
  turnstileToken: string,
) => {
  const district = getDistrictState();
  const result = await invokeEdgeFunction<
    {
      district_slug?: string | null;
      role?: "tenant_admin" | "district_admin";
      hashed_token?: string | null;
      user_id?: string | null;
    },
    {
      action: "create_admin";
      email: string;
      password: string;
      turnstile_token: string;
      current_district_slug?: string;
    }
  >(getDistrictHandoffFunctionName(), {
    method: "POST",
    body: {
      action: "create_admin",
      email,
      password,
      turnstile_token: turnstileToken,
      current_district_slug: district.isDistrictHost ? district.slug ?? undefined : undefined,
    },
  });

  if (
    !result.ok ||
    !result.data?.hashed_token ||
    !result.data?.role
  ) {
    if (!result.ok && result.error === "Tenant disabled") {
      throw new Error("Tenant disabled.");
    }
    if (!result.ok && result.error === "Access denied") {
      throw new Error("Access denied.");
    }
    if (!result.ok && result.error === "Invalid credentials") {
      throw new Error("Invalid credentials.");
    }
    if (!result.ok && result.error === "District not found") {
      throw new Error("No workspace assignment.");
    }
    throw new Error("Unable to prepare workspace sign-in.");
  }

  return {
    districtSlug: result.data.district_slug ?? null,
    role: result.data.role,
    tokenHash: result.data.hashed_token,
    userId: result.data.user_id ?? null,
  };
};
