import assert from 'node:assert/strict';
import { test } from 'node:test';

import { SKYBOX_FACE_WORD_COUNT, VDP_PMU_BANK_WORD_COUNT } from '../../src/bmsx/machine/devices/vdp/contracts';
import { VDP_XF_MATRIX_REGISTER_WORDS, VDP_XF_PROJECTION_MATRIX_RESET_INDEX, VDP_XF_VIEW_MATRIX_RESET_INDEX } from '../../src/bmsx/machine/devices/vdp/xf';
import type { RuntimeSaveState } from '../../src/bmsx/machine/runtime/contracts';
import { decodeRuntimeSaveState, encodeRuntimeSaveState } from '../../src/bmsx/machine/runtime/save_state/codec';

function numberedWords(count: number): number[] {
	const words = new Array<number>(count);
	for (let index = 0; index < count; index += 1) {
		words[index] = index + 1;
	}
	return words;
}

function createRuntimeSaveState(): RuntimeSaveState {
	return {
		machineState: {
			machine: {
				memory: {
					ram: new Uint8Array([1, 2, 3, 4]),
					busFaultCode: 2,
					busFaultAddr: 0x12345678,
					busFaultAccess: 0x400,
				},
				irq: { pendingFlags: 0xa5a5 },
				audio: {
					eventSequence: 3,
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
					skyboxControl: 5,
					skyboxFaceWords: numberedWords(SKYBOX_FACE_WORD_COUNT),
					pmuSelectedBank: 2,
					pmuBankWords: numberedWords(VDP_PMU_BANK_WORD_COUNT),
					ditherType: 1,
					vdpFaultCode: 0,
					vdpFaultDetail: 0,
					vramStaging: new Uint8Array([7, 8]),
					surfacePixels: [
						{ surfaceId: 4, pixels: new Uint8Array([9, 10, 11, 12]) },
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
	assert.deepEqual(decoded.machineState.machine.audio, state.machineState.machine.audio);
	assert.deepEqual(decoded.machineState.frameScheduler, state.machineState.frameScheduler);
	assert.deepEqual(decoded.machineState.machine.vdp.surfacePixels, state.machineState.machine.vdp.surfacePixels);
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
});
