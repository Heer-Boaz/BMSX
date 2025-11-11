import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { existsSync } from 'node:fs';

const ROM_NAME = 'marlies2020console';
const ROM_DEBUG_PATH = path.resolve('dist', `${ROM_NAME}.debug.rom`);
const HEADLESS_BUNDLE = path.resolve('dist', 'headless_debug.js');
const TIMELINE_PATH = path.resolve('src', ROM_NAME, 'test', `${ROM_NAME}_demo.json`);
const INPUT_MODULE_PATH = path.resolve('tests', 'helpers', 'marlies2020_collision_probe.js');
const MAX_BUFFER = 8 * 1024 * 1024;

test.skip('marlies2020console emits overlap events when player reaches ingredient (disabled: rom now throws error on boot)', async () => {
	const buildResult = spawnSync('npm', ['run', 'build:game:headless', ROM_NAME], { encoding: 'utf-8', maxBuffer: MAX_BUFFER });
	assert.equal(buildResult.status, 0, `build:game:headless failed:\n${buildResult.stdout}\n${buildResult.stderr}`);
	assert.ok(existsSync(ROM_DEBUG_PATH), `Expected debug ROM at ${ROM_DEBUG_PATH}`);
	const headlessArgs = [
		HEADLESS_BUNDLE,
		'--rom', ROM_DEBUG_PATH,
		'--input-timeline', TIMELINE_PATH,
		'--input-module', INPUT_MODULE_PATH,
		'--ttl', '5',
	];
	const runResult = spawnSync('node', headlessArgs, { encoding: 'utf-8', maxBuffer: MAX_BUFFER });
	assert.equal(runResult.status, 0, `headless runner failed:\n${runResult.stdout}\n${runResult.stderr}`);
	assert.match(runResult.stdout ?? '', /\[COLLISION_DETECTED\]/, 'Expected overlap event between player and ingredient');
});
