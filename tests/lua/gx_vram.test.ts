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
	const compiled = compileLuaChunkToProgram(
		parseLuaChunk(entrySource, 'test.lua'),
		[
			{
				path: 'cartlib/gx/display',
				chunk: parseLuaChunk(displaySource, 'cartlib/gx/display.lua'),
				source: displaySource,
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

test('GX VRAM aligns palette residency, retains its CLUT, and reuses an explicit release', () => {
	const result = runVram(`
local vram<const> = require('cartlib/gx/vram')
vram.configure(2)
local first<const> = vram.allocate_texture(128, 192, true)
local second<const> = vram.allocate_texture(256, 192, false)
local first_destination<const> = first.destination
local first_clut_destination<const> = first.clut_destination
vram.release(first)
local replacement<const> = vram.allocate_texture(128, 192, true)
return first_destination, first_clut_destination, second.destination, replacement.destination
`, gxGpuPair16(256, 192));

	assert.deepEqual(result, [
		gxGpuPair16(512, 0),
		gxGpuPair16(512, 192),
		gxGpuPair16(768, 0),
		gxGpuPair16(512, 0),
	]);
});

test('GX VRAM replaces the allocation that creates a valid texture placement', () => {
	const result = runVram(`
local vram<const> = require('cartlib/gx/vram')
vram.configure(1)
local retained<const> = vram.allocate_texture(16, 8, true)
local replaced<const> = vram.allocate_texture(640, 480, false)
local replacement<const> = vram.replace_texture(replaced, 1024, 256, false)
return retained.destination,
	replacement.destination,
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
