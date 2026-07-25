import { authenticatedCount } from "./authenticatedDataClient";

export type UsageStats = {
  totalItem: number;
  totalBorrowers: number;
  currentlyCheckedOut: number;
  checkouts7d: number;
  returns7d: number;
  checkouts30d: number;
  returns30d: number;
};

const countTable = async (table: string, query: Record<string, string> = {}) => authenticatedCount(table, query);

export const fetchUsageStats = async (): Promise<UsageStats> => {
  const now = new Date();
  const since7 = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000).toISOString();
  const since30 = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000).toISOString();

  const [
    totalItem,
    totalBorrowers,
    currentlyCheckedOut,
    checkouts7d,
    returns7d,
    checkouts30d,
    returns30d,
  ] = await Promise.all([
    countTable("items"),
    countTable("borrowers"),
    countTable("items", { checked_out_by: "not.is.null" }),
    countTable("item_logs", { action_type: "eq.checkout", action_time: `gte.${since7}` }),
    countTable("item_logs", { action_type: "eq.return", action_time: `gte.${since7}` }),
    countTable("item_logs", { action_type: "eq.checkout", action_time: `gte.${since30}` }),
    countTable("item_logs", { action_type: "eq.return", action_time: `gte.${since30}` }),
  ]);

  return {
    totalItem,
    totalBorrowers,
    currentlyCheckedOut,
    checkouts7d,
    returns7d,
    checkouts30d,
    returns30d,
  };
};
