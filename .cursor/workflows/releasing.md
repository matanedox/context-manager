---
description: Cut a Context Manager version — test, bump, changelog, package, push, install.
alwaysApply: false
personas: extension-engineer
---

# Releasing

Every step runs from a clean tree with the change already made. `*.vsix` is gitignored, so the
package is a local artifact: the commit carries the version bump and the changelog, not the build.

## 1. Green before anything else

```bash
cd extension && npm test          # tsc, every test/*.test.js, both hook tests, then eslint
cd .. && npm run format:check     # prettier over src, webview, test, hooks
```

`npm test` is the whole gate — it compiles, runs the layer check that keeps
`host → data → present → model` one-way, and lints. Do not bump a version over a red suite.

## 2. Bump

```bash
cd extension && npm version <x.y.z> --no-git-tag-version
```

`--no-git-tag-version` matters: this repo tags nothing, and the release is one commit that also
touches `CHANGELOG.md`. The bump edits `extension/package.json` and `extension/package-lock.json`;
the root `package.json` is formatting-only and stays at no version.

Patch for copy, CSS and fixes. Minor when a screen, command or the hook contract changes.

## 3. Changelog

Add a section at the top of `CHANGELOG.md`, above the previous version. Write what a user sees, in
prose — the existing entries are the house style. An upgrade that needs a manual Install / Repair
says so under **Upgrading:**.

## 4. Package

```bash
cd extension && npx --yes @vscode/vsce package
```

Takes about a minute. `vscode:prepublish` recompiles and copies `extension/hooks/`, so a package
that skips it ships an extension with no hook scripts.

## 5. Commit and push

Subject is `release: Context Manager <x.y.z>`, then a blank line and one paragraph on what changed
and why. Stage the changelog, both manifest files, and the source of the change:

```bash
git add CHANGELOG.md extension/package.json extension/package-lock.json <changed files>
git commit && git push
```

## 6. Install locally

```bash
cd extension && cursor --install-extension agent-context-<x.y.z>.vsix --force
```

`--force` overwrites the installed copy; without it the same-or-older version is skipped. Reload the
window afterwards — a running board keeps the old webview until it reloads.

Older `.vsix` files can be deleted once a release is installed; nothing reads them.
