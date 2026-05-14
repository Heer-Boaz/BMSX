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
} from '../../src/bmsx/machine/devices/audio/contracts';
import { SKYBOX_FACE_WORD_COUNT, VDP_PMU_BANK_WORD_COUNT } from '../../src/bmsx/machine/devices/vdp/contracts';
import { GEOMETRY_CONTROLLER_PHASE_BUSY, GEOMETRY_CONTROLLER_REGISTER_COUNT } from '../../src/bmsx/machine/devices/geometry/contracts';
import { VDP_REGISTER_COUNT } from '../../src/bmsx/machine/devices/vdp/registers';
import { VDP_XF_MATRIX_REGISTER_WORDS, VDP_XF_PROJECTION_MATRIX_RESET_INDEX, VDP_XF_VIEW_MATRIX_RESET_INDEX } from '../../src/bmsx/machine/devices/vdp/xf';
import type { RuntimeSaveState } from '../../src/bmsx/machine/runtime/contracts';
import { decodeRuntimeSaveState, encodeRuntimeSaveState } from '../../src/bmsx/machine/runtime/save_state/codec';
import { decodeBinaryWithPropTable } from '../../src/bmsx/common/serializer/binencoder';
import { RUNTIME_SAVE_STATE_PROP_NAMES } from '../../src/bmsx/machine/runtime/save_state/schema';

function numberedWords(count: number): number[] {
	const words = new Array<number>(count);
	for (let index = 0; index < count; index += 1) {
		words[index] = index + 1;
	}
	return words;
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
				irq: { pendingFlags: 0xa5a5 },
				audio: {
					registerWords: audioRegisterWords,
					commandFifoCommands: numberedWords(APU_COMMAND_FIFO_CAPACITY),
					commandFifoRegisterWords: numberedWords(APU_COMMAND_FIFO_REGISTER_WORD_COUNT),
					commandFifoReadIndex: 1,
					commandFifoWriteIndex: 2,
					commandFifoCount: 3,
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
				input: { sampleArmed: false },
				vdp: {
					xf: {
						matrixWords: numberedWords(VDP_XF_MATRIX_REGISTER_WORDS),
						viewMatrixIndex: VDP_XF_VIEW_MATRIX_RESET_INDEX,
						projectionMatrixIndex: VDP_XF_PROJECTION_MATRIX_RESET_INDEX,
					},
					vdpRegisterWords: numberedWords(VDP_REGISTER_COUNT),
					skyboxControl: 5,
					skyboxFaceWords: numberedWords(SKYBOX_FACE_WORD_COUNT),
					pmuSelectedBank: 2,
					pmuBankWords: numberedWords(VDP_PMU_BANK_WORD_COUNT),
					ditherType: 1,
					vdpFaultCode: 0,
					vdpFaultDetail: 0,
					vramStaging: new Uint8Array([7, 8]),
					surfacePixels: [
						{ surfaceId: 4, surfaceWidth: 1, surfaceHeight: 1, pixels: new Uint8Array([9, 10, 11, 12]) },
					],
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
			vblank: { cyclesIntoFrame: 0 },
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
		randomSeed: 123,
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
	assert.deepEqual(decoded.machineState.frameScheduler, state.machineState.frameScheduler);
	assert.deepEqual(decoded.machineState.machine.vdp.surfacePixels, state.machineState.machine.vdp.surfacePixels);
});

test('runtime save-state bytes start at the current property-table payload', () => {
	const encoded = encodeRuntimeSaveState(createRuntimeSaveState());

	assert.doesNotThrow(() => decodeBinaryWithPropTable(encoded, RUNTIME_SAVE_STATE_PROP_NAMES));
	assert.throws(() => decodeBinaryWithPropTable(encoded.subarray(2), RUNTIME_SAVE_STATE_PROP_NAMES));
});

test('runtime save-state codec rejects invalid VDP fixed register snapshots before device restore', () => {
	const badSkyboxState = createRuntimeSaveState();
	badSkyboxState.machineState.machine.vdp.skyboxFaceWords = numberedWords(SKYBOX_FACE_WORD_COUNT - 1);
	assert.throws(
		() => decodeRuntimeSaveState(encodeRuntimeSaveState(badSkyboxState)),
		/machine\.vdp\.skyboxFaceWords must contain/,
	);

	const badPmuState = createRuntimeSaveState();
	badPmuState.machineState.machine.vdp.pmuBankWords = numberedWords(VDP_PMU_BANK_WORD_COUNT - 1);
	assert.throws(
		() => decodeRuntimeSaveState(encodeRuntimeSaveState(badPmuState)),
		/machine\.vdp\.pmuBankWords must contain/,
	);

	const badVdpRegisterState = createRuntimeSaveState();
	badVdpRegisterState.machineState.machine.vdp.vdpRegisterWords = numberedWords(VDP_REGISTER_COUNT - 1);
	assert.throws(
		() => decodeRuntimeSaveState(encodeRuntimeSaveState(badVdpRegisterState)),
		/machine\.vdp\.vdpRegisterWords must contain/,
	);
});
