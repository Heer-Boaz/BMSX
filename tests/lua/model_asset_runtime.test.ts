import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import type { Closure } from '../../machine/ts/machine/cpu/closure';
import { RunResult } from '../../machine/ts/machine/cpu/cpu';
import type { Table } from '../../machine/ts/machine/cpu/table';
import { CART_ROM_BASE } from '../../machine/ts/spec/bmsx/memory_map';
import { parseCartHeader } from '../../machine/ts/rompack/format';
import { compileLuaChunkToProgram } from '../../toolchain/ts/lua/compiler';
import { alignRomAssetOffset, layoutRomAssetPayloads } from '../../toolchain/ts/rompack/asset_layout';
import type { GLTFModel } from '../../toolchain/ts/rompack/gltf';
import { writeCartRomHeader } from '../../toolchain/ts/rompack/header_encode';
import { packModelAsset } from '../../toolchain/ts/rompack/model_asset';
import { encodeRomToc } from '../../toolchain/ts/rompack/toc_encode';
import { createTestBlua32PairCpu, linkTestSystemBlua32 } from '../helpers/blua32';
import { profileWarmGuestKernel } from '../helpers/guest_kernel';
import { createTestRuntimeRomPayload } from '../helpers/runtime_sources';
import { materializeCpuCompletionValues, parseLuaChunk, runCompletionClosure } from './cpu_test_harness';

// The production packer and actual guest typed loads share this synthetic
// resource. No gameplay cart or host-side recreation of the Lua reader.
function modelCartridge(x: number, offset: number) {
	const model: GLTFModel = {
		name: 'shared', materials: [{}],
		meshes: [
			{ primitives: [
				{ positions: new Float32Array([x, -2.5, 3.75, 4, 5, 6, 7, 8, 9]),
					indices: new Uint8Array([2, 0, 1]), indexComponentType: 5121, materialIndex: 0 },
				{ positions: new Float32Array([10, 11, 12, 13, 14, 15, 16, 17, 18]) },
			] },
			{ primitives: [{ positions: new Float32Array([19, 20, 21]),
				indices: new Uint16Array([0x1234, 0xabcd, 0xffff]), indexComponentType: 5123 }] },
			{ primitives: [{ positions: new Float32Array([22, 23, 24]),
				indices: new Uint32Array([0x12345678, 0x80000001, 0xffffffff]), indexComponentType: 5125 }] },
		],
	};
	const layout = layoutRomAssetPayloads([
		{ type: 'model', resid: 'shared', ...packModelAsset(model) },
		// The directory admits names independently per resource kind.
		{ type: 'image', resid: 'shared', buffer: new Uint8Array([1, 2, 3, 4]) },
	], false, offset);
	const toc = encodeRomToc({ entries: layout.entries });
	const header = createTestRuntimeRomPayload();
	const bytes = new Uint8Array(layout.nextOffset + toc.length);
	bytes.set(header);
	for (const range of layout.ranges) bytes.set(range.buffer, range.start);
	bytes.set(toc, layout.nextOffset);
	writeCartRomHeader(bytes, { ...parseCartHeader(header), tocOffset: layout.nextOffset, tocLength: toc.length });
	return { bytes, address: CART_ROM_BASE + layout.entries[0].start };
}

const source = `require('bootstrap')
local models<const> = require('cartlib/gx/model_asset')
local directory<const> = require('cartlib/rom_dir')
local previous
probe = {
 read=function()
  local asset<const> = models.resolve('shared')
  local same<const> = previous == asset
  previous = asset
  local meshes<const>: *model_mesh = asset.meshes
  local primitives<const>: *model_primitive = asset.primitives
  local positions<const>: *model_position = asset.addr + primitives[0].positions_offset
  local indices8<const>: *u8 = asset.addr + primitives[0].indices_offset
  local indices16<const>: *u16 = asset.addr + primitives[2].indices_offset
  local indices32<const>: *u32 = asset.addr + primitives[3].indices_offset
  return same, models.resolve('shared') == asset, asset.addr, asset.mesh_count, asset.primitive_count,
   meshes[0].first_primitive, meshes[0].primitive_count, meshes[1].first_primitive, meshes[2].first_primitive,
   primitives[0].position_scalar_count, primitives[0].index_count, primitives[0].index_component_type, primitives[0].material_index,
   positions[0].x, positions[0].y, positions[0].z, positions[2].z,
   indices8[0], indices8[2], indices16[0], indices16[1], indices16[2], indices32[0], indices32[1], indices32[2],
   primitives[1].indices_offset, primitives[1].index_count, primitives[1].index_component_type, primitives[1].material_index,
   primitives[2].index_component_type, primitives[3].index_component_type,
   directory.image('shared').type == 'image', directory.model('missing') == nil,
   sizeof(model_asset_header), sizeof(model_mesh), sizeof(model_primitive), sizeof(model_position)
 end,
 steady=function(count)
  local sum = 0
  for index=1,count do
   local asset<const> = models.resolve('shared')
   local primitives<const>: *model_primitive = asset.primitives
   local positions<const>: *model_position = asset.addr + primitives[0].positions_offset
   sum = sum + positions[0].x + positions[2].z
  end
  return sum
 end,
 reload=directory.reload_cartridge_directory,
}
`;

for (const optLevel of [0, 3] as const) test(`model geometry binds ROM streams once and renews with its directory generation (O${optLevel})`, () => {
	const modules = [
		{ path: 'bootstrap', source: "require('base')\ntable = require('table')\nstring = require('string/base')" },
		{ path: 'tty/console', source: 'return { write = function() end, end_line = function() end }' },
		...['base', 'table', 'string/base', 'string/utf8', 'string/float/decode'].map(path => ({
			path, source: readFileSync(`machine/bios/${path}.lua`, 'utf8'),
		})),
		...['cartlib/memory', 'cartlib/bin', 'cartlib/rom_dir', 'cartlib/gx/model_asset'].map(path => ({
			path, source: readFileSync(`${path}.lua`, 'utf8'),
		})),
	].map(module => ({ ...module, chunk: parseLuaChunk(module.source, module.path) }));
	const compiled = compileLuaChunkToProgram(parseLuaChunk(source, 'model_reader.lua'), modules,
		{ entrySource: source, programDomain: 'system', optLevel });
	const linked = linkTestSystemBlua32(compiled);
	const systemToc = encodeRomToc({ entries: [] });
	const systemTocOffset = alignRomAssetOffset(linked.romBytes.length);
	const systemRomBytes = new Uint8Array(systemTocOffset + systemToc.length);
	systemRomBytes.set(linked.romBytes);
	systemRomBytes.set(systemToc, systemTocOffset);
	writeCartRomHeader(systemRomBytes, { ...parseCartHeader(linked.romBytes),
		tocOffset: systemTocOffset, tocLength: systemToc.length });
	const initial = modelCartridge(1.25, 0x100);
	const { cpu, memory } = createTestBlua32PairCpu({ systemRomBytes, cartRomBytes: initial.bytes });
	cpu.installBootPrimitives();
	assert.equal(cpu.runUntilDepth(0, 10_000_000), RunResult.Halted);
	const probe = cpu.getGlobalByKey(cpu.stringPool.find('probe')) as Table;
	const read = probe.getStringKey(cpu.stringPool.find('read')) as Closure;
	const observe = () => {
		runCompletionClosure(cpu, read, []);
		return materializeCpuCompletionValues(cpu);
	};
	const expected = (same: boolean, address: number, x: number) => [
		same, true, address, 3, 4, 0, 2, 2, 3, 9, 3, 5121, 0, x, -2.5, 3.75, 9,
		2, 1, 0x1234, 0xabcd, 0xffff, 0x12345678, 0x80000001, 0xffffffff,
		0, 0, 0, 0xffffffff, 5123, 5125, true, true, 24, 8, 24, 12,
	];
	assert.deepEqual(observe(), expected(false, initial.address, 1.25));
	assert.deepEqual(observe(), expected(true, initial.address, 1.25));
	const steady = probe.getStringKey(cpu.stringPool.find('steady')) as Closure;
	const profile = profileWarmGuestKernel(cpu, steady, 512);
	assert.equal(profile.reservations, 0, 'warm resource resolution and typed reads allocate no guest heap');
	assert.deepEqual(materializeCpuCompletionValues(cpu), [512 * 10.25]);
	const replacement = modelCartridge(6.5, 0x800);
	memory.cartridgeController.installRom(0, replacement.bytes);
	runCompletionClosure(cpu, probe.getStringKey(cpu.stringPool.find('reload')) as Closure, []);
	assert.deepEqual(observe(), expected(false, replacement.address, 6.5));
	assert.deepEqual(observe(), expected(true, replacement.address, 6.5));
});
