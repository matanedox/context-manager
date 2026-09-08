#!/usr/bin/env node
/** Cross-platform hook entrypoint: trim one Cursor event, append it, then refresh board state. */
import fs from "node:fs";
import path from "node:path";
import { refreshState, runtimeDir } from "./update-agent-state.mjs";

const KEEP = [
  "conversation_id",
  "parent_conversation_id",
  "role",
  "hook_event_name",
  "subagent_type",
  "subagentType",
  "tool_name",
  "description",
  "reason",
  "model",
  "composer_mode",
  "input_tokens",
  "output_tokens",
  "cache_read_tokens",
  "final_status",
];
const TOOL_PATHS = ["path", "file_path", "target_file", "notebook_path"];

function compact(input) {
  const raw = Object.fromEntries(KEEP.filter((key) => input[key] != null).map((key) => [key, input[key]]));
  if (input.tool_input && typeof input.tool_input === "object") {
    const toolInput = Object.fromEntries(
      TOOL_PATHS.filter((key) => input.tool_input[key] != null).map((key) => [key, input.tool_input[key]]),
    );
    if (Object.keys(toolInput).length) raw.tool_input = toolInput;
  }
  return raw;
}

let input;
try {
  input = JSON.parse(fs.readFileSync(0, "utf8"));
} catch {
  process.exit(0);
}

const dir = runtimeDir();
fs.mkdirSync(dir, { recursive: true });
fs.appendFileSync(
  path.join(dir, "events.jsonl"),
  `${JSON.stringify({
    ts: new Date().toISOString(),
    type: input.hook_event_name ?? "unknown",
    raw: compact(input),
  })}\n`,
);
refreshState();
