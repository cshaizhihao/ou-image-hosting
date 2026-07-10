#!/usr/bin/env bash

set -euo pipefail

if [[ "$#" -eq 0 ]]; then
  echo "Usage: $0 <command> [args...]" >&2
  exit 64
fi

# This host has two CPU cores and must stay below 30% sustained usage.
# Limit the complete process tree to 25% of one CPU core.
if command -v cpulimit >/dev/null 2>&1; then
  exec cpulimit --foreground --monitor-forks --limit=25 -- "$@"
fi

echo "cpulimit is required for CPU-intensive project commands." >&2
exit 69
