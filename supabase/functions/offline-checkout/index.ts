import { serve } from "https://deno.land/std@0.177.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.108.2";
import { validateAccountDeviceSession } from "../_shared/accountSessions.ts";
import { isAllowedOrigin, parseAllowedOrigins } from "../_shared/cors.ts";
import { isKillSwitchWriteBlocked } from "../_shared/killSwitch.ts";
import { resolveRateLimitResult } from "../_shared/preloginGuards.ts";
import { readJsonBody } from "../_shared/requestBody.ts";
import { requireTrustedEdgeIngress } from "../_shared/trustedIngress.ts";
import { requireEnum, ValidationError } from "../_shared/validation.ts";
import {
  containsQuickReturn,
  type OfflineSyncItem,
  parseDeviceId,
  parsePackVersion,
  parseResolvePayload,
  parseSyncOperations,
} from "./contracts.ts";

const ACTIONS = new Set(["prepare_pack", "sync", "resolve"] as const);
const PAGE_SIZE = 500;
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
  role: "tenant_account" | "workspace_admin";
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
      checked_out_by: item.checked_out_by,
    }
    : { missing: true };

const fetchAll = async <T>(
  makeQuery: (from: number, to: number) => PromiseLike<{
    data: T[] | null;
    error: { message?: string } | null;
  }>,
) => {
  const rows: T[] = [];
  for (let from = 0;; from += PAGE_SIZE) {
    const { data, error } = await makeQuery(from, from + PAGE_SIZE - 1);
    if (error) {
      throw new Error(error.message || "Unable to prepare offline pack.");
    }
    const page = data ?? [];
    rows.push(...page);
    if (page.length < PAGE_SIZE) return rows;
  }
};

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
    const { data: authData, error: authError } = await userClient.auth
      .getUser();
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
      !["tenant_account", "workspace_admin"].includes(profileRow.role)
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

    const { data: rateLimit, error: rateLimitError } = await userClient.rpc(
      "consume_rate_limit",
      {
        p_scope: `offline_checkout_${action}`,
        p_limit: action === "prepare_pack" ? 3 : 20,
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
      const [items, borrowers] = await Promise.all([
        fetchAll<ItemRow>((from, to) =>
          userClient.from("items")
            .select("id,name,barcode,status,checked_out_by,access_mode")
            .eq("workspace_id", profile.workspace_id).is("deleted_at", null)
            .not("barcode", "is", null).order("id").range(from, to)
        ),
        fetchAll<BorrowerRow>((from, to) =>
          userClient.from("borrowers")
            .select("id,username,borrower_id,access_mode")
            .eq("workspace_id", profile.workspace_id).is("deleted_at", null)
            .not("borrower_id", "is", null).order("id").range(from, to)
        ),
      ]);

      const { data: pack, error: packError } = await adminClient
        .from("offline_checkout_packs").insert({
          workspace_id: profile.workspace_id,
          profile_id: profile.id,
          device_id: deviceId,
          prepared_at: preparedAt.toISOString(),
          expires_at: expiresAt.toISOString(),
          item_count: items.length,
          borrower_count: borrowers.length,
        }).select("id,prepared_at,expires_at").single();
      if (packError || !pack?.id) {
        throw new Error("Unable to register offline pack.");
      }

      for (let offset = 0; offset < items.length; offset += PAGE_SIZE) {
        const snapshotRows = items.slice(offset, offset + PAGE_SIZE).map((
          item,
        ) => ({
          pack_id: pack.id,
          item_id: item.id,
          snapshot_status: item.status,
          snapshot_checked_out_by: item.checked_out_by,
        }));
        const { error } = await adminClient.from("offline_checkout_pack_items")
          .insert(snapshotRows);
        if (error) {
          await adminClient.from("offline_checkout_packs").delete().eq(
            "id",
            pack.id,
          );
          throw new Error("Unable to register offline pack contents.");
        }
      }

      await adminClient.from("offline_checkout_packs").update({
        invalidated_at: preparedAt.toISOString(),
      }).eq("profile_id", profile.id).eq("device_id", deviceId)
        .is("invalidated_at", null).neq("id", pack.id);

      return jsonResponse(200, {
        data: {
          pack_version: pack.id,
          prepared_at: pack.prepared_at,
          expires_at: pack.expires_at,
          workspace_id: profile.workspace_id,
          borrowers: borrowers.map(({ id, username, borrower_id }) => ({
            id,
            username,
            borrower_id,
          })),
          items: items.map(({ id, name, barcode, status, checked_out_by }) => ({
            id,
            name,
            barcode,
            status,
            checked_out_by,
          })),
        },
      });
    }

    const canAccessItem = async (item: ItemRow) => {
      if (profile.role === "workspace_admin" || item.access_mode === "all") {
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
        profile.role === "workspace_admin" || borrower.access_mode === "all"
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
        borrower_username: borrowerResult.data?.username ?? null,
        borrower_display_id: borrowerResult.data?.borrower_id ?? null,
        performed_by_email: actor?.auth_email ?? null,
        action_type: log?.action_type ?? null,
        action_time: log?.action_time ?? null,
      };
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
        profile.role !== "workspace_admin" &&
        containsQuickReturn(operations)
      ) {
        return jsonResponse(403, {
          error: "Quick Return requires a Workspace Admin.",
        });
      }
      const { data: pack } = await adminClient.from("offline_checkout_packs")
        .select("id,prepared_at,expires_at").eq("id", packVersion)
        .eq("workspace_id", profile.workspace_id).eq("profile_id", profile.id)
        .eq("device_id", deviceId).is("invalidated_at", null).maybeSingle();
      if (!pack) {
        return jsonResponse(403, {
          error: "Offline pack is not valid for this account and device.",
        });
      }

      const preparedMs = Date.parse(pack.prepared_at);
      const expiresMs = Date.parse(pack.expires_at);
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
            item_results: existingConflict.resolution_result ??
              existingConflict.server_state,
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
              server_state: atomicResult.server_state ??
                await describeServerState(item.item_id),
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
      .from("offline_checkout_packs").select("id")
      .eq("id", conflict.pack_id).eq("workspace_id", profile.workspace_id)
      .eq("profile_id", profile.id).eq("device_id", deviceId)
      .is("invalidated_at", null).maybeSingle();
    if (!activePack) {
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
          item_results: conflict.resolution_result ?? [],
        },
      });
    }

    const offlineItems = parseSyncOperations([{
      operation_id: operationId,
      created_at: new Date().toISOString(),
      items: conflict.offline_payload,
    }])[0].items;
    if (
      profile.role !== "workspace_admin" &&
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
            server_state: atomicResult.server_state ??
                await describeServerState(item.item_id),
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
