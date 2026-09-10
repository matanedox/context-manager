#!/usr/bin/env node
/** F5 preLaunchTask: no bash, no nvm. Local tsc, else npm. */
const { spawnSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');

const ext = path.join(__dirname, '..', 'extension');
const winNode = path.join(process.env.ProgramFiles || '', 'nodejs');
if (winNode && fs.existsSync(path.join(winNode, 'node.exe'))) {
	process.env.PATH = `${winNode}${path.delimiter}${process.env.PATH}`;
}

const tsc = path.join(ext, 'node_modules', '.bin', process.platform === 'win32' ? 'tsc.cmd' : 'tsc');
const result = fs.existsSync(tsc)
	? spawnSync(tsc, ['-p', '.'], { cwd: ext, stdio: 'inherit', shell: process.platform === 'win32' })
	: spawnSync('npm', ['run', 'compile'], { cwd: ext, stdio: 'inherit', shell: true });
process.exit(result.status ?? 1);
