import { execSync } from "node:child_process";

const severityRank = {
  info: 0,
  low: 1,
  moderate: 2,
  high: 3,
  critical: 4,
};

const minSeverity = process.env.ITX_AUDIT_MIN_SEVERITY ?? "moderate";
const minSeverityRank = severityRank[minSeverity] ?? severityRank.moderate;

const allowedSources = new Set(
  (process.env.ITX_AUDIT_ALLOW_SOURCES ?? "1113979")
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean)
);

const runNpmAuditJson = () => {
  try {
    return execSync("npm audit --json", { encoding: "utf8" });
  } catch (error) {
    // npm audit exits non-zero when vulnerabilities are found; stdout still contains the JSON report.
    const stdout = error && typeof error === "object" ? error.stdout : "";
    if (typeof stdout === "string" && stdout.trim()) {
      return stdout;
    }
    throw error;
  }
};

const reportRaw = runNpmAuditJson();
const report = JSON.parse(reportRaw);
const vulnerabilities = report.vulnerabilities ?? {};

const isIgnoredBySource = (vulnerabilityName, vulnerability, visited = new Set()) => {
  if (visited.has(vulnerabilityName)) {
    return false;
  }
  visited.add(vulnerabilityName);

  const via = Array.isArray(vulnerability.via) ? vulnerability.via : [];
  if (!via.length) return false;

  return via.every((item) => {
    if (item && typeof item === "object" && "source" in item) {
      return allowedSources.has(String(item.source));
    }
    if (typeof item === "string") {
      const linked = vulnerabilities[item];
      if (!linked) return false;
      return isIgnoredBySource(item, linked, visited);
    }
    return false;
  });
};

const blocking = [];
const ignored = [];

for (const [name, vulnerability] of Object.entries(vulnerabilities)) {
  const severity = vulnerability?.severity ?? "info";
  const rank = severityRank[severity] ?? severityRank.info;
  if (rank < minSeverityRank) continue;

  if (isIgnoredBySource(name, vulnerability)) {
    ignored.push({ name, severity, via: vulnerability.via });
    continue;
  }

  blocking.push({ name, severity, via: vulnerability.via });
}

if (blocking.length > 0) {
  console.error("[security] npm audit gate failed.");
  console.error(
    `[security] Blocking vulnerabilities at or above '${minSeverity}': ${blocking.length}`
  );
  for (const vulnerability of blocking) {
    const firstVia = Array.isArray(vulnerability.via) ? vulnerability.via[0] : null;
    const title =
      firstVia && typeof firstVia === "object" ? firstVia.title ?? vulnerability.name : vulnerability.name;
    console.error(` - ${vulnerability.name} (${vulnerability.severity}): ${title}`);
  }
  process.exit(1);
}

if (ignored.length > 0) {
  console.log(
    `[security] npm audit gate passed with ignored advisory source(s): ${[...allowedSources].join(", ")}`
  );
  console.log(
    `[security] Ignored vulnerabilities at or above '${minSeverity}': ${ignored
      .map((vulnerability) => vulnerability.name)
      .join(", ")}`
  );
} else {
  console.log(`[security] npm audit gate passed with no vulnerabilities at or above '${minSeverity}'.`);
}
