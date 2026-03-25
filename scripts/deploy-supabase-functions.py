#!/usr/bin/env python3
from __future__ import annotations

import argparse
import os
import re
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
SUPABASE_DIR = ROOT / "supabase"
FUNCTIONS_DIR = SUPABASE_DIR / "functions"
CONFIG_PATH = SUPABASE_DIR / "config.toml"
LOCAL_SUPABASE_CLI = ROOT / "node_modules" / ".bin" / "supabase"
SECTION_RE = re.compile(r"^\[functions\.([A-Za-z0-9_-]+)\]\s*$")
VERIFY_FALSE_RE = re.compile(r"^verify_jwt\s*=\s*false\s*$", re.IGNORECASE)


def load_verify_jwt_flags() -> dict[str, bool]:
    flags: dict[str, bool] = {}
    current: str | None = None
    for raw_line in CONFIG_PATH.read_text().splitlines():
        line = raw_line.strip()
        section_match = SECTION_RE.match(line)
        if section_match:
            current = section_match.group(1)
            flags.setdefault(current, False)
            continue
        if line.startswith("[") and line.endswith("]"):
            current = None
            continue
        if current and VERIFY_FALSE_RE.match(line):
            flags[current] = True
    return flags


def discover_functions() -> list[str]:
    names: list[str] = []
    for child in sorted(FUNCTIONS_DIR.iterdir()):
        if not child.is_dir() or child.name.startswith("_"):
            continue
        if (child / "index.ts").exists():
            names.append(child.name)
    return names


def run(cmd: list[str], cwd: Path) -> None:
    print(f"[deploy] {' '.join(cmd)}")
    completed = subprocess.run(cmd, cwd=str(cwd))
    if completed.returncode != 0:
        raise SystemExit(completed.returncode)


def supabase_cli() -> str:
    if LOCAL_SUPABASE_CLI.exists():
        return str(LOCAL_SUPABASE_CLI)
    return "supabase"


def main() -> int:
    parser = argparse.ArgumentParser(description="Deploy Supabase Edge Functions from this repo.")
    parser.add_argument("functions", nargs="*", help="Specific function names to deploy. Defaults to all repo functions.")
    parser.add_argument(
        "--project-ref",
        default=os.environ.get("SUPABASE_PROJECT_REF", "").strip(),
        help="Supabase project ref. Optional if your local CLI is already linked.",
    )
    parser.add_argument("--dry-run", action="store_true", help="Print deploy commands without executing them.")
    args = parser.parse_args()

    verify_jwt_flags = load_verify_jwt_flags()
    available = discover_functions()
    requested = args.functions or available

    unknown = [name for name in requested if name not in available]
    if unknown:
        print(f"Unknown function(s): {', '.join(unknown)}", file=sys.stderr)
        return 2

    print(f"[deploy] repo root: {ROOT}")
    print(f"[deploy] target project: {args.project_ref or 'using current Supabase CLI link state'}")

    cli = supabase_cli()

    for function_name in requested:
        cmd = [cli, "functions", "deploy", function_name]
        if args.project_ref:
            cmd.extend(["--project-ref", args.project_ref])
        if verify_jwt_flags.get(function_name, False):
            cmd.append("--no-verify-jwt")
        if args.dry_run:
            print(f"[dry-run] {' '.join(cmd)}")
            continue
        run(cmd, ROOT)

    print(f"[deploy] completed {len(requested)} function deploy(s)")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
