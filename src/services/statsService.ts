import { supabase } from "./supabaseClient";

export type UsageStats = {
  totalGear: number;
  totalStudents: number;
  currentlyCheckedOut: number;
  checkouts7d: number;
  returns7d: number;
  checkouts30d: number;
  returns30d: number;
};

const countTable = async (table: string, filter?: (q: any) => any) => {
  let query = supabase.from(table).select("id", { count: "exact", head: true });
  if (filter) query = filter(query);
  const { count, error } = await query;
  if (error || count === null) {
    throw new Error("Unable to load statistics.");
  }
  return count;
};

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
    countTable("gear", (q) => q.not("checked_out_by", "is", null)),
    countTable("gear_logs", (q) =>
      q.eq("action_type", "checkout").gte("action_time", since7)
    ),
    countTable("gear_logs", (q) =>
      q.eq("action_type", "return").gte("action_time", since7)
    ),
    countTable("gear_logs", (q) =>
      q.eq("action_type", "checkout").gte("action_time", since30)
    ),
    countTable("gear_logs", (q) =>
      q.eq("action_type", "return").gte("action_time", since30)
    ),
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
