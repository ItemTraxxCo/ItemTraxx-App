import { createAdapterFactory } from "better-auth/adapters";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";

type CleanWhere = {
  field: string;
  value: string | number | boolean | string[] | number[] | Date | null;
  operator: "eq" | "ne" | "lt" | "lte" | "gt" | "gte" | "in" | "not_in" | "contains" | "starts_with" | "ends_with";
  connector: "AND" | "OR";
  mode: "sensitive" | "insensitive";
};

const fail = (operation: string, error: { code?: string; message?: string } | null) => {
  if (!error) return;
  const code = error.code ? ` (${error.code})` : "";
  throw new Error(`Better Auth ${operation} failed${code}: ${error.message ?? "Data API error"}`);
};

const quoteFilterValue = (value: unknown) => {
  if (value === null) return "null";
  if (value instanceof Date) return `"${value.toISOString()}"`;
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  return `"${String(value).replaceAll("\\", "\\\\").replaceAll('"', '\\"')}"`;
};

const normalizeFilterValue = (value: CleanWhere["value"]) => {
  if (value instanceof Date) return value.toISOString();
  if (Array.isArray(value)) {
    return (value as unknown[]).map((item) => item instanceof Date ? item.toISOString() : item);
  }
  return value;
};

const orExpression = (where: CleanWhere) => {
  const field = `"${where.field.replaceAll('"', '""')}"`;
  const value = where.value;
  switch (where.operator) {
    case "eq": return value === null ? `${field}.is.null` : `${field}.${where.mode === "insensitive" ? "ilike" : "eq"}.${quoteFilterValue(value)}`;
    case "ne": return value === null ? `${field}.not.is.null` : `${field}.${where.mode === "insensitive" ? "not.ilike" : "neq"}.${quoteFilterValue(value)}`;
    case "lt": case "lte": case "gt": case "gte": return `${field}.${where.operator}.${quoteFilterValue(value)}`;
    case "in": return `${field}.in.(${(value as unknown[]).map(quoteFilterValue).join(",")})`;
    case "not_in": return `${field}.not.in.(${(value as unknown[]).map(quoteFilterValue).join(",")})`;
    case "contains": return `${field}.${where.mode === "insensitive" ? "ilike" : "like"}.${quoteFilterValue(`%${String(value)}%`)}`;
    case "starts_with": return `${field}.${where.mode === "insensitive" ? "ilike" : "like"}.${quoteFilterValue(`${String(value)}%`)}`;
    case "ends_with": return `${field}.${where.mode === "insensitive" ? "ilike" : "like"}.${quoteFilterValue(`%${String(value)}`)}`;
  }
};

const applyOne = (query: any, where: CleanWhere) => {
  const { field, operator, mode } = where;
  const value = normalizeFilterValue(where.value);
  switch (operator) {
    case "eq": return value === null ? query.is(field, null) : mode === "insensitive" && typeof value === "string" ? query.ilike(field, value) : query.eq(field, value);
    case "ne": return value === null ? query.not(field, "is", null) : mode === "insensitive" && typeof value === "string" ? query.not(field, "ilike", value) : query.neq(field, value);
    case "lt": case "lte": case "gt": case "gte": return query[operator](field, value);
    case "in": return query.in(field, value as unknown[]);
    case "not_in": return query.not(field, "in", `(${(value as unknown[]).map(quoteFilterValue).join(",")})`);
    case "contains": return (mode === "insensitive" ? query.ilike(field, `%${String(value)}%`) : query.like(field, `%${String(value)}%`));
    case "starts_with": return (mode === "insensitive" ? query.ilike(field, `${String(value)}%`) : query.like(field, `${String(value)}%`));
    case "ends_with": return (mode === "insensitive" ? query.ilike(field, `%${String(value)}`) : query.like(field, `%${String(value)}`));
  }
};

const applyWhere = (query: any, where: CleanWhere[] | undefined) => {
  if (!where?.length) return query;
  const and = where.filter((condition) => condition.connector !== "OR");
  const or = where.filter((condition) => condition.connector === "OR");
  for (const condition of and) query = applyOne(query, condition);
  if (or.length) query = query.or(or.map(orExpression).join(","));
  return query;
};

export const createBetterAuthDataClient = (url: string, serviceRoleKey: string) =>
  createClient(url, serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
    db: { schema: "better_auth" },
    global: { headers: { "X-Client-Info": "itemtraxx-better-auth-server" } },
  });

export const supabaseBetterAuthAdapter = (client: SupabaseClient<any, any, any, any, any>) =>
  createAdapterFactory({
    config: {
      adapterId: "itemtraxx-supabase-data-api",
      adapterName: "ItemTraxx Supabase Data API",
      supportsNumericIds: false,
      supportsUUIDs: false,
      supportsJSON: false,
      supportsDates: true,
      supportsBooleans: true,
      supportsArrays: false,
      transaction: false,
    },
    adapter: () => ({
      create: async ({ model, data }) => {
        const { data: row, error } = await client.schema("better_auth").from(model).insert(data as any).select().single();
        fail(`create ${model}`, error);
        return row as typeof data;
      },
      findOne: async ({ model, where }) => {
        let query = client.schema("better_auth").from(model).select("*").limit(1);
        query = applyWhere(query, where as CleanWhere[]);
        const { data, error } = await query.maybeSingle();
        fail(`findOne ${model}`, error);
        return data;
      },
      findMany: async ({ model, where, limit, offset, sortBy }) => {
        let query = client.schema("better_auth").from(model).select("*");
        query = applyWhere(query, where as CleanWhere[] | undefined);
        if (sortBy) query = query.order(sortBy.field, { ascending: sortBy.direction === "asc" });
        if (offset) query = query.range(offset, offset + limit - 1);
        else query = query.limit(limit);
        const { data, error } = await query;
        fail(`findMany ${model}`, error);
        return data ?? [];
      },
      update: async ({ model, where, update }) => {
        let query = client.schema("better_auth").from(model).update(update as any).select().limit(1);
        query = applyWhere(query, where as CleanWhere[]);
        const { data, error } = await query.maybeSingle();
        fail(`update ${model}`, error);
        return data;
      },
      updateMany: async ({ model, where, update }) => {
        let query = client.schema("better_auth").from(model).update(update as any).select("id");
        query = applyWhere(query, where as CleanWhere[]);
        const { data, error } = await query;
        fail(`updateMany ${model}`, error);
        return data?.length ?? 0;
      },
      delete: async ({ model, where }) => {
        let query = client.schema("better_auth").from(model).delete();
        query = applyWhere(query, where as CleanWhere[]);
        const { error } = await query;
        fail(`delete ${model}`, error);
      },
      deleteMany: async ({ model, where }) => {
        let query = client.schema("better_auth").from(model).delete().select("id");
        query = applyWhere(query, where as CleanWhere[]);
        const { data, error } = await query;
        fail(`deleteMany ${model}`, error);
        return data?.length ?? 0;
      },
      count: async ({ model, where }) => {
        let query = client.schema("better_auth").from(model).select("id", { count: "exact", head: true });
        query = applyWhere(query, where as CleanWhere[] | undefined);
        const { count, error } = await query;
        fail(`count ${model}`, error);
        return count ?? 0;
      },
    }),
  });
