#!/usr/bin/env python3
"""Create a safe, deterministic PR comment from Strix SARIF results."""

import argparse
from html import escape
import json
import os
import re
from pathlib import Path
from typing import Optional


MARKER = "<!-- itemtraxx-strix-security-scan -->"
COMMENT_HEADING = "## Strix Penetration Test and Security Scanning"
MAX_FINDINGS_IN_COMMENT = 20
SAFE_DISPLAY = re.compile(r"[^A-Za-z0-9._/@:+-]")
WHITESPACE = re.compile(r"\s+")


def safe_display(value: object, fallback: str) -> str:
    """Keep SARIF-controlled values out of Markdown syntax and prompts."""
    if not isinstance(value, str) or not value:
        return fallback
    return SAFE_DISPLAY.sub("_", value)[:200] or fallback


def normalized_display(value: object, fallback: str) -> str:
    """Normalize scanner text without changing readable punctuation."""
    if not isinstance(value, str) or not value:
        return fallback
    return WHITESPACE.sub(" ", value).strip()[:200] or fallback


def safe_html_display(value: object, fallback: str) -> str:
    """Preserve readable scanner text for a Markdown code span."""
    # Backticks would terminate the code span used at the render sites below.
    # Replace them before HTML escaping so scanner text cannot reopen Markdown.
    display = normalized_display(value, fallback).replace("`", "'")
    return escape(display, quote=False)


def report_paths(findings_root: Path, filename: str) -> list[Path]:
    """Return public per-run reports, excluding Strix's hidden internal state."""
    paths = []
    for path in findings_root.glob(f"**/{filename}"):
        relative_parts = path.relative_to(findings_root).parts
        if any(part.startswith(".") for part in relative_parts[:-1]):
            continue
        paths.append(path)
    return sorted(paths)


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


def collect_findings(
    findings_root: Path,
) -> tuple[list[tuple[str, str, str]], bool, list[str]]:
    findings = []
    sarif_found = False
    parse_errors = []
    for path in report_paths(findings_root, "findings.sarif"):
        sarif_found = True
        try:
            with path.open(encoding="utf-8") as report_file:
                report = json.load(report_file)
        except (OSError, json.JSONDecodeError, TypeError) as error:
            parse_errors.append(f"{path.name}: {type(error).__name__}")
            continue
        if not isinstance(report, dict):
            parse_errors.append(f"{path.name}: top-level JSON is not an object")
            continue
        runs = report.get("runs", [])
        if not isinstance(runs, list):
            parse_errors.append(f"{path.name}: runs is not an array")
            continue
        for sarif_run in runs:
            if isinstance(sarif_run, dict):
                results = sarif_run.get("results", [])
                if not isinstance(results, list):
                    parse_errors.append(f"{path.name}: results is not an array")
                    continue
                for result in results:
                    if not is_coverage_result(result):
                        findings.append(finding_summary(result))
    return findings, sarif_found, parse_errors


def collect_coverage_gaps(findings_root: Path) -> tuple[list[str], Optional[bool], list[str]]:
    """Collect scanner-reported coverage gaps for an honest clean-result summary."""
    gaps = []
    coverage_complete = None
    parse_errors = []
    coverage_seen = False
    for path in report_paths(findings_root, "coverage.json"):
        coverage_seen = True
        try:
            with path.open(encoding="utf-8") as report_file:
                coverage = json.load(report_file)
        except (OSError, json.JSONDecodeError, TypeError) as error:
            coverage_complete = False
            parse_errors.append(f"{path.name}: {type(error).__name__}")
            continue
        if not isinstance(coverage, dict):
            coverage_complete = False
            parse_errors.append(f"{path.name}: top-level JSON is not an object")
            continue
        completeness = coverage.get("completeness")
        if isinstance(completeness, dict) and completeness.get("complete") is True:
            if coverage_complete is not False:
                coverage_complete = True
        else:
            coverage_complete = False
        raw_gaps = coverage.get("gaps", [])
        if not isinstance(raw_gaps, list):
            coverage_complete = False
            parse_errors.append(f"{path.name}: gaps is not an array")
            raw_gaps = []
        for gap in raw_gaps:
            if not isinstance(gap, dict):
                continue
            risk_area = normalized_display(gap.get("risk_area"), "unknown-risk-area")
            detail = normalized_display(gap.get("detail"), "unexamined coverage")
            gaps.append(f"{risk_area}: {detail}")
    if not coverage_seen:
        coverage_complete = None
    return gaps, coverage_complete, parse_errors


def build_comment(
    exit_code: str,
    findings: list[tuple[str, str, str]],
    sarif_found: bool,
    coverage_gaps: list[str],
    coverage_complete: Optional[bool] = None,
    report_errors: Optional[list[str]] = None,
) -> str:
    report_errors = report_errors or []
    assessment_incomplete = coverage_complete is not True or bool(coverage_gaps) or bool(report_errors)
    if exit_code == "0" and not findings and sarif_found:
        if assessment_incomplete:
            lines = [
                MARKER,
                COMMENT_HEADING,
                "Strix reported no exploitable vulnerabilities, but the assessment is incomplete.",
                "Do not treat this run as a complete clean security assessment.",
            ]
        else:
            lines = [
                MARKER,
                COMMENT_HEADING,
                "Strix completed the penetration test and security scan and found no exploitable vulnerabilities.",
            ]
        if coverage_gaps:
            lines.extend(
                [
                    "",
                    "### Coverage gaps",
                    *[
                        f"- `{safe_html_display(gap, 'unexamined coverage')}`"
                        for gap in coverage_gaps[:MAX_FINDINGS_IN_COMMENT]
                    ],
                ]
            )
            if len(coverage_gaps) > MAX_FINDINGS_IN_COMMENT:
                lines.append(
                    f"- {len(coverage_gaps) - MAX_FINDINGS_IN_COMMENT} additional coverage gap(s) are in the artifact."
                )
        if report_errors:
            lines.extend(
                [
                    "",
                    "### Report parsing issues",
                    *[
                        f"- `{safe_html_display(error, 'unreadable scanner report')}`"
                        for error in report_errors[:MAX_FINDINGS_IN_COMMENT]
                    ],
                ]
            )
            if len(report_errors) > MAX_FINDINGS_IN_COMMENT:
                lines.append(
                    f"- {len(report_errors) - MAX_FINDINGS_IN_COMMENT} additional report parsing issue(s) are in the artifact."
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
        if assessment_incomplete:
            lines.extend(
                [
                    "",
                    "Coverage is incomplete; review the artifact before treating these findings as a complete assessment.",
                ]
            )
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

    findings, sarif_found, finding_errors = collect_findings(args.findings_root)
    coverage_gaps, coverage_complete, coverage_errors = collect_coverage_gaps(args.findings_root)
    comment = build_comment(
        args.exit_code,
        findings,
        sarif_found,
        coverage_gaps,
        coverage_complete,
        finding_errors + coverage_errors,
    )
    output = args.output or Path(os.environ.get("RUNNER_TEMP", ".")) / "strix-pr-comment.md"
    output.parent.mkdir(parents=True, exist_ok=True)
    output.write_text(comment, encoding="utf-8")


if __name__ == "__main__":
    main()
