#!/usr/bin/env bash
# Emit additional_context so the agent answers as the active scrum persona, not the LLM vendor.
set -euo pipefail

hook_dir="$(cd "$(dirname "$0")" && pwd)"
input=$(cat)

export NVM_DIR="${NVM_DIR:-$HOME/.nvm}"
if [ -s "$NVM_DIR/nvm.sh" ]; then
  # shellcheck source=/dev/null
  . "$NVM_DIR/nvm.sh"
fi

# log-agent-event.sh already refreshed current-state.json for this event, so one node call is enough.
if command -v node >/dev/null 2>&1; then
  out=$(node "$hook_dir/resolve-persona-context.mjs" <<<"$input" 2>/dev/null || true)
  if [ -n "$out" ]; then
    printf '%s\n' "$out"
    exit 0
  fi
fi

# Without node the board cannot tell its own sessions from the chats Cursor opened by itself, and a
# blanket scrum line landed in every one of them. Say nothing rather than the wrong thing.
printf '%s\n' '{}'
exit 0
