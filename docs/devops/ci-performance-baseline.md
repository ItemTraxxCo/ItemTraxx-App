# CI performance baseline

Baseline collected on 2026-11-20 before the CI optimization changes, from the
150 most recent runs of `.github/workflows/ci.yml`. The reusable
`.github/workflows/ci-validation.yml` has no standalone runs; its job and step
timings are embedded in those parent runs.

## Workflow timing

The sample contained 148 completed runs and two queued runs. Times below use
the completed runs; queue time is workflow creation to runner start, and total
workflow time is creation to completion.

| Measure | Median | p95 |
| --- | ---: | ---: |
| Total workflow | 99s | 1,064s (17m 44s) |
| Waiting for a runner | 0s | 576s (9m 36s) |
| Validation setup | 32s | 72s |
| Validation running work | 50s | 212s |
| Validation wall time | 81s | 314s |
| Created to final validation completion | 95s | 867s (14m 27s) |

The pull request subset (95 completed runs, 94 with validation jobs) had a
94s median and 10,417s p95 total workflow time. Its queue p95 was 10,241s
(2h 50m 41s), while validation setup was 34s/78s and running work was
50s/212s at median/p95. These queue outliers were delayed Dependabot PR runs.
Queue time is controlled by GitHub runner availability and cannot be brought
under 10s by changing a workflow file alone.
`.github/workflows/ci.yml` already uses a per-ref concurrency group with
`cancel-in-progress: true`, so new commits cancel earlier runs on that ref.

Setup is the sum of named setup steps on the last-finishing validation leaf.
Running work is the validation critical-path wall time after subtracting that
setup. These are useful operational buckets, not a decomposition of every
overlapping job's CPU time.

## Validation step timings

Recent per-job samples showed root `npm ci` at 7s median/11s p95. Across 130
unit-test runs, each existing shard spent 18s median and 25–26s p95 in Vitest;
job duration was 41s median and 48–49s p95. Across the four E2E shards, test
execution medians were 33–43s and p95 values were 42–52s. Chrome installation
was 1s median and 4–5s p95. The Playwright dependency step normally found the
required shared libraries already installed and skipped apt.

The current app typecheck ran locally in 4.56s on the required Node 24.22.3.
The repository has no ESLint or Prettier installation/configuration and no
lint script. There is no installed pre-push hook in this checkout.
