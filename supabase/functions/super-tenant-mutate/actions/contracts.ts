import { isMissingPostgrestColumn } from "../../_shared/postgrestErrors.ts";

type PostgrestError = {
  code?: string;
  message?: string;
};

export const isMissingDistrictIdColumn = (
  error: PostgrestError | null | undefined,
) => isMissingPostgrestColumn(error, "district_id");

export const isValidTenantStatus = (
  value: unknown,
): value is "active" | "suspended" | "archived" =>
  value === "active" || value === "suspended" || value === "archived";

export const resolveResetRedirectTo = (configured: string | undefined) => {
  const redirectTo = (configured ?? "").trim();
  return redirectTo || null;
};
