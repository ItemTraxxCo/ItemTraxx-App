#!/usr/bin/env python3
"""Create a safe, deterministic PR comment from Strix SARIF results."""

import argparse
import json
import os
import re
from pathlib import Path


MARKER = "<!-- itemtraxx-strix-security-scan -->"
COMMENT_HEADING = "## Strix Penetration Test and Security Scanning"
MAX_FINDINGS_IN_COMMENT = 20
SAFE_DISPLAY = re.compile(r"[^A-Za-z0-9._/@:+-]")


def safe_display(value: object, fallback: str) -> str:
    """Keep SARIF-controlled values out of Markdown syntax and prompts."""
    if not isinstance(value, str) or not value:
        return fallback
    return SAFE_DISPLAY.sub("_", value)[:200] or fallback


def finding_summary(result: object) -> tuple[str, str, str]:
    if not isinstance(result, dict):
        return ("unknown", "unknown-rule", "unknown-location")

    severity = safe_display(result.get("level"), "unknown")
    rule_id = safe_display(result.get("ruleId"), "unknown-rule")
    location = "unknown-location"
    locations = result.get("locations")
    if isinstance(locations, list) and locations and isinstance(locations[0], dict):
        physical_location = locations[0].get("physicalLocation")
        if isinstance(physical_location, dict):
            artifact_location = physical_location.get("artifactLocation")
            if isinstance(artifact_location, dict):
                location = safe_display(artifact_location.get("uri"), location)
            region = physical_location.get("region")
            if isinstance(region, dict) and isinstance(region.get("startLine"), int):
                location = f"{location}:{region['startLine']}"
    return (severity, rule_id, location)


def is_coverage_result(result: object) -> bool:
    """Return whether a SARIF result is a pass/coverage record, not a finding."""
    if not isinstance(result, dict):
        return False
    if result.get("kind") == "pass":
        return True
    properties = result.get("properties")
    if not isinstance(properties, dict):
        return False
    strix_properties = properties.get("strix")
    return isinstance(strix_properties, dict) and bool(strix_properties.get("coverage_outcome"))


def collect_findings(findings_root: Path) -> tuple[list[tuple[str, str, str]], bool]:
    findings = []
    sarif_found = False
    for path in findings_root.glob("**/findings.sarif"):
        sarif_found = True
        with path.open(encoding="utf-8") as report_file:
            report = json.load(report_file)
        for sarif_run in report.get("runs", []):
            if isinstance(sarif_run, dict):
                for result in sarif_run.get("results", []):
                    if not is_coverage_result(result):
                        findings.append(finding_summary(result))
    return findings, sarif_found


def collect_coverage_gaps(findings_root: Path) -> list[str]:
    """Collect scanner-reported coverage gaps for an honest clean-result summary."""
    gaps = []
    for path in findings_root.glob("**/coverage.json"):
        with path.open(encoding="utf-8") as report_file:
            coverage = json.load(report_file)
        if not isinstance(coverage, dict):
            continue
        for gap in coverage.get("gaps", []):
            if not isinstance(gap, dict):
                continue
            risk_area = safe_display(gap.get("risk_area"), "unknown-risk-area")
            detail = safe_display(gap.get("detail"), "unexamined coverage").strip()
            gaps.append(f"{risk_area}: {detail}")
    return gaps


def build_comment(
    exit_code: str,
    findings: list[tuple[str, str, str]],
    sarif_found: bool,
    coverage_gaps: list[str],
) -> str:
    if exit_code == "0" and not findings and sarif_found:
        lines = [
            MARKER,
            COMMENT_HEADING,
            "Strix completed the penetration test and security scan and found no exploitable vulnerabilities.",
        ]
        if coverage_gaps:
            lines.extend(
                [
                    "",
                    "However, the run reported coverage gaps, so this is not a complete clean assessment:",
                    *[f"- {gap}" for gap in coverage_gaps[:MAX_FINDINGS_IN_COMMENT]],
                ]
            )
            if len(coverage_gaps) > MAX_FINDINGS_IN_COMMENT:
                lines.append(
                    f"- {len(coverage_gaps) - MAX_FINDINGS_IN_COMMENT} additional coverage gap(s) are in the artifact."
                )
    elif exit_code == "0" and not findings and not sarif_found:
        lines = [
            MARKER,
            COMMENT_HEADING,
            "Strix completed, but no SARIF report was found, so results can't be summarized here. "
            "Review the Strix results artifact on this workflow run for the actual output.",
        ]
    elif findings:
        visible_findings = findings[:MAX_FINDINGS_IN_COMMENT]
        lines = [
            MARKER,
            COMMENT_HEADING,
            f"Strix reported {len(findings)} finding(s). Review the attached SARIF artifact for complete evidence and remediation guidance.",
            "",
            "### Findings",
        ]
        for severity, rule_id, location in visible_findings:
            lines.append(f"- Severity: `{severity}` | Rule: `{rule_id}` | Location: `{location}`")
        if len(findings) > MAX_FINDINGS_IN_COMMENT:
            lines.append(f"- {len(findings) - MAX_FINDINGS_IN_COMMENT} additional finding(s) are in the SARIF artifact.")
    else:
        lines = [
            MARKER,
            COMMENT_HEADING,
            "Strix did not complete successfully, so this run cannot claim a clean result. Review the workflow log and Strix results artifact.",
        ]
    return "\n".join(lines) + "\n"


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--exit-code", default=os.environ.get("STRIX_EXIT_CODE", "1"))
    parser.add_argument("--findings-root", type=Path, default=Path("strix_runs"))
    parser.add_argument("--output", type=Path)
    args = parser.parse_args()

    findings, sarif_found = collect_findings(args.findings_root)
    coverage_gaps = collect_coverage_gaps(args.findings_root)
    comment = build_comment(args.exit_code, findings, sarif_found, coverage_gaps)
    output = args.output or Path(os.environ.get("RUNNER_TEMP", ".")) / "strix-pr-comment.md"
    output.parent.mkdir(parents=True, exist_ok=True)
    output.write_text(comment, encoding="utf-8")


if __name__ == "__main__":
    main()
