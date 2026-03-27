import { authenticatedCount } from "./authenticatedDataClient";

export type UsageStats = {
  totalGear: number;
  totalStudents: number;
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
    totalGear,
    totalStudents,
    currentlyCheckedOut,
    checkouts7d,
    returns7d,
    checkouts30d,
    returns30d,
  ] = await Promise.all([
    countTable("gear"),
    countTable("students"),
    countTable("gear", { checked_out_by: "not.is.null" }),
    countTable("gear_logs", { action_type: "eq.checkout", action_time: `gte.${since7}` }),
    countTable("gear_logs", { action_type: "eq.return", action_time: `gte.${since7}` }),
    countTable("gear_logs", { action_type: "eq.checkout", action_time: `gte.${since30}` }),
    countTable("gear_logs", { action_type: "eq.return", action_time: `gte.${since30}` }),
  ]);

  return {
    totalGear,
    totalStudents,
    currentlyCheckedOut,
    checkouts7d,
    returns7d,
    checkouts30d,
    returns30d,
  };
};
