import { serve } from "https://deno.land/std@0.177.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.108.2";
import { validateAccountDeviceSession } from "../_shared/accountSessions.ts";
import { getExternalAuthUser } from "../_shared/externalAuth.ts";
import { isAllowedOrigin, parseAllowedOrigins } from "../_shared/cors.ts";
import { isKillSwitchWriteBlocked } from "../_shared/killSwitch.ts";
import { resolveRateLimitResult } from "../_shared/preloginGuards.ts";
import { readJsonBody } from "../_shared/requestBody.ts";
import { requireTrustedEdgeIngress } from "../_shared/trustedIngress.ts";
import { requireEnum, requireUuid, ValidationError } from "../_shared/validation.ts";
import {
  containsQuickReturn,
  type OfflineSyncItem,
  parseDeviceId,
  parsePackVersion,
  parseResolvePayload,
  parseSyncOperations,
  visibleCheckedOutBy,
} from "./contracts.ts";

const ACTIONS = new Set([
  "prepare_pack",
  "prepare_pack_chunk",
  "complete_pack",
  "activate_pack",
  "cancel_pack",
  "sync",
  "resolve",
] as const);
const PACK_CHUNK_SIZE = 100;
const MAX_OFFLINE_PACK_RECORDS = 10_000;
const MAX_OFFLINE_PACK_BYTES = 25 * 1024 * 1024;
const MAX_OFFLINE_PACK_CHUNK_BYTES = 1024 * 1024;
const PACK_LIFETIME_MS = 24 * 60 * 60 * 1000;

const baseCorsHeaders = {
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-request-id",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  Vary: "Origin",
};

type Profile = {
  id: string;
  workspace_id: string;
  role: "tenant_account" | "workspace_admin" | "individual_account";
};

type ItemRow = {
  id: string;
  name: string;
  barcode: string;
  status: string;
  checked_out_by: string | null;
  access_mode: string;
  deleted_at?: string | null;
};

type BorrowerRow = {
  id: string;
  username: string;
  borrower_id: string;
  access_mode: string;
};

const publicItemState = (item: ItemRow | null) =>
  item
    ? {
      id: item.id,
      name: item.name,
      barcode: item.barcode,
      status: item.status,
      // A conflict can be returned after the actor's borrower grant has been
      // revoked. Keep the review envelope useful without exposing the current
      // borrower's identifier across that boundary.
      checked_out_by: null,
    }
    : { missing: true };

serve(async (req) => {
  const origin = req.headers.get("Origin");
  const allowedOrigins = parseAllowedOrigins(
    Deno.env.get("ITX_ALLOWED_ORIGINS"),
  );
  const originAllowed = !origin || isAllowedOrigin(origin, allowedOrigins);
  const headers = origin && originAllowed
    ? { ...baseCorsHeaders, "Access-Control-Allow-Origin": origin }
    : { ...baseCorsHeaders };
  const jsonResponse = (status: number, body: Record<string, unknown>) =>
    new Response(JSON.stringify(body), {
      status,
      headers: { ...headers, "Content-Type": "application/json" },
    });

  if (req.method === "OPTIONS") {
    return originAllowed
      ? new Response("ok", { headers })
      : new Response("Origin not allowed", { status: 403, headers });
  }
  if (origin && !originAllowed) {
    return jsonResponse(403, { error: "Origin not allowed" });
  }

  const ingressError = await requireTrustedEdgeIngress(
    req,
    "offline-checkout",
    jsonResponse,
  );
  if (ingressError) return ingressError;

  try {
    const authHeader = req.headers.get("authorization");
    const authToken = authHeader?.replace(/^Bearer\s+/i, "").trim() ?? "";
    const supabaseUrl = Deno.env.get("ITX_SUPABASE_URL") ?? Deno.env.get("SUPABASE_URL");
    const publishableKey = Deno.env.get("ITX_PUBLISHABLE_KEY") ?? Deno.env.get("SUPABASE_ANON_KEY");
    const serviceKey = Deno.env.get("ITX_SECRET_KEY") ?? Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
    if (!authHeader || !authToken) {
      return jsonResponse(401, { error: "Unauthorized" });
    }
    if (!supabaseUrl || !publishableKey || !serviceKey) {
      return jsonResponse(500, { error: "Server misconfiguration" });
    }

    const userClient = createClient(supabaseUrl, publishableKey, {
      global: { headers: { Authorization: authHeader } },
      auth: { persistSession: false },
    });
    // Better Auth issues the external JWT consumed by Supabase RLS; it is not
    // a GoTrue auth.users token. Resolve the caller through the verified
    // external subject and the ItemTraxx profile mapping instead of asking
    // GoTrue to look up a user that intentionally does not exist there.
    const { data: authData, error: authError } = await getExternalAuthUser(
      userClient,
      authHeader,
    );
    if (authError || !authData.user) {
      return jsonResponse(401, { error: "Unauthorized" });
    }

    const { data: profileRow, error: profileError } = await userClient
      .from("profiles")
      .select("id,workspace_id,role,is_active,deleted_at")
      .eq("id", authData.user.id)
      .single();
    if (
      profileError || !profileRow?.workspace_id ||
      profileRow.is_active === false ||
      profileRow.deleted_at ||
      !["tenant_account", "workspace_admin", "individual_account"].includes(profileRow.role)
    ) {
      return jsonResponse(403, { error: "Access denied" });
    }
    const profile = profileRow as Profile;

    const body = await readJsonBody(req, 256 * 1024);
    const action = requireEnum(body.action, ACTIONS);
    const deviceId = parseDeviceId(body.device_id);
    const adminClient = createClient(supabaseUrl, serviceKey, {
      auth: { persistSession: false },
    });
    const session = await validateAccountDeviceSession(adminClient, {
      workspaceId: profile.workspace_id,
      profileId: profile.id,
      deviceId,
      authToken,
    });
    if (session.relationMissing) {
      return jsonResponse(503, {
        error: "Session controls unavailable. Run latest SQL setup.",
      });
    }
    if (!session.valid) {
      if (session.reason === "missing_session") {
        return jsonResponse(409, {
          error: "Offline session is still initializing. Please retry.",
        });
      }
      return jsonResponse(401, { error: "Session revoked" });
    }

    const { data: workspace, error: workspaceError } = await adminClient
      .from("workspaces")
      .select("status")
      .eq("id", profile.workspace_id)
      .maybeSingle();
    if (workspaceError) throw new Error("Unable to verify workspace status.");
    if (!workspace || workspace.status !== "active") {
      return jsonResponse(403, { error: "Workspace disabled" });
    }

    const { data: maintenanceRow } = await adminClient
      .from("app_runtime_config").select("value")
      .eq("key", "maintenance_mode").maybeSingle();
    const maintenance = maintenanceRow?.value &&
        typeof maintenanceRow.value === "object"
      ? maintenanceRow.value as Record<string, unknown>
      : {};
    if (maintenance.enabled === true) {
      return jsonResponse(503, {
        error: typeof maintenance.message === "string" &&
            maintenance.message.trim()
          ? maintenance.message.trim()
          : "Maintenance mode enabled.",
      });
    }

    const rateLimitRequestLimit = action === "prepare_pack"
      ? 3
      : action === "prepare_pack_chunk"
      ? 120
      : action === "cancel_pack"
      ? 10
      : 20;
    const { data: rateLimit, error: rateLimitError } = await userClient.rpc(
      "consume_rate_limit",
      {
        p_scope: `offline_checkout_${action}`,
        p_limit: rateLimitRequestLimit,
        p_window_seconds: 60,
      },
    );
    const { result: limit, response: limitFailure } = resolveRateLimitResult({
      data: rateLimit,
      error: rateLimitError,
      jsonResponse,
      failureStatus: 503,
    });
    if (limitFailure) return limitFailure;
    if (!limit?.allowed) {
      return jsonResponse(429, {
        error: "Rate limit exceeded, please try again shortly.",
        retry_after_seconds: limit?.retry_after_seconds ?? null,
      });
    }

    if (action === "prepare_pack") {
      const preparedAt = new Date();
      const expiresAt = new Date(preparedAt.getTime() + PACK_LIFETIME_MS);
      const [itemsCountResult, borrowersCountResult] = await Promise.all([
        userClient.from("items")
          .select("id", { count: "exact", head: true })
          .eq("workspace_id", profile.workspace_id).is("deleted_at", null)
          .not("barcode", "is", null),
        userClient.from("borrowers")
          .select("id", { count: "exact", head: true })
          .eq("workspace_id", profile.workspace_id).is("deleted_at", null)
          .not("borrower_id", "is", null),
      ]);
      if (itemsCountResult.error || borrowersCountResult.error) {
        throw new Error("Unable to count offline checkout records.");
      }
      const itemCount = itemsCountResult.count ?? 0;
      const borrowerCount = borrowersCountResult.count ?? 0;
      if (itemCount + borrowerCount > MAX_OFFLINE_PACK_RECORDS) {
        return jsonResponse(413, {
          error:
            `Offline pack exceeds the server safety limit of ${MAX_OFFLINE_PACK_RECORDS.toLocaleString()} total items and borrowers. Narrow the records available to this account before downloading an offline pack.`,
          code: "offline_pack_too_large",
          item_count: itemCount,
          borrower_count: borrowerCount,
          max_records: MAX_OFFLINE_PACK_RECORDS,
        });
      }

      const { error: stalePreparationError } = await adminClient
        .from("offline_checkout_packs").delete()
        .eq("workspace_id", profile.workspace_id).eq("profile_id", profile.id)
        .eq("device_id", deviceId).eq("download_complete", false);
      if (stalePreparationError) {
        throw new Error("Unable to clear an interrupted offline pack preparation.");
      }

      const { data: pack, error: packError } = await adminClient
        .from("offline_checkout_packs").insert({
          workspace_id: profile.workspace_id,
          profile_id: profile.id,
          device_id: deviceId,
          prepared_at: preparedAt.toISOString(),
          expires_at: expiresAt.toISOString(),
          item_count: itemCount,
          borrower_count: borrowerCount,
          download_complete: false,
        }).select("id,prepared_at,expires_at").single();
      if (packError || !pack?.id) {
        throw new Error("Unable to register offline pack.");
      }

      return jsonResponse(200, {
        data: {
          pack_version: pack.id,
          prepared_at: pack.prepared_at,
          expires_at: pack.expires_at,
          workspace_id: profile.workspace_id,
          item_count: itemCount,
          borrower_count: borrowerCount,
          chunk_size: PACK_CHUNK_SIZE,
          max_records: MAX_OFFLINE_PACK_RECORDS,
          max_bytes: MAX_OFFLINE_PACK_BYTES,
        },
      });
    }

    if (
      action === "prepare_pack_chunk" || action === "complete_pack" ||
      action === "activate_pack" || action === "cancel_pack"
    ) {
      const packVersion = requireUuid(body.pack_version);
      const { data: pack, error: packError } = await adminClient
        .from("offline_checkout_packs")
        .select("id,prepared_at,expires_at,item_count,borrower_count,download_complete,invalidated_at")
        .eq("id", packVersion)
        .eq("workspace_id", profile.workspace_id)
        .eq("profile_id", profile.id)
        .eq("device_id", deviceId)
        .maybeSingle();
      if (packError) throw new Error("Unable to verify offline pack.");
      if (!pack || pack.invalidated_at) {
        return jsonResponse(403, {
          error: "Offline pack is not valid for this account and device.",
        });
      }

      if (action === "cancel_pack") {
        if (!pack.download_complete) {
          const { error } = await adminClient.from("offline_checkout_packs")
            .delete().eq("id", pack.id).eq("workspace_id", profile.workspace_id)
            .eq("profile_id", profile.id).eq("device_id", deviceId)
            .eq("download_complete", false);
          if (error) throw new Error("Unable to cancel offline pack preparation.");
        }
        return jsonResponse(200, { data: { cancelled: true } });
      }

      if (Date.parse(pack.expires_at) <= Date.now()) {
        return jsonResponse(403, { error: "Offline pack preparation has expired." });
      }

      if (action === "prepare_pack_chunk") {
        if (pack.download_complete) {
          return jsonResponse(409, { error: "Offline pack is already complete." });
        }
        const afterItemId = body.after_item_id === undefined || body.after_item_id === null || body.after_item_id === ""
          ? null
          : requireUuid(body.after_item_id);
        const afterBorrowerId = body.after_borrower_id === undefined || body.after_borrower_id === null || body.after_borrower_id === ""
          ? null
          : requireUuid(body.after_borrower_id);
        const itemQuery = userClient.from("items")
          .select("id,name,barcode,status,checked_out_by,access_mode")
          .eq("workspace_id", profile.workspace_id).is("deleted_at", null)
          .not("barcode", "is", null);
        const borrowerQuery = userClient.from("borrowers")
          .select("id,username,borrower_id,access_mode")
          .eq("workspace_id", profile.workspace_id).is("deleted_at", null)
          .not("borrower_id", "is", null);
        const [itemsResult, borrowersResult] = await Promise.all([
          (afterItemId ? itemQuery.gt("id", afterItemId) : itemQuery)
            .order("id").limit(PACK_CHUNK_SIZE),
          (afterBorrowerId ? borrowerQuery.gt("id", afterBorrowerId) : borrowerQuery)
            .order("id").limit(PACK_CHUNK_SIZE),
        ]);
        if (itemsResult.error || borrowersResult.error) {
          throw new Error("Unable to load the next offline pack chunk.");
        }
        const items = (itemsResult.data ?? []) as ItemRow[];
        const borrowers = (borrowersResult.data ?? []) as BorrowerRow[];
        const chunkData = {
          items: items.map(({ id, name, barcode, status, checked_out_by }) => ({
            id,
            name,
            barcode,
            status,
            checked_out_by,
          })),
          borrowers: borrowers.map(({ id, username, borrower_id }) => ({
            id,
            username,
            borrower_id,
          })),
          next_item_id: items.at(-1)?.id ?? null,
          next_borrower_id: borrowers.at(-1)?.id ?? null,
          item_count: pack.item_count,
          borrower_count: pack.borrower_count,
        };
        if (!items.length && !borrowers.length) {
          return jsonResponse(200, { data: chunkData });
        }
        const referencedBorrowerIds = [...new Set(items.flatMap((item) => item.checked_out_by ? [item.checked_out_by] : []))];
        const visibleBorrowerIds = new Set<string>();
        if (referencedBorrowerIds.length) {
          const { data, error } = await userClient.from("borrowers")
            .select("id").eq("workspace_id", profile.workspace_id)
            .is("deleted_at", null).in("id", referencedBorrowerIds);
          if (error) throw new Error("Unable to verify offline borrower access.");
          for (const row of data ?? []) visibleBorrowerIds.add(row.id);
        }

        const visibleItems = items.map((item, index) => ({
          ...chunkData.items[index],
          checked_out_by: visibleCheckedOutBy(item.checked_out_by, visibleBorrowerIds),
        }));
        const responseData = { ...chunkData, items: visibleItems };
        const chunkBytes = new TextEncoder().encode(
          JSON.stringify({ data: responseData }),
        ).byteLength;
        if (chunkBytes > MAX_OFFLINE_PACK_CHUNK_BYTES) {
          return jsonResponse(413, {
            error: "One offline pack chunk exceeds the 1 MiB transfer limit. Shorten unusually large item or borrower details and try again.",
            code: "offline_pack_chunk_too_large",
            max_chunk_bytes: MAX_OFFLINE_PACK_CHUNK_BYTES,
          });
        }

        const { error: chunkError } = await adminClient.rpc(
          "store_offline_checkout_pack_chunk",
          {
            p_pack_id: pack.id,
            p_workspace_id: profile.workspace_id,
            p_profile_id: profile.id,
            p_device_id: deviceId,
            p_items: items.map((item) => ({
              item_id: item.id,
              snapshot_status: item.status,
              snapshot_checked_out_by: item.checked_out_by,
            })),
            p_borrower_ids: borrowers.map((borrower) => borrower.id),
            p_chunk_bytes: chunkBytes,
          },
        );
        if (chunkError?.code === "22023") {
          return jsonResponse(413, {
            error: "The offline pack exceeds the 25 MiB server safety limit. Reduce the records or details available to this account and try again.",
            code: "offline_pack_too_large",
            max_bytes: MAX_OFFLINE_PACK_BYTES,
          });
        }
        if (chunkError) throw new Error("Unable to register offline pack chunk.");

        return jsonResponse(200, {
          data: responseData,
        });
      }

      if (action === "complete_pack") {
        const { error } = await adminClient.rpc("complete_offline_checkout_pack", {
          p_pack_id: pack.id,
          p_workspace_id: profile.workspace_id,
          p_profile_id: profile.id,
          p_device_id: deviceId,
        });
        if (error) throw new Error("Unable to verify completed offline pack contents.");
        return jsonResponse(200, { data: { pack_version: pack.id, download_complete: true } });
      }

      if (!pack.download_complete) {
        return jsonResponse(409, { error: "Offline pack is not complete." });
      }
      const activatedAt = new Date().toISOString();
      const { error: invalidateError } = await adminClient.from("offline_checkout_packs")
        .update({ invalidated_at: activatedAt })
        .eq("workspace_id", profile.workspace_id).eq("profile_id", profile.id)
        .eq("device_id", deviceId).eq("download_complete", true)
        .is("invalidated_at", null).neq("id", pack.id);
      if (invalidateError) throw new Error("Unable to activate offline pack.");
      return jsonResponse(200, { data: { pack_version: pack.id, activated: true } });
    }

    const canAccessItem = async (item: ItemRow) => {
      if (profile.role === "workspace_admin" || profile.role === "individual_account" || item.access_mode === "all") {
        return true;
      }
      const { data } = await adminClient.from("item_access_grants").select(
        "item_id",
      )
        .eq("item_id", item.id).eq("profile_id", profile.id).maybeSingle();
      return !!data?.item_id;
    };
    const canAccessBorrower = async (borrowerId: string | null) => {
      if (!borrowerId) return true;
      const { data: borrower } = await adminClient.from("borrowers")
        .select("id,access_mode").eq("id", borrowerId)
        .eq("workspace_id", profile.workspace_id).is("deleted_at", null)
        .maybeSingle();
      if (!borrower) return false;
      if (
        profile.role === "workspace_admin" || profile.role === "individual_account" || borrower.access_mode === "all"
      ) return true;
      const { data: grant } = await adminClient.from("borrower_access_grants")
        .select("borrower_id").eq("borrower_id", borrowerId)
        .eq("profile_id", profile.id).maybeSingle();
      return !!grant?.borrower_id;
    };
    const loadItem = async (itemId: string) => {
      const { data } = await adminClient.from("items")
        .select("id,name,barcode,status,checked_out_by,access_mode,deleted_at")
        .eq("id", itemId).eq("workspace_id", profile.workspace_id)
        .maybeSingle();
      return (data as ItemRow | null) ?? null;
    };
    const describeServerState = async (itemId: string) => {
      const current = await loadItem(itemId);
      if (!current) return publicItemState(null);
      if (!(await canAccessItem(current))) return { unavailable: true };
      if (
        current.checked_out_by &&
        !(await canAccessBorrower(current.checked_out_by))
      ) return publicItemState(current);
      const [borrowerResult, logResult] = await Promise.all([
        current.checked_out_by
          ? adminClient.from("borrowers")
            .select("username,borrower_id")
            .eq("id", current.checked_out_by)
            .eq("workspace_id", profile.workspace_id)
            .maybeSingle()
          : Promise.resolve({ data: null }),
        adminClient.from("item_logs")
          .select("performed_by,action_type,action_time")
          .eq("workspace_id", profile.workspace_id)
          .eq("item_id", itemId)
          .order("action_time", { ascending: false })
          .limit(1)
          .maybeSingle(),
      ]);
      const log = logResult.data as {
        performed_by?: string | null;
        action_type?: string | null;
        action_time?: string | null;
      } | null;
      const { data: actor } = log?.performed_by
        ? await adminClient.from("profiles")
          .select("auth_email")
          .eq("id", log.performed_by)
          .eq("workspace_id", profile.workspace_id)
          .maybeSingle()
        : { data: null };
      return {
        ...publicItemState(current),
        checked_out_by: current.checked_out_by,
        borrower_username: borrowerResult.data?.username ?? null,
        borrower_display_id: borrowerResult.data?.borrower_id ?? null,
        ...(profile.role === "tenant_account"
          ? { performed_by_email: null }
          : { performed_by_email: actor?.auth_email ?? null }),
        action_type: log?.action_type ?? null,
        action_time: log?.action_time ?? null,
      };
    };
    const sanitizeStoredItemResults = (value: unknown) => {
      if (!Array.isArray(value)) return [];
      return value.map((entry) => {
        if (!entry || typeof entry !== "object" || Array.isArray(entry)) {
          return { status: "needs_review" };
        }
        const source = entry as Record<string, unknown>;
        const safe: Record<string, unknown> = {};
        for (const key of ["item_id", "barcode", "status", "reason"]) {
          if (typeof source[key] === "string") safe[key] = source[key];
        }
        if (source.server_state && typeof source.server_state === "object") {
          const state = source.server_state as Record<string, unknown>;
          safe.server_state = {
            ...(typeof state.id === "string" ? { id: state.id } : {}),
            ...(typeof state.name === "string" ? { name: state.name } : {}),
            ...(typeof state.barcode === "string"
              ? { barcode: state.barcode }
              : {}),
            ...(typeof state.status === "string"
              ? { status: state.status }
              : {}),
            checked_out_by: null,
          };
        }
        return safe;
      });
    };
    const applyItemAtomically = async (
      packId: string,
      operationId: string,
      item: OfflineSyncItem,
      options: { conflictId?: string; force?: boolean } = {},
    ) => {
      const { data, error } = await adminClient.rpc(
        "apply_offline_checkout_item",
        {
          p_workspace_id: profile.workspace_id,
          p_profile_id: profile.id,
          p_device_id: deviceId,
          p_pack_id: packId,
          p_operation_id: operationId,
          p_item_id: item.item_id,
          p_barcode: item.barcode,
          p_intent: item.intent,
          p_borrower_id: item.borrower_id,
          p_expected_status: item.expected_status,
          p_expected_checked_out_by: item.expected_checked_out_by,
          p_conflict_id: options.conflictId ?? null,
          p_force: options.force === true,
        },
      );
      if (error) {
        if (error.code === "42501") {
          return {
            status: "needs_review" as const,
            reason: "access_or_pack_changed",
          };
        }
        throw new Error("Unable to atomically apply offline item.");
      }
      if (!data || typeof data !== "object" || Array.isArray(data)) {
        throw new Error("Invalid offline item result.");
      }
      const result = data as {
        status?: "synced" | "idempotent" | "needs_review";
        reason?: string;
        server_state?: unknown;
      };
      if (!result.status) {
        throw new Error("Invalid offline item result.");
      }
      return result;
    };
    const resultForCurrentState = async (
      item: OfflineSyncItem,
      status: "synced" | "idempotent" | "needs_review",
      reason?: string,
    ) => {
      return {
        item_id: item.item_id,
        barcode: item.barcode,
        status,
        ...(reason ? { reason } : {}),
        ...(status === "needs_review"
          ? { server_state: await describeServerState(item.item_id) }
          : {}),
      };
    };

    if (action === "sync") {
      if (isKillSwitchWriteBlocked(req)) {
        return jsonResponse(503, {
          error: "Unfortunately ItemTraxx is currently unavailable.",
        });
      }
      const packVersion = parsePackVersion(body.pack_version);
      const operations = parseSyncOperations(body.operations);
      if (
        profile.role !== "workspace_admin" && profile.role !== "individual_account" &&
        containsQuickReturn(operations)
      ) {
        return jsonResponse(403, {
          error: "Quick Return requires a Workspace Admin.",
        });
      }
      const { data: pack } = await adminClient.from("offline_checkout_packs")
        .select("id,prepared_at,expires_at,download_complete").eq("id", packVersion)
        .eq("workspace_id", profile.workspace_id).eq("profile_id", profile.id)
        .eq("device_id", deviceId).eq("download_complete", true)
        .is("invalidated_at", null).maybeSingle();
      if (!pack || !pack.download_complete) {
        return jsonResponse(403, {
          error: "Offline pack is not valid for this account and device.",
        });
      }

      const preparedMs = Date.parse(pack.prepared_at);
      const expiresMs = Date.parse(pack.expires_at);
      const nowMs = Date.now();
      if (
        !Number.isFinite(preparedMs) || !Number.isFinite(expiresMs) ||
        expiresMs <= preparedMs || nowMs < preparedMs || nowMs >= expiresMs
      ) {
        return jsonResponse(403, {
          error: "Offline pack has expired or is not yet active.",
        });
      }
      const operationResults = [];
      for (const operation of operations) {
        const createdMs = Date.parse(operation.created_at);
        if (createdMs < preparedMs - 5 * 60_000 || createdMs > expiresMs) {
          return jsonResponse(400, {
            error: "Offline transaction falls outside the pack lifetime.",
          });
        }

        const { data: existingConflict } = await adminClient
          .from("offline_checkout_conflicts")
          .select(
            "pack_id,device_id,status,resolution,resolution_result,server_state",
          )
          .eq("workspace_id", profile.workspace_id).eq("profile_id", profile.id)
          .eq("operation_id", operation.operation_id).maybeSingle();
        if (existingConflict) {
          if (
            existingConflict.pack_id !== packVersion ||
            existingConflict.device_id !== deviceId
          ) {
            return jsonResponse(409, {
              error:
                "Offline operation identifier was already used by another pack.",
            });
          }
          operationResults.push({
            operation_id: operation.operation_id,
            status: existingConflict.status === "pending"
              ? "needs_review"
              : "synced",
            resolution: existingConflict.resolution,
            item_results: sanitizeStoredItemResults(
              existingConflict.resolution_result ?? existingConflict.server_state,
            ),
          });
          continue;
        }

        const itemResults = [];
        const conflicts: OfflineSyncItem[] = [];
        for (const item of operation.items) {
          const { data: packedItem } = await adminClient
            .from("offline_checkout_pack_items").select("item_id")
            .eq("pack_id", packVersion).eq("item_id", item.item_id)
            .maybeSingle();
          const current = await loadItem(item.item_id);
          if (!packedItem || !current || current.deleted_at) {
            conflicts.push(item);
            itemResults.push(
              await resultForCurrentState(
                item,
                "needs_review",
                "item_unavailable",
              ),
            );
            continue;
          }
          if (current.barcode !== item.barcode) {
            conflicts.push(item);
            itemResults.push(
              await resultForCurrentState(
                item,
                "needs_review",
                "item_identity_changed",
              ),
            );
            continue;
          }
          if (
            !(await canAccessItem(current)) ||
            (item.intent !== "quick_return" &&
              !(await canAccessBorrower(item.borrower_id)))
          ) {
            conflicts.push(item);
            itemResults.push(
              await resultForCurrentState(
                item,
                "needs_review",
                "access_changed",
              ),
            );
            continue;
          }

          const atomicResult = await applyItemAtomically(
            packVersion,
            operation.operation_id,
            item,
          );
          if (atomicResult.status === "needs_review") {
            conflicts.push(item);
            itemResults.push({
              item_id: item.item_id,
              barcode: item.barcode,
              status: "needs_review",
              reason: atomicResult.reason ?? "server_state_changed",
              server_state: await describeServerState(item.item_id),
            });
            continue;
          }
          itemResults.push({
            item_id: item.item_id,
            barcode: item.barcode,
            status: atomicResult.status,
          });
        }

        if (conflicts.length) {
          const { error } = await adminClient.from("offline_checkout_conflicts")
            .insert({
              pack_id: packVersion,
              workspace_id: profile.workspace_id,
              profile_id: profile.id,
              device_id: deviceId,
              operation_id: operation.operation_id,
              offline_payload: conflicts,
              server_state: itemResults,
            });
          if (error && error.code !== "23505") {
            throw new Error("Unable to save offline conflict.");
          }
        }
        operationResults.push({
          operation_id: operation.operation_id,
          status: conflicts.length ? "needs_review" : "synced",
          item_results: itemResults,
        });
      }
      return jsonResponse(200, { data: { operations: operationResults } });
    }

    if (isKillSwitchWriteBlocked(req)) {
      return jsonResponse(503, {
        error: "Unfortunately ItemTraxx is currently unavailable.",
      });
    }
    const { operationId, resolution } = parseResolvePayload(body);
    const { data: conflict } = await adminClient.from(
      "offline_checkout_conflicts",
    )
      .select("id,pack_id,status,resolution,resolution_result,offline_payload")
      .eq("workspace_id", profile.workspace_id).eq("profile_id", profile.id)
      .eq("device_id", deviceId).eq("operation_id", operationId).maybeSingle();
    if (!conflict) {
      return jsonResponse(404, { error: "Offline conflict not found." });
    }
    const { data: activePack } = await adminClient
      .from("offline_checkout_packs").select("id,expires_at,download_complete")
      .eq("id", conflict.pack_id).eq("workspace_id", profile.workspace_id)
      .eq("profile_id", profile.id).eq("device_id", deviceId)
      .eq("download_complete", true)
      .is("invalidated_at", null).maybeSingle();
    const activePackExpiresMs = activePack ? Date.parse(activePack.expires_at) : Number.NaN;
    if (!activePack || !Number.isFinite(activePackExpiresMs) || Date.now() >= activePackExpiresMs) {
      return jsonResponse(403, {
        error: "Offline pack is no longer active for this account and device.",
      });
    }
    if (conflict.status !== "pending") {
      return jsonResponse(200, {
        data: {
          operation_id: operationId,
          status: "resolved",
          resolution: conflict.resolution,
          item_results: sanitizeStoredItemResults(conflict.resolution_result),
        },
      });
    }

    const offlineItems = parseSyncOperations([{
      operation_id: operationId,
      created_at: new Date().toISOString(),
      items: conflict.offline_payload,
    }])[0].items;
    if (
      profile.role !== "workspace_admin" && profile.role !== "individual_account" &&
      containsQuickReturn([{
        operation_id: operationId,
        created_at: new Date().toISOString(),
        items: offlineItems,
      }])
    ) {
      return jsonResponse(403, {
        error: "Quick Return requires a Workspace Admin.",
      });
    }
    const { error: attemptAuditError } = await adminClient.from(
      "admin_audit_logs",
    ).insert({
      workspace_id: profile.workspace_id,
      actor_id: profile.id,
      action_type: "offline_checkout_resolution_requested",
      entity_type: "offline_checkout_conflict",
      entity_id: conflict.id,
      metadata: {
        operation_id: operationId,
        resolution,
        device_id: deviceId,
        item_count: offlineItems.length,
      },
    });
    if (attemptAuditError) {
      throw new Error("Unable to write offline resolution audit log.");
    }
    const resolutionResults = [];
    let allResolved = true;
    for (const item of offlineItems) {
      const current = await loadItem(item.item_id);
      if (resolution === "keep_server") {
        resolutionResults.push({
          item_id: item.item_id,
          barcode: item.barcode,
          status: "kept_server",
          server_state: await describeServerState(item.item_id),
        });
        continue;
      }
      let resolutionAccessFailure: string | undefined;
      if (!current || current.deleted_at) {
        resolutionAccessFailure = "item_unavailable";
      } else if (current.barcode !== item.barcode) {
        resolutionAccessFailure = "item_identity_changed";
      } else if (
        !(await canAccessItem(current)) ||
        (item.intent !== "quick_return" &&
          !(await canAccessBorrower(item.borrower_id)))
      ) {
        resolutionAccessFailure = "access_changed";
      }
      if (resolutionAccessFailure) {
        allResolved = false;
        resolutionResults.push(
          await resultForCurrentState(
            item,
            "needs_review",
            resolutionAccessFailure,
          ),
        );
        continue;
      }
      const atomicResult = await applyItemAtomically(
        conflict.pack_id,
        operationId,
        item,
        { conflictId: conflict.id, force: true },
      );
      if (atomicResult.status === "needs_review") allResolved = false;
      resolutionResults.push({
        item_id: item.item_id,
        barcode: item.barcode,
        status: atomicResult.status,
        ...(atomicResult.status === "needs_review"
          ? {
            reason: atomicResult.reason ?? "resolution_failed",
            server_state: await describeServerState(item.item_id),
          }
          : {}),
      });
    }

    if (!allResolved) {
      await adminClient.from("offline_checkout_conflicts").update({
        server_state: resolutionResults,
      }).eq("id", conflict.id).eq("status", "pending");
      return jsonResponse(409, {
        data: {
          operation_id: operationId,
          status: "needs_review",
          resolution,
          item_results: resolutionResults,
        },
      });
    }

    const resolvedAt = new Date().toISOString();
    const resolvedStatus = resolution === "keep_server"
      ? "kept_server"
      : "applied_offline";
    const { data: resolvedConflict, error: resolutionError } = await adminClient
      .from("offline_checkout_conflicts").update({
        status: resolvedStatus,
        resolution,
        resolution_result: resolutionResults,
        resolved_at: resolvedAt,
        resolved_by: profile.id,
      }).eq("id", conflict.id).eq("status", "pending").select("id")
      .maybeSingle();
    if (resolutionError) throw new Error("Unable to save conflict resolution.");
    if (!resolvedConflict?.id) {
      return jsonResponse(409, {
        error: "Offline conflict was resolved by another request.",
      });
    }
    return jsonResponse(200, {
      data: {
        operation_id: operationId,
        status: "resolved",
        resolution,
        item_results: resolutionResults,
      },
    });
  } catch (error) {
    if (error instanceof ValidationError) {
      return jsonResponse(error.status, { error: error.message });
    }
    console.error("offline-checkout failed", {
      message: error instanceof Error ? error.message : "unknown",
      stack: error instanceof Error ? error.stack : undefined,
    });
    return jsonResponse(500, { error: "Request failed" });
  }
});
