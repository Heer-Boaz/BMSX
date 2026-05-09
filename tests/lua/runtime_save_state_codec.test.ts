import assert from 'node:assert/strict';
import { test } from 'node:test';

import { SKYBOX_FACE_WORD_COUNT, VDP_PMU_BANK_WORD_COUNT } from '../../src/bmsx/machine/devices/vdp/contracts';
import type { RuntimeSaveState } from '../../src/bmsx/machine/runtime/contracts';
import { decodeRuntimeSaveState, encodeRuntimeSaveState } from '../../src/bmsx/machine/runtime/save_state/codec';

function numberedWords(count: number): number[] {
	const words = new Array<number>(count);
	for (let index = 0; index < count; index += 1) {
		words[index] = index + 1;
	}
	return words;
}

function matrix(seed: number): number[] {
	const values = new Array<number>(16);
	for (let index = 0; index < values.length; index += 1) {
		values[index] = seed + index;
	}
	return values;
}

test('runtime save-state codec preserves string pool ROM/runtime ownership', () => {
	const state = {
		machineState: {
			machine: {
				memory: {
					ram: new Uint8Array([1, 2, 3, 4]),
					busFaultCode: 2,
					busFaultAddr: 0x12345678,
					busFaultAccess: 0x400,
				},
				irq: { pendingFlags: 0xa5a5 },
				stringPool: {
					entries: [
						{ id: 0, value: 'rom literal', tracked: false },
						{ id: 1, value: 'runtime literal', tracked: true },
					],
				},
				input: { sampleArmed: false },
				vdp: {
					camera: {
						view: matrix(10),
						proj: matrix(40),
						eye: [1, 2, 3],
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
		renderState: {
			camera: null,
			ambientLights: [],
			directionalLights: [],
			pointLights: [],
		},
		systemProgramActive: true,
		luaInitialized: true,
		luaRuntimeFailed: false,
		randomSeed: 123,
		pendingEntryCall: false,
	} as unknown as RuntimeSaveState;

	const decoded = decodeRuntimeSaveState(encodeRuntimeSaveState(state));

	assert.deepEqual(decoded.machineState.machine.stringPool.entries, state.machineState.machine.stringPool.entries);
	assert.deepEqual(decoded.machineState.machine.irq, state.machineState.machine.irq);
	assert.deepEqual(decoded.machineState.frameScheduler, state.machineState.frameScheduler);
	assert.deepEqual(decoded.machineState.machine.vdp.surfacePixels, state.machineState.machine.vdp.surfacePixels);
});
