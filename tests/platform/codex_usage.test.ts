import test from 'node:test';
import assert from 'node:assert/strict';
import { CodexUsage, type CodexRateLimits } from '../../hosts/node/codex/usage';

const week = (usedPercent: number) => ({ usedPercent, windowDurationMins: 10080, resetsAt: 100000 });
const short = (usedPercent: number) => ({ usedPercent, windowDurationMins: 300, resetsAt: 90000 });
const snapshot = (primary: CodexRateLimits['primary'], secondary: CodexRateLimits['secondary'], limitId: string | null = 'codex'): CodexRateLimits => ({ primary, secondary, limitId });

test('quota reports only an explicitly weekly Codex window, never an assumed secondary window', () => {
	const usage = new CodexUsage();
	assert.deepEqual(usage.snapshot(), { weeklyRemaining: null });
	usage.update(snapshot(short(99), { ...week(50), windowDurationMins: null }));
	assert.equal(usage.snapshot().weeklyRemaining, null);
	usage.update(snapshot(null, week(37)));
	assert.equal(usage.snapshot().weeklyRemaining, 63);
	usage.update(snapshot(short(15), null));
	assert.equal(usage.snapshot().weeklyRemaining, 63, 'sparse rolling update retains the observed weekly window');
	assert.equal(usage.update(snapshot(null, week(100), 'codex_other')), false);
	assert.equal(usage.snapshot().weeklyRemaining, 63, 'unrelated model buckets cannot overwrite the account quota');
	usage.clear(); usage.update(snapshot(week(100), null, null));
	assert.equal(usage.snapshot().weeklyRemaining, 0, 'zero remains a known quota, not an unavailable value');
	usage.update(snapshot(week(0), null)); assert.equal(usage.snapshot().weeklyRemaining, 100);
});

test('a slow initial quota response seeds missing windows but never replaces newer notifications', () => {
	const usage = new CodexUsage();
	usage.update(snapshot(null, week(37)));
	usage.initialize({ rateLimits: snapshot(short(2), week(10)), rateLimitsByLimitId: null });
	assert.equal(usage.snapshot().weeklyRemaining, 63);
	usage.clear();
	usage.initialize({ rateLimits: snapshot(null, week(5)), rateLimitsByLimitId: { codex: snapshot(null, week(80)), other: snapshot(null, week(0), 'other') } });
	assert.equal(usage.snapshot().weeklyRemaining, 20);
	usage.clear(); assert.equal(usage.snapshot().weeklyRemaining, null);
});
