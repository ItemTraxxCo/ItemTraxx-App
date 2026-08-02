import { describe, expect, it, vi } from "vitest";

vi.mock("./client", () => ({
  callSuperOps: vi.fn(),
}));

import { callSuperOps } from "./client";
import {
  addCustomerStatusEntry,
  closeSalesLead,
  listCustomers,
  listSalesLeads,
  moveSalesLeadToCustomer,
  setSalesLeadStage,
} from "./salesCustomers";
import type { CustomerRecord, SalesLead } from "./types";

const mockedCall = vi.mocked(callSuperOps);

const makeLead = (overrides: Partial<SalesLead> = {}): SalesLead => ({
  id: "lead-1",
  plan: "growth",
  lead_state: "open",
  stage: "waiting_for_quote",
  schools_count: 3,
  name: "Jane Doe",
  organization: "Acme School",
  reply_email: "jane@acme.test",
  details: null,
  source: "website",
  created_at: "2026-01-01T00:00:00Z",
  updated_at: null,
  ...overrides,
});

describe("salesCustomers", () => {
  it("listSalesLeads defaults to an empty payload and returns the leads", async () => {
    const leads = { leads: [makeLead()] };
    mockedCall.mockResolvedValueOnce(leads);

    const result = await listSalesLeads();

    expect(result).toBe(leads);
    expect(mockedCall).toHaveBeenCalledWith({ action: "list_sales_leads", payload: {} });
  });

  it("listSalesLeads forwards a provided search/limit payload", async () => {
    mockedCall.mockResolvedValueOnce({ leads: [] });

    await listSalesLeads({ search: "acme", limit: 10 });

    expect(mockedCall).toHaveBeenCalledWith({
      action: "list_sales_leads",
      payload: { search: "acme", limit: 10 },
    });
  });

  it("setSalesLeadStage forwards lead_id and stage", async () => {
    const lead = makeLead({ stage: "quote_sent" });
    mockedCall.mockResolvedValueOnce({ lead });

    const result = await setSalesLeadStage({ lead_id: "lead-1", stage: "quote_sent" });

    expect(result).toEqual({ lead });
    expect(mockedCall).toHaveBeenCalledWith({
      action: "set_sales_lead_stage",
      payload: { lead_id: "lead-1", stage: "quote_sent" },
    });
  });

  it("closeSalesLead forwards lead_id", async () => {
    const lead = makeLead({ lead_state: "closed" });
    mockedCall.mockResolvedValueOnce({ lead });

    const result = await closeSalesLead({ lead_id: "lead-1" });

    expect(result).toEqual({ lead });
    expect(mockedCall).toHaveBeenCalledWith({ action: "close_sales_lead", payload: { lead_id: "lead-1" } });
  });

  it("moveSalesLeadToCustomer forwards lead_id", async () => {
    const lead = makeLead({ lead_state: "converted_to_customer" });
    mockedCall.mockResolvedValueOnce({ lead });

    const result = await moveSalesLeadToCustomer({ lead_id: "lead-1" });

    expect(result).toEqual({ lead });
    expect(mockedCall).toHaveBeenCalledWith({
      action: "move_sales_lead_to_customer",
      payload: { lead_id: "lead-1" },
    });
  });

  it("listCustomers defaults to an empty payload and returns the customers", async () => {
    const customer: CustomerRecord = {
      id: "cust-1",
      plan: "growth",
      lead_state: "converted_to_customer",
      schools_count: 3,
      name: "Jane Doe",
      organization: "Acme School",
      reply_email: "jane@acme.test",
      stage: "invoice_paid",
      details: null,
      latest_status: "paid_on_time",
      latest_invoice_id: "inv-1",
      status_logs: [],
    };
    mockedCall.mockResolvedValueOnce({ customers: [customer] });

    const result = await listCustomers();

    expect(result).toEqual({ customers: [customer] });
    expect(mockedCall).toHaveBeenCalledWith({ action: "list_customers", payload: {} });
  });

  it("listCustomers forwards a provided search/limit payload", async () => {
    mockedCall.mockResolvedValueOnce({ customers: [] });

    await listCustomers({ search: "acme", limit: 5 });

    expect(mockedCall).toHaveBeenCalledWith({
      action: "list_customers",
      payload: { search: "acme", limit: 5 },
    });
  });

  it("addCustomerStatusEntry forwards the full status entry payload", async () => {
    const entry = {
      id: "log-1",
      lead_id: "lead-1",
      invoice_id: "inv-1",
      status: "paid_on_time" as const,
      created_at: "2026-01-01T00:00:00Z",
      created_by: "user-1",
    };
    mockedCall.mockResolvedValueOnce({ entry });

    const payload = { lead_id: "lead-1", invoice_id: "inv-1", status: "paid_on_time" as const };
    const result = await addCustomerStatusEntry(payload);

    expect(result).toEqual({ entry });
    expect(mockedCall).toHaveBeenCalledWith({ action: "add_customer_status_entry", payload });
  });

  it("propagates a rejection from callSuperOps", async () => {
    mockedCall.mockRejectedValueOnce(new Error("lookup failed"));
    await expect(listSalesLeads()).rejects.toThrow("lookup failed");
  });
});
