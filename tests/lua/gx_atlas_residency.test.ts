import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';

import { compileLuaChunkToProgram } from '../../toolchain/ts/lua/compiler';
import { runCompiledTestSystem } from '../helpers/blua32';
import { materializeCpuCompletionValues, parseLuaChunk } from './cpu_test_harness';

const atlasSource = readFileSync('cartlib/gx/atlas.lua', 'utf8');

function runAtlasResidency(entrySource: string, vramSource = `local active_count = 0
local destination = 0
return {
	allocate = function()
		if active_count == 2 then return nil end
		active_count = active_count + 1
		destination = destination + 0x100
		return {
			x = destination,
			y = 0,
		}
	end,
	replace = function()
		return nil
	end,
	release = function()
		active_count = active_count - 1
	end,
}`): unknown[] {
	const moduleSources = [
		{
			path: 'cartlib/gx/gp0',
			source: `return {
	texture_mode_palette4 = 0,
	texture_mode_direct16 = 2,
	texture_page_span = 256,
	draw_mode_blend_half = 1,
}`,
		},
		{
			path: 'cartlib/gx/imgdec',
			source: `local count = 0
return {
	upload = function()
		count = count + 1
	end,
	upload_count = function()
		return count
	end,
}`,
		},
		{
			path: 'cartlib/rom_dir',
			source: `local texture_meta<const> = {
	texture_word_count = 16,
	clut_word_count = 0,
	mode = 2,
	word_width = 16,
	height = 16,
}
local textures<const> = {
	first = { addr = 0x1000, len = 16, texturemeta = texture_meta },
	second = { addr = 0x2000, len = 16, texturemeta = texture_meta },
	third = { addr = 0x3000, len = 16, texturemeta = texture_meta },
}
return {
	texture = function(id)
		return textures[id]
	end,
}`,
		},
		{
			path: 'cartlib/gx/vram',
			source: vramSource,
		},
		{
			path: 'cartlib/gx/atlas',
			source: atlasSource,
		},
	].map(module => ({
		path: module.path,
		chunk: parseLuaChunk(module.source, `${module.path}.lua`),
		source: module.source,
	}));
	const compiled = compileLuaChunkToProgram(
		parseLuaChunk(entrySource, 'test.lua'),
		moduleSources,
		{ entrySource, optLevel: 3, programDomain: 'system' },
	);
	return materializeCpuCompletionValues(runCompiledTestSystem(compiled, 1_000_000));
}

test('GX atlas admission retains one allocation per atlas and evicts by load recency', () => {
	const result = runAtlasResidency(`
local atlas<const> = require('cartlib/gx/atlas')
local imgdec<const> = require('cartlib/gx/imgdec')
local first<const> = atlas.resolve('first')
local second<const> = atlas.resolve('second')
local third<const> = atlas.resolve('third')

atlas.load('first')
atlas.load('second')
atlas.load('first')
atlas.load('third')
local first_after_third<const> = first._allocation ~= nil and 1 or 0
local second_after_third<const> = second._allocation ~= nil and 1 or 0
local third_after_third<const> = third._allocation ~= nil and 1 or 0

atlas.load('second')
return first_after_third,
	second_after_third,
	third_after_third,
	first._allocation ~= nil and 1 or 0,
	second._allocation ~= nil and 1 or 0,
	third._allocation ~= nil and 1 or 0,
	imgdec.upload_count()
`);

	assert.deepEqual(result, [1, 0, 1, 0, 1, 1, 4]);
});

test('GX atlas admission replaces a fitting cache allocation before evicting unrelated residency', () => {
	const result = runAtlasResidency(`
local atlas<const> = require('cartlib/gx/atlas')
local imgdec<const> = require('cartlib/gx/imgdec')
local first<const> = atlas.resolve('first')
local second<const> = atlas.resolve('second')
local third<const> = atlas.resolve('third')

atlas.load('first')
atlas.load('second')
atlas.load('third')
return first._allocation ~= nil and 1 or 0,
	second._allocation ~= nil and 1 or 0,
	third._allocation ~= nil and 1 or 0,
	imgdec.upload_count()
`, `local active_count = 0
return {
	allocate = function()
		if active_count == 2 then return nil end
		active_count = active_count + 1
		return {
			x = active_count * 0x100,
			y = 0,
			replaceable = active_count == 2,
		}
	end,
	replace = function(allocation)
		if not allocation.replaceable then return nil end
		allocation.x = 0x300
		return allocation
	end,
	release = function()
		active_count = active_count - 1
	end,
}`);

	assert.deepEqual(result, [1, 0, 1, 3]);
});
