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
import { BMSX_ROM_HEADER_BLUA32_STARTUP_FUNCTION_ADDRESS_OFFSET } from '../../machine/ts/spec/bmsx/rom_header';
import { CART_ROM_BASE } from '../../machine/ts/spec/bmsx/memory_map';
import { materializeCpuCompletionValues, parseLuaChunk } from './cpu_test_harness';
import {
	createTestBlua32PairCpu,
	createTestSystemCpu,
	linkTestBlua32Pair,
	linkTestSystemBlua32,
} from '../helpers/blua32';

const MODE_SELECTOR_ADDRESS = 0x08040000;
const SYSTEM_BOOT_SOURCE = `
math = require('lua/math')
cop0.exec = mem[${CART_ROM_BASE + BMSX_ROM_HEADER_BLUA32_STARTUP_FUNCTION_ADDRESS_OFFSET}]
`;
const CART_ENTRY_SOURCE = `
local gx_gpu<const> = require('cartlib/gx/gpu')
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
else
	gx_gpu.reset_640x512i()
end
return gx_gpu.display_size()
`;
const BIOS_ENTRY_SOURCE = `
local bios_gpu<const> = require('gpu/gpu')
local smode1_low<const>: *word = 0x080103a8
local display2_low<const>: *word = 0x08010370
*smode1_low = 0x40200504
*display2_low = 420 | (40 << 12)
bios_gpu.prepare_supervisor_320x240(0)
return 320, 240
`;
const SYSTEM_MODULE_FILES = [
	['lua/math', 'bios/lua/math.lua'],
	['lua/math/sincos', 'bios/lua/math/sincos.lua'],
] as const;
const CART_MODULE_FILES = [
	['cartlib/gx/gpu', 'cartlib/gx/gpu.lua'],
] as const;
const BIOS_MODULE_FILES = [
	['gpu/gpu', 'bios/gpu/gpu.lua'],
] as const;

function sourceModules(files: ReadonlyArray<readonly [string, string]>) {
	return files.map(([path, file]) => {
		const source = readFileSync(file, 'utf8');
		return { path, chunk: parseLuaChunk(source, `${path}.lua`), source };
	});
}

const systemModules = sourceModules(SYSTEM_MODULE_FILES);
const cartModules = sourceModules(CART_MODULE_FILES);
const biosModules = sourceModules(BIOS_MODULE_FILES);
const systemCompiled = compileLuaChunkToProgram(
	parseLuaChunk(SYSTEM_BOOT_SOURCE, 'boot.lua'),
	systemModules,
	{ entrySource: SYSTEM_BOOT_SOURCE, optLevel: 3, programDomain: 'system' },
);
const cartCompiled = compileLuaChunkToProgram(
	parseLuaChunk(CART_ENTRY_SOURCE, 'cart.lua'),
	cartModules,
	{ entrySource: CART_ENTRY_SOURCE, optLevel: 3, programDomain: 'cart' },
);
const gxImages = linkTestBlua32Pair(systemCompiled, cartCompiled);
const biosCompiled = compileLuaChunkToProgram(
	parseLuaChunk(BIOS_ENTRY_SOURCE, 'bios.lua'),
	biosModules,
	{ entrySource: BIOS_ENTRY_SOURCE, optLevel: 3, programDomain: 'system' },
);
const biosImage = linkTestSystemBlua32(biosCompiled);

type OutputMode = {
	width: number;
	height: number;
	interlaced: boolean;
	refreshUfpsScaled: number;
};

const OUTPUT_MODES: readonly OutputMode[] = [
	{ width: 256, height: 240, interlaced: false, refreshUfpsScaled: 49_761_146 },
	{ width: 320, height: 240, interlaced: false, refreshUfpsScaled: 49_761_146 },
	{ width: 368, height: 240, interlaced: false, refreshUfpsScaled: 49_761_146 },
	{ width: 512, height: 240, interlaced: false, refreshUfpsScaled: 49_761_146 },
	{ width: 640, height: 240, interlaced: false, refreshUfpsScaled: 49_761_146 },
	{ width: 640, height: 480, interlaced: true, refreshUfpsScaled: 59_940_059 },
	{ width: 640, height: 448, interlaced: true, refreshUfpsScaled: 59_940_059 },
	{ width: 640, height: 512, interlaced: true, refreshUfpsScaled: 50_000_000 },
];

function runCartMode(modeIndex: number): { memory: Memory; cpu: CPU } {
	const { memory, cpu } = createTestBlua32PairCpu(gxImages);
	memory.writeMappedU32LE(MODE_SELECTOR_ADDRESS, modeIndex);
	assert.equal(cpu.runUntilDepth(0, 10_000_000), RunResult.Halted);
	return { memory, cpu };
}

test('GX cart SDK programs native PSX widths and PS2 SD interlaced outputs', () => {
	for (let modeIndex = 0; modeIndex < OUTPUT_MODES.length; modeIndex += 1) {
		const expected = OUTPUT_MODES[modeIndex]!;
		const { memory, cpu } = runCartMode(modeIndex);
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
	const { memory, cpu } = createTestSystemCpu(biosImage);
	assert.equal(cpu.runUntilDepth(0, 10_000_000), RunResult.Halted);
	assert.deepEqual(materializeCpuCompletionValues(cpu), [320, 240]);
	assert.equal(memory.readMappedU32LE(gxGpuPcrtcRegisterAddress(GX_GPU_PCRTC_DISPLAY1_LOW)), 420 | (40 << 12));
	assert.equal(memory.readMappedU32LE(gxGpuPcrtcRegisterAddress(GX_GPU_PCRTC_DISPLAY1_HIGH)), 319 | (239 << 12));
});
