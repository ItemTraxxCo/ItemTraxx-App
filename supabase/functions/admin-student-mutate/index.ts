import { serve } from "https://deno.land/std@0.177.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { isKillSwitchWriteBlocked } from "../_shared/killSwitch.ts";

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

const generateStudentId = () => `${randomDigits(4)}${randomLetters(2)}`;

const generateUsername = () => {
  const prefix =
    CODENAME_PREFIXES[secureRandomInt(CODENAME_PREFIXES.length)];
  const suffix =
    CODENAME_SUFFIXES[secureRandomInt(CODENAME_SUFFIXES.length)];
  const token = `${randomLetters(2)}${randomDigits(4)}`;
  return `${prefix}${suffix}${token}`;
};

const buildUniqueStudentIdentity = async (
  adminClient: ReturnType<typeof createClient>,
  tenantId: string
) => {
  for (let attempt = 0; attempt < 12; attempt += 1) {
    const candidateStudentId = generateStudentId();
    const candidateUsername = generateUsername();
    const { data: conflictStudentId } = await adminClient
      .from("students")
      .select("id")
      .eq("tenant_id", tenantId)
      .eq("student_id", candidateStudentId)
      .limit(1)
      .maybeSingle();
    if (conflictStudentId?.id) {
      continue;
    }
    const { data: conflictUsername } = await adminClient
      .from("students")
      .select("id")
      .eq("tenant_id", tenantId)
      .eq("username", candidateUsername)
      .limit(1)
      .maybeSingle();
    if (conflictUsername?.id) {
      continue;
    }
    return { studentId: candidateStudentId, username: candidateUsername };
  }
  throw new Error("Unable to generate a unique student identity.");
};

const resolveCorsHeaders = (req: Request) => {
  const origin = req.headers.get("Origin");
  const allowedOrigins = (Deno.env.get("ITX_ALLOWED_ORIGINS") ?? "")
    .split(",")
    .map((item) => item.trim())
    .filter((item) => item.length > 0);

  const hasOrigin = !!origin;
  const originAllowed =
    !hasOrigin || (hasOrigin && allowedOrigins.includes(origin as string));

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
    if (hostname.startsWith("192.168.") || hostname.startsWith("10.")) {
      return true;
    }
    const match172 = hostname.match(/^172\.(\d{1,3})\./);
    if (!match172) return false;
    const secondOctet = Number(match172[1]);
    return Number.isFinite(secondOctet) && secondOctet >= 16 && secondOctet <= 31;
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

  if (isKillSwitchWriteBlocked(req)) {
    return jsonResponse(503, { error: "Unfortunately ItemTraxx is currently unavailable." });
  }

  try {
    const authHeader = req.headers.get("authorization");
    if (!authHeader) {
      return jsonResponse(401, { error: "Unauthorized" });
    }

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
      .select("tenant_id, role")
      .eq("id", user.id)
      .single();

    if (profileError || !profile?.tenant_id || profile.role !== "tenant_admin") {
      return jsonResponse(403, { error: "Access denied" });
    }

    const { data: tenantStatusRow } = await userClient
      .from("tenants")
      .select("status")
      .eq("id", profile.tenant_id)
      .single();

    if (tenantStatusRow?.status === "suspended") {
      return jsonResponse(403, { error: "Tenant disabled" });
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

    const rateLimitResult = rateLimit as RateLimitResult;
    if (!rateLimitResult.allowed) {
      return jsonResponse(429, {
        error: "Rate limit exceeded, please try again in a minute.",
      });
    }

    const { action, payload } = await req.json();
    if (typeof action !== "string" || typeof payload !== "object" || !payload) {
      return jsonResponse(400, { error: "Invalid request" });
    }

    const adminClient = createClient(supabaseUrl, serviceKey, {
      auth: { persistSession: false },
    });

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
        .from("students")
        .select("id, tenant_id, username, student_id")
        .eq("tenant_id", profile.tenant_id)
        .not("deleted_at", "is", null)
        .order("deleted_at", { ascending: false })
        .limit(300);

      if (error) {
        return jsonResponse(400, { error: "Unable to load archived students." });
      }

      return jsonResponse(200, { data: data ?? [] });
    }

    if (action === "create") {
      const payloadRecord = payload as Record<string, unknown>;
      const providedStudentId =
        typeof payloadRecord.student_id === "string"
          ? payloadRecord.student_id.trim().toUpperCase()
          : "";
      const providedUsername =
        typeof payloadRecord.username === "string"
          ? payloadRecord.username.trim()
          : "";
      const hasValidProvidedId = /^[0-9]{4}[A-Z]{2}$/.test(providedStudentId);
      const hasValidProvidedUsername =
        providedUsername.length >= 4 && providedUsername.length <= 40;
      let studentId = hasValidProvidedId ? providedStudentId : "";
      let username = hasValidProvidedUsername ? providedUsername : "";

      if (studentId && username) {
        const [idConflictResult, usernameConflictResult] = await Promise.all([
          adminClient
            .from("students")
            .select("id")
            .eq("tenant_id", profile.tenant_id)
            .eq("student_id", studentId)
            .limit(1)
            .maybeSingle(),
          adminClient
            .from("students")
            .select("id")
            .eq("tenant_id", profile.tenant_id)
            .eq("username", username)
            .limit(1)
            .maybeSingle(),
        ]);
        if (idConflictResult.data?.id || usernameConflictResult.data?.id) {
          studentId = "";
          username = "";
        }
      }

      if (!studentId || !username) {
        const generatedIdentity = await buildUniqueStudentIdentity(
          adminClient,
          profile.tenant_id
        );
        studentId = generatedIdentity.studentId;
        username = generatedIdentity.username;
      }

      const { data, error } = await adminClient
        .from("students")
        .insert({
          tenant_id: profile.tenant_id,
          username,
          student_id: studentId,
        })
        .select("id, tenant_id, username, student_id")
        .single();

      if (error || !data) {
        return jsonResponse(400, { error: "Unable to create student." });
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
        tenant_id: string;
        username: string;
        student_id: string;
      }> = [];
      const skipped: Array<{ row: number; reason: string }> = [];
      const seenIds = new Set<string>();
      const seenUsernames = new Set<string>();

      const normalizedRows = rows.map((row, index) => {
        const username =
          typeof row.username === "string" ? row.username.trim() : "";
        const studentId =
          typeof row.student_id === "string"
            ? row.student_id.trim().toUpperCase()
            : "";

        return { row: index + 1, username, studentId };
      });

      const requestedIds = normalizedRows
        .map((row) => row.studentId)
        .filter((value) => /^[0-9]{4}[A-Z]{2}$/.test(value));
      const requestedUsernames = normalizedRows
        .map((row) => row.username)
        .filter((value) => value.length >= 4 && value.length <= 40);

      const [existingByIdResult, existingByUsernameResult] = await Promise.all([
        requestedIds.length
          ? adminClient
              .from("students")
              .select("student_id")
              .eq("tenant_id", profile.tenant_id)
              .in("student_id", requestedIds)
          : Promise.resolve({ data: [], error: null }),
        requestedUsernames.length
          ? adminClient
              .from("students")
              .select("username")
              .eq("tenant_id", profile.tenant_id)
              .in("username", requestedUsernames)
          : Promise.resolve({ data: [], error: null }),
      ]);

      if (existingByIdResult.error || existingByUsernameResult.error) {
        return jsonResponse(400, { error: "Unable to validate student rows." });
      }

      const existingIds = new Set(
        ((existingByIdResult.data ?? []) as Array<{ student_id: string }>).map((row) =>
          row.student_id.toUpperCase()
        )
      );
      const existingUsernames = new Set(
        ((existingByUsernameResult.data ?? []) as Array<{ username: string }>).map((row) =>
          row.username.toLowerCase()
        )
      );

      for (const row of normalizedRows) {
        const hasValidId = /^[0-9]{4}[A-Z]{2}$/.test(row.studentId);
        const hasValidUsername = row.username.length >= 4 && row.username.length <= 40;
        let studentId = hasValidId ? row.studentId : "";
        let username = hasValidUsername ? row.username : "";

        if (
          studentId &&
          (existingIds.has(studentId) || seenIds.has(studentId))
        ) {
          skipped.push({ row: row.row, reason: "Student ID already exists." });
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

        if (!studentId || !username) {
          try {
            const generated = await buildUniqueStudentIdentity(
              adminClient,
              profile.tenant_id
            );
            studentId = generated.studentId;
            username = generated.username;
          } catch {
            skipped.push({ row: row.row, reason: "Unable to generate identity." });
            continue;
          }
        }

        const { data, error } = await adminClient
          .from("students")
          .insert({
            tenant_id: profile.tenant_id,
            username,
            student_id: studentId,
          })
          .select("id, tenant_id, username, student_id")
          .single();

        if (error || !data) {
          skipped.push({ row: row.row, reason: "Insert failed." });
          continue;
        }

        inserted.push(data as {
          id: string;
          tenant_id: string;
          username: string;
          student_id: string;
        });
        seenIds.add(studentId);
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
      const { id } = payload as Record<string, unknown>;
      const normalizedId = typeof id === "string" ? id.trim() : "";
      if (!normalizedId) {
        return jsonResponse(400, { error: "Invalid request" });
      }

      const { data: activeStudent } = await adminClient
        .from("students")
        .select("id")
        .eq("id", normalizedId)
        .eq("tenant_id", profile.tenant_id)
        .is("deleted_at", null)
        .maybeSingle();

      if (!activeStudent?.id) {
        return jsonResponse(404, { error: "Student not found." });
      }

      const { count, error: checkedOutError } = await adminClient
        .from("gear")
        .select("id", { count: "exact", head: true })
        .eq("tenant_id", profile.tenant_id)
        .eq("checked_out_by", normalizedId)
        .is("deleted_at", null);

      if (checkedOutError) {
        return jsonResponse(400, { error: "Unable to archive student." });
      }

      if ((count ?? 0) > 0) {
        return jsonResponse(400, {
          error: "Return all checked-out items before archiving this student.",
        });
      }

      const { error } = await adminClient
        .from("students")
        .update({
          deleted_at: new Date().toISOString(),
          deleted_by: user.id,
        })
        .eq("id", normalizedId)
        .eq("tenant_id", profile.tenant_id)
        .is("deleted_at", null);

      if (error) {
        return jsonResponse(400, { error: "Unable to archive student." });
      }

      return jsonResponse(200, { success: true });
    }

    if (action === "restore") {
      const { id } = payload as Record<string, unknown>;
      const normalizedId = typeof id === "string" ? id.trim() : "";
      if (!normalizedId) {
        return jsonResponse(400, { error: "Invalid request" });
      }

      const { data, error } = await adminClient
        .from("students")
        .update({ deleted_at: null, deleted_by: null })
        .eq("id", normalizedId)
        .eq("tenant_id", profile.tenant_id)
        .not("deleted_at", "is", null)
        .select("id, tenant_id, username, student_id")
        .single();

      if (error || !data) {
        return jsonResponse(400, { error: "Unable to restore student." });
      }

      return jsonResponse(200, { data });
    }

    return jsonResponse(400, { error: "Invalid action" });
  } catch (error) {
    console.error("admin-student-mutate function error", {
      message: error instanceof Error ? error.message : "Unknown error",
      stack: error instanceof Error ? error.stack : undefined,
    });
    return jsonResponse(500, { error: "Request failed" });
  }
});
