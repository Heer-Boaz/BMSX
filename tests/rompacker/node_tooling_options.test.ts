import assert from 'node:assert/strict';
import * as path from 'node:path';
import { test } from 'node:test';

import {
	parseNodeToolingOptions,
} from '../../scripts/bootrom/platforms/node_tooling_options';

test('node tooling resolves artifact-owned ROM paths and mode defaults', () => {
	const command = parseNodeToolingOptions([
		'--input-timeline',
		'tests/carts/demo.json',
		'game',
	], true, 20);

	assert(command.kind === 'run');
	assert.deepEqual(command.options, {
		debug: true,
		romPath: path.resolve('dist/game.debug.rom'),
		slot1Path: '',
		frameIntervalMs: 20,
		ttlMs: 60_000,
		systemRomPath: path.resolve('dist/bmsx-bios.debug.rom'),
		mode: {
			kind: 'timeline',
			path: path.resolve('tests/carts/demo.json'),
		},
		cpuProfile: false,
	});
});

test('node tooling explicit paths and TTL are authoritative', () => {
	const command = parseNodeToolingOptions([
		'--no-debug',
		'--rom',
		'custom/cart.bin',
		'--system-rom',
		'custom/system.bin',
		'--slot1',
		'custom/data.bin',
		'--ttl',
		'2.5',
	], true, 20);

	assert(command.kind === 'run');
	assert.equal(command.options.debug, false);
	assert.equal(command.options.romPath, path.resolve('custom/cart.bin'));
	assert.equal(command.options.systemRomPath, path.resolve('custom/system.bin'));
	assert.equal(command.options.slot1Path, path.resolve('custom/data.bin'));
	assert.equal(command.options.ttlMs, 2_500);
	assert.deepEqual(command.options.mode, { kind: 'plain' });
});

test('node tooling exposes help without requiring a ROM', () => {
	assert.deepEqual(parseNodeToolingOptions(['--help'], false, 20), { kind: 'help' });
});

test('node tooling rejects conflicting concrete modes', () => {
	assert.throws(
		() => parseNodeToolingOptions([
			'--rom',
			'cart.rom',
			'--test',
			'test.lua',
			'--ide-test',
			'test.js',
		], false, 20),
		/Only one tooling mode/,
	);
});
