// Adversarial security suite runner. Not part of CI by design.
//
// Database: if ITEMTRAXX_TEST_DATABASE_URL is set, it must point at a loopback
// PostgreSQL that already has the application schema. Otherwise this script
// provisions a disposable Supabase Postgres in Docker, applies GoTrue's auth
// schema and the committed schema baseline
// (tests/security/postgres/baseline/schema.sql), runs every suite, and always
// removes the container and network afterwards (ITX_SECURITY_KEEP_DB=1 keeps
// them for debugging). Repo migrations newer than the baseline are applied on
// top unless ITX_SECURITY_DEPLOYED_ONLY=1. Requires Docker, psql, and Deno.
//
// The repo migration chain cannot build a database from empty (production
// predates it and migrations were applied out of filename order), so the
// baseline is regenerated from staging with `npm run test:security:baseline`.
import { spawnSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { createServer } from "node:net";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(fileURLToPath(new URL("..", import.meta.url)));
if (process.versions.node !== "24.22.1") {
  console.error(
    `This suite requires Node 24.22.1 for repository parity; found ${process.versions.node}.`,
  );
  process.exit(2);
}

const vitest = resolve(root, "node_modules/vitest/vitest.mjs");
if (!existsSync(vitest)) {
  console.error("Vitest is not installed. Run npm ci before this suite.");
  process.exit(2);
}

// Patch-level image differences do not change catalog or RLS semantics; the
// defaults match the Supabase CLI images used for local development. Override
// to pin a different build.
const POSTGRES_IMAGE = process.env.ITX_SECURITY_PG_IMAGE ??
  "public.ecr.aws/supabase/postgres:17.11.0.004";
const GOTRUE_IMAGE = process.env.ITX_SECURITY_GOTRUE_IMAGE ??
  "public.ecr.aws/supabase/gotrue:v2.197.0";
const BASELINE_PATH = resolve(root, "tests/security/postgres/baseline/schema.sql");
const KEEP_DB = process.env.ITX_SECURITY_KEEP_DB === "1";
const DEPLOYED_ONLY = process.env.ITX_SECURITY_DEPLOYED_ONLY === "1";

const run = (command, args, options = {}) =>
  spawnSync(command, args, { cwd: root, encoding: "utf8", ...options });

const requireTool = (command, args, hint) => {
  const result = run(command, args);
  if (result.error || result.status !== 0) {
    console.error(`${command} is required: ${hint}`);
    process.exit(2);
  }
};

const freePort = () =>
  new Promise((resolvePort, reject) => {
    const server = createServer();
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const { port } = server.address();
      server.close(() => resolvePort(port));
    });
  });

const sleep = (ms) => new Promise((done) => setTimeout(done, ms));

const pgEnvironmentFor = (databaseUrl) => {
  const parsed = new URL(databaseUrl);
  return {
    ...(parsed.username ? { PGUSER: decodeURIComponent(parsed.username) } : {}),
    ...(parsed.password ? { PGPASSWORD: decodeURIComponent(parsed.password) } : {}),
    PGHOST: parsed.hostname.replace(/^\[|\]$/g, ""),
    PGPORT: parsed.port || "5432",
    PGDATABASE: decodeURIComponent(parsed.pathname.replace(/^\//, "")),
    PGSSLMODE: parsed.searchParams.get("sslmode") ?? "disable",
    PGOPTIONS: "-c statement_timeout=120000",
  };
};

const assertLoopbackDatabase = (databaseUrl) => {
  let parsed;
  try {
    parsed = new URL(databaseUrl);
  } catch {
    console.error("ITEMTRAXX_TEST_DATABASE_URL must be a valid PostgreSQL URL.");
    process.exit(2);
  }
  const localHosts = new Set(["localhost", "127.0.0.1", "::1"]);
  if (
    !["postgres:", "postgresql:"].includes(parsed.protocol) ||
    !localHosts.has(parsed.hostname.replace(/^\[|\]$/g, ""))
  ) {
    console.error(
      "Refusing to run security fixtures against a non-local database. Use a loopback PostgreSQL URL.",
    );
    process.exit(2);
  }
};

// Repo migrations the baseline's source project has not recorded. Staging
// records apply-time versions, so match on file version or name.
const pendingMigrations = (baselineSql) => {
  const header = baselineSql.split("-- END MIGRATIONS")[0] ?? "";
  const applied = new Set();
  for (const line of header.split("\n")) {
    const match = line.match(/^--\s+(\d{14})\s*(\S*)/);
    if (!match) continue;
    applied.add(match[1]);
    if (match[2]) applied.add(match[2].replace(/^\d{14}_/, ""));
  }
  // Superseded migrations must never execute (they would revert newer
  // definitions); see supabase/migration-drift-allowlist.json.
  const superseded = JSON.parse(
    readFileSync(resolve(root, "supabase/migration-drift-allowlist.json"), "utf8"),
  ).superseded ?? {};
  return readdirSync(resolve(root, "supabase/migrations"))
    .filter((file) => file.endsWith(".sql"))
    .sort()
    .filter((file) => {
      const [, version, name] = file.match(/^(\d{14})_(.+)\.sql$/) ?? [];
      return version && !applied.has(version) && !applied.has(name) &&
        !(`${version}_${name}` in superseded);
    });
};

const cleanupSteps = [];
const cleanup = () => {
  while (cleanupSteps.length > 0) {
    const step = cleanupSteps.pop();
    try {
      step();
    } catch {
      // best effort
    }
  }
};
for (const signal of ["SIGINT", "SIGTERM"]) {
  process.on(signal, () => {
    cleanup();
    process.exit(130);
  });
}

const provisionDatabase = async () => {
  requireTool("docker", ["info"], "start Docker to provision the disposable database.");
  requireTool("psql", ["--version"], "install the PostgreSQL client (psql).");
  if (!existsSync(BASELINE_PATH)) {
    console.error("Missing schema baseline. Run `npm run test:security:baseline` first.");
    process.exit(2);
  }
  const baselineSql = readFileSync(BASELINE_PATH, "utf8");
  const pending = pendingMigrations(baselineSql);

  const suffix = `${process.pid}-${randomBytes(3).toString("hex")}`;
  const network = `itx-security-${suffix}`;
  const container = `itx-security-pg-${suffix}`;
  const password = randomBytes(18).toString("hex");
  const authPassword = randomBytes(18).toString("hex");
  const port = await freePort();

  console.info(`Provisioning disposable database (${POSTGRES_IMAGE})...`);
  if (run("docker", ["network", "create", network]).status !== 0) {
    throw new Error("could not create the Docker network");
  }
  if (!KEEP_DB) cleanupSteps.push(() => run("docker", ["network", "rm", network]));

  // Secrets never go on a command line (visible to other local processes via
  // `ps`, and echoed back in error output). `docker -e NAME` without a value
  // reads NAME from the Docker CLI's own environment.
  const started = run("docker", [
    "run", "-d", "--name", container, "--network", network,
    "-e", "POSTGRES_PASSWORD",
    "-p", `127.0.0.1:${port}:5432`,
    POSTGRES_IMAGE,
  ], { env: { ...process.env, POSTGRES_PASSWORD: password } });
  if (started.status !== 0) {
    throw new Error(`could not start Postgres: ${started.stderr.trim().slice(-800)}`);
  }
  if (!KEEP_DB) cleanupSteps.push(() => run("docker", ["rm", "-f", container]));

  const databaseUrl = `postgresql://postgres:${password}@127.0.0.1:${port}/postgres`;
  const pgEnv = { ...process.env, ...pgEnvironmentFor(databaseUrl) };

  // The Supabase image restarts once while running its init scripts; wait
  // until its roles exist and connections stay up.
  let ready = false;
  for (let attempt = 0; attempt < 90 && !ready; attempt += 1) {
    const probe = run("psql", [
      "-X", "-Atq", "-c",
      "select count(*) from pg_roles where rolname in ('authenticated', 'supabase_auth_admin', 'service_role')",
    ], { env: pgEnv });
    ready = probe.status === 0 && probe.stdout.trim() === "3";
    if (!ready) await sleep(1000);
  }
  if (!ready) throw new Error("Postgres did not become ready in 90 seconds");
  await sleep(2000);

  // The role password travels over stdin, not argv. psql's output from this
  // step is never surfaced because it executes secret-bearing SQL.
  const authRoleUpdate = run("docker", [
    "exec", "-i", container,
    "psql", "-U", "supabase_admin", "-d", "postgres", "-Xq", "-v", "ON_ERROR_STOP=1",
  ], { input: `alter role supabase_auth_admin with password '${authPassword}';\n` });
  if (authRoleUpdate.status !== 0) {
    throw new Error(
      `could not configure the auth admin role (exit ${authRoleUpdate.status}); rerun with ITX_SECURITY_KEEP_DB=1 and inspect \`docker logs ${container}\`.`,
    );
  }

  console.info(`Applying GoTrue auth schema (${GOTRUE_IMAGE})...`);
  const jwtSecret = randomBytes(32).toString("hex");
  const authMigrate = run("docker", [
    "run", "--rm", "--network", network,
    "-e", "GOTRUE_DB_DRIVER=postgres",
    "-e", "GOTRUE_DB_DATABASE_URL",
    "-e", "GOTRUE_SITE_URL=http://localhost",
    "-e", "GOTRUE_JWT_SECRET",
    "-e", "API_EXTERNAL_URL=http://localhost",
    GOTRUE_IMAGE, "auth", "migrate",
  ], {
    env: {
      ...process.env,
      GOTRUE_DB_DATABASE_URL:
        `postgres://supabase_auth_admin:${authPassword}@${container}:5432/postgres?sslmode=disable`,
      GOTRUE_JWT_SECRET: jwtSecret,
    },
  });
  if (authMigrate.status !== 0) {
    // GoTrue may echo its connection settings; scrub secrets before surfacing.
    const diagnostics = [authPassword, jwtSecret].reduce(
      (text, secret) => text.split(secret).join("****"),
      authMigrate.stderr.trim().slice(-800),
    );
    throw new Error(`GoTrue auth migration failed: ${diagnostics}`);
  }

  console.info("Applying schema baseline...");
  const baseline = run("psql", [
    "-X", "-q", "-v", "ON_ERROR_STOP=1", "-1", "-f", BASELINE_PATH,
  ], { env: pgEnv });
  if (baseline.status !== 0) {
    throw new Error(`schema baseline failed to apply:\n${baseline.stderr.trim().slice(-2000)}`);
  }

  // By default the suite tests the schema this branch would deploy: the
  // baseline plus repo migrations its source project has not recorded, in
  // filename order (what `supabase db push --include-all` would apply).
  if (pending.length > 0) {
    console.warn(
      `\nThe schema baseline's source project has not recorded ${pending.length} repo migration(s):\n  ${
        pending.join("\n  ")
      }\nThose environments do not yet have these changes.\n`,
    );
    if (DEPLOYED_ONLY) {
      console.warn("ITX_SECURITY_DEPLOYED_ONLY=1: testing the deployed baseline without them.\n");
    } else {
      for (const file of pending) {
        const applied = run("psql", [
          "-X", "-q", "-v", "ON_ERROR_STOP=1", "-1",
          "-f", resolve(root, "supabase/migrations", file),
        ], { env: pgEnv });
        if (applied.status !== 0) {
          throw new Error(`pending migration ${file} failed to apply:\n${applied.stderr.trim().slice(-1500)}`);
        }
      }
      console.info(`Applied ${pending.length} pending repo migration(s) on top of the baseline.`);
    }
  }

  if (KEEP_DB) {
    // Built from non-secret parts only; the password stays in the container env.
    console.info(
      `Keeping database for debugging: postgres@127.0.0.1:${port}/postgres (container ${container}).\n` +
        `Password: docker inspect -f '{{range .Config.Env}}{{println .}}{{end}}' ${container} | grep POSTGRES_PASSWORD`,
    );
  }
  return databaseUrl;
};

let databaseUrl = process.env.ITEMTRAXX_TEST_DATABASE_URL?.trim();
let failed = false;
try {
  if (databaseUrl) {
    assertLoopbackDatabase(databaseUrl);
  } else {
    databaseUrl = await provisionDatabase();
  }

  const databaseEnvironment = {
    ...process.env,
    ITEMTRAXX_TEST_DATABASE_URL: databaseUrl,
    ...pgEnvironmentFor(databaseUrl),
  };

  const edgeFunctionEnvironmentAllowlist = [
    "ITX_EDGE_PROXY_SHARED_SECRET",
    "BETTER_AUTH_JWKS_URL",
    "BETTER_AUTH_JWT_ISSUER",
    "BETTER_AUTH_JWT_AUDIENCE",
    // Shared replay-store flag and the service-role endpoint it would use.
    "ITX_TRUSTED_INGRESS_REPLAY_STORE",
    "ITX_SUPABASE_URL",
    "SUPABASE_URL",
    "ITX_SECRET_KEY",
    "SUPABASE_SERVICE_ROLE_KEY",
  ].join(",");

  const commands = [
    {
      label: "Vitest PostgreSQL security integration suite",
      command: process.execPath,
      args: [vitest, "run", "--config", "vitest.security.config.ts"],
      env: databaseEnvironment,
    },
    {
      label: "Deno Edge Function security tests",
      command: "deno",
      args: [
        "test",
        `--allow-env=${edgeFunctionEnvironmentAllowlist}`,
        // Static guards read function sources (query-string binding, admin-ops
        // role wiring); scope reads to the functions tree only.
        "--allow-read=supabase/functions",
        "--no-check",
        "tests/security/deno/trusted_ingress_adversarial_test.ts",
        "tests/security/deno/external_auth_adversarial_test.ts",
        "tests/security/deno/admin_ops_security_test.ts",
      ],
      env: process.env,
    },
    {
      label: "Cloudflare Worker security tests",
      command: "deno",
      args: [
        "test",
        // Better Auth's imported environment helpers inspect process.env while
        // initializing Worker modules; these tests stub all outbound fetches.
        "--allow-env",
        "--no-check",
        "tests/security/deno/request_headers_adversarial_test.ts",
        "tests/security/deno/edge_proxy_security_boundary_test.ts",
      ],
      env: process.env,
    },
  ];

  for (const task of commands) {
    console.info(`\nRunning ${task.label}...`);
    const result = spawnSync(task.command, task.args, {
      cwd: root,
      env: task.env,
      stdio: "inherit",
    });
    if (result.error) {
      console.error(`${task.label} could not start: ${result.error.message}`);
      failed = true;
    } else if (result.status !== 0) {
      console.error(`${task.label} failed with exit code ${result.status ?? "unknown"}.`);
      failed = true;
    }
  }
} catch (error) {
  console.error(`Security suite setup failed: ${error instanceof Error ? error.message : error}`);
  failed = true;
} finally {
  cleanup();
}

process.exit(failed ? 1 : 0);
