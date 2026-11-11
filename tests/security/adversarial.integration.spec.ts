import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { describe, it } from "vitest";

const repoRoot = process.cwd();
const databaseUrl = process.env.ITEMTRAXX_TEST_DATABASE_URL?.trim();
if (!databaseUrl) {
  throw new Error(
    "ITEMTRAXX_TEST_DATABASE_URL is required for the adversarial security integration suite.",
  );
}

let parsedDatabaseUrl: URL;
try {
  parsedDatabaseUrl = new URL(databaseUrl);
} catch {
  throw new Error("ITEMTRAXX_TEST_DATABASE_URL must be a valid PostgreSQL URL.");
}

const localHosts = new Set(["localhost", "127.0.0.1", "::1"]);
if (
  !["postgres:", "postgresql:"].includes(parsedDatabaseUrl.protocol) ||
  !localHosts.has(parsedDatabaseUrl.hostname.replace(/^\[|\]$/g, ""))
) {
  throw new Error(
    "Refusing to run security fixtures against a non-local database. Use a local Supabase URL with a loopback host.",
  );
}

const databaseEnvironment = {
  ...process.env,
  ITEMTRAXX_TEST_DATABASE_URL: undefined,
  ...(parsedDatabaseUrl.username
    ? { PGUSER: decodeURIComponent(parsedDatabaseUrl.username) }
    : {}),
  ...(parsedDatabaseUrl.password
    ? { PGPASSWORD: decodeURIComponent(parsedDatabaseUrl.password) }
    : {}),
  PGHOST: parsedDatabaseUrl.hostname.replace(/^\[|\]$/g, ""),
  PGPORT: parsedDatabaseUrl.port || "5432",
  PGDATABASE: decodeURIComponent(parsedDatabaseUrl.pathname.replace(/^\//, "")),
  PGSSLMODE: parsedDatabaseUrl.searchParams.get("sslmode") ?? "disable",
  PGOPTIONS: "-c statement_timeout=120000",
};

const runSql = (relativePath: string) => {
  const sqlFile = resolve(repoRoot, relativePath);
  if (!existsSync(sqlFile)) throw new Error(`Missing SQL integration test: ${relativePath}`);

  try {
    execFileSync(
      "psql",
      ["-X", "-q", "-v", "ON_ERROR_STOP=1", "-f", sqlFile],
      {
        cwd: repoRoot,
        encoding: "utf8",
        timeout: 120_000,
        env: databaseEnvironment,
        stdio: ["ignore", "pipe", "pipe"],
      },
    );
  } catch (error) {
    const output = error && typeof error === "object" && "stderr" in error
      ? String((error as { stderr?: unknown }).stderr ?? "")
      : "";
    const stdout = error && typeof error === "object" && "stdout" in error
      ? String((error as { stdout?: unknown }).stdout ?? "")
      : "";
    throw new Error(`${relativePath} failed.\n${stdout}${output}`);
  }
};

describe("Security: Cross-Tenant IDOR", () => {
  it("blocks raw UUID CRUD and mixed-tenant batches at both the grant and RLS layers", () => {
    runSql("tests/security/postgres/cross_tenant_idor.sql");
  });
});

describe("Security: RLS & Service Role Boundaries", () => {
  it("binds authorization to the Better Auth profile and blocks client role claims", () => {
    runSql("tests/security/postgres/rls_service_role_boundaries.sql");
  });
});

describe("Security: Privilege Escalation & Mass Assignment", () => {
  it("rejects reserved columns and fuzzed JSONB without partial mutation", () => {
    runSql("tests/security/postgres/mass_assignment_jsonb.sql");
  });
});

describe("Security: Trusted Ingress Replay Store", () => {
  it("claims each signed envelope once across isolates and denies browser roles", () => {
    runSql("tests/security/postgres/trusted_ingress_replay_store.sql");
  });
});
