#!/usr/bin/env node
/** npm run compile && node test/cursor-usage.test.js */
const assert = require('node:assert/strict');
const { formatUsage, parseRequests, parseUsageSummary } = require('../out/data/cursor-usage');
const { accountSub, jwtPayload, sessionCookieFromAccessToken } = require('../out/data/cursor-session');
const { pythonCommands, readToken } = require('../out/data/cursor-account');

function jwtWith(payload) {
	const body = Buffer.from(JSON.stringify(payload)).toString('base64url');
	return `eyJhbGciOiJub25lIn0.${body}.x`;
}

const jwt = jwtWith({ sub: 'github|user_01ABC' });
assert.equal(jwtPayload(jwt)?.sub, 'github|user_01ABC');
assert.equal(accountSub(jwt), 'github|user_01ABC', 'the query param wants the claim as-is');
assert.equal(sessionCookieFromAccessToken(jwt), `user_01ABC%3A%3A${jwt}`);
assert.equal(sessionCookieFromAccessToken('not-a-jwt'), null);
assert.equal(sessionCookieFromAccessToken(jwtWith({})), null);
assert.deepEqual(
	pythonCommands('win32').slice(0, 2),
	[
		['py', ['-3']],
		['python', []],
	],
	'Windows tries its standard Python launchers before the Unix name'
);

// No state DB is nobody logged in, so the board still offers Connect. A DB no reader can open is
// the Windows defect instead: it must be reported, never answered with the login page again.
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
assert.deepEqual(readToken(path.join(os.tmpdir(), 'agent-context-absent.vscdb')), {});
const notADb = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'agent-context-db-')), 'state.vscdb');
fs.writeFileSync(notADb, 'not a sqlite database');
assert.equal(readToken(notADb).unreadable, true, 'an unreadable state DB is a reported failure');
fs.rmSync(path.dirname(notADb), { recursive: true, force: true });

// Both shapes exactly as the endpoints answered them on 8 Sep 2026.
const SUMMARY = {
	billingCycleEnd: '2026-10-01T00:00:00.000Z',
	individualUsage: { onDemand: { enabled: true, used: 0, limit: 7500 } },
};
const USAGE = {
	'gpt-4': { numRequests: 189, numRequestsTotal: 189, maxRequestUsage: 500 },
	startOfMonth: '2026-09-01T00:00:00.000Z',
};
assert.deepEqual(parseRequests(USAGE), { used: 189, total: 500 });
assert.deepEqual(parseRequests({}), { used: undefined, total: undefined });

const reading = parseUsageSummary(SUMMARY, USAGE);
assert.equal(reading.usedRequests, 189);
assert.equal(reading.totalRequests, 500);
assert.equal(reading.onDemandDollars, 0, 'cents, so 0 is $0');
assert.equal(reading.onDemandCapDollars, 75, 'a 7500 limit is the $75 ceiling the card shows');
assert.equal(reading.resetsOn, 'Oct 1, 2026');

// The two cards, side by side, exactly as the dashboard prints them.
const shown = formatUsage(reading);
assert.equal(shown.label, '189 / 500 · $0 / $75');
assert.equal(shown.included, '189 / 500');
assert.equal(shown.onDemand, '$0 / $75');
assert.equal(shown.exhausted, false, 'requests left, so the card keeps the lead');
const text = shown.details.join('\n');
assert.match(text, /Included-Request Usage: 189 \/ 500, included in your plan\./);
assert.match(text, /On-Demand Usage: \$0 \/ \$75, for usage beyond your plan limits\./);
assert.match(text, /Resets Oct 1, 2026\./);
assert.doesNotMatch(text, /%/, 'no percentages anywhere');

// Spent requests hand the lead to the dollars, in the label and in the strip.
const overflowed = formatUsage(
	parseUsageSummary(
		{ ...SUMMARY, individualUsage: { onDemand: { enabled: true, used: 640, limit: 7500 } } },
		{ 'gpt-4': { numRequests: 500, maxRequestUsage: 500 } }
	)
);
assert.equal(overflowed.exhausted, true);
assert.equal(overflowed.label, '$6.40 / $75 · 500 / 500');

// Either card can be missing and the other still reads.
assert.equal(formatUsage(parseUsageSummary(SUMMARY, undefined)).label, '$0 / $75');
assert.equal(
	formatUsage(parseUsageSummary({ individualUsage: {} }, USAGE)).label,
	'189 / 500',
	'no on-demand card, no dollars'
);

// On-demand switched off is worth saying, and never priced against a ceiling.
const off = formatUsage(
	parseUsageSummary({ ...SUMMARY, individualUsage: { onDemand: { enabled: false, used: 0, limit: 7500 } } }, USAGE)
);
assert.equal(off.label, '189 / 500');
assert.match(off.details.join('\n'), /On-Demand Usage is off/);

// No ceiling set at all.
const uncapped = parseUsageSummary(
	{ ...SUMMARY, individualUsage: { onDemand: { enabled: true, used: 900, limit: null } } },
	USAGE
);
assert.equal(uncapped.onDemandCapDollars, undefined);
assert.equal(formatUsage(uncapped).onDemand, '$9');

assert.equal(parseUsageSummary({}, {}), null, 'nothing to read is no reading');
assert.equal(parseUsageSummary(null), null);
console.log('cursor-usage.test.js ok');
