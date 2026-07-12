#!/usr/bin/env bash
# Thin wrapper around the cross-platform Node installer (install.js) that sits
# next to this script. All arguments are forwarded, e.g.:
#   ./install.sh --hide-builtin-context
set -euo pipefail
here="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
if ! command -v node >/dev/null 2>&1; then
  echo "node was not found on PATH. Install Node.js (the Copilot CLI already needs it) and retry." >&2
  exit 1
fi
exec node "$here/install.js" "$@"
