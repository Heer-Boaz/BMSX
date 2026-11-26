import { valueInteger } from '../../machine/ts/machine/cpu/value';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';

import { compileTestSystemWithHeap } from '../helpers/heap_service_system';
import { runCompiledTestSystem } from '../helpers/blua32';
import { materializeCpuCompletionValues, parseLuaChunk } from '../helpers/cpu_test_harness';

const atlasSource = readFileSync('cartlib/gx/atlas.lua', 'utf8');

function runAtlasResidency(entrySource: string, vramSource = `local active_count = 0
local destination = 0
return {
	allocate = function()
		if active_count == 2 then return nil end
		active_count = active_count + 1
		destination = destination + 0x100
		return {
			x = destination % 1024,
			y = (destination // 1024) * 256,
		}
	end,
	replace = function()
		return nil
	end,
	release = function()
		active_count = active_count - 1
	end,
}`) {
	const moduleSources = [
		...['cartlib/gx/gp0', 'cartlib/component/tile_layer_row'].map(path => ({
			path, source: readFileSync(`${path}.lua`, 'utf8'),
		})),
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
	second_pal = { addr = 0x2000, len = 16, texturemeta = {
		mode = 0, word_width = 2, height = 8, texture_word_count = 16, clut_word_count = 16,
	} },
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
	const compiled = compileTestSystemWithHeap(
		parseLuaChunk(entrySource, 'test.lua'),
		moduleSources,
		{ entrySource, optLevel: 3, programDomain: 'system' },
	);
	return materializeCpuCompletionValues(runCompiledTestSystem(compiled, 1_000_000));
}

test('GX atlas recency evicts placements and refreshes mirrored row packets on readmission', () => {
	const result = runAtlasResidency(`
local atlas<const> = require('cartlib/gx/atlas')
local imgdec<const> = require('cartlib/gx/imgdec')
local first<const> = atlas.resolve('first')
local second<const> = atlas.resolve('second_pal')
local third<const> = atlas.resolve('third')

local row_api<const> = require('cartlib/component/tile_layer_row')
local row<const> = row_api.new()
row_api.configure(row,1,0x00080008,2)
row.first_visible_source, row.last_visible_source, row.source_count = 2, 2, 1
local rows<const> = {row, placement_revision=atlas.placement_revision}
local source<const> = {source_x=8,source_y=0,width=8,height=8,_size_word=0x00080008}
atlas.bind_source(second,source)
row_api.set_source(row,2,source)

atlas.load('first')
atlas.load('second_pal')
row_api.refresh_packets(rows,1)
local initial_mode<const>, initial_uv<const> = row.draw_modes[2], row.uv_words[2]
atlas.load('first')
atlas.load('third')
local first_after_third<const> = first._allocation ~= nil and 1 or 0
local second_after_third<const> = second._allocation ~= nil and 1 or 0
local third_after_third<const> = third._allocation ~= nil and 1 or 0

atlas.load('second_pal')
row_api.refresh_packets(rows,1)
local moved_mode<const>, moved_uv<const> = row.draw_modes[4], row.uv_words[4]
return first_after_third,
	second_after_third,
	third_after_third,
	first._allocation ~= nil and 1 or 0,
	second._allocation ~= nil and 1 or 0,
	third._allocation ~= nil and 1 or 0,
	imgdec.upload_count(),
	initial_mode, initial_uv, moved_mode, moved_uv,
	row.draw_mode_counts[moved_mode], row.draw_modes[2], row.uv_words[2]
`);

	assert.deepEqual(result, [1, 0, 1, 0, 1, 1, 4, 8, 0x02200008, 16, 0x42000008, 1, 16, 0x42000008].map(valueInteger));
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

	assert.deepEqual(result, [1, 0, 1, 3].map(valueInteger));
});
