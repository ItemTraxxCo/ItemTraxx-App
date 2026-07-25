import { serve } from "https://deno.land/std@0.177.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.108.2";
import { isKillSwitchWriteBlocked } from "../_shared/killSwitch.ts";
import { isAllowedOrigin, parseAllowedOrigins } from "../_shared/cors.ts";
import { requireTrustedEdgeIngress } from "../_shared/trustedIngress.ts";
import {
  hasPrivilegedStepUp,
  isMissingPrivilegedStepUpTable,
} from "../_shared/privilegedStepUp.ts";
import { validateAccountDeviceSession } from "../_shared/accountSessions.ts";
import { readJsonBody } from "../_shared/requestBody.ts";
import {
  optionalText,
  requireEnum,
  requireUuid,
  BORROWER_ID_PATTERN,
  USERNAME_PATTERN,
  ValidationError,
} from "../_shared/validation.ts";

const baseCorsHeaders = {
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-request-id",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  Vary: "Origin",
};

type RateLimitResult = {
  allowed: boolean;
  retry_after_seconds: number | null;
};

type SupabaseAdminClient = ReturnType<typeof createClient<any, "public", any>>;

type BorrowerRecord = {
  id: string;
  workspace_id: string;
  username: string;
  borrower_id: string;
};
const ACCESS_MODES = new Set(["all", "restricted"] as const);

const CODENAME_PREFIXES = [
  "Nova",
  "Echo",
  "Atlas",
  "Pixel",
  "Orbit",
  "Scout",
  "Comet",
  "Lumen",
  "Aster",
  "Vivid",
  "Aero",
  "Blaze",
  "Cobalt",
  "Delta",
  "Falcon",
  "Glint",
  "Helix",
  "Indigo",
  "Jade",
  "Lynx",
  "Mosaic",
  "Nimbus",
  "Onyx",
  "Prism",
  "Quartz",
  "Raven",
  "Solar",
  "Topaz",
  "Vector",
  "Willow",
  "Zephyr",
  "Beacon",
  "Cosmo",
  "Dawn",
  "Ember",
  "Frost",
  "Gale",
  "Horizon",
  "Jet",
  "Lagoon",
  "Laser",
  "Lotus",
  "Lunar",
  "Neon",
  "Ocean",
  "Opal",
  "Pioneer",
  "Rocket",
  "Saffron",
  "Terra",
  "Auric",
  "Boreal",
  "Cascade",
  "Cipher",
  "Crimson",
  "Draco",
  "Emberly",
  "Fable",
  "Galaxy",
  "Haven",
  "Ion",
  "Krypton",
  "Lucid",
  "Mirage",
  "Noble",
  "Obsidian",
  "Parallax",
  "Radiant",
  "Sierra",
  "Tempest",
  "Unity",
  "Verdant",
  "Warden",
  "Yukon",
  "Zenith",
  "Aurora",
  "Brisk",
  "Cadence",
  "Dynamo",
  "Element",
  "Flux",
  "Garnet",
  "Helio",
  "Jovian",
  "Kepler",
  "Lattice",
  "Matrix",
  "Nexus",
  "Orion",
];

const CODENAME_SUFFIXES = [
  "Fox",
  "Pine",
  "Wave",
  "Maple",
  "River",
  "Spark",
  "Drift",
  "Cedar",
  "Birch",
  "Stone",
  "Oak",
  "Trail",
  "Brook",
  "Field",
  "Grove",
  "Vale",
  "Summit",
  "Harbor",
  "Ridge",
  "Meadow",
  "Glade",
  "Bay",
  "Cliff",
  "Falls",
  "Peak",
  "Dune",
  "Creek",
  "Forest",
  "Lake",
  "Shore",
  "Spruce",
  "Elm",
  "Sage",
  "Anchor",
  "Bluff",
  "Branch",
  "Cloud",
  "Coast",
  "Copper",
  "Cove",
  "Delta",
  "Eagle",
  "Fern",
  "Flame",
  "Fjord",
  "Glacier",
  "Hawk",
  "Island",
  "Jasper",
  "Valley",
  "Arbor",
  "Badge",
  "Beacon",
  "Briar",
  "Canopy",
  "Cascade",
  "Chime",
  "Comet",
  "Compass",
  "Crescent",
  "Crossing",
  "Current",
  "Dawn",
  "Echo",
  "Ember",
  "Estuary",
  "Evergreen",
  "Flint",
  "Frontier",
  "Glow",
  "Grove",
  "Harbor",
  "Horizon",
  "Jetty",
  "Juniper",
  "Kernel",
  "Lantern",
  "Ledge",
  "Marina",
  "Moraine",
  "Nectar",
  "Nook",
  "Orchard",
  "Pass",
  "Pond",
  "Port",
  "Quarry",
  "Raptor",
  "Rift",
  "Roost",
  "Signal",
  "Sound",
  "Spire",
  "Station",
  "Tide",
  "Vista",
  "Wharf",
  "Yard",
  "Yarrow",
  "Zeal",
];

const secureRandomInt = (maxExclusive: number): number => {
  if (!Number.isInteger(maxExclusive) || maxExclusive <= 0) {
    throw new Error("maxExclusive must be a positive integer");
  }
  const uint32Range = 0x1_0000_0000;
  const maxAllowed = Math.floor(uint32Range / maxExclusive) * maxExclusive;
  const buffer = new Uint32Array(1);
  while (true) {
    crypto.getRandomValues(buffer);
    const value = buffer[0];
    if (value < maxAllowed) {
      return value % maxExclusive;
    }
  }
};

const randomDigits = (len: number) =>
  Array.from({ length: len }, () => secureRandomInt(10)).join("");

const randomLetters = (len: number) =>
  Array.from({ length: len }, () =>
    String.fromCharCode(65 + secureRandomInt(26))
  ).join("");

const generateBorrowerId = () => `${randomDigits(4)}${randomLetters(2)}`;

const normalizeNameToken = (token: string) => token.slice(0, 6);

const generateUsername = () => {
  const prefix =
    CODENAME_PREFIXES[secureRandomInt(CODENAME_PREFIXES.length)] ?? "Nova";
  const suffix =
    CODENAME_SUFFIXES[secureRandomInt(CODENAME_SUFFIXES.length)] ?? "Fox";
  // Keep usernames short and readable: NameNameNNN
  return `${normalizeNameToken(prefix)}${normalizeNameToken(suffix)}${randomDigits(3)}`;
};

const buildUniqueBorrowerIdentity = async (
  adminClient: SupabaseAdminClient,
  workspaceId: string
) => {
  for (let attempt = 0; attempt < 12; attempt += 1) {
    const candidateBorrowerId = generateBorrowerId();
    const candidateUsername = generateUsername();
    const { data: conflictBorrowerId } = await adminClient
      .from("borrowers")
      .select("id")
      .eq("workspace_id", workspaceId)
      .eq("borrower_id", candidateBorrowerId)
      .limit(1)
      .maybeSingle();
    if ((conflictBorrowerId as { id?: string } | null)?.id) {
      continue;
    }
    const { data: conflictUsername } = await adminClient
      .from("borrowers")
      .select("id")
      .eq("workspace_id", workspaceId)
      .eq("username", candidateUsername)
      .limit(1)
      .maybeSingle();
    if ((conflictUsername as { id?: string } | null)?.id) {
      continue;
    }
    return { borrowerId: candidateBorrowerId, username: candidateUsername };
  }
  throw new Error("Unable to generate a unique borrower identity.");
};

const isUniqueIdentityConflict = (error: unknown) => {
  const record = error as { code?: string; message?: string; details?: string } | null;
  const message = `${record?.message ?? ""} ${record?.details ?? ""}`.toLowerCase();
  return (
    record?.code === "23505" ||
    message.includes("unique") ||
    message.includes("duplicate") ||
    message.includes("borrower identity already exists")
  );
};

const createBorrowerRecord = async (
  adminClient: SupabaseAdminClient,
  workspaceId: string,
  username: string,
  borrowerId: string
) => {
  const { data, error } = await (adminClient as any)
    .rpc("create_borrower_identity", {
      p_workspace_id: workspaceId,
      p_username: username,
      p_borrower_id: borrowerId,
    })
    .single();

  if (error || !data) {
    return { data: null, error };
  }

  return { data: data as BorrowerRecord, error: null };
};

const createGeneratedBorrowerRecord = async (
  adminClient: SupabaseAdminClient,
  workspaceId: string
) => {
  for (let attempt = 0; attempt < 12; attempt += 1) {
    const generatedIdentity = await buildUniqueBorrowerIdentity(adminClient, workspaceId);
    const result = await createBorrowerRecord(
      adminClient,
      workspaceId,
      generatedIdentity.username,
      generatedIdentity.borrowerId
    );
    if (result.data) {
      return result;
    }
    if (!isUniqueIdentityConflict(result.error)) {
      return result;
    }
  }

  return {
    data: null,
    error: new Error("Unable to generate a unique borrower identity."),
  };
};

const resolveCorsHeaders = (req: Request) => {
  const origin = req.headers.get("Origin");
  const allowedOrigins = parseAllowedOrigins(Deno.env.get("ITX_ALLOWED_ORIGINS"));

  const hasOrigin = !!origin;
  const originAllowed =
    !hasOrigin || (hasOrigin && isAllowedOrigin(origin as string, allowedOrigins));

  const headers =
    hasOrigin && originAllowed
      ? { ...baseCorsHeaders, "Access-Control-Allow-Origin": origin as string }
      : { ...baseCorsHeaders };

  return { hasOrigin, originAllowed, headers };
};

const isLocalhostMaintenanceBypassRequest = (req: Request) => {
  if ((Deno.env.get("ITX_ALLOW_LOCALHOST_MAINTENANCE_BYPASS") ?? "").toLowerCase() !== "true") {
    return false;
  }
  const origin = req.headers.get("origin");
  if (!origin) return false;
  try {
    const hostname = new URL(origin).hostname.toLowerCase();
    if (hostname === "localhost" || hostname === "127.0.0.1" || hostname === "0.0.0.0") {
      return true;
    }
    return false;
  } catch {
    return false;
  }
};

serve(async (req) => {
  const { hasOrigin, originAllowed, headers } = resolveCorsHeaders(req);

  const jsonResponse = (status: number, body: Record<string, unknown>) =>
    new Response(JSON.stringify(body), {
      status,
      headers: { ...headers, "Content-Type": "application/json" },
    });

  if (req.method === "OPTIONS") {
    if (!originAllowed) {
      return new Response("Origin not allowed", { status: 403, headers });
    }
    return new Response("ok", { headers });
  }

  if (hasOrigin && !originAllowed) {
    return jsonResponse(403, { error: "Origin not allowed" });
  }

  const ingressError = await requireTrustedEdgeIngress(
    req,
    "admin-borrower-mutate",
    jsonResponse
  );
  if (ingressError) {
    return ingressError;
  }

  if (isKillSwitchWriteBlocked(req)) {
    return jsonResponse(503, { error: "Unfortunately ItemTraxx is currently unavailable." });
  }

  try {
    const authHeader = req.headers.get("authorization");
    if (!authHeader) {
      return jsonResponse(401, { error: "Unauthorized" });
    }
    const authToken = authHeader.replace(/^Bearer\s+/i, "").trim();

    const supabaseUrl = Deno.env.get("ITX_SUPABASE_URL");
    const publishableKey = Deno.env.get("ITX_PUBLISHABLE_KEY");
    const serviceKey = Deno.env.get("ITX_SECRET_KEY");

    if (!supabaseUrl || !publishableKey || !serviceKey) {
      return jsonResponse(500, { error: "Server misconfiguration" });
    }

    const userClient = createClient(supabaseUrl, publishableKey, {
      global: { headers: { Authorization: authHeader } },
      auth: { persistSession: false },
    });

    const {
      data: { user },
      error: authError,
    } = await userClient.auth.getUser();

    if (authError || !user) {
      return jsonResponse(401, { error: "Unauthorized" });
    }

    const { data: profile, error: profileError } = await userClient
      .from("profiles")
      .select("id, workspace_id, role, is_active")
      .eq("id", user.id)
      .single();

    if (
      profileError ||
      !profile?.workspace_id ||
      profile.role !== "workspace_admin" ||
      profile.is_active === false
    ) {
      return jsonResponse(403, { error: "Access denied" });
    }

    const { data: workspaceStatusRow } = await userClient
      .from("workspaces")
      .select("status")
      .eq("id", profile.workspace_id)
      .single();

    if (workspaceStatusRow?.status && workspaceStatusRow.status !== "active") {
      return jsonResponse(403, { error: "Workspace disabled" });
    }

    const { action, payload } = await readJsonBody(req);
    if (typeof action !== "string" || typeof payload !== "object" || !payload) {
      return jsonResponse(400, { error: "Invalid request" });
    }

    const isMutationAction =
      action === "create" ||
      action === "bulk_create" ||
      action === "delete" ||
      action === "restore";

    const payloadRecord = payload as Record<string, unknown>;
    const deviceId = optionalText(payloadRecord.device_id, { maxLen: 128 }) || null;

    const adminClient = createClient(supabaseUrl, serviceKey, {
      auth: { persistSession: false },
    });
    const resolveAccess = async () => {
      const accessMode = requireEnum(payloadRecord.access_mode, ACCESS_MODES);
      const profileIds = Array.isArray(payloadRecord.profile_ids) ? [...new Set(payloadRecord.profile_ids.map((value) => requireUuid(value)))] : [];
      if (accessMode === "restricted" && !profileIds.length) throw new ValidationError("Select at least one Tenant Account.");
      if (profileIds.length) {
        const { count, error } = await adminClient.from("profiles").select("id", { count: "exact", head: true }).eq("workspace_id", profile.workspace_id).eq("role", "tenant_account").eq("is_active", true).is("deleted_at", null).in("id", profileIds);
        if (error || count !== profileIds.length) throw new ValidationError("Invalid Tenant Account selection.");
      }
      return { accessMode, profileIds };
    };

    if (isMutationAction) {
      try {
        const hasStepUp = await hasPrivilegedStepUp(adminClient, {
          userId: user.id,
          roleScope: "workspace_admin",
          authToken,
        });
        if (!hasStepUp) {
          return jsonResponse(403, { error: "Admin verification required." });
        }
      } catch (error) {
        if (isMissingPrivilegedStepUpTable(error as { code?: string; message?: string })) {
          return jsonResponse(503, {
            error: "Privileged verification controls unavailable. Run latest SQL setup.",
          });
        }
        throw error;
      }
    }

    if (isMutationAction) {
      if (!deviceId) {
        return jsonResponse(400, { error: "Device session is required." });
      }

      const { data: rateLimit, error: rateLimitError } = await userClient.rpc(
        "consume_rate_limit",
        {
          p_scope: "admin",
          p_limit: 20,
          p_window_seconds: 60,
        }
      );

      if (rateLimitError) {
        return jsonResponse(500, { error: "Rate limit check failed" });
      }

      const rateLimitResult = Array.isArray(rateLimit)
        ? ((rateLimit[0] as RateLimitResult | undefined) ?? null)
        : ((rateLimit as RateLimitResult | null) ?? null);
      if (!rateLimitResult) {
        return jsonResponse(500, { error: "Rate limit check failed" });
      }
      if (!rateLimitResult.allowed) {
        return jsonResponse(429, {
          error: "Rate limit exceeded, please try again in a minute.",
        });
      }

      const activeSession = await validateAccountDeviceSession(adminClient, {
        workspaceId: profile.workspace_id,
        profileId: profile.id,
        deviceId,
        authToken,
      });
      if (activeSession.relationMissing) {
        return jsonResponse(503, {
          error: "Session controls unavailable. Run latest SQL setup.",
        });
      }
      if (!activeSession.valid) {
        return jsonResponse(401, { error: "Session revoked" });
      }
    }

    const { data: maintenanceRow } = await adminClient
      .from("app_runtime_config")
      .select("value")
      .eq("key", "maintenance_mode")
      .maybeSingle();
    const maintenanceValue =
      maintenanceRow?.value && typeof maintenanceRow.value === "object"
        ? (maintenanceRow.value as Record<string, unknown>)
        : {};
    if (maintenanceValue.enabled === true && !isLocalhostMaintenanceBypassRequest(req)) {
      return jsonResponse(503, {
        error:
          typeof maintenanceValue.message === "string" && maintenanceValue.message.trim()
            ? maintenanceValue.message.trim()
            : "Maintenance mode enabled.",
      });
    }

    if (action === "list_deleted") {
      const { data, error } = await adminClient
        .from("borrowers")
        .select("id, workspace_id, username, borrower_id")
        .eq("workspace_id", profile.workspace_id)
        .not("deleted_at", "is", null)
        .order("deleted_at", { ascending: false })
        .limit(300);

      if (error) {
        return jsonResponse(400, { error: "Unable to load archived borrowers." });
      }

      return jsonResponse(200, { data: data ?? [] });
    }

    if (action === "create") {
      const { accessMode, profileIds } = await resolveAccess();
      const providedBorrowerId = optionalText(payloadRecord.borrower_id, {
        maxLen: 6,
        transform: "uppercase",
      });
      const providedUsername = optionalText(payloadRecord.username, { maxLen: 40 });
      const hasValidProvidedId = BORROWER_ID_PATTERN.test(providedBorrowerId);
      const hasValidProvidedUsername =
        providedUsername.length >= 4 && USERNAME_PATTERN.test(providedUsername);
      let borrowerId = hasValidProvidedId ? providedBorrowerId : "";
      let username = hasValidProvidedUsername ? providedUsername : "";

      if (borrowerId && username) {
        const [idConflictResult, usernameConflictResult] = await Promise.all([
          adminClient
            .from("borrowers")
            .select("id")
            .eq("workspace_id", profile.workspace_id)
            .eq("borrower_id", borrowerId)
            .is("deleted_at", null)
            .limit(1)
            .maybeSingle(),
          adminClient
            .from("borrowers")
            .select("id")
            .eq("workspace_id", profile.workspace_id)
            .eq("username", username)
            .is("deleted_at", null)
            .limit(1)
            .maybeSingle(),
        ]);
        if (idConflictResult.data?.id || usernameConflictResult.data?.id) {
          return jsonResponse(409, { error: "Borrower ID or username already exists." });
        }
      }

      const { data, error } =
        borrowerId && username
          ? await createBorrowerRecord(adminClient, profile.workspace_id, username, borrowerId)
          : await createGeneratedBorrowerRecord(adminClient, profile.workspace_id);

      if (error || !data) {
        if (isUniqueIdentityConflict(error)) {
          return jsonResponse(409, { error: "Borrower ID or username already exists." });
        }
        return jsonResponse(400, { error: "Unable to create borrower." });
      }

      const { error: modeError } = await adminClient.from("borrowers").update({ access_mode: accessMode }).eq("id", data.id).eq("workspace_id", profile.workspace_id);
      if (modeError) throw new Error("Unable to set borrower access.");
      if (accessMode === "restricted") {
        const { error: grantError } = await adminClient.from("borrower_access_grants").insert(profileIds.map((profileId) => ({ borrower_id: data.id, profile_id: profileId, granted_by: user.id })));
        if (grantError) throw new Error("Unable to set borrower access.");
      }

      return jsonResponse(200, { data });
    }

    if (action === "bulk_create") {
      const payloadRecord = payload as Record<string, unknown>;
      const rows = Array.isArray(payloadRecord.rows)
        ? (payloadRecord.rows as Array<Record<string, unknown>>)
        : [];

      if (!rows.length || rows.length > 500) {
        return jsonResponse(400, { error: "Provide between 1 and 500 rows." });
      }

      const inserted: Array<{
        id: string;
        workspace_id: string;
        username: string;
        borrower_id: string;
      }> = [];
      const skipped: Array<{ row: number; reason: string }> = [];
      const seenIds = new Set<string>();
      const seenUsernames = new Set<string>();

      const normalizedRows = rows.map((row, index) => {
        const rowRecord =
          row && typeof row === "object" && !Array.isArray(row)
            ? (row as Record<string, unknown>)
            : {};
        const username = optionalText(rowRecord.username, { maxLen: 40 });
        const borrowerId = optionalText(rowRecord.borrower_id, {
          maxLen: 6,
          transform: "uppercase",
        });

        return { row: index + 1, username, borrowerId };
      });

      const requestedIds = normalizedRows
        .map((row) => row.borrowerId)
        .filter((value) => BORROWER_ID_PATTERN.test(value));
      const requestedUsernames = normalizedRows
        .map((row) => row.username)
        .filter((value) => value.length >= 4 && USERNAME_PATTERN.test(value));

      const [existingByIdResult, existingByUsernameResult] = await Promise.all([
        requestedIds.length
          ? adminClient
              .from("borrowers")
              .select("borrower_id")
              .eq("workspace_id", profile.workspace_id)
              .is("deleted_at", null)
              .in("borrower_id", requestedIds)
          : Promise.resolve({ data: [], error: null }),
        requestedUsernames.length
          ? adminClient
              .from("borrowers")
              .select("username")
              .eq("workspace_id", profile.workspace_id)
              .is("deleted_at", null)
              .in("username", requestedUsernames)
          : Promise.resolve({ data: [], error: null }),
      ]);

      if (existingByIdResult.error || existingByUsernameResult.error) {
        return jsonResponse(400, { error: "Unable to validate borrower rows." });
      }

      const existingIds = new Set(
        ((existingByIdResult.data ?? []) as Array<{ borrower_id: string }>).map((row) =>
          row.borrower_id.toUpperCase()
        )
      );
      const existingUsernames = new Set(
        ((existingByUsernameResult.data ?? []) as Array<{ username: string }>).map((row) =>
          row.username.toLowerCase()
        )
      );

      for (const row of normalizedRows) {
        const hasValidId = BORROWER_ID_PATTERN.test(row.borrowerId);
        const hasValidUsername =
          row.username.length >= 4 && USERNAME_PATTERN.test(row.username);
        let borrowerId = hasValidId ? row.borrowerId : "";
        let username = hasValidUsername ? row.username : "";

        if (
          borrowerId &&
          (existingIds.has(borrowerId) || seenIds.has(borrowerId))
        ) {
          skipped.push({ row: row.row, reason: "Borrower ID already exists." });
          continue;
        }

        if (
          username &&
          (existingUsernames.has(username.toLowerCase()) ||
            seenUsernames.has(username.toLowerCase()))
        ) {
          skipped.push({ row: row.row, reason: "Username already exists." });
          continue;
        }

        if (!borrowerId || !username) {
          const generated = await createGeneratedBorrowerRecord(
            adminClient,
            profile.workspace_id
          );
          if (!generated.data) {
            skipped.push({ row: row.row, reason: "Unable to generate identity." });
            continue;
          }
          inserted.push(generated.data);
          seenIds.add(generated.data.borrower_id);
          seenUsernames.add(generated.data.username.toLowerCase());
          continue;
        }

        const { data, error } = await createBorrowerRecord(
          adminClient,
          profile.workspace_id,
          username,
          borrowerId
        );

        if (error || !data) {
          skipped.push({
            row: row.row,
            reason: isUniqueIdentityConflict(error)
              ? "Borrower ID or username already exists."
              : "Insert failed.",
          });
          continue;
        }

        inserted.push(data);
        seenIds.add(borrowerId);
        seenUsernames.add(username.toLowerCase());
      }

      return jsonResponse(200, {
        data: {
          inserted_count: inserted.length,
          skipped_count: skipped.length,
          inserted,
          skipped,
        },
      });
    }

    if (action === "delete") {
      const { id } = payloadRecord;
      const normalizedId = requireUuid(id);

      const { data: activeBorrower } = await adminClient
        .from("borrowers")
        .select("id")
        .eq("id", normalizedId)
        .eq("workspace_id", profile.workspace_id)
        .is("deleted_at", null)
        .maybeSingle();

      if (!activeBorrower?.id) {
        return jsonResponse(404, { error: "Borrower not found." });
      }

      const { count, error: checkedOutError } = await adminClient
        .from("items")
        .select("id", { count: "exact", head: true })
        .eq("workspace_id", profile.workspace_id)
        .eq("checked_out_by", normalizedId)
        .is("deleted_at", null);

      if (checkedOutError) {
        return jsonResponse(400, { error: "Unable to archive borrower." });
      }

      if ((count ?? 0) > 0) {
        return jsonResponse(400, {
          error: "Return all checked-out items before archiving this borrower.",
        });
      }

      const { error } = await adminClient
        .from("borrowers")
        .update({
          deleted_at: new Date().toISOString(),
          deleted_by: user.id,
        })
        .eq("id", normalizedId)
        .eq("workspace_id", profile.workspace_id)
        .is("deleted_at", null);

      if (error) {
        return jsonResponse(400, { error: "Unable to archive borrower." });
      }

      return jsonResponse(200, { success: true });
    }

    if (action === "restore") {
      const { id } = payloadRecord;
      const normalizedId = requireUuid(id);

      const { data: archivedBorrower, error: archivedBorrowerError } = await adminClient
        .from("borrowers")
        .select("id, username, borrower_id")
        .eq("id", normalizedId)
        .eq("workspace_id", profile.workspace_id)
        .not("deleted_at", "is", null)
        .maybeSingle();

      if (archivedBorrowerError || !archivedBorrower?.id) {
        return jsonResponse(404, { error: "Borrower not found." });
      }

      const [idConflictResult, usernameConflictResult] = await Promise.all([
        adminClient
          .from("borrowers")
          .select("id")
          .eq("workspace_id", profile.workspace_id)
          .eq("borrower_id", archivedBorrower.borrower_id)
          .neq("id", normalizedId)
          .is("deleted_at", null)
          .limit(1)
          .maybeSingle(),
        adminClient
          .from("borrowers")
          .select("id")
          .eq("workspace_id", profile.workspace_id)
          .eq("username", archivedBorrower.username)
          .neq("id", normalizedId)
          .is("deleted_at", null)
          .limit(1)
          .maybeSingle(),
      ]);

      if (idConflictResult.data?.id || usernameConflictResult.data?.id) {
        return jsonResponse(409, { error: "Borrower ID or username already exists." });
      }

      const { data, error } = await adminClient
        .from("borrowers")
        .update({ deleted_at: null, deleted_by: null })
        .eq("id", normalizedId)
        .eq("workspace_id", profile.workspace_id)
        .not("deleted_at", "is", null)
        .select("id, workspace_id, username, borrower_id")
        .single();

      if (error || !data) {
        return jsonResponse(400, { error: "Unable to restore borrower." });
      }

      return jsonResponse(200, { data });
    }

    return jsonResponse(400, { error: "Invalid action" });
  } catch (error) {
    if (error instanceof ValidationError) {
      return jsonResponse(error.status, { error: error.message });
    }
    console.error("admin-borrower-mutate function error", {
      message: error instanceof Error ? error.message : "Unknown error",
      stack: error instanceof Error ? error.stack : undefined,
    });
    return jsonResponse(500, { error: "Request failed" });
  }
});
