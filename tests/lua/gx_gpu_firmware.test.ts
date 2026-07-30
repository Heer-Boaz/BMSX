import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';

import { compileLuaChunkToProgram } from '../../toolchain/ts/lua/compiler';
import { CPU, RunResult } from '../../machine/ts/machine/cpu/cpu';
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
import { materializeCpuCompletionValues, parseLuaChunk } from './cpu_test_harness';
import { createTestSystemCpu, linkTestSystemBlua32 } from '../helpers/blua32';

const MODE_SELECTOR_ADDRESS = 0x08040000;
const ENTRY_SOURCE = `
local gx_gpu<const> = require('cartlib/gx/gpu')
local bios_gpu<const> = require('bios/gx_gpu')
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
	local smode1_low<const>: *word = 0x080103a8
	local display2_low<const>: *word = 0x08010370
	*smode1_low = 0x40200504
	*display2_low = 420 | (40 << 12)
	bios_gpu.prepare_supervisor_320x240(0)
	return 320, 240
end
return gx_gpu.display_size()
`;

const MODULE_FILES = [
	['stdlib/util/round_to_nearest', 'machine/firmware/stdlib/util/round_to_nearest.lua'],
	['cartlib/gx/gpu', 'cartlib/gx/gpu.lua'],
	['bios/gx_gpu', 'machine/firmware/bios/gx_gpu.lua'],
] as const;

const modules = MODULE_FILES.map(([path, file]) => {
	const source = readFileSync(file, 'utf8');
	return { path, chunk: parseLuaChunk(source, `${path}.lua`), source };
});
const compiled = compileLuaChunkToProgram(parseLuaChunk(ENTRY_SOURCE, 'entry.lua'), modules, { entrySource: ENTRY_SOURCE, optLevel: 3 });
const finalized = linkTestSystemBlua32(compiled);
const image = finalized.image;

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
	const { memory, cpu } = createTestSystemCpu(finalized);
	memory.writeMappedU32LE(MODE_SELECTOR_ADDRESS, modeIndex);
	assert.equal(cpu.runUntilDepth(0, 10_000_000), RunResult.Halted);
	return { memory, cpu };
}

test('GX cart SDK programs native PSX widths and PS2 SD interlaced outputs', () => {
	for (let modeIndex = 0; modeIndex < FIRMWARE_MODES.length; modeIndex += 1) {
		const expected = FIRMWARE_MODES[modeIndex]!;
		const { memory, cpu } = runFirmwareMode(modeIndex);
		assert.deepEqual(materializeCpuCompletionValues(cpu), [expected.width, expected.height]);
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

test('BIOS GX code aligns the supervisor circuit to a retained PS2 DTV origin', () => {
	const { memory, cpu } = runFirmwareMode(FIRMWARE_MODES.length);
	assert.deepEqual(materializeCpuCompletionValues(cpu), [320, 240]);
	assert.equal(memory.readMappedU32LE(gxGpuPcrtcRegisterAddress(GX_GPU_PCRTC_DISPLAY1_LOW)), 420 | (40 << 12));
	assert.equal(memory.readMappedU32LE(gxGpuPcrtcRegisterAddress(GX_GPU_PCRTC_DISPLAY1_HIGH)), 319 | (239 << 12));
});
