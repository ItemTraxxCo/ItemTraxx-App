import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("./edgeFunctionClient", () => ({ invokeEdgeFunction: vi.fn() }));

import { invokeEdgeFunction } from "./edgeFunctionClient";
import {
  createIndividualAccount,
  listIndividualAccounts,
  sendIndividualAccountReset,
  setIndividualAccountStatus,
  updateIndividualAccount,
  type IndividualAccountPolicyInput,
  type SuperIndividualAccount,
} from "./superIndividualAccountService";

const mockedInvoke = vi.mocked(invokeEdgeFunction);
const account: SuperIndividualAccount = {
  id: "account-1",
  name: "Personal account",
  status: "active",
  archived_at: null,
  created_at: "2026-01-01T00:00:00Z",
  primary_admin_profile_id: null,
  primary_admin_email: "person@example.com",
  account_category: "individual",
};
const policy: IndividualAccountPolicyInput = {
  plan_code: "individual_yearly",
  checkout_due_hours: 72,
  feature_flags: { enable_notifications: true },
};

beforeEach(() => mockedInvoke.mockReset());

describe("super individual account service", () => {
  it("lists accounts with search and status", async () => {
    mockedInvoke.mockResolvedValueOnce({ ok: true, status: 200, error: "", data: { data: [account] } });
    await expect(listIndividualAccounts("person", "active")).resolves.toEqual([account]);
    expect(invokeEdgeFunction).toHaveBeenCalledWith("super-workspace-mutate", expect.objectContaining({
      body: { action: "list_individual_accounts", payload: { search: "person", status: "active" } },
    }));
  });

  it("creates without a slug field", async () => {
    mockedInvoke.mockResolvedValueOnce({ ok: true, status: 200, error: "", data: { data: account } });
    const payload = { ...policy, name: "Personal account", auth_email: "person@example.com" };
    await createIndividualAccount(payload);
    expect(invokeEdgeFunction).toHaveBeenCalledWith("super-workspace-mutate", expect.objectContaining({
      body: { action: "create_individual_account", payload },
    }));
    expect(payload).not.toHaveProperty("slug");
  });

  it("updates, changes status, and sends a reset", async () => {
    mockedInvoke
      .mockResolvedValueOnce({ ok: true, status: 200, error: "", data: { data: account } })
      .mockResolvedValueOnce({ ok: true, status: 200, error: "", data: { data: account } })
      .mockResolvedValueOnce({ ok: true, status: 200, error: "", data: { data: { success: true, auth_email: "person@example.com" } } });
    await updateIndividualAccount({ ...policy, id: "account-1", name: "Updated", auth_email: "new@example.com" });
    await setIndividualAccountStatus("account-1", "suspended");
    await sendIndividualAccountReset("account-1");
    expect(invokeEdgeFunction).toHaveBeenNthCalledWith(1, "super-workspace-mutate", expect.objectContaining({ body: expect.objectContaining({ action: "update_individual_account" }) }));
    expect(mockedInvoke.mock.calls[0][1]).toEqual(expect.objectContaining({
      body: expect.objectContaining({
        payload: expect.objectContaining({ auth_email: "new@example.com" }),
      }),
    }));
    expect(invokeEdgeFunction).toHaveBeenNthCalledWith(2, "super-workspace-mutate", expect.objectContaining({ body: { action: "set_individual_account_status", payload: { id: "account-1", status: "suspended" } } }));
    expect(invokeEdgeFunction).toHaveBeenNthCalledWith(3, "super-workspace-mutate", expect.objectContaining({ body: { action: "send_individual_account_reset", payload: { id: "account-1" } } }));
  });
});
