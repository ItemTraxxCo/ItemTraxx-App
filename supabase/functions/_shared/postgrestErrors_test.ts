import {
  isMissingPostgrestColumn,
  isMissingPostgrestRelation,
} from "./postgrestErrors.ts";

const assert = (condition: boolean, message: string) => {
  if (!condition) throw new Error(message);
};

Deno.test("classifies missing relations without broadening other errors", () => {
  assert(
    isMissingPostgrestRelation(
      {
        code: "42P01",
        message: 'relation "tenant_admin_sessions" does not exist',
      },
      "tenant_admin_sessions",
    ),
    "expected missing relation",
  );
  assert(
    !isMissingPostgrestRelation(
      { code: "42501", message: "permission denied for tenant_admin_sessions" },
      "tenant_admin_sessions",
    ),
    "must not hide permission errors",
  );
  assert(
    !isMissingPostgrestRelation(
      { code: "42P01", message: 'relation "other_table" does not exist' },
      "tenant_admin_sessions",
    ),
    "must require the named relation",
  );
  assert(
    !isMissingPostgrestRelation(
      { code: "42703", message: "tenant_admin_sessions does not exist" },
      "tenant_admin_sessions",
    ),
    "must require the missing-relation code",
  );
  assert(
    !isMissingPostgrestRelation(null, "tenant_admin_sessions") &&
      !isMissingPostgrestRelation(undefined, "tenant_admin_sessions"),
    "nullish errors must not classify",
  );
});

Deno.test("relation names are matched case-insensitively while codes remain exact", () => {
  assert(
    isMissingPostgrestRelation(
      {
        code: "42P01",
        message: 'relation "TENANT_ADMIN_SESSIONS" does not exist',
      },
      "tenant_admin_sessions",
    ),
    "relation name matching must remain case-insensitive",
  );
  assert(
    !isMissingPostgrestRelation(
      {
        code: "42p01",
        message: 'relation "tenant_admin_sessions" does not exist',
      },
      "tenant_admin_sessions",
    ),
    "PostgreSQL error codes must remain case-sensitive",
  );
});

Deno.test("classifies strict missing columns without broadening other errors", () => {
  assert(
    isMissingPostgrestColumn(
      { code: "42703", message: 'column "login_method" does not exist' },
      "login_method",
    ),
    "expected missing column",
  );
  assert(
    !isMissingPostgrestColumn(
      { code: "42501", message: "permission denied for login_method" },
      "login_method",
    ),
    "must not hide permission errors",
  );
  assert(
    !isMissingPostgrestColumn(
      { code: "42703", message: 'column "other_column" does not exist' },
      "login_method",
    ),
    "must require the named column",
  );
  assert(
    !isMissingPostgrestColumn(
      { code: "42P01", message: "login_method does not exist" },
      "login_method",
    ),
    "must require the missing-column code",
  );
  assert(
    !isMissingPostgrestColumn(null, "login_method") &&
      !isMissingPostgrestColumn(undefined, "login_method"),
    "nullish errors must not classify",
  );
});

Deno.test("column names are matched case-insensitively", () => {
  assert(
    isMissingPostgrestColumn(
      { code: "42703", message: 'column "LOGIN_METHOD" does not exist' },
      "login_method",
    ),
    "column name matching must remain case-insensitive",
  );
});

Deno.test("schema-cache column fallback is opt-in", () => {
  const pgrstError = {
    code: "PGRST204",
    message: "Could not find the feature_flags column in the schema cache",
  };
  assert(
    !isMissingPostgrestColumn(pgrstError, "feature_flags"),
    "strict mode must reject PGRST204 schema-cache fallback",
  );
  assert(
    isMissingPostgrestColumn(pgrstError, "feature_flags", {
      allowSchemaCache: true,
    }),
    "compat mode must accept PGRST204 schema-cache fallback",
  );
  assert(
    !isMissingPostgrestColumn(
      { ...pgrstError, code: "pgrst204", message: "feature_flags is missing" },
      "feature_flags",
      { allowSchemaCache: true },
    ),
    "PostgREST error codes must remain case-sensitive",
  );

  const schemaCacheMessage = {
    code: "POSTGREST_COMPAT",
    message: "Schema cache has no feature_flags field",
  };
  assert(
    !isMissingPostgrestColumn(schemaCacheMessage, "feature_flags"),
    "strict mode must reject message-only schema-cache fallback",
  );
  assert(
    isMissingPostgrestColumn(schemaCacheMessage, "feature_flags", {
      allowSchemaCache: true,
    }),
    "compat mode must preserve the existing schema-cache message fallback",
  );
});

Deno.test("schema-cache compatibility still requires the named column", () => {
  assert(
    !isMissingPostgrestColumn(
      {
        code: "PGRST204",
        message:
          "Could not find the account_category column in the schema cache",
      },
      "feature_flags",
      { allowSchemaCache: true },
    ),
    "PGRST204 must not match a different column",
  );
  assert(
    !isMissingPostgrestColumn(
      { code: "42501", message: "permission denied for feature_flags" },
      "feature_flags",
      { allowSchemaCache: true },
    ),
    "compat mode must not hide unrelated permission errors",
  );
});
