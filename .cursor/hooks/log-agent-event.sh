#!/usr/bin/env bash
# Trim the hook payload and pipe it to the state updater, which owns the log path and appends it.
set -euo pipefail

input=$(cat)
hook_dir="$(cd "$(dirname "$0")" && pwd)"

ts=$(date -u +"%Y-%m-%dT%H:%M:%SZ")

# Raw payloads carry whole files and command output. Keep only the fields the board reads,
# or the log grows to megabytes and every reader re-parses it on every refresh.
keep_fields='{
  conversation_id, parent_conversation_id, role, hook_event_name, subagent_type, subagentType,
  tool_name, description, reason, model, composer_mode,
  input_tokens, output_tokens, cache_read_tokens, final_status,
  tool_input: (if (.tool_input | type) == "object"
    then .tool_input | {path, file_path, target_file, notebook_path} | with_entries(select(.value != null))
    else null end)
} | with_entries(select(.value != null and .value != {}))'

if command -v jq >/dev/null 2>&1; then
  payload=$(jq -nc \
    --arg ts "$ts" \
    --argjson raw "$input" \
    "{ts: \$ts, type: (\$raw.hook_event_name // \"unknown\"), raw: (\$raw | $keep_fields)}")
else
  escaped=$(printf '%s' "$input" | tr -d '\n' | sed 's/"/\\"/g')
  payload="{\"ts\":\"$ts\",\"type\":\"unknown\",\"raw\":\"$escaped\"}"
fi

export NVM_DIR="${NVM_DIR:-$HOME/.nvm}"
if [ -s "$NVM_DIR/nvm.sh" ]; then
  # shellcheck source=/dev/null
  . "$NVM_DIR/nvm.sh"
fi

# ponytail: without node nothing is logged at all. That is the same board outcome as before, since
# the state file it feeds also needs node; the upgrade path is a shell-side append that would have
# to duplicate the runtime path derivation.
if command -v node >/dev/null 2>&1; then
  printf '%s\n' "$payload" | node "$hook_dir/update-agent-state.mjs" || true
fi

exit 0
