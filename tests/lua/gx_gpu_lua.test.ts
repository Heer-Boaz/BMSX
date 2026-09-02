import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';

import { compileLuaChunkToProgram } from '../../toolchain/ts/lua/compiler';
import { CPU, RunResult } from '../../machine/ts/machine/cpu/cpu';
import {
	GX_GPU_PCRTC_CONFIG_WORD_COUNT,
	GX_GPU_PCRTC_DISPFB1_HIGH,
	GX_GPU_PCRTC_DISPFB1_LOW,
	GX_GPU_PCRTC_DISPLAY1_LOW,
	GX_GPU_PCRTC_DISPLAY1_HIGH,
	GX_GPU_PCRTC_PMODE_LOW,
	GX_GPU_PCRTC_SMODE1_HIGH,
	GX_GPU_PCRTC_SMODE1_LOW,
	GX_GPU_PCRTC_SMODE2_INT,
	GX_GPU_PCRTC_SMODE2_HIGH,
	GX_GPU_PCRTC_SMODE2_LOW,
	GX_GPU_PCRTC_SYNCH1_HIGH,
	GX_GPU_PCRTC_SYNCH1_LOW,
	GX_GPU_PCRTC_SYNCH2_HIGH,
	GX_GPU_PCRTC_SYNCH2_LOW,
	GX_GPU_PCRTC_SYNCV_HIGH,
	GX_GPU_PCRTC_SYNCV_LOW,
	gxGpuPcrtcRegisterAddress,
} from '../../machine/ts/spec/gx/pcrtc';
import {
	GxGpuPcrtcScanout,
	GxGpuPcrtcTiming,
} from '../../machine/ts/machine/devices/gx/gpu_pcrtc';
import { Memory } from '../../machine/ts/machine/memory/memory';
import { BMSX_ROM_HEADER_BLUA32_STARTUP_FUNCTION_ADDRESS_OFFSET } from '../../machine/ts/spec/bmsx/rom_header';
import { CART_ROM_BASE, RAM_BASE } from '../../machine/ts/spec/bmsx/memory_map';
import { PSX_MACHINE_SPEC } from '../../machine/ts/spec/bmsx/model';
import { gxGpuPair16 } from '../../machine/ts/spec/gx/gp0';
import {
	GX_GPU_DISPLAY_DISPFB_GX16_1024_LAYOUT_WORD,
	GX_GPU_DISPLAY_PMODE_CIRCUIT1_OPAQUE_WORD,
	GX_GPU_DISPLAY_PRESET_256X192_PAL_WORDS,
	GX_GPU_DISPLAY_PRESET_256X212_PAL_WORDS,
	GX_GPU_DISPLAY_PRESET_256X240_PAL_WORDS,
	GX_GPU_DISPLAY_PRESET_320X240_PAL_WORDS,
	GX_GPU_DISPLAY_PRESET_368X240_PAL_WORDS,
	GX_GPU_DISPLAY_PRESET_512X240_PAL_WORDS,
	GX_GPU_DISPLAY_PRESET_640X240_PAL_WORDS,
	GX_GPU_DISPLAY_PRESET_640X448I_NTSC_WORDS,
	GX_GPU_DISPLAY_PRESET_640X480I_NTSC_WORDS,
	GX_GPU_DISPLAY_PRESET_640X512I_PAL_WORDS,
	GX_GPU_DISPLAY_PRESET_HEIGHT_WORD,
	GX_GPU_DISPLAY_PRESET_PCRTC_DISPLAY_HIGH_WORD,
	GX_GPU_DISPLAY_PRESET_PCRTC_DISPLAY_LOW_WORD,
	GX_GPU_DISPLAY_PRESET_PCRTC_SMODE2_LOW_WORD,
	GX_GPU_DISPLAY_PRESET_PCRTC_SYNCV_LOW_WORD,
	GX_GPU_DISPLAY_PRESET_WIDTH_WORD,
	GX_GPU_DISPLAY_TIMING_NTSC_WORDS,
	GX_GPU_DISPLAY_TIMING_PAL_WORDS,
	GX_GPU_DISPLAY_TIMING_SMODE1_HIGH_WORD,
	GX_GPU_DISPLAY_TIMING_SMODE1_RUN_LOW_WORD,
	GX_GPU_DISPLAY_TIMING_SMODE1_SETUP_LOW_WORD,
	GX_GPU_DISPLAY_TIMING_SYNCH1_HIGH_WORD,
	GX_GPU_DISPLAY_TIMING_SYNCH1_LOW_WORD,
	GX_GPU_DISPLAY_TIMING_SYNCH2_HIGH_WORD,
	GX_GPU_DISPLAY_TIMING_SYNCH2_LOW_WORD,
	GX_GPU_DISPLAY_TIMING_SYNCV_HIGH_WORD,
} from '../../machine/ts/spec/gx/display_presets';
import {
	GX_DISPLAY_PRESET_MODULE_PATH,
	GX_DISPLAY_PRESET_SOURCE_PATH,
	GX_REGISTER_MODULE_PATH,
	GX_REGISTER_SOURCE_PATH,
} from '../../toolchain/ts/rompack/generated_modules';
import { GX_DISPLAY_PRESET_MODULE_SOURCE } from '../../toolchain/ts/rompack/gx_display_preset_module';
import { GX_REGISTER_MODULE_SOURCE } from '../../toolchain/ts/rompack/gx_register_module';
import { materializeCpuCompletionValues, parseLuaChunk } from './cpu_test_harness';
import {
	createTestBlua32PairCpu,
	createTestSystemCpu,
	linkTestBlua32Pair,
	linkTestSystemBlua32,
} from '../helpers/blua32';

const MODE_SELECTOR_ADDRESS = 0x08040000;
const PCRTC_SENTINEL_BASE = 0xa5000000;
const SYSTEM_TEXTURE_UPLOAD_ADDRESS = RAM_BASE + PSX_MACHINE_SPEC.ramBytes - 0x100;
const SYSTEM_BOOT_SOURCE = `
math = require('math')
cop0.exec = mem[${CART_ROM_BASE + BMSX_ROM_HEADER_BLUA32_STARTUP_FUNCTION_ADDRESS_OFFSET}]
`;
const CART_ENTRY_SOURCE = `
local gx_display<const> = require('cartlib/gx/display')
local mode_selector<const>: *word = ${MODE_SELECTOR_ADDRESS}
if *mode_selector == 0 then
	gx_display.reset_256x192()
elseif *mode_selector == 1 then
	gx_display.reset_256x212()
elseif *mode_selector == 2 then
	gx_display.reset_256x240()
elseif *mode_selector == 3 then
	gx_display.reset_320x240()
elseif *mode_selector == 4 then
	gx_display.reset_368x240()
elseif *mode_selector == 5 then
	gx_display.reset_512x240()
elseif *mode_selector == 6 then
	gx_display.reset_640x240()
elseif *mode_selector == 7 then
	gx_display.reset_640x480i()
elseif *mode_selector == 8 then
	gx_display.reset_640x448i()
else
	gx_display.reset_640x512i()
end
return gx_display.size()
`;
const BIOS_ENTRY_SOURCE = `
local bios_gpu<const> = require('gpu/gpu')
local system_vram_region<const> = require('gpu/system_vram_region')
local pmode<const>: *word = 0x08010354
local smode1_low<const>: *word = 0x080103ac
local display2_low<const>: *word = 0x08010374
local display2_high<const>: *word = 0x08010378
*pmode = 2
*smode1_low = 0x40200504
*display2_low = 420 | (40 << 12)
*display2_high = 319 | (239 << 12)
local width<const>, height<const> = bios_gpu.prepare_supervisor(0, 320, 240)
bios_gpu.enable_display()
local system_origin<const>, system_size<const> = system_vram_region()
return width, height, system_origin, system_size
`;
const BIOS_RESET_ENTRY_SOURCE = `
local bios_gpu<const> = require('gpu/gpu')
bios_gpu.reset_320x240()
`;
const SYSTEM_MODULE_FILES = [
	['math', 'machine/bios/math.lua'],
	['math/sin', 'machine/bios/math/sin.lua'],
] as const;
const CART_MODULE_FILES = [
	['cartlib/gx/display', 'cartlib/gx/display.lua'],
	['cartlib/gx/gpu', 'cartlib/gx/gpu.lua'],
	['cartlib/gx/gp0', 'cartlib/gx/gp0.lua'],
] as const;
const BIOS_MODULE_FILES = [
	['tty/layout', 'machine/bios/tty/layout.lua'],
	['gpu/gpu', 'machine/bios/gpu/gpu.lua'],
	['gpu/system_vram_region', 'machine/bios/gpu/system_vram_region.lua'],
] as const;

function sourceModules(files: ReadonlyArray<readonly [string, string]>) {
	return files.map(([path, file]) => {
		const source = readFileSync(file, 'utf8');
		return { path, chunk: parseLuaChunk(source, `${path}.lua`), source };
	});
}

const systemModules = sourceModules(SYSTEM_MODULE_FILES);
const gxDisplayPresetModule = {
	path: GX_DISPLAY_PRESET_MODULE_PATH,
	chunk: parseLuaChunk(GX_DISPLAY_PRESET_MODULE_SOURCE, GX_DISPLAY_PRESET_SOURCE_PATH),
	source: GX_DISPLAY_PRESET_MODULE_SOURCE,
};
const gxRegisterModule = {
	path: GX_REGISTER_MODULE_PATH,
	chunk: parseLuaChunk(GX_REGISTER_MODULE_SOURCE, GX_REGISTER_SOURCE_PATH),
	source: GX_REGISTER_MODULE_SOURCE,
};
systemModules.push(gxDisplayPresetModule, gxRegisterModule);
const cartModules = [gxDisplayPresetModule, gxRegisterModule, ...sourceModules(CART_MODULE_FILES)];
const systemAssetsSource = `module<const>
local bin_gx_system_texture_addr<const> = ${SYSTEM_TEXTURE_UPLOAD_ADDRESS}
return {
	bin_gx_system_texture_addr = bin_gx_system_texture_addr,
}`;
const biosModules = [
	gxDisplayPresetModule,
	gxRegisterModule,
	{
		path: 'bmsx/system_assets',
		chunk: parseLuaChunk(systemAssetsSource, 'bmsx/system_assets.lua'),
		source: systemAssetsSource,
	},
	...sourceModules(BIOS_MODULE_FILES),
];
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
const biosResetCompiled = compileLuaChunkToProgram(
	parseLuaChunk(BIOS_RESET_ENTRY_SOURCE, 'bios_reset.lua'),
	biosModules,
	{ entrySource: BIOS_RESET_ENTRY_SOURCE, optLevel: 3, programDomain: 'system' },
);
const biosResetImage = linkTestSystemBlua32(biosResetCompiled);

type OutputMode = {
	preset: readonly [number, number, number, number, number, number, number, number];
	timing: readonly [number, number, number, number, number, number, number, number];
	interlaced: boolean;
	refreshUfpsScaled: number;
};

const OUTPUT_MODES: readonly OutputMode[] = [
	{ preset: GX_GPU_DISPLAY_PRESET_256X192_PAL_WORDS, timing: GX_GPU_DISPLAY_TIMING_PAL_WORDS, interlaced: false, refreshUfpsScaled: 49_761_146 },
	{ preset: GX_GPU_DISPLAY_PRESET_256X212_PAL_WORDS, timing: GX_GPU_DISPLAY_TIMING_PAL_WORDS, interlaced: false, refreshUfpsScaled: 49_761_146 },
	{ preset: GX_GPU_DISPLAY_PRESET_256X240_PAL_WORDS, timing: GX_GPU_DISPLAY_TIMING_PAL_WORDS, interlaced: false, refreshUfpsScaled: 49_761_146 },
	{ preset: GX_GPU_DISPLAY_PRESET_320X240_PAL_WORDS, timing: GX_GPU_DISPLAY_TIMING_PAL_WORDS, interlaced: false, refreshUfpsScaled: 49_761_146 },
	{ preset: GX_GPU_DISPLAY_PRESET_368X240_PAL_WORDS, timing: GX_GPU_DISPLAY_TIMING_PAL_WORDS, interlaced: false, refreshUfpsScaled: 49_761_146 },
	{ preset: GX_GPU_DISPLAY_PRESET_512X240_PAL_WORDS, timing: GX_GPU_DISPLAY_TIMING_PAL_WORDS, interlaced: false, refreshUfpsScaled: 49_761_146 },
	{ preset: GX_GPU_DISPLAY_PRESET_640X240_PAL_WORDS, timing: GX_GPU_DISPLAY_TIMING_PAL_WORDS, interlaced: false, refreshUfpsScaled: 49_761_146 },
	{ preset: GX_GPU_DISPLAY_PRESET_640X480I_NTSC_WORDS, timing: GX_GPU_DISPLAY_TIMING_NTSC_WORDS, interlaced: true, refreshUfpsScaled: 59_940_059 },
	{ preset: GX_GPU_DISPLAY_PRESET_640X448I_NTSC_WORDS, timing: GX_GPU_DISPLAY_TIMING_NTSC_WORDS, interlaced: true, refreshUfpsScaled: 59_940_059 },
	{ preset: GX_GPU_DISPLAY_PRESET_640X512I_PAL_WORDS, timing: GX_GPU_DISPLAY_TIMING_PAL_WORDS, interlaced: true, refreshUfpsScaled: 50_000_000 },
];

function runCartMode(modeIndex: number): { memory: Memory; cpu: CPU; initialWords: Uint32Array } {
	const { memory, cpu } = createTestBlua32PairCpu(gxImages);
	const initialWords = new Uint32Array(GX_GPU_PCRTC_CONFIG_WORD_COUNT);
	for (let wordIndex = 0; wordIndex < initialWords.length; wordIndex += 1) {
		const word = (PCRTC_SENTINEL_BASE | wordIndex) >>> 0;
		initialWords[wordIndex] = word;
		memory.writeMappedU32LE(gxGpuPcrtcRegisterAddress(wordIndex), word);
	}
	memory.writeMappedU32LE(MODE_SELECTOR_ADDRESS, modeIndex);
	assert.equal(cpu.runUntilDepth(0, 10_000_000), RunResult.Halted);
	return { memory, cpu, initialWords };
}

test('GX cart SDK programs every public display preset from the exact raw PCRTC words', () => {
	for (let modeIndex = 0; modeIndex < OUTPUT_MODES.length; modeIndex += 1) {
		const expected = OUTPUT_MODES[modeIndex]!;
		const width = expected.preset[GX_GPU_DISPLAY_PRESET_WIDTH_WORD];
		const height = expected.preset[GX_GPU_DISPLAY_PRESET_HEIGHT_WORD];
		const { memory, cpu, initialWords } = runCartMode(modeIndex);
		assert.deepEqual(materializeCpuCompletionValues(cpu), [width, height]);
		const words = new Uint32Array(GX_GPU_PCRTC_CONFIG_WORD_COUNT);
		for (let wordIndex = 0; wordIndex < words.length; wordIndex += 1) {
			words[wordIndex] = memory.readMappedU32LE(gxGpuPcrtcRegisterAddress(wordIndex));
		}
		const expectedWords = initialWords.slice();
		expectedWords[GX_GPU_PCRTC_PMODE_LOW] = GX_GPU_DISPLAY_PMODE_CIRCUIT1_OPAQUE_WORD;
		expectedWords[GX_GPU_PCRTC_DISPFB1_LOW] = GX_GPU_DISPLAY_DISPFB_GX16_1024_LAYOUT_WORD;
		expectedWords[GX_GPU_PCRTC_DISPFB1_HIGH] = 0;
		expectedWords[GX_GPU_PCRTC_DISPLAY1_LOW] = expected.preset[GX_GPU_DISPLAY_PRESET_PCRTC_DISPLAY_LOW_WORD];
		expectedWords[GX_GPU_PCRTC_DISPLAY1_HIGH] = expected.preset[GX_GPU_DISPLAY_PRESET_PCRTC_DISPLAY_HIGH_WORD];
		expectedWords[GX_GPU_PCRTC_SMODE1_LOW] = expected.timing[GX_GPU_DISPLAY_TIMING_SMODE1_RUN_LOW_WORD];
		expectedWords[GX_GPU_PCRTC_SMODE1_HIGH] = expected.timing[GX_GPU_DISPLAY_TIMING_SMODE1_HIGH_WORD];
		expectedWords[GX_GPU_PCRTC_SMODE2_LOW] = expected.preset[GX_GPU_DISPLAY_PRESET_PCRTC_SMODE2_LOW_WORD];
		expectedWords[GX_GPU_PCRTC_SMODE2_HIGH] = 0;
		expectedWords[GX_GPU_PCRTC_SYNCH1_LOW] = expected.timing[GX_GPU_DISPLAY_TIMING_SYNCH1_LOW_WORD];
		expectedWords[GX_GPU_PCRTC_SYNCH1_HIGH] = expected.timing[GX_GPU_DISPLAY_TIMING_SYNCH1_HIGH_WORD];
		expectedWords[GX_GPU_PCRTC_SYNCH2_LOW] = expected.timing[GX_GPU_DISPLAY_TIMING_SYNCH2_LOW_WORD];
		expectedWords[GX_GPU_PCRTC_SYNCH2_HIGH] = expected.timing[GX_GPU_DISPLAY_TIMING_SYNCH2_HIGH_WORD];
		expectedWords[GX_GPU_PCRTC_SYNCV_LOW] = expected.preset[GX_GPU_DISPLAY_PRESET_PCRTC_SYNCV_LOW_WORD];
		expectedWords[GX_GPU_PCRTC_SYNCV_HIGH] = expected.timing[GX_GPU_DISPLAY_TIMING_SYNCV_HIGH_WORD];
		assert.deepEqual(words, expectedWords);
		const timing = new GxGpuPcrtcTiming();
		const scanout = new GxGpuPcrtcScanout();
		timing.update(words);
		scanout.update(words, timing);
		assert.equal((words[GX_GPU_PCRTC_SMODE2_LOW]! & GX_GPU_PCRTC_SMODE2_INT) !== 0, expected.interlaced);
		assert.equal(timing.refreshUfpsScaled, expected.refreshUfpsScaled);
		assert.equal(timing.fieldToggles, expected.interlaced);
		assert.equal(scanout.outputWidth, width);
		assert.equal(scanout.outputHeight, height);
		assert.equal(scanout.interlaced, expected.interlaced);
	}
});

test('GX cart SDK holds SMODE1 reset until every timing latch is programmed', () => {
	const { memory, cpu } = createTestBlua32PairCpu(gxImages);
	const timingWrites: number[] = [];
	const recordTimingWrite = (writes: number[], address: number, word: number): void => {
		writes.push(address, word);
	};
	for (const wordIndex of [
		GX_GPU_PCRTC_SMODE1_LOW,
		GX_GPU_PCRTC_SMODE1_HIGH,
		GX_GPU_PCRTC_SMODE2_LOW,
		GX_GPU_PCRTC_SMODE2_HIGH,
		GX_GPU_PCRTC_SYNCH1_LOW,
		GX_GPU_PCRTC_SYNCH1_HIGH,
		GX_GPU_PCRTC_SYNCH2_LOW,
		GX_GPU_PCRTC_SYNCH2_HIGH,
		GX_GPU_PCRTC_SYNCV_LOW,
		GX_GPU_PCRTC_SYNCV_HIGH,
	]) {
		memory.mapIoWrite(gxGpuPcrtcRegisterAddress(wordIndex), timingWrites, recordTimingWrite);
	}
	memory.writeMappedU32LE(MODE_SELECTOR_ADDRESS, 3);
	assert.equal(cpu.runUntilDepth(0, 10_000_000), RunResult.Halted);
	assert.deepEqual(timingWrites, [
		gxGpuPcrtcRegisterAddress(GX_GPU_PCRTC_SMODE1_LOW), GX_GPU_DISPLAY_TIMING_PAL_WORDS[GX_GPU_DISPLAY_TIMING_SMODE1_SETUP_LOW_WORD],
		gxGpuPcrtcRegisterAddress(GX_GPU_PCRTC_SMODE1_HIGH), GX_GPU_DISPLAY_TIMING_PAL_WORDS[GX_GPU_DISPLAY_TIMING_SMODE1_HIGH_WORD],
		gxGpuPcrtcRegisterAddress(GX_GPU_PCRTC_SYNCH1_LOW), GX_GPU_DISPLAY_TIMING_PAL_WORDS[GX_GPU_DISPLAY_TIMING_SYNCH1_LOW_WORD],
		gxGpuPcrtcRegisterAddress(GX_GPU_PCRTC_SYNCH1_HIGH), GX_GPU_DISPLAY_TIMING_PAL_WORDS[GX_GPU_DISPLAY_TIMING_SYNCH1_HIGH_WORD],
		gxGpuPcrtcRegisterAddress(GX_GPU_PCRTC_SYNCH2_LOW), GX_GPU_DISPLAY_TIMING_PAL_WORDS[GX_GPU_DISPLAY_TIMING_SYNCH2_LOW_WORD],
		gxGpuPcrtcRegisterAddress(GX_GPU_PCRTC_SYNCH2_HIGH), GX_GPU_DISPLAY_TIMING_PAL_WORDS[GX_GPU_DISPLAY_TIMING_SYNCH2_HIGH_WORD],
		gxGpuPcrtcRegisterAddress(GX_GPU_PCRTC_SYNCV_HIGH), GX_GPU_DISPLAY_TIMING_PAL_WORDS[GX_GPU_DISPLAY_TIMING_SYNCV_HIGH_WORD],
		gxGpuPcrtcRegisterAddress(GX_GPU_PCRTC_SYNCV_LOW), GX_GPU_DISPLAY_PRESET_320X240_PAL_WORDS[GX_GPU_DISPLAY_PRESET_PCRTC_SYNCV_LOW_WORD],
		gxGpuPcrtcRegisterAddress(GX_GPU_PCRTC_SMODE2_LOW), GX_GPU_DISPLAY_PRESET_320X240_PAL_WORDS[GX_GPU_DISPLAY_PRESET_PCRTC_SMODE2_LOW_WORD],
		gxGpuPcrtcRegisterAddress(GX_GPU_PCRTC_SMODE2_HIGH), 0,
		gxGpuPcrtcRegisterAddress(GX_GPU_PCRTC_SMODE1_LOW), GX_GPU_DISPLAY_TIMING_PAL_WORDS[GX_GPU_DISPLAY_TIMING_SMODE1_RUN_LOW_WORD],
	]);
});

test('BIOS GX reset programs the same 320x240 raw preset without touching circuit 2', () => {
	const { memory, cpu } = createTestSystemCpu(biosResetImage);
	const initialWords = new Uint32Array(GX_GPU_PCRTC_CONFIG_WORD_COUNT);
	for (let wordIndex = 0; wordIndex < initialWords.length; wordIndex += 1) {
		const word = (PCRTC_SENTINEL_BASE | wordIndex) >>> 0;
		initialWords[wordIndex] = word;
		memory.writeMappedU32LE(gxGpuPcrtcRegisterAddress(wordIndex), word);
	}
	assert.equal(cpu.runUntilDepth(0, 10_000_000), RunResult.Halted);
	const words = new Uint32Array(GX_GPU_PCRTC_CONFIG_WORD_COUNT);
	for (let wordIndex = 0; wordIndex < words.length; wordIndex += 1) {
		words[wordIndex] = memory.readMappedU32LE(gxGpuPcrtcRegisterAddress(wordIndex));
	}
	const expectedWords = initialWords.slice();
	expectedWords[GX_GPU_PCRTC_PMODE_LOW] = GX_GPU_DISPLAY_PMODE_CIRCUIT1_OPAQUE_WORD;
	expectedWords[GX_GPU_PCRTC_DISPFB1_LOW] = GX_GPU_DISPLAY_DISPFB_GX16_1024_LAYOUT_WORD;
	expectedWords[GX_GPU_PCRTC_DISPFB1_HIGH] = 0;
	expectedWords[GX_GPU_PCRTC_DISPLAY1_LOW] = GX_GPU_DISPLAY_PRESET_320X240_PAL_WORDS[GX_GPU_DISPLAY_PRESET_PCRTC_DISPLAY_LOW_WORD];
	expectedWords[GX_GPU_PCRTC_DISPLAY1_HIGH] = GX_GPU_DISPLAY_PRESET_320X240_PAL_WORDS[GX_GPU_DISPLAY_PRESET_PCRTC_DISPLAY_HIGH_WORD];
	expectedWords[GX_GPU_PCRTC_SMODE1_LOW] = GX_GPU_DISPLAY_TIMING_PAL_WORDS[GX_GPU_DISPLAY_TIMING_SMODE1_RUN_LOW_WORD];
	expectedWords[GX_GPU_PCRTC_SMODE1_HIGH] = GX_GPU_DISPLAY_TIMING_PAL_WORDS[GX_GPU_DISPLAY_TIMING_SMODE1_HIGH_WORD];
	expectedWords[GX_GPU_PCRTC_SMODE2_LOW] = GX_GPU_DISPLAY_PRESET_320X240_PAL_WORDS[GX_GPU_DISPLAY_PRESET_PCRTC_SMODE2_LOW_WORD];
	expectedWords[GX_GPU_PCRTC_SMODE2_HIGH] = 0;
	expectedWords[GX_GPU_PCRTC_SYNCH1_LOW] = GX_GPU_DISPLAY_TIMING_PAL_WORDS[GX_GPU_DISPLAY_TIMING_SYNCH1_LOW_WORD];
	expectedWords[GX_GPU_PCRTC_SYNCH1_HIGH] = GX_GPU_DISPLAY_TIMING_PAL_WORDS[GX_GPU_DISPLAY_TIMING_SYNCH1_HIGH_WORD];
	expectedWords[GX_GPU_PCRTC_SYNCH2_LOW] = GX_GPU_DISPLAY_TIMING_PAL_WORDS[GX_GPU_DISPLAY_TIMING_SYNCH2_LOW_WORD];
	expectedWords[GX_GPU_PCRTC_SYNCH2_HIGH] = GX_GPU_DISPLAY_TIMING_PAL_WORDS[GX_GPU_DISPLAY_TIMING_SYNCH2_HIGH_WORD];
	expectedWords[GX_GPU_PCRTC_SYNCV_LOW] = GX_GPU_DISPLAY_PRESET_320X240_PAL_WORDS[GX_GPU_DISPLAY_PRESET_PCRTC_SYNCV_LOW_WORD];
	expectedWords[GX_GPU_PCRTC_SYNCV_HIGH] = GX_GPU_DISPLAY_TIMING_PAL_WORDS[GX_GPU_DISPLAY_TIMING_SYNCV_HIGH_WORD];
	assert.deepEqual(words, expectedWords);
});

test('BIOS GX code aligns the source-alpha supervisor circuit to a retained PS2 DTV origin', () => {
	const { memory, cpu } = createTestSystemCpu(biosImage);
	memory.writeMappedU32LE(SYSTEM_TEXTURE_UPLOAD_ADDRESS + 4, gxGpuPair16(768, 960));
	memory.writeMappedU32LE(SYSTEM_TEXTURE_UPLOAD_ADDRESS + 8, gxGpuPair16(256, 64));
	assert.equal(cpu.runUntilDepth(0, 10_000_000), RunResult.Halted);
	assert.deepEqual(materializeCpuCompletionValues(cpu), [
		320,
		240,
		gxGpuPair16(704, 720),
		gxGpuPair16(320, 304),
	]);
	assert.equal(memory.readMappedU32LE(gxGpuPcrtcRegisterAddress(GX_GPU_PCRTC_PMODE_LOW)), 0x00000003);
	assert.equal(memory.readMappedU32LE(gxGpuPcrtcRegisterAddress(GX_GPU_PCRTC_DISPLAY1_LOW)), 420 | (40 << 12));
	assert.equal(memory.readMappedU32LE(gxGpuPcrtcRegisterAddress(GX_GPU_PCRTC_DISPLAY1_HIGH)), 319 | (239 << 12));
});
