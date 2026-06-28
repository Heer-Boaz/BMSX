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
import { VDP_JTU_REGISTER_WORDS, VDP_MFU_WEIGHT_COUNT } from '../../machine/ts/machine/devices/vdp/contracts';
import { GEOMETRY_CONTROLLER_PHASE_BUSY, GEOMETRY_CONTROLLER_REGISTER_COUNT } from '../../machine/ts/machine/devices/geometry/contracts';
import { INPUT_CONTROLLER_KEY_WORD_COUNT, INPUT_CONTROLLER_PAD_AXIS_COUNT, INPUT_CONTROLLER_PAD_COUNT } from '../../machine/ts/machine/devices/input/contracts';
import { VDP_REGISTER_COUNT } from '../../machine/ts/machine/devices/vdp/registers';
import { VDP_LPU_REGISTER_WORDS } from '../../machine/ts/machine/devices/vdp/lpu';
import { VDP_XF_MATRIX_REGISTER_WORDS, VDP_XF_PROJECTION_MATRIX_RESET_INDEX, VDP_XF_VIEW_MATRIX_RESET_INDEX } from '../../machine/ts/machine/devices/vdp/xf';
import {
	VDP_DEX_FRAME_IDLE,
	VDP_SUBMITTED_FRAME_EMPTY,
	VDP_SUBMITTED_FRAME_EXECUTING,
} from '../../machine/ts/machine/devices/vdp/frame';
import { captureVdpRpuFrameState, createVdpRpuFrameOutput, VDP_RPU_FRAME_IDLE } from '../../machine/ts/machine/devices/vdp/rpu';
import type { RuntimeSaveState } from '../../machine/ts/machine/runtime/save_state';
import { decodeRuntimeSaveState, encodeRuntimeSaveState } from '../../machine/ts/machine/runtime/save_state/codec';
import { decodeBinaryWithPropTable } from '../../machine/ts/common/serializer/binencoder';
import { RUNTIME_SAVE_STATE_PROP_NAMES } from '../../machine/ts/machine/runtime/save_state/schema';

function numberedWords(count: number): number[] {
	const words = new Array<number>(count);
	for (let index = 0; index < count; index += 1) {
		words[index] = index + 1;
	}
	return words;
}

function createSubmittedFrameState(state = VDP_SUBMITTED_FRAME_EMPTY) {
	return {
		state,
		hasCommands: state !== VDP_SUBMITTED_FRAME_EMPTY,
		cost: state === VDP_SUBMITTED_FRAME_EMPTY ? 0 : 9,
		workRemaining: state === VDP_SUBMITTED_FRAME_EMPTY ? 0 : 7,
		ditherType: 2,
		frameBufferWidth: 256,
		frameBufferHeight: 212,
		xf: {
			matrixWords: numberedWords(VDP_XF_MATRIX_REGISTER_WORDS),
			viewMatrixIndex: VDP_XF_VIEW_MATRIX_RESET_INDEX,
			projectionMatrixIndex: VDP_XF_PROJECTION_MATRIX_RESET_INDEX,
		},
		lightRegisterWords: numberedWords(VDP_LPU_REGISTER_WORDS),
		morphWeightWords: numberedWords(VDP_MFU_WEIGHT_COUNT),
		jointMatrixWords: numberedWords(VDP_JTU_REGISTER_WORDS),
		rpu: captureVdpRpuFrameState(createVdpRpuFrameOutput()),
	};
}

function createRpuState() {
	return {
		buildState: VDP_RPU_FRAME_IDLE,
		vdpVram: [21, 22, 23],
	};
}

function createRuntimeSaveState(): RuntimeSaveState {
	const audioRegisterWords = numberedWords(APU_PARAMETER_REGISTER_COUNT);
	audioRegisterWords[APU_PARAMETER_SLOT_INDEX] = 1;
	const audioSlotRegisterWords = new Array<number>(APU_SLOT_REGISTER_WORD_COUNT).fill(0);
	audioSlotRegisterWords[apuSlotRegisterWordIndex(0, APU_PARAMETER_SOURCE_ADDR_INDEX)] = 0x1000;
	audioSlotRegisterWords[apuSlotRegisterWordIndex(1, APU_PARAMETER_SOURCE_ADDR_INDEX)] = 0x2000;
	audioSlotRegisterWords[apuSlotRegisterWordIndex(2, APU_PARAMETER_SOURCE_ADDR_INDEX)] = 0x3000;
	const audioSlotSourceBytes = Array.from({ length: APU_SLOT_COUNT }, (_, slot) => new Uint8Array(slot === 1 ? [9, 8, 7, 6] : []));
	return {
		machineState: {
			machine: {
				memory: {
					ram: new Uint8Array([1, 2, 3, 4]),
					busFaultCode: 2,
					busFaultAddr: 0x12345678,
					busFaultAccess: 0x400,
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
				vdp: {
					xf: {
						matrixWords: numberedWords(VDP_XF_MATRIX_REGISTER_WORDS),
						viewMatrixIndex: VDP_XF_VIEW_MATRIX_RESET_INDEX,
						projectionMatrixIndex: VDP_XF_PROJECTION_MATRIX_RESET_INDEX,
					},
					vdpRegisterWords: numberedWords(VDP_REGISTER_COUNT),
					buildFrame: {
						state: VDP_DEX_FRAME_IDLE,
										rpu: captureVdpRpuFrameState(createVdpRpuFrameOutput()),
						cost: 0,
					},
					activeFrame: createSubmittedFrameState(VDP_SUBMITTED_FRAME_EXECUTING),
					pendingFrame: createSubmittedFrameState(),
					rpu: createRpuState(),
					workCarry: 12,
					availableWorkUnits: 3,
					streamIngress: {
						dmaSubmitActive: true,
						fifoWordScratch: [1, 2, 3, 4],
						fifoWordByteCount: 2,
						fifoStreamWords: [0x12345678],
						fifoStreamWordCount: 1,
					},
					readback: {
						readBudgetBytes: 12,
						readOverflow: true,
					},
					lightRegisterWords: numberedWords(VDP_LPU_REGISTER_WORDS),
					morphWeightWords: numberedWords(VDP_MFU_WEIGHT_COUNT),
					jointMatrixWords: numberedWords(VDP_JTU_REGISTER_WORDS),

					ditherType: 1,
					vdpFaultCode: 0,
					vdpFaultDetail: 0,
					vram: {
						staging: new Uint8Array([7, 8]),
						surfacePixels: [
							{ surfaceId: 4, surfaceWidth: 1, surfaceHeight: 1, pixels: new Uint8Array([9, 10, 11, 12]) },
						],
					},
					displayFrameBufferPixels: new Uint8Array([13, 14]),
				},
			},
			frameScheduler: {
				accumulatedHostTimeMs: 1.5,
				queuedTickCompletions: [
					{
						sequence: 11,
						remaining: 22,
						visualCommitted: true,
						vdpFrameCost: 33,
						vdpFrameHeld: false,
					},
				],
				lastTickSequence: 44,
				lastTickBudgetGranted: 55,
				lastTickCpuBudgetGranted: 66,
				lastTickCpuUsedCycles: 77,
				lastTickBudgetRemaining: 88,
				lastTickVisualFrameCommitted: true,
				lastTickVdpFrameCost: 99,
				lastTickVdpFrameHeld: false,
				lastTickCompleted: true,
				lastTickConsumedSequence: 111,
			},
			vblank: { nowCycles: 0, cyclesIntoFrame: 0 },
		},
		cpuState: {
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
			maskableInterruptsEnabled: true,
			maskableInterruptsRestoreEnabled: true,
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

	assert.deepEqual(decoded.machineState.machine.stringPool.entries, state.machineState.machine.stringPool.entries);
	assert.deepEqual(decoded.machineState.machine.irq, state.machineState.machine.irq);
	assert.deepEqual(decoded.machineState.machine.geometry, state.machineState.machine.geometry);
	assert.deepEqual(decoded.machineState.machine.audio, state.machineState.machine.audio);
	assert.deepEqual(decoded.machineState.machine.input, state.machineState.machine.input);
	assert.deepEqual(decoded.machineState.machine.vdp.activeFrame, state.machineState.machine.vdp.activeFrame);
	assert.deepEqual(decoded.machineState.machine.vdp.rpu, state.machineState.machine.vdp.rpu);
	assert.deepEqual(decoded.machineState.machine.vdp.streamIngress.fifoWordScratch, state.machineState.machine.vdp.streamIngress.fifoWordScratch);
	assert.deepEqual(decoded.machineState.machine.vdp.streamIngress.fifoStreamWords, state.machineState.machine.vdp.streamIngress.fifoStreamWords);
	assert.deepEqual(decoded.machineState.machine.vdp.readback, state.machineState.machine.vdp.readback);
	assert.deepEqual(decoded.machineState.frameScheduler, state.machineState.frameScheduler);
	assert.deepEqual(decoded.machineState.machine.vdp.vram, state.machineState.machine.vdp.vram);
});

test('runtime save-state codec preserves interrupt frame metadata', () => {
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
		isInterruptFrame: true,
		savedMaskableEnabled: false,
	}];

	const decoded = decodeRuntimeSaveState(encodeRuntimeSaveState(state));

	assert.deepEqual(decoded.cpuState.frames, state.cpuState.frames);
});

test('runtime save-state property table preserves the retired randomSeed slot', () => {
	const registersIndex = RUNTIME_SAVE_STATE_PROP_NAMES.indexOf('registers');
	assert.equal(RUNTIME_SAVE_STATE_PROP_NAMES[registersIndex - 1], 'randomSeed');
});

test('runtime save-state bytes start at the current property-table payload', () => {
	const encoded = encodeRuntimeSaveState(createRuntimeSaveState());

	assert.doesNotThrow(() => decodeBinaryWithPropTable(encoded, RUNTIME_SAVE_STATE_PROP_NAMES));
	assert.throws(() => decodeBinaryWithPropTable(encoded.subarray(2), RUNTIME_SAVE_STATE_PROP_NAMES));
});

test('runtime save-state codec rejects invalid VDP fixed register snapshots before device restore', () => {
	const badVdpRegisterState = createRuntimeSaveState();
	badVdpRegisterState.machineState.machine.vdp.vdpRegisterWords = numberedWords(VDP_REGISTER_COUNT - 1);
	assert.throws(
		() => decodeRuntimeSaveState(encodeRuntimeSaveState(badVdpRegisterState)),
		/machine\.vdp\.vdpRegisterWords must contain/,
	);
});
