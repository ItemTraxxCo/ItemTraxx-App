#!/usr/bin/env bash
set -euo pipefail

BASE_URL="${1:-https://itemtraxx.com}"
EDGE_URL="${2:-https://itemtraxx-edge-proxy.itemtraxx-co.workers.dev/functions}"

BROWSER_UA="Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/123.0.0.0 Safari/537.36"

check_html_route() {
  local url="$1"
  echo "== smoke route $url"
  local status
  status="$(curl -sSI --http1.1 -A "$BROWSER_UA" "$url" | awk 'NR==1 {print $2}')"
  if [ -z "$status" ]; then
    echo "Missing status for $url"
    return 1
  fi
  if [ "$status" -ge 500 ]; then
    echo "Route returned HTTP $status: $url"
    return 1
  fi
}

check_status_endpoint() {
  echo "== smoke edge system-status"
  local status
  status="$(curl -sS -o /tmp/itx_status_body.json -w '%{http_code}' \
    "${EDGE_URL}/system-status" \
    -H "Origin: ${BASE_URL}")"
  if [ "$status" -ge 500 ]; then
    echo "system-status returned HTTP $status"
    cat /tmp/itx_status_body.json
    return 1
  fi
}

check_contact_sales_validation() {
  echo "== smoke edge contact-sales-submit validation response"
  local status
  status="$(curl -sS -o /tmp/itx_contact_body.json -w '%{http_code}' \
    -X POST "${EDGE_URL}/contact-sales-submit" \
    -H "Origin: ${BASE_URL}" \
    -H "Content-Type: application/json" \
    --data '{"plan":"core"}')"
  if [ "$status" -eq 500 ]; then
    echo "contact-sales-submit returned HTTP 500"
    cat /tmp/itx_contact_body.json
    return 1
  fi
}

check_html_route "${BASE_URL}"
check_html_route "${BASE_URL}/pricing"
check_html_route "${BASE_URL}/contact-sales"
check_html_route "${BASE_URL}/legal"
check_status_endpoint
check_contact_sales_validation

echo "Synthetic smoke checks completed successfully."
