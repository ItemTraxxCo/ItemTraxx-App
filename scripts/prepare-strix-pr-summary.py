#!/usr/bin/env python3
"""Create a safe, deterministic PR comment from Strix SARIF results."""

import argparse
import json
import os
import re
from pathlib import Path


MARKER = "<!-- itemtraxx-strix-security-scan -->"
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


def collect_findings(findings_root: Path) -> list[tuple[str, str, str]]:
    findings = []
    for path in findings_root.glob("**/findings.sarif"):
        with path.open(encoding="utf-8") as report_file:
            report = json.load(report_file)
        for sarif_run in report.get("runs", []):
            if isinstance(sarif_run, dict):
                for result in sarif_run.get("results", []):
                    findings.append(finding_summary(result))
    return findings


def build_comment(exit_code: str, findings: list[tuple[str, str, str]]) -> str:
    if exit_code == "0" and not findings:
        lines = [
            MARKER,
            "## Strix security scan",
            "Strix completed the security scan and found no exploitable vulnerabilities.",
        ]
    elif findings:
        visible_findings = findings[:MAX_FINDINGS_IN_COMMENT]
        lines = [
            MARKER,
            "## Strix security scan",
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
            "## Strix security scan",
            "Strix did not complete successfully, so this run cannot claim a clean result. Review the workflow log and Strix results artifact.",
        ]
    return "\n".join(lines) + "\n"


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--exit-code", default=os.environ.get("STRIX_EXIT_CODE", "1"))
    parser.add_argument("--findings-root", type=Path, default=Path("strix_runs"))
    parser.add_argument("--output", type=Path)
    args = parser.parse_args()

    comment = build_comment(args.exit_code, collect_findings(args.findings_root))
    output = args.output or Path(os.environ.get("RUNNER_TEMP", ".")) / "strix-pr-comment.md"
    output.parent.mkdir(parents=True, exist_ok=True)
    output.write_text(comment, encoding="utf-8")


if __name__ == "__main__":
    main()
