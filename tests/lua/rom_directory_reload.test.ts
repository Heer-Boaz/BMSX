import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { RunResult } from '../../machine/ts/machine/cpu/cpu';
import type { Closure } from '../../machine/ts/machine/cpu/closure';
import { valueString } from '../../machine/ts/machine/cpu/value';
import { SYSTEM_EXECUTION_DOMAIN_ID } from '../../machine/ts/spec/blua32/execution_domain';
import { CART_ROM_BASE } from '../../machine/ts/spec/bmsx/memory_map';
import { parseCartHeader } from '../../machine/ts/rompack/format';
import { compileLuaChunkToProgram } from '../../toolchain/ts/lua/compiler';
import type { RomAsset } from '../../toolchain/ts/rompack/assets';
import { writeCartRomHeader } from '../../toolchain/ts/rompack/header_encode';
import { encodeRomToc } from '../../toolchain/ts/rompack/toc_encode';
import { alignRomAssetOffset } from '../../toolchain/ts/rompack/asset_layout';
import { createTestBlua32PairCpu, linkTestSystemBlua32 } from '../helpers/blua32';
import { createTestRuntimeRomPayload } from '../helpers/runtime_sources';
import { materializeCpuCompletionValues, parseLuaChunk, runCompletionClosure } from './cpu_test_harness';

function directory(bytes: Uint8Array, offset: number, entries: RomAsset[]): Uint8Array {
	const toc = encodeRomToc({ entries });
	const result = new Uint8Array(offset + toc.length);
	result.set(bytes);
	result.set(toc, offset);
	writeCartRomHeader(result, { ...parseCartHeader(bytes), tocOffset: offset, tocLength: toc.length });
	return result;
}

for (const optLevel of [0, 3] as const) test(`annotated preparation renews relocated ROM directories before dependent init (O${optLevel})`, () => {
	const entrySource = `require('bootstrap')
local rom_dir<const> = require('cartlib/rom_dir')
local function init<init>()
    preparations = (preparations or 0) + 1
    ready_image = rom_dir.image('late')
end
init()
return function(id, system)
    local record = system and rom_dir.system_image(id) or rom_dir.image(id)
    if record == nil then return nil end
    return record.addr, record.len
end`;
	const modules = [
		{ path: 'bootstrap', source: "require('base')\ntable = require('table')\nstring = require('string/base')" },
		{ path: 'tty/console', source: 'return { write = function() end, end_line = function() end }' },
		...['base', 'table', 'string/base', 'string/utf8', 'string/float/decode'].map(path => ({
			path, source: readFileSync(`machine/bios/${path}.lua`, 'utf8'),
		})),
		...['cartlib/memory', 'cartlib/bin', 'cartlib/rom_dir'].map(path => ({ path, source: readFileSync(`${path}.lua`, 'utf8') })),
	].map(module => ({ ...module, chunk: parseLuaChunk(module.source, module.path) }));
	const compiled = compileLuaChunkToProgram(parseLuaChunk(entrySource, 'entry.lua'), modules,
		{ entrySource, programDomain: 'system', optLevel });
	const linked = linkTestSystemBlua32(compiled);
	const cartBase = createTestRuntimeRomPayload();
	const systemOffset = alignRomAssetOffset(linked.romBytes.length + 64);
	const { cpu, memory } = createTestBlua32PairCpu({
		systemRomBytes: directory(linked.romBytes, systemOffset, [{ type: 'image', resid: 'system', start: 0x80, end: 0x84 }]),
		cartRomBytes: directory(cartBase, 0x400, [
			{ type: 'image', resid: 'warm', start: 0x100, end: 0x104 },
			{ type: 'image', resid: 'removed', start: 0x110, end: 0x114 },
		]),
	});
	cpu.installBootPrimitives();
	assert.equal(cpu.runUntilDepth(0, 10_000_000), RunResult.Halted, 'cold boot');
	const read = materializeCpuCompletionValues(cpu)[0] as Closure;
	const lookup = (id: string, system = false) => {
		runCompletionClosure(cpu, read, [valueString(cpu.stringPool.intern(id)), system]);
		return materializeCpuCompletionValues(cpu);
	};
	assert.deepEqual(lookup('warm'), [CART_ROM_BASE + 0x100, 4]);
	assert.deepEqual(lookup('removed'), [CART_ROM_BASE + 0x110, 4]);
	assert.deepEqual(lookup('late'), [null]);
	assert.deepEqual(lookup('system', true), [0x80, 4]);
	// Replace the physical media. The old directory addresses now contain zeros;
	// only the existing annotated-init path may rebuild guest-owned indices.
	memory.cartridgeController.installRom(0, directory(cartBase, 0x800, [
		{ type: 'image', resid: 'warm', start: 0x120, end: 0x128 },
		{ type: 'image', resid: 'late', start: 0x130, end: 0x13c },
		{ type: 'texture', resid: 'late', start: 0x140, end: 0x150 },
	]));
	memory.installSystemRom(directory(linked.romBytes, systemOffset + 512, [
		{ type: 'image', resid: 'system', start: 0x90, end: 0x98 },
	]));
	cpu.beginCompletionCallInExecutionDomain(SYSTEM_EXECUTION_DOMAIN_ID, linked.vectors.initFunctionAddress);
	assert.equal(cpu.runUntilDepth(0, 10_000_000), RunResult.Halted);
	assert.equal(cpu.getGlobalByKey(cpu.stringPool.intern('preparations')), 2, 'preparation retains the live program');
	assert.notEqual(cpu.getGlobalByKey(cpu.stringPool.intern('ready_image')), null, 'directory refresh precedes dependent init');
	assert.deepEqual(lookup('warm'), [CART_ROM_BASE + 0x120, 8]);
	assert.deepEqual(lookup('late'), [CART_ROM_BASE + 0x130, 12]);
	assert.deepEqual(lookup('removed'), [null]);
	assert.deepEqual(lookup('system', true), [0x90, 8]);
});
