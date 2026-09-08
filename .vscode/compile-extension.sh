#!/usr/bin/env bash
# F5 preLaunchTask: nvm often isn't on PATH in Cursor's task shell.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
export NVM_DIR="${NVM_DIR:-$HOME/.nvm}"
if [ -s "$NVM_DIR/nvm.sh" ]; then
  # shellcheck source=/dev/null
  . "$NVM_DIR/nvm.sh"
fi
cd "$ROOT/extension"
if [ -x node_modules/.bin/tsc ]; then
  exec node_modules/.bin/tsc -p .
fi
if command -v npm >/dev/null 2>&1; then
  exec npm run compile
fi
echo "Node/npm not found. Install Node or run: cd extension && npm install" >&2
exit 127
