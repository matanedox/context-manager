#!/usr/bin/env node
/**
 * Guards the layering the folders only suggest: folders alone never keep a layer honest.
 * Direction is host -> data -> model and host -> present -> model.
 */
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const srcDir = path.resolve(__dirname, "../src");

function sourcesIn(layer) {
  const dir = path.join(srcDir, layer);
  return fs
    .readdirSync(dir, { recursive: true })
    .filter((file) => String(file).endsWith(".ts"))
    .map((file) => ({
      file: `src/${layer}/${String(file).split(path.sep).join("/")}`,
      text: fs.readFileSync(path.join(dir, String(file)), "utf8"),
    }));
}

/** Module specifier of every import in the file, including multi-line ones. */
function importsOf(text) {
  return [...text.matchAll(/^import\s[\s\S]*?from\s+"([^"]+)";/gm)].map((match) => match[1]);
}

function forbid(layer, specifiers, why) {
  for (const { file, text } of sourcesIn(layer)) {
    for (const specifier of importsOf(text)) {
      assert.ok(!specifiers.includes(specifier), `${file} imports "${specifier}": ${why}`);
    }
  }
}

const IO_MODULES = ["fs", "node:fs", "os", "node:os", "vscode"];

// model/ is the floor: pure state, exercised directly by node with no editor and no disk.
forbid("model", IO_MODULES, "model must stay pure");
for (const { file, text } of sourcesIn("model")) {
  for (const specifier of importsOf(text)) {
    assert.ok(
      !specifier.startsWith("../"),
      `${file} imports "${specifier}": model may not depend on another layer`
    );
  }
}

// present/ turns a snapshot into a payload; it never reads disk and never sees the editor.
forbid(
  "present",
  IO_MODULES,
  "present must not do I/O — read it in data/snapshot.ts and pass it in"
);
for (const { file, text } of sourcesIn("present")) {
  for (const specifier of importsOf(text)) {
    assert.ok(
      !specifier.includes("../host/"),
      `${file} imports "${specifier}": the payload cannot depend on what sends it`
    );
  }
}

// data/ owns disk, host/ owns the editor.
forbid("data", ["vscode"], "only host/ may use vscode");
assert.ok(
  sourcesIn("host").some(({ text }) => importsOf(text).includes("vscode")),
  "host/ is the layer that talks to vscode"
);

// html.ts hardcodes the script tags, so a renamed webview file would break the board silently.
const webviewDir = path.resolve(__dirname, "../webview");
const onDisk = fs
  .readdirSync(webviewDir, { recursive: true })
  .map((file) => String(file).split(path.sep).join("/"))
  .filter((file) => file.endsWith(".js"))
  .sort();
const htmlSource = fs.readFileSync(path.join(srcDir, "host/html.ts"), "utf8");
const listed = [...htmlSource.matchAll(/"((?:[\w-]+\/)?[\w-]+\.js)"/g)].map((m) => m[1]).sort();
assert.deepEqual(listed, onDisk, "every webview script must be listed in host/html.ts, and exist");

// A page is only really added once both sides can render it.
const pages = [
  ...fs
    .readFileSync(path.join(srcDir, "present/ui.ts"), "utf8")
    .match(/PAGES = \[([^\]]+)\]/)[1]
    .matchAll(/"([^"]+)"/g),
].map((match) => match[1]);
assert.ok(pages.length >= 2, "PAGES parsed from present/ui.ts");
const registry = fs.readFileSync(path.join(srcDir, "present/screens/index.ts"), "utf8");
const webviewMain = fs.readFileSync(path.resolve(__dirname, "../webview/main.js"), "utf8");
for (const page of pages) {
  assert.match(registry, new RegExp(`\\b${page}:`), `present/screens has no builder for "${page}"`);
  assert.match(
    webviewMain,
    new RegExp(`\\b${page}:`),
    `webview/main.js has no renderer for "${page}"`
  );
}

console.log("layers checks passed");
