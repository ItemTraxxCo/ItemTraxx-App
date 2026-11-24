#!/usr/bin/env python3
"""Start an isolated local Supabase stack from the checked-in schema baseline.

Historical production migrations are incomplete and cannot bootstrap an empty DB.
This uses the same pending-migration selection as test-security-adversarial.mjs.
The stack and its temporary workdir remain available until explicitly stopped.
"""
import json
import re
import subprocess
import tempfile
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
PROJECT = "itx-baseline-local"
DB_CONTAINER = f"supabase_db_{PROJECT}"


def run(args, *, data=None):
    result = subprocess.run(args, cwd=ROOT, input=data, capture_output=True)
    if result.returncode:
        raise RuntimeError(f"{args[0]} failed: {result.stderr.decode(errors='replace')[-1500:]}")
    return result.stdout


def main():
    existing = run(["docker", "ps", "-a", "--filter", f"name=^{DB_CONTAINER}$", "--format", "{{.Names}}"]).decode().strip()
    if existing:
        raise RuntimeError(f"{DB_CONTAINER} already exists; preserve or stop that stack before starting another")
    volume = f"supabase_db_{PROJECT}"
    volumes = run(["docker", "volume", "ls", "--filter", f"name=^{volume}$", "--format", "{{.Name}}"]).decode().splitlines()
    if volume in volumes:
        raise RuntimeError(f"{volume} already exists; preserve its data and use its existing stack instead")
    temp = Path(tempfile.mkdtemp(prefix="itx-baseline-supabase-"))
    supabase = temp / "supabase"
    supabase.mkdir()
    config = (ROOT / "supabase/config.toml").read_text()
    for before, after in [
        ('project_id = "itemtraxx-code"', f'project_id = "{PROJECT}"'),
        ('[db.migrations]\n# If disabled, migrations will be skipped during a db push or reset.\nenabled = true', '[db.migrations]\nenabled = false'),
        ('[db.seed]\n# If enabled, seeds the database after migrations during a db reset.\nenabled = true', '[db.seed]\nenabled = false'),
    ]:
        if config.count(before) != 1:
            raise RuntimeError("Local Supabase configuration changed; review baseline startup")
        config = config.replace(before, after, 1)
    (supabase / "config.toml").write_text(config)
    (supabase / "functions").symlink_to(ROOT / "supabase/functions", target_is_directory=True)
    print("Starting isolated local Supabase stack...", flush=True)
    run(["supabase", "start", "--workdir", str(temp)])
    print("Loading schema baseline...", flush=True)
    baseline = (ROOT / "tests/security/postgres/baseline/schema.sql").read_bytes()
    psql = ["docker", "exec", "-i", DB_CONTAINER, "psql", "-U", "postgres", "-d", "postgres", "-X", "-q", "-v", "ON_ERROR_STOP=1", "-1"]
    run(psql, data=baseline)
    header = baseline.decode().split("-- END MIGRATIONS")[0]
    applied = set()
    for line in header.splitlines():
        match = re.match(r"^--\s+(\d{14})\s*(\S*)", line)
        if match:
            applied.add(match[1])
            if match[2]:
                applied.add(re.sub(r"^\d{14}_", "", match[2]))
    superseded = json.loads((ROOT / "supabase/migration-drift-allowlist.json").read_text()).get("superseded", {})
    count = 0
    for path in sorted((ROOT / "supabase/migrations").glob("*.sql")):
        match = re.fullmatch(r"(\d{14})_(.+)\.sql", path.name)
        if match and match[1] not in applied and match[2] not in applied and f"{match[1]}_{match[2]}" not in superseded:
            try:
                run(psql, data=path.read_bytes())
            except RuntimeError as error:
                raise RuntimeError(f"Migration {path.name} failed: {error}") from error
            count += 1
    print(f"Ready: baseline and {count} pending migrations applied; workdir: {temp}")
    print(f"Stop with: supabase stop --workdir {temp}")


if __name__ == "__main__":
    try:
        main()
    except (OSError, RuntimeError) as error:
        raise SystemExit(str(error))
