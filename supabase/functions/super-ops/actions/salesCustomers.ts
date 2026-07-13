import { optionalPostgrestSearchText } from "../../_shared/postgrestSearch.ts";
import {
  optionalInteger,
  optionalText,
  requireText,
  requireUuid,
} from "../../_shared/validation.ts";
import type { SuperOpsContext } from "../context.ts";

export const SALES_CUSTOMER_ACTIONS = [
  "list_sales_leads",
  "close_sales_lead",
  "move_sales_lead_to_customer",
  "set_sales_lead_stage",
  "delete_sales_lead",
  "list_customers",
  "add_customer_status_entry",
] as const;

export const handleSalesCustomersAction = async (
  context: SuperOpsContext,
): Promise<Response | null> => {
  const { action, payload, adminClient, user, jsonResponse, writeAudit } =
    context;

  if (action === "list_sales_leads") {
    const next = payload;
    const search = optionalPostgrestSearchText(next.search, { maxLen: 120 });
    const limit = optionalInteger(next.limit, 1, 200, 100);

    let query = adminClient
      .from("sales_leads")
      .select(
        "id, plan, lead_state, stage, schools_count, name, organization, reply_email, details, source, created_at, updated_at",
      )
      .order("created_at", { ascending: false })
      .limit(limit);

    if (search) {
      query = query.or(
        `name.ilike.%${search}%,organization.ilike.%${search}%,reply_email.ilike.%${search}%`,
      );
    }

    const { data, error } = await query;
    if (error) {
      return jsonResponse(400, { error: "Unable to load sales leads." });
    }

    return jsonResponse(200, {
      data: {
        leads: data ?? [],
      },
    });
  }

  if (action === "close_sales_lead") {
    const next = payload;
    const leadId = requireUuid(next.lead_id);

    const { data, error } = await adminClient
      .from("sales_leads")
      .update({
        lead_state: "closed",
        updated_at: new Date().toISOString(),
      })
      .eq("id", leadId)
      .select(
        "id, plan, lead_state, stage, schools_count, name, organization, reply_email, details, source, created_at, updated_at",
      )
      .single();

    if (error || !data) {
      return jsonResponse(400, { error: "Unable to close sales lead." });
    }

    await writeAudit("close_sales_lead", "sales_lead", leadId, {});
    return jsonResponse(200, { data: { lead: data } });
  }

  if (action === "move_sales_lead_to_customer") {
    const next = payload;
    const leadId = requireUuid(next.lead_id);

    const { data, error } = await adminClient
      .from("sales_leads")
      .update({
        lead_state: "converted_to_customer",
        updated_at: new Date().toISOString(),
      })
      .eq("id", leadId)
      .select(
        "id, plan, lead_state, stage, schools_count, name, organization, reply_email, details, source, created_at, updated_at",
      )
      .single();

    if (error || !data) {
      return jsonResponse(400, {
        error: "Unable to move lead to customers.",
      });
    }

    await writeAudit("move_sales_lead_to_customer", "sales_lead", leadId, {});
    return jsonResponse(200, { data: { lead: data } });
  }

  if (action === "set_sales_lead_stage") {
    const next = payload;
    const leadId = requireUuid(next.lead_id);
    const stage = optionalText(next.stage, { maxLen: 40 });
    const allowedStages = new Set([
      "waiting_for_quote",
      "quote_generated",
      "quote_sent",
      "quote_converted_to_invoice",
      "invoice_sent",
      "invoice_paid",
    ]);
    if (!allowedStages.has(stage)) {
      return jsonResponse(400, { error: "Invalid request" });
    }

    const { data, error } = await adminClient
      .from("sales_leads")
      .update({
        stage,
        updated_at: new Date().toISOString(),
      })
      .eq("id", leadId)
      .select(
        "id, plan, stage, schools_count, name, organization, reply_email, details, source, created_at, updated_at",
      )
      .single();

    if (error || !data) {
      return jsonResponse(400, { error: "Unable to update lead stage." });
    }

    await writeAudit("set_sales_lead_stage", "sales_lead", leadId, { stage });
    return jsonResponse(200, { data: { lead: data } });
  }

  if (action === "delete_sales_lead") {
    const next = payload;
    const leadId = requireUuid(next.lead_id);

    const { error } = await adminClient
      .from("sales_leads")
      .delete()
      .eq("id", leadId);

    if (error) {
      return jsonResponse(400, { error: "Unable to delete sales lead." });
    }

    await writeAudit("delete_sales_lead", "sales_lead", leadId, {});
    return jsonResponse(200, { data: { deleted: true } });
  }

  if (action === "list_customers") {
    const next = payload;
    const search = optionalPostgrestSearchText(next.search, { maxLen: 120 });
    const limit = optionalInteger(next.limit, 1, 300, 150);

    let leadQuery = adminClient
      .from("sales_leads")
      .select(
        "id, plan, lead_state, stage, schools_count, name, organization, reply_email, details, created_at, updated_at",
      )
      .eq("lead_state", "converted_to_customer")
      .order("created_at", { ascending: false })
      .limit(limit);

    if (search) {
      leadQuery = leadQuery.or(
        `name.ilike.%${search}%,organization.ilike.%${search}%,reply_email.ilike.%${search}%`,
      );
    }

    const { data: leads, error: leadError } = await leadQuery;
    if (leadError) {
      return jsonResponse(400, { error: "Unable to load customers." });
    }

    const leadIds = (leads ?? []).map((lead) => lead.id as string);
    const { data: statusLogs, error: statusError } = leadIds.length
      ? await adminClient
        .from("customer_status_logs")
        .select("id, lead_id, invoice_id, status, created_at, created_by")
        .in("lead_id", leadIds)
        .order("created_at", { ascending: false })
      : { data: [], error: null };

    if (statusError) {
      return jsonResponse(400, {
        error: "Unable to load customer status logs.",
      });
    }

    const groupedLogs = new Map<
      string,
      Array<{
        id: string;
        lead_id: string;
        invoice_id: string;
        status: string;
        created_at: string;
        created_by: string | null;
      }>
    >();
    for (
      const row of (statusLogs ?? []) as Array<{
        id: string;
        lead_id: string;
        invoice_id: string;
        status: string;
        created_at: string;
        created_by: string | null;
      }>
    ) {
      const list = groupedLogs.get(row.lead_id) ?? [];
      list.push(row);
      groupedLogs.set(row.lead_id, list);
    }

    const customers = (leads ?? []).map((lead) => {
      const logs = groupedLogs.get(lead.id as string) ?? [];
      const latest = logs[0] ?? null;
      return {
        ...lead,
        latest_status: latest?.status ?? null,
        latest_invoice_id: latest?.invoice_id ?? null,
        status_logs: logs,
      };
    });

    return jsonResponse(200, { data: { customers } });
  }

  if (action === "add_customer_status_entry") {
    const next = payload;
    const leadId = requireUuid(next.lead_id);
    const invoiceId = requireText(next.invoice_id, { maxLen: 120 });
    const status = optionalText(next.status, { maxLen: 40 });
    const allowedStatuses = new Set([
      "paid_on_time",
      "paid_late",
      "awaiting_payment",
      "canceling",
    ]);
    if (!allowedStatuses.has(status)) {
      return jsonResponse(400, { error: "Invalid request" });
    }

    const { data, error } = await adminClient
      .from("customer_status_logs")
      .insert({
        lead_id: leadId,
        invoice_id: invoiceId,
        status,
        created_by: user.id,
      })
      .select("id, lead_id, invoice_id, status, created_at, created_by")
      .single();

    if (error || !data) {
      return jsonResponse(400, {
        error: "Unable to add customer status entry.",
      });
    }

    await writeAudit("add_customer_status_entry", "sales_lead", leadId, {
      invoice_id: invoiceId,
      status,
    });
    return jsonResponse(200, { data: { entry: data } });
  }

  return null;
};
