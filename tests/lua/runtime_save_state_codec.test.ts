import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
	APU_COMMAND_FIFO_CAPACITY,
	APU_COMMAND_FIFO_REGISTER_WORD_COUNT,
	APU_PARAMETER_REGISTER_COUNT,
	APU_RATE_STEP_Q16_ONE,
	APU_PARAMETER_SLOT_INDEX,
	APU_PARAMETER_SOURCE_ADDR_INDEX,
	APU_SLOT_COUNT,
	APU_SLOT_PHASE_FADING,
	APU_SLOT_PHASE_IDLE,
	APU_SLOT_PHASE_PLAYING,
	APU_SLOT_REGISTER_WORD_COUNT,
	apuSlotRegisterWordIndex,
} from '../../machine/ts/machine/devices/audio/contracts';
import { GEOMETRY_CONTROLLER_PHASE_BUSY, GEOMETRY_CONTROLLER_REGISTER_COUNT } from '../../machine/ts/machine/devices/geometry/contracts';
import { GX_GPU_READBACK_READY, GX_GPU_READBACK_SUBMITTED, GX_GPU_VRAM_BYTE_COUNT } from '../../machine/ts/machine/devices/gx/gpu_command_buffer';
import {
	GX_CHARACTER_PLANE_CELL_BYTES,
	GX_CHARACTER_PLANE_GLYPH_BYTES,
	GX_CHARACTER_PLANE_PALETTE_BYTES,
} from '../../machine/ts/machine/devices/gx/character_plane';
import { GX_GTE_CONTROL_REGISTER_COUNT, GX_GTE_DATA_REGISTER_COUNT } from '../../machine/ts/machine/devices/gx/gte';
import { INPUT_CONTROLLER_KEY_WORD_COUNT, INPUT_CONTROLLER_PAD_AXIS_COUNT, INPUT_CONTROLLER_PAD_COUNT } from '../../machine/ts/machine/devices/input/contracts';
import { PSX_GPU_DISPLAY_MODE_PAL_WORD } from '../../machine/ts/machine/model_registry';

import type { RuntimeSaveState } from '../../machine/ts/machine/runtime/save_state';
import { RUNTIME_SAVE_STATE_WIRE_CAPACITY, decodeRuntimeSaveState, encodeRuntimeSaveState } from '../../machine/ts/machine/runtime/save_state/codec';
import { decodeBinaryWithPropTable } from '../../machine/ts/common/serializer/binencoder';
import { RUNTIME_SAVE_STATE_PROP_NAMES } from '../../machine/ts/machine/runtime/save_state/schema';
import { BuiltinFunctionId } from '../../machine/ts/machine/cpu/cpu';
import { CPU_STATUS_CART_ENTRY } from '../../machine/ts/machine/cpu/cop0';
import { DMA_STATUS_BUSY } from '../../machine/ts/machine/bus/io';
import { RAM_BASE, RAM_END } from '../../machine/ts/machine/memory/map';

const codecTestGxVram = new Uint8Array(GX_GPU_VRAM_BYTE_COUNT);
codecTestGxVram[0] = 0x34;
codecTestGxVram[1] = 0x12;
codecTestGxVram[1024] = 0xcd;
codecTestGxVram[1025] = 0xab;
const codecTestGxCharacterPalette = new Uint8Array(GX_CHARACTER_PLANE_PALETTE_BYTES);
const codecTestGxCharacterGlyphs = new Uint8Array(GX_CHARACTER_PLANE_GLYPH_BYTES);
const codecTestGxCharacterCells = new Uint8Array(GX_CHARACTER_PLANE_CELL_BYTES);
codecTestGxCharacterPalette[7] = 0x80;
codecTestGxCharacterGlyphs[260] = 0x5a;
codecTestGxCharacterCells[1284] = 0xa5;

function numberedWords(count: number): number[] {
	const words = new Array<number>(count);
	for (let index = 0; index < count; index += 1) {
		words[index] = index + 1;
	}
	return words;
}

function createRuntimeSaveState(): RuntimeSaveState {
	const ram = new Uint8Array(RAM_END - RAM_BASE);
	ram.set([1, 2, 3, 4]);
	const audioRegisterWords = numberedWords(APU_PARAMETER_REGISTER_COUNT);
	audioRegisterWords[APU_PARAMETER_SLOT_INDEX] = 1;
	const audioSlotRegisterWords = new Array<number>(APU_SLOT_REGISTER_WORD_COUNT).fill(0);
	audioSlotRegisterWords[apuSlotRegisterWordIndex(0, APU_PARAMETER_SOURCE_ADDR_INDEX)] = 0x1000;
	audioSlotRegisterWords[apuSlotRegisterWordIndex(1, APU_PARAMETER_SOURCE_ADDR_INDEX)] = 0x2000;
	audioSlotRegisterWords[apuSlotRegisterWordIndex(2, APU_PARAMETER_SOURCE_ADDR_INDEX)] = 0x3000;
	const audioSlotSourceBytes = Array.from({ length: APU_SLOT_COUNT }, (_, slot) => new Uint8Array(slot === 1 ? [9, 8, 7, 6] : []));
	return {
		machineState: {
			psxGpuDisplayModeWord: PSX_GPU_DISPLAY_MODE_PAL_WORD,
			machine: {
				memory: {
					ram,
					busFaultCode: 2,
					busFaultAddr: 0x12345678,
					busFaultAccess: 0x400,
				},
				dma: {
					readAddressWord: 0x01002010,
					writeAddressWord: 0x08010240,
					transferCountWord: 5,
					controlWord: 5,
					statusWord: DMA_STATUS_BUSY,
					timingCarry: 12345,
					scheduledGrantWords: 5,
					scheduledGrantCycles: 17,
				},
				geometry: {
					phase: GEOMETRY_CONTROLLER_PHASE_BUSY,
					registerWords: numberedWords(GEOMETRY_CONTROLLER_REGISTER_COUNT),
					activeJob: {
						cmd: 1,
						src0: 0x1000,
						src1: 0x2000,
						src2: 0x3000,
						dst0: 0x4000,
						dst1: 0x5000,
						count: 6,
						param0: 7,
						param1: 8,
						stride0: 9,
						stride1: 10,
						stride2: 11,
						processed: 2,
						resultCount: 3,
						exactPairCount: 4,
						broadphasePairCount: 5,
					},
					workCarry: 12,
					availableWorkUnits: 1,
				},
				gxGpu: {
					gp0Word: 0x12345678,
					gp1Word: 0x08000008,
					displayModeWord: PSX_GPU_DISPLAY_MODE_PAL_WORD,
					statusWord: 0x1c100000,
					gp0CommandWordCount: 2,
					gp0CommandTargetWordCount: 4,
					gp0CommandWords: [0x200000ff, 0x00010002],
					gp0FifoWordCount: 2,
					gp0FifoWords: [0xe1000123, 0xe6000003],
					pendingCommandCycles: 17,
					pendingCommandTargetCount: 2,
					gp0ImageLoadWordsRemaining: 3,
					gp0ImageLoadCommandWordStart: 4,
					gp0ImageLoadCommandWordCount: 5,
					gp0ImageLoadCommandOpcode: 0xa0,
					gp0PolylineWordsPerVertex: 2,
					gp0PolylinePayloadPhase: 1,
					gp0PolylineCommandWordStart: 5,
					gp0PolylineCommandWordCount: 6,
					gp0PolylineCommandOpcode: 0x58,
					gpuReadWord: 0x00000400,
					drawModeWord: 0x00000183,
					textureWindowWord: 0x00000f0f,
					drawingAreaTopLeftWord: 0x00000402,
					drawingAreaBottomRightWord: 0x000140a0,
					drawingOffsetWord: 0x00100020,
					maskBitModeWord: 0x00000003,
					displayStartWord: 0x00011844,
					horizontalDisplayRangeWord: 0x00c60260,
					verticalDisplayRangeWord: 0x0003fc10,
					textureDisableAllowedWord: 1,
					scanoutInterlacedField: 1,
					scanoutInterlacedDisplayField: 1,
					scanoutActiveLineLsb: 0,
					presentStatusWord: 0x1c100001,
					presentDisplayModeWord: PSX_GPU_DISPLAY_MODE_PAL_WORD,
					presentDisplayStartWord: 0x00011844,
					presentHorizontalDisplayRangeWord: 0x00c60260,
					presentVerticalDisplayRangeWord: 0x0003fc10,
					commandBuffer: {
						commandCount: 2,
						executedCommandCount: 1,
						presentCommandCount: 1,
						wordCount: 7,
						commandKind: [1, 5],
						commandOpcode: [0x20, 0x02],
						commandWordStart: [0, 4],
						commandWordCount: [4, 3],
						commandDrawModeWord: [0x0183, 0x0183],
						commandTextureWindowWord: [0x0f0f, 0x0f0f],
						commandDrawingAreaTopLeftWord: [0, 0],
						commandDrawingAreaBottomRightWord: [0x00ef013f, 0x00ef013f],
						commandDrawingOffsetWord: [0, 0],
						commandMaskBitModeWord: [0, 0],
						commandInterlacedRenderWord: [0, 1],
						words: [0x200000ff, 0, 1, 2, 0x0200001f, 0, 0x00100010],
						readbackPhase: 0,
						readbackFenceCommandCount: 0,
						readbackX: 0,
						readbackY: 0,
						readbackWidth: 0,
						readbackHeight: 0,
						readbackPixelCursor: 0,
						readbackPixelBytes: new Uint8Array(),
					},
					characterPlane: {
						controlWord: 0x80000001,
						paletteAddressWord: 7,
						glyphAddressWord: 65,
						cellAddressWord: 321,
						paletteBytes: codecTestGxCharacterPalette,
						glyphBytes: codecTestGxCharacterGlyphs,
						cellBytes: codecTestGxCharacterCells,
					},
					vramBytes: codecTestGxVram,
				},
				gxGte: {
					dataRegisterWords: numberedWords(GX_GTE_DATA_REGISTER_COUNT),
					controlRegisterWords: numberedWords(GX_GTE_CONTROL_REGISTER_COUNT),
					mac0: 1,
					mac1: -2,
					mac2: 3,
					mac3: -4,
					currentSf: 1,
					lastCycles: 8,
				},
				irq: { mask: 0x00ff, pendingFlags: 0xa5a5 },
				audio: {
					registerWords: audioRegisterWords,
					commandFifo: {
						commands: numberedWords(APU_COMMAND_FIFO_CAPACITY),
						registerWords: numberedWords(APU_COMMAND_FIFO_REGISTER_WORD_COUNT),
						readIndex: 1,
						writeIndex: 2,
						count: 3,
					},
					eventSequence: 3,
					eventKind: 1,
					eventSlot: 2,
					eventSourceAddr: 0x2000,
					slotPhases: Array.from({ length: APU_SLOT_COUNT }, (_, slot) => slot === 1 ? APU_SLOT_PHASE_FADING : (slot === 2 ? APU_SLOT_PHASE_PLAYING : APU_SLOT_PHASE_IDLE)),
					slotRegisterWords: audioSlotRegisterWords,
					slotSourceBytes: audioSlotSourceBytes,
					slotPlaybackCursorQ16: Array.from({ length: APU_SLOT_COUNT }, (_, slot) => slot === 1 ? 2 * APU_RATE_STEP_Q16_ONE : 0),
					slotFadeSamplesRemaining: Array.from({ length: APU_SLOT_COUNT }, (_, slot) => slot === 1 ? 7 : 0),
					slotFadeSamplesTotal: Array.from({ length: APU_SLOT_COUNT }, (_, slot) => slot === 1 ? 11 : 0),
					output: {
						voices: [
							{
								slot: 1,
								position: 2.5,
								step: 1,
								gain: 0.75,
								targetGain: 0.5,
								gainRampRemaining: 0.25,
								stopAfter: 0.125,
								filterSampleRate: 44100,
								filter: {
									enabled: true,
									b0: 0.1,
									b1: 0.2,
									b2: 0.3,
									a1: -0.4,
									a2: 0.5,
									l1: 0.6,
									l2: 0.7,
									r1: 0.8,
									r2: 0.9,
								},
								badp: {
									predictors: [11, -12],
									stepIndices: [3, 4],
									nextFrame: 5,
									blockEnd: 6,
									blockFrames: 7,
									blockFrameIndex: 8,
									payloadOffset: 9,
									nibbleCursor: 10,
									decodedFrame: 11,
									decodedLeft: -12,
									decodedRight: 13,
								},
							},
						],
					},
					sampleCarry: 8,
					availableSamples: 9,
					apuStatus: 1,
					apuFaultCode: 0x0102,
					apuFaultDetail: 0x1234,
				},
				stringPool: {
					entries: [
						{ id: 0, value: 'rom literal', tracked: false },
						{ id: 1, value: 'runtime literal', tracked: true },
					],
				},
				input: {
					sampleArmed: false,
					sampleSequence: 3,
					lastSampleCycle: 77,
					systemNmiLineHigh: true,
					registers: {
						ctrl: 1,
						keyWords: numberedWords(INPUT_CONTROLLER_KEY_WORD_COUNT),
						pointerButtons: 3,
						pointerXQ16: 0x000c8000,
						pointerYQ16: 0xfffcc000,
						pointerWheelQ16: 0x00018000,
						padButtons: numberedWords(INPUT_CONTROLLER_PAD_COUNT),
						padAxesQ16: numberedWords(INPUT_CONTROLLER_PAD_COUNT * INPUT_CONTROLLER_PAD_AXIS_COUNT),
						outputPort: 2,
						outputIntensityQ16: 0x8000,
						outputDurationMs: 120,
						outputStatus: 4,
					},
				},
				systemControl: {
					resetRequested: true,
				},
			},
			frameScheduler: {
				accumulatedHostTimeMs: 1.5,
				queuedTickCompletions: [
					{
						sequence: 11,
						remaining: 22,
						visualCommitted: true,
					},
				],
				lastTickSequence: 44,
				lastTickBudgetGranted: 55,
				lastTickCpuBudgetGranted: 66,
				lastTickCpuUsedCycles: 77,
				lastTickBudgetRemaining: 88,
				lastTickVisualFrameCommitted: true,
				lastTickCompleted: true,
				lastTickConsumedSequence: 111,
			},
			vblank: { nowCycles: 0, cyclesIntoFrame: 0 },
		},
		cpuState: {
			systemGlobals: [
				{ name: 'irq', value: { tag: 'number', value: 7 } },
			],
			globals: [
				{ name: 'answer', value: { tag: 'number', value: 42 } },
			],
			moduleCache: [],
			frames: [],
			lastReturnValues: [],
			objects: [],
			openUpvalues: [],
			lastPc: 0,
			lastInstruction: 0,
			instructionBudgetRemaining: 0,
			haltedUntilIrq: false,
			memoryWriteBlocked: false,
			memoryWriteBlockedAddress: 0,
			statusWord: CPU_STATUS_CART_ENTRY,
			causeWord: 0,
			epcWord: 0,
			badAddressWord: 0,
			nonMaskableInterruptPending: false,
			yieldRequested: false,
		},
		systemProgramActive: true,
		luaInitialized: true,
		luaRuntimeFailed: false,
		pendingEntryCall: false,
	} as unknown as RuntimeSaveState;
}

test('runtime save-state codec preserves string pool ROM/runtime ownership', () => {
	const state = createRuntimeSaveState();

	const decoded = decodeRuntimeSaveState(encodeRuntimeSaveState(state));

	assert.equal(decoded.machineState.psxGpuDisplayModeWord, state.machineState.psxGpuDisplayModeWord);
	assert.deepEqual(decoded.machineState.machine.stringPool.entries, state.machineState.machine.stringPool.entries);
	assert.deepEqual(decoded.machineState.machine.irq, state.machineState.machine.irq);
	assert.deepEqual(decoded.machineState.machine.dma, state.machineState.machine.dma);
	assert.deepEqual(decoded.machineState.machine.geometry, state.machineState.machine.geometry);
	assert.deepEqual(decoded.machineState.machine.gxGpu, state.machineState.machine.gxGpu);
	assert.deepEqual(decoded.machineState.machine.gxGte, state.machineState.machine.gxGte);
	assert.deepEqual(decoded.machineState.machine.audio, state.machineState.machine.audio);
	assert.deepEqual(decoded.machineState.machine.input, state.machineState.machine.input);
	assert.deepEqual(decoded.machineState.machine.systemControl, state.machineState.machine.systemControl);
	assert.deepEqual(decoded.machineState.frameScheduler, state.machineState.frameScheduler);
	assert.deepEqual(decoded.cpuState.systemGlobals, state.cpuState.systemGlobals);
});

test('runtime save-state codec stores READY GPUREAD bytes and rejects backend-only phases', () => {
	const ready = createRuntimeSaveState();
	const readyReadback = ready.machineState.machine.gxGpu.commandBuffer;
	readyReadback.readbackPhase = GX_GPU_READBACK_READY;
	readyReadback.readbackX = 1023;
	readyReadback.readbackY = 511;
	readyReadback.readbackWidth = 3;
	readyReadback.readbackHeight = 1;
	readyReadback.readbackPixelCursor = 1;
	readyReadback.readbackPixelBytes = new Uint8Array([0x11, 0x11, 0x22, 0x22, 0x33, 0x33]);
	const decodedReady = decodeRuntimeSaveState(encodeRuntimeSaveState(ready)).machineState.machine.gxGpu.commandBuffer;
	assert.equal(decodedReady.readbackPhase, GX_GPU_READBACK_READY);
	assert.equal(decodedReady.readbackPixelCursor, 1);
	assert.deepEqual(decodedReady.readbackPixelBytes, readyReadback.readbackPixelBytes);

	const submitted = createRuntimeSaveState();
	const submittedReadback = submitted.machineState.machine.gxGpu.commandBuffer;
	submittedReadback.readbackPhase = GX_GPU_READBACK_SUBMITTED;
	submittedReadback.readbackWidth = 1024;
	submittedReadback.readbackHeight = 512;
	submittedReadback.readbackPixelBytes = new Uint8Array(0);
	assert.throws(
		() => decodeRuntimeSaveState(encodeRuntimeSaveState(submitted)),
		/backend-submitted phase/,
	);

	const oversized = createRuntimeSaveState();
	oversized.machineState.machine.gxGpu.vramBytes = new Uint8Array(RUNTIME_SAVE_STATE_WIRE_CAPACITY);
	assert.throws(
		() => encodeRuntimeSaveState(oversized),
		/current-format wire capacity/,
	);
	assert.throws(
		() => decodeRuntimeSaveState(new Uint8Array(RUNTIME_SAVE_STATE_WIRE_CAPACITY + 1)),
		/current-format wire capacity/,
	);
});

test('runtime save-state codec preserves exception frame metadata', () => {
	const state = createRuntimeSaveState();
	state.cpuState.frames = [{
		protoIndex: 3,
		pc: 44,
		closureRef: 7,
		registers: [{ tag: 'nil' }],
		varargs: [],
		returnBase: 1,
		returnCount: 0,
		top: 1,
		captureReturns: false,
		callSitePc: 41,
		isExceptionFrame: true,
	}];

	const decoded = decodeRuntimeSaveState(encodeRuntimeSaveState(state));

	assert.deepEqual(decoded.cpuState.frames, state.cpuState.frames);
});

test('runtime save-state codec preserves builtin VM primitive ids', () => {
	const state = createRuntimeSaveState();
	state.cpuState.globals = [
		{ name: 'foo', value: { tag: 'builtin', id: BuiltinFunctionId.Next } },
	];
	state.cpuState.lastReturnValues = [
		{ tag: 'builtin', id: BuiltinFunctionId.StringChar },
	];

	const decoded = decodeRuntimeSaveState(encodeRuntimeSaveState(state));

	assert.deepEqual(decoded.cpuState.globals, state.cpuState.globals);
	assert.deepEqual(decoded.cpuState.lastReturnValues, state.cpuState.lastReturnValues);
});

test('runtime save-state bytes start at the current property-table payload', () => {
	const encoded = encodeRuntimeSaveState(createRuntimeSaveState());

	assert.doesNotThrow(() => decodeBinaryWithPropTable(encoded, RUNTIME_SAVE_STATE_PROP_NAMES));
	assert.throws(() => decodeBinaryWithPropTable(encoded.subarray(2), RUNTIME_SAVE_STATE_PROP_NAMES));
});
