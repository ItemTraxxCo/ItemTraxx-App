export type PostgrestErrorLike = {
  code?: string;
  message?: string;
};

export const isMissingPostgrestRelation = (
  error: PostgrestErrorLike | null | undefined,
  relation: string,
): boolean =>
  Boolean(
    error?.code === "42P01" &&
      (error.message ?? "").toLowerCase().includes(relation.toLowerCase()),
  );

export const isMissingPostgrestColumn = (
  error: PostgrestErrorLike | null | undefined,
  column: string,
  options: { allowSchemaCache?: boolean } = {},
): boolean => {
  if (!error) return false;
  const message = (error.message ?? "").toLowerCase();
  if (!message.includes(column.toLowerCase())) return false;

  return error.code === "42703" ||
    (options.allowSchemaCache === true &&
      (error.code === "PGRST204" || message.includes("schema cache")));
};
