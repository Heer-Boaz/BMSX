import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';

import { compileLuaChunkToProgram } from '../../toolchain/ts/lua/compiler';
import { runCompiledTestSystem } from '../helpers/blua32';
import { materializeCpuCompletionValues, parseLuaChunk } from './cpu_test_harness';

const textureSource = readFileSync('cartlib/gx/texture.lua', 'utf8');

function runTextureResidency(entrySource: string, vramSource = `local active_count = 0
local destination = 0
return {
	allocate_texture = function()
		if active_count == 2 then return nil end
		active_count = active_count + 1
		destination = destination + 0x100
		return {
			destination = destination,
			clut_destination = 0,
		}
	end,
	replace_texture = function()
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
local images<const> = {
	first = { imgmeta = { gx_texture_resid = 'first' } },
	second = { imgmeta = { gx_texture_resid = 'second' } },
	third = { imgmeta = { gx_texture_resid = 'third' } },
}
return {
	texture = function(id)
		return textures[id]
	end,
	image = function(id)
		return images[id]
	end,
}`,
		},
		{
			path: 'cartlib/gx/vram',
			source: vramSource,
		},
		{
			path: 'cartlib/gx/texture',
			source: textureSource,
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

test('GX texture admission retains one allocation per atlas and evicts by upload recency', () => {
	const result = runTextureResidency(`
local texture<const> = require('cartlib/gx/texture')
local imgdec<const> = require('cartlib/gx/imgdec')
local first<const> = texture.resolve('first')
local second<const> = texture.resolve('second')
local third<const> = texture.resolve('third')

texture.upload('first')
texture.upload('second')
texture.upload('first')
texture.upload('third')
local first_after_third<const> = first._allocation ~= nil and 1 or 0
local second_after_third<const> = second._allocation ~= nil and 1 or 0
local third_after_third<const> = third._allocation ~= nil and 1 or 0

texture.upload('second')
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

test('GX texture admission replaces a fitting cache allocation before evicting unrelated residency', () => {
	const result = runTextureResidency(`
local texture<const> = require('cartlib/gx/texture')
local imgdec<const> = require('cartlib/gx/imgdec')
local first<const> = texture.resolve('first')
local second<const> = texture.resolve('second')
local third<const> = texture.resolve('third')

texture.upload('first')
texture.upload('second')
texture.upload('third')
return first._allocation ~= nil and 1 or 0,
	second._allocation ~= nil and 1 or 0,
	third._allocation ~= nil and 1 or 0,
	imgdec.upload_count()
`, `local active_count = 0
return {
	allocate_texture = function()
		if active_count == 2 then return nil end
		active_count = active_count + 1
		return {
			destination = active_count * 0x100,
			clut_destination = 0,
			replaceable = active_count == 2,
		}
	end,
	replace_texture = function(allocation)
		if not allocation.replaceable then return nil end
		allocation.destination = 0x300
		return allocation
	end,
	release = function()
		active_count = active_count - 1
	end,
}`);

	assert.deepEqual(result, [1, 0, 1, 3]);
});
