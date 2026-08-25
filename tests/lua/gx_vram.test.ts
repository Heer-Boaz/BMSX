import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';

import { compileLuaChunkToProgram } from '../../toolchain/ts/lua/compiler';
import { gxGpuPair16 } from '../../machine/ts/spec/gx/gp0';
import { runCompiledTestSystem } from '../helpers/blua32';
import { materializeCpuCompletionValues, parseLuaChunk } from './cpu_test_harness';

const vramSource = readFileSync('cartlib/gx/vram.lua', 'utf8');

function runVram(entrySource: string, displaySize: number): unknown[] {
	const displaySource = `return {
	read_size_word = function()
		return ${displaySize}
	end,
}`;
	const systemVramRegionSource = `return function()
	return ${gxGpuPair16(704, 720)}, ${gxGpuPair16(320, 304)}
end`;
	const compiled = compileLuaChunkToProgram(
		parseLuaChunk(entrySource, 'test.lua'),
		[
			{
				path: 'cartlib/gx/display',
				chunk: parseLuaChunk(displaySource, 'cartlib/gx/display.lua'),
				source: displaySource,
			},
			{
				path: 'gpu/system_vram_region',
				chunk: parseLuaChunk(systemVramRegionSource, 'gpu/system_vram_region.lua'),
				source: systemVramRegionSource,
			},
			{
				path: 'cartlib/gx/vram',
				chunk: parseLuaChunk(vramSource, 'cartlib/gx/vram.lua'),
				source: vramSource,
			},
		],
		{ entrySource, optLevel: 3, programDomain: 'system' },
	);
	return materializeCpuCompletionValues(runCompiledTestSystem(compiled, 1_000_000));
}

test('GX VRAM configures horizontal 256x192 display pages from retained display state', () => {
	const result = runVram(`
local vram<const> = require('cartlib/gx/vram')
return vram.configure(2)
`, gxGpuPair16(256, 192));

	assert.deepEqual(result, [0, gxGpuPair16(256, 0), gxGpuPair16(256, 192)]);
});

test('GX VRAM configures vertical 640x480 display pages without a fixed presentation band', () => {
	const result = runVram(`
local vram<const> = require('cartlib/gx/vram')
return vram.configure(2)
`, gxGpuPair16(640, 480));

	assert.deepEqual(result, [0, gxGpuPair16(0, 480), gxGpuPair16(640, 480)]);
});

test('GX VRAM honors two-axis alignment and reuses an explicit release', () => {
	const result = runVram(`
local vram<const> = require('cartlib/gx/vram')
vram.configure(2)
local first<const> = vram.allocate(128, 193, 64, 256)
local second<const> = vram.allocate(256, 192, 256, 256)
local first_destination<const> = first.x | (first.y << 16)
local first_index<const> = first._allocation_index
vram.release(first)
local replacement<const> = vram.allocate(128, 193, 64, 256)
return first_destination,
	second.x | (second.y << 16),
	replacement.x | (replacement.y << 16),
	first_index,
	replacement._allocation_index
`, gxGpuPair16(256, 192));

	assert.deepEqual(result, [
		gxGpuPair16(512, 0),
		gxGpuPair16(768, 0),
		gxGpuPair16(512, 0),
		4,
		5,
	]);
});

test('GX VRAM replaces the allocation that creates a valid aligned placement', () => {
	const result = runVram(`
local vram<const> = require('cartlib/gx/vram')
vram.configure(1)
local retained<const> = vram.allocate(16, 9, 64, 256)
local replaced<const> = vram.allocate(640, 480, 256, 256)
local replacement<const> = vram.replace(replaced, 1024, 256, 256, 256)
return retained.x | (retained.y << 16),
	replacement.x | (replacement.y << 16),
	retained._allocation_index,
	replacement._allocation_index
`, gxGpuPair16(320, 240));

	assert.deepEqual(result, [
		gxGpuPair16(320, 0),
		gxGpuPair16(0, 256),
		3,
		4,
	]);
});
