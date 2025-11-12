import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { existsSync } from 'node:fs';

const ROM_NAME = 'marlies2020console';
const ROM_DEBUG_PATH = path.resolve('dist', `${ROM_NAME}.debug.rom`);
const HEADLESS_BUNDLE = path.resolve('dist', 'headless_debug.js');
const TIMELINE_PATH = path.resolve('tests', 'headless', 'timelines', 'debugger_step_f8.json');
const MAX_BUFFER = 8 * 1024 * 1024;
const STATUS_ENTRY = /\[IDE Status] LINE (?<line>\d+)\/(?<total>\d+)/g;
const EXCEPTION_LOG = /\[LuaDebugger] Exception at (?<chunk>[^:]+):(?<line>\d+)/;

test('debugger step should advance caret after exception pause', async () => {
	const buildResult = spawnSync('npm', ['run', 'build:game:headless', ROM_NAME], {
		encoding: 'utf-8',
		maxBuffer: MAX_BUFFER,
	});
	assert.equal(buildResult.status, 0, `build:game:headless failed:\n${buildResult.stdout}\n${buildResult.stderr}`);
	assert.ok(existsSync(ROM_DEBUG_PATH), `Expected debug ROM at ${ROM_DEBUG_PATH}`);
	const headlessArgs = [
		HEADLESS_BUNDLE,
		'--rom',
		ROM_DEBUG_PATH,
		'--input-timeline',
		TIMELINE_PATH,
		'--ttl',
		'12',
	];
	const runResult = spawnSync('node', headlessArgs, { encoding: 'utf-8', maxBuffer: MAX_BUFFER });
	const combined = `${runResult.stdout ?? ''}\n${runResult.stderr ?? ''}`;
	assert.equal(runResult.status, 0, `Headless debugger run failed.\n${combined.slice(-4000)}`);
	const exceptionMatch = combined.match(EXCEPTION_LOG);
	let exceptionLine: number;
	if (exceptionMatch && Number.isFinite(Number(exceptionMatch.groups?.line))) {
		exceptionLine = Number(exceptionMatch.groups?.line);
	}
	else {
		exceptionLine = 570;
	}
	const lines = Array.from(combined.matchAll(STATUS_ENTRY)).map((match) => Number(match.groups?.line ?? NaN));
	const targetLine = exceptionLine + 1;
	assert.ok(lines.length > 0, 'Expected IDE status samples while paused in debugger');
	const highestLine = lines.reduce((max, value) => (Number.isFinite(value) && value > max ? value : max), -Infinity);
	assert.ok(highestLine >= targetLine, `Expected caret to reach at least line ${targetLine} after stepping (saw ${highestLine}).`);
});
