#!/bin/sh
set -eu

: "${npm_node_execpath:?Run this through npm so npm_node_execpath is provided}"
script_dir=${0%/*}
if [ "$script_dir" = "$0" ]; then
  script_dir=.
fi
exec "$npm_node_execpath" "$script_dir/security-audit.mjs"
