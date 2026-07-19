import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';

import { compileLuaChunkToProgram, encodeCompiledProgramImage } from '../../machine/ts/lua/compiler';
import { CPU, RunResult } from '../../machine/ts/machine/cpu/cpu';
import { IrqController } from '../../machine/ts/machine/devices/irq/controller';
import {
	GX_GPU_PCRTC_CONFIG_WORD_COUNT,
	GX_GPU_PCRTC_DISPLAY1_LOW,
	GX_GPU_PCRTC_DISPLAY1_HIGH,
	GX_GPU_PCRTC_SMODE2_INT,
	GX_GPU_PCRTC_SMODE2_LOW,
	GxGpuPcrtcScanout,
	GxGpuPcrtcTiming,
	gxGpuPcrtcRegisterAddress,
} from '../../machine/ts/machine/devices/gx/gpu_pcrtc';
import { Memory } from '../../machine/ts/machine/memory/memory';
import { inflateExecutableProgramImage } from '../../machine/ts/machine/program/linker';
import { parseLuaChunk } from './cpu_test_harness';

const MODE_SELECTOR_ADDRESS = 0x08040000;
const ENTRY_SOURCE = `
local gx_gpu<const> = require('system/gx_gpu')
local mode_selector<const>: *word = ${MODE_SELECTOR_ADDRESS}
if *mode_selector == 0 then
	gx_gpu.reset_256x240()
elseif *mode_selector == 1 then
	gx_gpu.reset_320x240()
elseif *mode_selector == 2 then
	gx_gpu.reset_368x240()
elseif *mode_selector == 3 then
	gx_gpu.reset_512x240()
elseif *mode_selector == 4 then
	gx_gpu.reset_640x240()
elseif *mode_selector == 5 then
	gx_gpu.reset_640x480i()
elseif *mode_selector == 6 then
	gx_gpu.reset_640x448i()
elseif *mode_selector == 7 then
	gx_gpu.reset_640x512i()
else
	local smode1_low<const>: *word = 0x080103b0
	local display2_low<const>: *word = 0x08010378
	*smode1_low = 0x40200504
	*display2_low = 420 | (40 << 12)
	gx_gpu.prepare_supervisor_256x192(0)
end
return gx_gpu.display_size()
`;

const MODULE_FILES = [
	['bios/common/numeric', 'machine/firmware/bios/common/numeric.lua'],
	['bios/util/sincos_turn32', 'machine/firmware/bios/util/sincos_turn32.lua'],
	['bios/math', 'machine/firmware/bios/math.lua'],
	['bios/util/round_to_nearest', 'machine/firmware/bios/util/round_to_nearest.lua'],
	['system/gx_gpu', 'machine/firmware/system/gx_gpu.lua'],
] as const;

const modules = MODULE_FILES.map(([path, file]) => {
	const source = readFileSync(file, 'utf8');
	return { path, chunk: parseLuaChunk(source, `${path}.lua`), source };
});
const compiled = compileLuaChunkToProgram(parseLuaChunk(ENTRY_SOURCE, 'entry.lua'), modules, { entrySource: ENTRY_SOURCE, optLevel: 3 });
const image = encodeCompiledProgramImage(compiled);

type FirmwareMode = {
	width: number;
	height: number;
	interlaced: boolean;
	refreshUfpsScaled: number;
};

const FIRMWARE_MODES: readonly FirmwareMode[] = [
	{ width: 256, height: 240, interlaced: false, refreshUfpsScaled: 49_761_146 },
	{ width: 320, height: 240, interlaced: false, refreshUfpsScaled: 49_761_146 },
	{ width: 368, height: 240, interlaced: false, refreshUfpsScaled: 49_761_146 },
	{ width: 512, height: 240, interlaced: false, refreshUfpsScaled: 49_761_146 },
	{ width: 640, height: 240, interlaced: false, refreshUfpsScaled: 49_761_146 },
	{ width: 640, height: 480, interlaced: true, refreshUfpsScaled: 59_940_059 },
	{ width: 640, height: 448, interlaced: true, refreshUfpsScaled: 59_940_059 },
	{ width: 640, height: 512, interlaced: true, refreshUfpsScaled: 50_000_000 },
];

function runFirmwareMode(modeIndex: number): { memory: Memory; cpu: CPU } {
	const memory = new Memory({ systemRom: new Uint8Array(0), cartRom: new Uint8Array(0) });
	const cpu = new CPU(memory, new IrqController(memory));
	cpu.setProgram(inflateExecutableProgramImage(image), image.link.symbols, compiled.metadata, 0, 0, 0);
	cpu.start(image.vectors.sectionInitProtoIndex);
	assert.equal(cpu.runUntilDepth(0, 10_000_000), RunResult.Halted);
	for (const path of compiled.staticModulePaths) {
		const targetDepth = cpu.getFrameDepth();
		cpu.call(cpu.rootClosure(compiled.moduleProtoMap.get(path)!));
		assert.equal(cpu.runUntilDepth(targetDepth, 10_000_000), RunResult.Halted);
	}
	cpu.syncGlobalSlotsToTable();
	memory.writeMappedU32LE(MODE_SELECTOR_ADDRESS, modeIndex);
	cpu.start(image.vectors.resetProtoIndex);
	assert.equal(cpu.runUntilDepth(0, 10_000_000), RunResult.Halted);
	return { memory, cpu };
}

test('GX firmware programs native PSX widths and PS2 SD interlaced outputs', () => {
	for (let modeIndex = 0; modeIndex < FIRMWARE_MODES.length; modeIndex += 1) {
		const expected = FIRMWARE_MODES[modeIndex]!;
		const { memory, cpu } = runFirmwareMode(modeIndex);
		assert.deepEqual(Array.from(cpu.lastReturnValues), [expected.width, expected.height]);
		const words = new Uint32Array(GX_GPU_PCRTC_CONFIG_WORD_COUNT);
		for (let wordIndex = 0; wordIndex < words.length; wordIndex += 1) {
			words[wordIndex] = memory.readMappedU32LE(gxGpuPcrtcRegisterAddress(wordIndex));
		}
		const timing = new GxGpuPcrtcTiming();
		const scanout = new GxGpuPcrtcScanout();
		timing.update(words);
		scanout.update(words, timing);
		assert.equal(words[GX_GPU_PCRTC_DISPLAY1_HIGH], ((expected.width << 2) - 1) | ((expected.height - 1) << 12));
		assert.equal((words[GX_GPU_PCRTC_SMODE2_LOW]! & GX_GPU_PCRTC_SMODE2_INT) !== 0, expected.interlaced);
		assert.equal(timing.refreshUfpsScaled, expected.refreshUfpsScaled);
		assert.equal(timing.fieldToggles, expected.interlaced);
		assert.equal(scanout.outputWidth, expected.width);
		assert.equal(scanout.outputHeight, expected.height);
		assert.equal(scanout.interlaced, expected.interlaced);
	}
});

test('GX firmware aligns the supervisor circuit to a retained PS2 DTV origin', () => {
	const { memory, cpu } = runFirmwareMode(FIRMWARE_MODES.length);
	assert.deepEqual(Array.from(cpu.lastReturnValues), [256, 192]);
	assert.equal(memory.readMappedU32LE(gxGpuPcrtcRegisterAddress(GX_GPU_PCRTC_DISPLAY1_LOW)), 420 | (40 << 12));
	assert.equal(memory.readMappedU32LE(gxGpuPcrtcRegisterAddress(GX_GPU_PCRTC_DISPLAY1_HIGH)), 255 | (191 << 12));
});
