import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { test } from 'node:test';
import { RunResult } from '../../machine/ts/machine/cpu/cpu';
import { CpuExecutionBackend } from '../../machine/ts/machine/cpu/compiled_block';
import { asClosure, asInteger, isNil, valueBool, valueTag, valuePayload, valueInteger, valueNil, valueString } from '../../machine/ts/machine/cpu/value';
import { SYSTEM_EXECUTION_DOMAIN_ID } from '../../machine/ts/spec/blua32/execution_domain';
import { CART_ROM_BASE } from '../../machine/ts/spec/bmsx/memory_map';
import { parseCartHeader } from '../../machine/ts/rompack/format';
import { hashAssetId } from '../../machine/ts/rompack/tokens';
import { compileLuaChunkToProgram } from '../../toolchain/ts/lua/compiler';
import type { RomAsset } from '../../toolchain/ts/rompack/assets';
import { writeCartRomHeader } from '../../toolchain/ts/rompack/header_encode';
import { encodeRomToc } from '../../toolchain/ts/rompack/toc_encode';
import { alignRomAssetOffset } from '../../toolchain/ts/rompack/asset_layout';
import { createTestBlua32PairCpu, linkTestSystemBlua32 } from '../helpers/blua32';
import { createTestRuntimeRomPayload } from '../helpers/runtime_sources';
import { materializeCpuCompletionValues, parseLuaChunk, runCompletionClosure } from '../helpers/cpu_test_harness';

function directory(bytes: Uint8Array, offset: number, entries: RomAsset[]): Uint8Array {
	const toc = encodeRomToc({ entries });
	const result = new Uint8Array(offset + toc.length);
	result.set(bytes);
	result.set(toc, offset);
	writeCartRomHeader(result, { ...parseCartHeader(bytes), tocOffset: offset, tocLength: toc.length });
	return result;
}

const modules = [
	{ path: 'bootstrap', source: "require('base')\ntable = require('table')\nstring = require('string/base')" },
	{ path: 'tty/console', source: 'return { write = function() end, end_line = function() end }' },
	...['base', 'number/parse', 'number/decimal', 'table', 'string/base', 'string/mapped', 'string/float/decode'].map(path => ({
		path, source: readFileSync(`machine/bios/${path}.lua`, 'utf8'),
	})),
	...['cartlib/memory', 'cartlib/bin', 'cartlib/rom_dir'].map(path => ({ path, source: readFileSync(`${path}.lua`, 'utf8') })),
].map(module => ({ ...module, chunk: parseLuaChunk(module.source, module.path) }));

for (const optLevel of [3] as const) for (const backend of [CpuExecutionBackend.Interpreter]) test(`raw token lookup and relocated ROM directories retain dependent init (O${optLevel}, ${backend})`, () => {
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

	const compiled = compileLuaChunkToProgram(parseLuaChunk(entrySource, 'entry.lua'), modules,
		{ entrySource, programDomain: 'system', optLevel });
	const linked = linkTestSystemBlua32(compiled);
	const cartBase = createTestRuntimeRomPayload();
	const systemOffset = alignRomAssetOffset(linked.romBytes.length + 64);
	const ids = ['', 'a'.repeat(500), ...Array.from({ length: 96 }, (_, index) => `asset-${index}-texture`)];
	const tokenSigns = new Set<number>();
	const tokenEntries: RomAsset[] = ids.map((resid, index) => {
		let oracle = 0xcbf29ce484222325n;
		for (const byte of new TextEncoder().encode(resid)) oracle = BigInt.asUintN(64, (oracle ^ BigInt(byte)) * 0x100000001b3n);
		const lo = Number(oracle & 0xffffffffn), hi = Number(oracle >> 32n);
		assert.deepEqual(hashAssetId(resid), { lo, hi }, 'the production packer agrees with independent wide arithmetic');
		tokenSigns.add((lo >>> 31) | ((hi >>> 31) << 1));
		return { type: 'image', resid, start: 0x200 + index * 4, end: 0x204 + index * 4 };
	});
	assert.equal(tokenSigns.size, 4, 'both token words exercise positive and negative Integer carriers');
	const { cpu, memory } = createTestBlua32PairCpu({
		systemRomBytes: directory(linked.romBytes, systemOffset, [{ type: 'image', resid: 'system', start: 0x80, end: 0x84 }]),
		cartRomBytes: directory(cartBase, 0x400, [
			{ type: 'image', resid: 'warm', start: 0x100, end: 0x104 },
			{ type: 'image', resid: 'removed', start: 0x110, end: 0x114 },
			...tokenEntries,
		]),
	}, backend);
	cpu.installBootPrimitives();
	assert.equal(cpu.runUntilDepth(0, 10_000_000), RunResult.Halted, 'cold boot');
	const read = asClosure(materializeCpuCompletionValues(cpu)[0], cpu.gc);
	const lookup = (id: string, system = false) => {
		runCompletionClosure(cpu, read, [valueString(cpu.stringPool.intern(id)), valueBool(system)]);
		return materializeCpuCompletionValues(cpu);
	};
	assert.deepEqual(lookup('warm'), [valueInteger(CART_ROM_BASE + 0x100), valueInteger(4)]);
	assert.deepEqual(lookup('removed'), [valueInteger(CART_ROM_BASE + 0x110), valueInteger(4)]);
	assert.deepEqual(lookup('late'), [valueNil()]);
	assert.deepEqual(lookup('system', true), [valueInteger(0x80), valueInteger(4)]);
	for (let round = 0; round < 3; ++round) for (const entry of tokenEntries) {
		assert.deepEqual(lookup(entry.resid), [valueInteger(CART_ROM_BASE + entry.start!), valueInteger(4)], entry.resid);
	}
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
	assert.equal(asInteger(cpu.getGlobalByKey(cpu.stringPool.intern('preparations'))), 2, 'preparation retains the live program');
	assert.equal(isNil(cpu.getGlobalByKey(cpu.stringPool.intern('ready_image'))), false, 'directory refresh precedes dependent init');
	assert.deepEqual(lookup('warm'), [valueInteger(CART_ROM_BASE + 0x120), valueInteger(8)]);
	assert.deepEqual(lookup('late'), [valueInteger(CART_ROM_BASE + 0x130), valueInteger(12)]);
	assert.deepEqual(lookup('removed'), [valueNil()]);
	assert.deepEqual(lookup('system', true), [valueInteger(0x90), valueInteger(8)]);
});

const nativeRunner = process.env.BMSX_CPU32_RUNNER;
for (const optLevel of [3] as const) test(`packed system directory O${optLevel}: native resource lookup matches TS words and cycles`, { skip: !nativeRunner }, () => {
	const source = readFileSync(new URL('../fixtures/compiler32/asset-lookup.lua', import.meta.url), 'utf8');
	const program = compileLuaChunkToProgram(parseLuaChunk(source, 'asset-lookup.lua'), modules,
		{ entrySource: source, programDomain: 'system', optLevel });
	const linked = linkTestSystemBlua32(program);
	const entries: RomAsset[] = ['', 'a'.repeat(500), ...Array.from({ length: 96 }, (_, i) => `asset-${i}-texture`)]
		.map((resid, i) => ({ type: 'image', resid, start: 0x200 + i * 4, end: 0x204 + i * 4 }));
	const romBytes = directory(linked.romBytes, alignRomAssetOffset(linked.romBytes.length), entries);
	const { cpu } = createTestBlua32PairCpu({ systemRomBytes: romBytes, cartRomBytes: createTestRuntimeRomPayload() });
	cpu.installBootPrimitives();
	const budget = 10_000_000;
	assert.equal(cpu.runUntilDepth(0, budget), RunResult.Halted);
	assert.equal(cpu.readLuaFaultReasonWord(), 0);
	const results = materializeCpuCompletionValues(cpu);
	assert.deepEqual(results, [valueInteger(98), valueInteger(entries.reduce((sum, entry) => sum + entry.start!, 0)), valueInteger(392)]);
	const expected = [`budget ${cpu.instructionBudgetRemaining} fault 0`, ...results.map(value => `${valueTag(value).toString(16)} ${valuePayload(value).toString(16)}`)].join('\n') + '\n';
	assert.equal(execFileSync(nativeRunner!, ['--execute-rom', '--boot-primitives', String(budget)], { input: romBytes, encoding: 'utf8' }), expected);
});
