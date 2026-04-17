#!/usr/bin/env bash
set -euo pipefail

BASE_URL="${1:-https://itemtraxx.com}"
EDGE_URL="${2:-https://edge.itemtraxx.com/functions}"

BROWSER_UA="Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/123.0.0.0 Safari/537.36"

SMOKE_MAX_ATTEMPTS="${SMOKE_MAX_ATTEMPTS:-4}"
SMOKE_RETRY_BASE_SLEEP_S="${SMOKE_RETRY_BASE_SLEEP_S:-1}"

smoke_sleep() {
  local seconds="$1"
  sleep "$seconds"
}

retryable_http_status() {
  local status="$1"
  # curl uses 000 when it couldn't get an HTTP response.
  if [ "$status" -eq 0 ]; then
    return 0
  fi
  # Cloudflare and origin transient errors often surface as 5xx (including 530).
  if [ "$status" -ge 500 ]; then
    return 0
  fi
  return 1
}

curl_http_code() {
  # Usage: curl_http_code <outfile> <curl args...>
  local outfile="$1"
  shift

  local http_code curl_ec
  set +e
  http_code="$(curl -sS -o "$outfile" -w '%{http_code}' "$@")"
  curl_ec="$?"
  set -e

  # If curl itself errored, treat it as no HTTP response so callers can retry.
  if [ "$curl_ec" -ne 0 ]; then
    echo "0"
    return 0
  fi

  if [ -z "$http_code" ]; then
    echo "0"
    return 0
  fi

  echo "$http_code"
}

check_html_route() {
  local url="$1"
  echo "== smoke route $url"
  local attempt=1
  local sleep_s="$SMOKE_RETRY_BASE_SLEEP_S"
  local status

  while [ "$attempt" -le "$SMOKE_MAX_ATTEMPTS" ]; do
    status="$(curl_http_code /dev/null \
      --http1.1 -I -A "$BROWSER_UA" \
      --connect-timeout 5 --max-time 15 \
      "$url")"
    if ! retryable_http_status "$status"; then
      return 0
    fi

    if [ "$attempt" -eq "$SMOKE_MAX_ATTEMPTS" ]; then
      echo "Route returned HTTP $status after ${SMOKE_MAX_ATTEMPTS} attempts: $url"
      return 1
    fi
    echo "Route returned HTTP $status (attempt ${attempt}/${SMOKE_MAX_ATTEMPTS}); retrying in ${sleep_s}s: $url"
    smoke_sleep "$sleep_s"
    sleep_s="$((sleep_s * 2))"
    attempt="$((attempt + 1))"
  done
}

check_status_endpoint() {
  echo "== smoke edge system-status"
  local attempt=1
  local sleep_s="$SMOKE_RETRY_BASE_SLEEP_S"
  local status

  while [ "$attempt" -le "$SMOKE_MAX_ATTEMPTS" ]; do
    status="$(curl_http_code /tmp/itx_status_body.json \
      --connect-timeout 5 --max-time 15 \
      "${EDGE_URL}/system-status" \
      -H "Origin: ${BASE_URL}")"
    if ! retryable_http_status "$status"; then
      return 0
    fi

    if [ "$attempt" -eq "$SMOKE_MAX_ATTEMPTS" ]; then
      echo "system-status returned HTTP $status after ${SMOKE_MAX_ATTEMPTS} attempts"
      cat /tmp/itx_status_body.json
      return 1
    fi
    echo "system-status returned HTTP $status (attempt ${attempt}/${SMOKE_MAX_ATTEMPTS}); retrying in ${sleep_s}s"
    cat /tmp/itx_status_body.json
    smoke_sleep "$sleep_s"
    sleep_s="$((sleep_s * 2))"
    attempt="$((attempt + 1))"
  done
}

check_contact_sales_validation() {
  echo "== smoke edge contact-sales-submit validation response"
  local attempt=1
  local sleep_s="$SMOKE_RETRY_BASE_SLEEP_S"
  local status

  while [ "$attempt" -le "$SMOKE_MAX_ATTEMPTS" ]; do
    status="$(curl_http_code /tmp/itx_contact_body.json \
      --connect-timeout 5 --max-time 15 \
      -X POST "${EDGE_URL}/contact-sales-submit" \
      -H "Origin: ${BASE_URL}" \
      -H "Content-Type: application/json" \
      --data '{"plan":"core"}')"
    if ! retryable_http_status "$status"; then
      return 0
    fi

    if [ "$attempt" -eq "$SMOKE_MAX_ATTEMPTS" ]; then
      echo "contact-sales-submit returned HTTP $status after ${SMOKE_MAX_ATTEMPTS} attempts"
      cat /tmp/itx_contact_body.json
      return 1
    fi
    echo "contact-sales-submit returned HTTP $status (attempt ${attempt}/${SMOKE_MAX_ATTEMPTS}); retrying in ${sleep_s}s"
    cat /tmp/itx_contact_body.json
    smoke_sleep "$sleep_s"
    sleep_s="$((sleep_s * 2))"
    attempt="$((attempt + 1))"
  done
}

check_html_route "${BASE_URL}"
check_html_route "${BASE_URL}/pricing"
check_html_route "${BASE_URL}/contact-sales"
check_html_route "${BASE_URL}/legal"
check_status_endpoint
check_contact_sales_validation

echo "Synthetic smoke checks completed successfully."
