import { runTrustedNpm } from "./security-exec.mjs";

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
  (process.env.ITX_AUDIT_ALLOW_SOURCES ?? "")
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean),
);

const outputText = (value) => typeof value === "string"
  ? value
  : Buffer.isBuffer(value)
  ? value.toString("utf8")
  : "";

const containsTransportFailure = (value) =>
  /ENOTFOUND|EAI_AGAIN|EAI_FAIL|ECONNREFUSED|ECONNRESET|ETIMEDOUT|ESOCKETTIMEDOUT|EHOSTUNREACH|ERR_SOCKET_TIMEOUT|audit endpoint returned an error|audit request.{0,80}(?:failed|error)|(?:registry|audit).{0,80}(?:unavailable|network|transport)/i.test(
    value,
  );

const parseAuditReport = (value) => {
  try {
    const report = JSON.parse(value);
    const metadataVulnerabilities = report?.metadata?.vulnerabilities;
    if (
      !report ||
      typeof report !== "object" ||
      Array.isArray(report) ||
      report.auditReportVersion !== 2 ||
      !report.vulnerabilities ||
      typeof report.vulnerabilities !== "object" ||
      Array.isArray(report.vulnerabilities) ||
      !metadataVulnerabilities ||
      typeof metadataVulnerabilities !== "object" ||
      Array.isArray(metadataVulnerabilities) ||
      report.error
    ) {
      return null;
    }

    const counts = Object.fromEntries(
      Object.keys(severityRank).map((severity) => [severity, 0]),
    );
    for (const severity of [...Object.keys(severityRank), "total"]) {
      if (
        !Number.isInteger(metadataVulnerabilities[severity]) ||
        metadataVulnerabilities[severity] < 0
      ) {
        return null;
      }
    }

    for (const vulnerability of Object.values(report.vulnerabilities)) {
      if (
        !vulnerability ||
        typeof vulnerability !== "object" ||
        Array.isArray(vulnerability) ||
        !Object.hasOwn(severityRank, vulnerability.severity) ||
        !Array.isArray(vulnerability.via) ||
        vulnerability.via.length === 0
      ) {
        return null;
      }
      for (const advisory of vulnerability.via) {
        if (typeof advisory === "string") {
          if (!advisory) return null;
          continue;
        }
        if (
          !advisory ||
          typeof advisory !== "object" ||
          Array.isArray(advisory) ||
          !Object.hasOwn(severityRank, advisory.severity)
        ) {
          return null;
        }
      }
      counts[vulnerability.severity] += 1;
    }

    const total = Object.values(counts).reduce((sum, count) => sum + count, 0);
    if (
      metadataVulnerabilities.total !== total ||
      Object.entries(counts).some(
        ([severity, count]) => metadataVulnerabilities[severity] !== count,
      )
    ) {
      return null;
    }
    return report;
  } catch {
    return null;
  }
};

const runNpmAuditJson = () => {
  const result = runTrustedNpm(["audit", "--json"], {
    encoding: "utf8",
    maxBuffer: 10 * 1024 * 1024,
  });
  const stdout = outputText(result.stdout);
  const stderr = outputText(result.stderr);
  const report = parseAuditReport(stdout);
  const errorText = `${stderr}\n${outputText(result.error?.message)}`;

  if (containsTransportFailure(errorText)) {
    throw new Error(
      "[security] npm audit reported a registry or transport error; failing closed.",
    );
  }

  if (result.error || result.status === null) {
    throw new Error(
      "[security] npm audit could not be executed successfully; failing closed.",
    );
  }

  if (result.status === 0) {
    if (!report) {
      throw new Error(
        "[security] npm audit returned an incomplete or invalid report; failing closed.",
      );
    }
    return report;
  }

  // npm exits non-zero when vulnerabilities exceed its configured threshold;
  // stdout still contains a report. Continue only for a complete advisory report.
  if (report && Object.keys(report.vulnerabilities).length > 0) {
    return report;
  }
  throw new Error(
    "[security] npm audit failed before a complete report was returned; failing closed.",
  );
};

const report = runNpmAuditJson();
const vulnerabilities = report.vulnerabilities ?? {};

const isIgnoredBySource = (
  vulnerabilityName,
  vulnerability,
  visited = new Set(),
) => {
  if (visited.has(vulnerabilityName)) {
    return false;
  }
  visited.add(vulnerabilityName);

  const via = Array.isArray(vulnerability.via) ? vulnerability.via : [];
  if (!via.length) return false;

  return via.every((item) => {
    if (item && typeof item === "object" && "source" in item) {
      const itemRank = severityRank[item.severity] ?? severityRank.info;
      if (itemRank < minSeverityRank) return true;
      return allowedSources.has(String(item.source));
    }
    if (typeof item === "string") {
      const linked = vulnerabilities[item];
      if (!linked) return false;
      return isIgnoredBySource(item, linked, new Set(visited));
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
    `[security] Blocking vulnerabilities at or above '${minSeverity}': ${blocking.length}`,
  );
  for (const vulnerability of blocking) {
    const firstVia = Array.isArray(vulnerability.via)
      ? vulnerability.via[0]
      : null;
    const title = firstVia && typeof firstVia === "object"
      ? firstVia.title ?? vulnerability.name
      : vulnerability.name;
    console.error(
      ` - ${vulnerability.name} (${vulnerability.severity}): ${title}`,
    );
  }
  process.exit(1);
}

if (ignored.length > 0) {
  console.log(
    `[security] npm audit gate passed with ignored advisory source(s): ${
      [...allowedSources].join(", ")
    }`,
  );
  console.log(
    `[security] Ignored vulnerabilities at or above '${minSeverity}': ${
      ignored
        .map((vulnerability) => vulnerability.name)
        .join(", ")
    }`,
  );
} else {
  console.log(
    `[security] npm audit gate passed with no vulnerabilities at or above '${minSeverity}'.`,
  );
}
