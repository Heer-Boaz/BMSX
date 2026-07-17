import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';

import { compileLuaChunkToProgram, encodeCompiledProgramImage } from '../../machine/ts/lua/compiler';
import { CPU, RunResult } from '../../machine/ts/machine/cpu/cpu';
import { IrqController } from '../../machine/ts/machine/devices/irq/controller';
import { Memory } from '../../machine/ts/machine/memory/memory';
import { inflateExecutableProgramImage } from '../../machine/ts/machine/program/linker';
import { parseLuaChunk } from './cpu_test_harness';

const MODULE_FILES = [
	['bios/common/numeric', 'machine/firmware/bios/common/numeric.lua'],
	['bios/common/endian', 'machine/firmware/bios/common/endian.lua'],
	['bios/util/sincos_turn32', 'machine/firmware/bios/util/sincos_turn32.lua'],
	['bios/math', 'machine/firmware/bios/math.lua'],
	['system/dma', 'machine/firmware/system/dma.lua'],
	['system/apu', 'machine/firmware/system/apu.lua'],
	['cartlib/aem_biquad', 'cartlib/aem_biquad.lua'],
] as const;

test('AEM biquad design emits the exact packed Q14 APU register words', () => {
	const entrySource = `
local biquad<const> = require('cartlib/aem_biquad')
local numeric<const> = require('bios/common/numeric')
local control<const>, b0_b1<const>, b2_a1<const>, a2<const> = biquad.design({
	type = 'lowpass',
	frequency = 1000,
	q = 0.707,
	gain = 0,
})
return control, b0_b1, b2_a1, a2, numeric.encode_signed_q14(-3), numeric.encode_signed_q14(3)
`;
	const modules = MODULE_FILES.map(([path, file]) => {
		const source = readFileSync(file, 'utf8');
		return { path, chunk: parseLuaChunk(source, `${path}.lua`), source };
	});
	const compiled = compileLuaChunkToProgram(parseLuaChunk(entrySource, 'entry.lua'), modules, { entrySource, optLevel: 3 });
	const image = encodeCompiledProgramImage(compiled);
	const memory = new Memory({ systemRom: new Uint8Array(0), cartRom: new Uint8Array(0) });
	const cpu = new CPU(memory, new IrqController(memory));
	cpu.setProgram(inflateExecutableProgramImage(image), image.link.symbols, compiled.metadata, 0, 0, 0);
	cpu.start(image.vectors.sectionInitProtoIndex);
	assert.equal(cpu.runUntilDepth(0, 100000), RunResult.Halted);
	for (const path of compiled.staticModulePaths) {
		const targetDepth = cpu.getFrameDepth();
		cpu.call(cpu.rootClosure(compiled.moduleProtoMap.get(path)!));
		assert.equal(cpu.runUntilDepth(targetDepth, 100000), RunResult.Halted);
	}
	cpu.syncGlobalSlotsToTable();
	cpu.start(image.vectors.resetProtoIndex);
	assert.equal(cpu.runUntilDepth(0, 100000), RunResult.Halted);
	assert.deepEqual(Array.from(cpu.lastReturnValues, value => (value as number) >>> 0), [
		0x00000001,
		0x0097004c,
		0x8cdc004c,
		0x00003452,
		0x00008000,
		0x00007fff,
	]);
});
