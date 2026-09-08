#!/usr/bin/env bash
# Identity must come from the asking conversation, never from whichever chat wrote state last.
set -euo pipefail

hook="$(cd "$(dirname "$0")" && pwd)/inject-persona-context.sh"
# -P: the hooks resolve the physical cwd, so the fixture path has to match what they compute.
work="$(cd "$(mktemp -d)" && pwd -P)"
trap 'rm -rf "$work"' EXIT

# Runtime state lives outside the workspace, keyed by the workspace path with separators flattened.
export CURSOR_AGENT_VIZ_HOME="$work/runtime-home"
slug="${work#/}"
viz="$CURSOR_AGENT_VIZ_HOME/${slug//\//_}"
mkdir -p "$viz" "$work/.cursor/agent-viz"

# The workspace file is the only subagent→role mapping; the hooks carry no built-in map.
cat >"$work/.cursor/agent-viz/role-map.json" <<'EOF'
{ "explore": "beta", "bugbot": "gamma" }
EOF

cat >"$viz/events.jsonl" <<'EOF'
{"ts":"2026-08-24T10:00:00Z","type":"sessionStart","raw":{"hook_event_name":"sessionStart","conversation_id":"chat-a"}}
{"ts":"2026-08-24T10:00:01Z","type":"sessionStart","raw":{"hook_event_name":"sessionStart","conversation_id":"chat-b"}}
{"ts":"2026-08-24T10:00:02Z","type":"subagentStart","raw":{"hook_event_name":"subagentStart","conversation_id":"chat-a","subagentType":"explore"}}
{"ts":"2026-08-24T10:00:03Z","type":"beforeSubmitPrompt","raw":{"hook_event_name":"beforeSubmitPrompt","conversation_id":"chat-b"}}
{"ts":"2026-08-24T10:00:04Z","type":"subagentStart","raw":{"hook_event_name":"subagentStart","conversation_id":"chat-a","parent_conversation_id":"chat-a","subagent_type":"bugbot"}}
{"ts":"2026-08-24T10:00:05Z","type":"sessionStart","raw":{"hook_event_name":"sessionStart","conversation_id":"sub-bugbot"}}
{"ts":"2026-08-24T10:00:06Z","type":"sessionStart","raw":{"hook_event_name":"sessionStart","conversation_id":"chat-guide","reason":"board_click","role":"guide"}}
EOF

cat >"$viz/current-state.json" <<'EOF'
{
  "activePersona": "poison",
  "workingWith": "poison → leftover (shell)",
  "sessions": [
    { "conversationId": "chat-a", "role": "delta", "subagents": [] },
    { "conversationId": "chat-b", "role": "gamma", "subagents": [] }
  ]
}
EOF

# The log hook owns the refresh, so the fixture is reduced once here the way a logged event would
# do it. The identity hook only reads state; it must never recompute it.
(cd "$work" && printf '' | node "$(dirname "$hook")/update-agent-state.mjs")

mkdir -p "$work/.cursor/personas"
cat >"$work/.cursor/personas/delta.md" <<'EOF'
---
id: delta
title: Delta
description: from disk charter
---
EOF

ask() {
  printf '{"hook_event_name":"beforeSubmitPrompt","conversation_id":"%s"}' "$1" |
    (cd "$work" && bash "$hook")
}

a=$(ask chat-a)
b=$(ask chat-b)

fail() { printf 'FAIL: %s\n%s\n' "$1" "$2" >&2; exit 1; }

case "$a" in
  *'**delta**'*) ;;
  *) fail "chat-a must answer as its own persona (delta)" "$a" ;;
esac
case "$a" in
  *'from disk charter'*) ;;
  *) fail "chat-a must use the persona file title, not the hardcoded map" "$a" ;;
esac
case "$a" in
  *'Working with: delta → beta (explore)'*) ;;
  *) fail "chat-a must report its own running subagent" "$a" ;;
esac
case "$b" in
  *'**gamma**'*) ;;
  *) fail "chat-b must answer as gamma, not as chat-a's persona" "$b" ;;
esac
case "$b" in
  *'Working with'*) fail "chat-b has no subagent and must not borrow chat-a's" "$b" ;;
  *) ;;
esac
case "$a$b" in
  *poison*) fail "the global activePersona must never leak into a conversation" "$a$b" ;;
  *) ;;
esac

# Most projects list every role in one charter file instead of a file per role.
cat >"$work/.cursor/personas/team-roles.md" <<'EOF'
## Role Index

- gamma — test strategy, regression coverage.
EOF
charter=$(ask chat-b)
case "$charter" in
  *'test strategy, regression coverage'*) ;;
  *) fail "a role listed only in a charter file must still get its own title" "$charter" ;;
esac

# A chat created from the board can reach this hook before its own sessionStart is logged.
printf '{"role":"clicked","afterEventCount":0,"createdAt":"%s"}' \
  "$(date -u +%Y-%m-%dT%H:%M:%SZ)" >"$viz/pending-role.json"
fresh=$(ask chat-brand-new)
case "$fresh" in
  *'**clicked**'*) ;;
  *) fail "an unlogged chat must take the role the click is waiting to hand out" "$fresh" ;;
esac

bugbot=$(printf '{"hook_event_name":"subagentStart","conversation_id":"chat-a","parent_conversation_id":"chat-a","subagent_type":"bugbot"}' | (cd "$work" && bash "$hook"))
case "$bugbot" in
  *'**gamma**'*) ;;
  *) fail "bugbot subagent must answer as gamma via role-map, not the parent" "$bugbot" ;;
esac

# No project roster is ever assumed, so a board-started chat with no project persona is the guide,
# and it must be briefed as one instead of introducing itself as an implementer.
rm -f "$viz/pending-role.json"
guide=$(ask chat-guide)
case "$guide" in
  *'**guide**'*) ;;
  *) fail "a board chat with no project persona must answer as the board's guide" "$guide" ;;
esac
case "$guide" in
  *'introduction guide, not an implementer'*) ;;
  *) fail "the guide must carry its own brief" "$guide" ;;
esac

# The chats Cursor opens by itself are not the board's, and a scrum identity in them is poison.
unknown=$(ask chat-unmapped)
case "$unknown" in
  *SCRUM*|*persona*) fail "a chat the board never started must get no scrum context" "$unknown" ;;
  *) ;;
esac

sub_chat=$(ask sub-bugbot)
case "$sub_chat" in
  *'**gamma**'*) ;;
  *) fail "a subagent chat conversation must answer as gamma, not the parent" "$sub_chat" ;;
esac

case "$a$b$fresh$bugbot$sub_chat" in
  *chat-a*|*chat-b*|*chat-brand-new*|*session*)
    fail "persona context must not expose internal chat identifiers or session metadata" "$a$b$fresh"
    ;;
  *) ;;
esac

echo "persona injection checks passed"
