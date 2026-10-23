#!/usr/bin/env bash

set -u -o pipefail

reject() {
  printf 'Deno lock sync push rejected: %s\n' "$1" >&2
  exit 1
}

if [[ -z "${EXPECTED_HEAD_SHA:-}" ]]; then
  reject 'EXPECTED_HEAD_SHA is required.'
fi

if [[ -z "${SYNC_BRANCH:-}" ]]; then
  reject 'SYNC_BRANCH is required.'
fi

if [[ "${1:-}" != origin || -z "${2:-}" ]]; then
  reject 'Only the configured origin remote may be updated.'
fi

expected_remote_ref="refs/heads/$SYNC_BRANCH"
expected_local_sha="$(git rev-parse --verify 'HEAD^{commit}' 2>/dev/null)" || reject 'Could not resolve HEAD.'
update_count=0

while IFS=' ' read -r local_ref local_sha remote_ref remote_sha extra; do
  [[ -n "${local_ref:-}" && -n "${local_sha:-}" && -n "${remote_ref:-}" && -n "${remote_sha:-}" ]] ||
    reject 'The push supplied an incomplete ref update.'
  [[ -z "${extra:-}" ]] || reject 'The push supplied an unexpected ref update format.'
  [[ "$local_ref" == HEAD && "$local_sha" == "$expected_local_sha" ]] ||
    reject 'The local update does not point to the validated HEAD commit.'
  [[ "$remote_ref" == "$expected_remote_ref" ]] ||
    reject 'The push targets an unexpected remote ref.'
  [[ "$remote_sha" == "$EXPECTED_HEAD_SHA" ]] ||
    reject 'The Dependabot PR branch changed before the push.'

  update_count=$((update_count + 1))
done

[[ "$update_count" -eq 1 ]] || reject 'Expected exactly one remote ref update.'
