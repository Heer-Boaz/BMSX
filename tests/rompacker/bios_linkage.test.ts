import assert from 'node:assert/strict';
import { test } from 'node:test';
import { writeLE32 } from '../../machine/ts/common/endian';
import { RunResult } from '../../machine/ts/machine/cpu/cpu';
import { BiosFunction, BIOS_FUNCTION_MODULE_PATHS } from '../../machine/ts/spec/bmsx/bios';
import { PSX_MACHINE_SPEC } from '../../machine/ts/spec/bmsx/model';
import { CART_ROM_BASE } from '../../machine/ts/spec/bmsx/memory_map';
import { readBlua32BiosImports } from '../../toolchain/ts/rompack/blua32_bios_imports';
import { buildBlua32Image } from '../../toolchain/ts/rompack/blua32_image_builder';
import { createTestBlua32PairCpu, createTestSystemCpu, writeTestBlua32Rom } from '../helpers/blua32';
import { buildPublicBiosFixture, PUBLIC_BIOS_PROBE_SOURCE } from '../helpers/bios_linkage';
import { materializeCpuCompletionValues, parseLuaChunk } from '../lua/cpu_test_harness';

test('published BIOS slots derive addresses and RAM occupancy from the ROM header', () => {
	const rom = new Uint8Array(0x200);
	writeLE32(rom, 0x20, 0x100);
	writeLE32(rom, 0x110, 0x1230);
	writeLE32(rom, 0x14c, 0x080c0020);
	writeLE32(rom, 0x150, 0x34);
	assert.deepEqual(BIOS_FUNCTION_MODULE_PATHS, ['math/sin', 'string/float/decode', 'gpu/system_vram_region']);
	assert.equal(BiosFunction.TurnPhaseSine, 0);
	assert.equal(BiosFunction.DecodeFloat, 1);
	assert.equal(BiosFunction.SystemVramRegion, 2);
	assert.deepEqual(readBlua32BiosImports(rom), {
		cartridgeStaticRamBase: 0x080c0054,
		functions: [
			{ path: 'math/sin', exportPathKey: '', functionAddress: 0x1230 },
			{ path: 'string/float/decode', exportPathKey: '', functionAddress: 0x1250 },
			{ path: 'gpu/system_vram_region', exportPathKey: '', functionAddress: 0x1270 },
		],
	});
});

for (const optLevel of [0, 3] as const) {
	test(`guest locates all BIOS functions without tooling metadata (O${optLevel})`, () => {
		const fixture = buildPublicBiosFixture(PUBLIC_BIOS_PROBE_SOURCE, optLevel);
		const { cpu } = createTestSystemCpu({ romBytes: fixture.rom });
		assert.equal(cpu.runUntilDepth(0, 100_000), RunResult.Halted);
		assert.deepEqual(materializeCpuCompletionValues(cpu), [true, true]);
	});

	test(`cartridge linker uses the same raw BIOS bytes as guest calls (O${optLevel})`, () => {
		const system = buildPublicBiosFixture(`module<entry>
data firmware_value: word = 11
bss firmware_buffer: word[7]
cop0.exec = mem32le[0x10000028]`, optLevel);
		const imports = readBlua32BiosImports(system.rom);
		assert.deepEqual(imports, system.linked.biosImports);
		const source = `module<entry>
data cartridge_value: word = 17
local sine<const> = require('math/sin')
local decode<const> = require('string/float/decode')
local region<const> = require('gpu/system_vram_region')
local origin<const>, extent<const> = region()
return sine(0x40000000), decode(0x3fa00000, 0, 4), origin, extent, *cartridge_value`;
		const cart = buildBlua32Image({
			domain: 'cart',
			luaModules: [{ path: 'entry', displayPath: 'entry.lua', source, chunk: parseLuaChunk(source, 'entry') }],
			generatedLuaModules: [],
			loadAddress: CART_ROM_BASE + 0x100,
			ramByteCount: PSX_MACHINE_SPEC.ramBytes,
			optLevel,
			traceStatements: 'erase',
			biosImports: imports,
		});
		assert.equal(cart.linked.layout.header.dataAddress,
			system.linked.layout.header.bssAddress + system.linked.layout.header.bssByteCount);
		const { cpu } = createTestBlua32PairCpu({ systemRomBytes: system.rom, cartRomBytes: writeTestBlua32Rom(cart.linked) });
		assert.equal(cpu.runUntilDepth(0, 100_000), RunResult.Halted);
		assert.deepEqual(materializeCpuCompletionValues(cpu), [65536, 1.25, 0x02d002c0, 0x00fc0140, 17]);
	});
}
