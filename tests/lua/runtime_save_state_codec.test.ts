import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
	APU_COMMAND_FIFO_CAPACITY,
	APU_COMMAND_FIFO_REGISTER_WORD_COUNT,
	APU_PARAMETER_REGISTER_COUNT,
	APU_RATE_STEP_Q16_ONE,
	APU_SAMPLE_RAM_BYTES,
	APU_PARAMETER_SLOT_INDEX,
	APU_PARAMETER_SOURCE_ADDR_INDEX,
	APU_SLOT_COUNT,
	APU_SLOT_PHASE_FADING,
	APU_SLOT_PHASE_IDLE,
	APU_SLOT_PHASE_PLAYING,
	APU_SLOT_REGISTER_WORD_COUNT,
	APU_TRANSFER_FIFO_WORD_CAPACITY,
	apuSlotRegisterWordIndex,
} from '../../machine/ts/machine/devices/audio/contracts';
import { GEOMETRY_CONTROLLER_PHASE_BUSY, GEOMETRY_CONTROLLER_REGISTER_COUNT } from '../../machine/ts/machine/devices/geometry/contracts';
import { GX_GPU_GP0_INGRESS_POLYLINE_PAYLOAD } from '../../machine/ts/machine/devices/gx/gp0';
import { GX_GPU_READBACK_READY, GX_GPU_READBACK_SUBMITTED } from '../../machine/ts/machine/devices/gx/gpu_command_buffer';
import { GX_GPU_PCRTC_COMPOSITION_WORD_COUNT, GX_GPU_PCRTC_CONFIG_WORD_COUNT } from '../../machine/ts/machine/devices/gx/gpu_pcrtc';
import { GX_GPU_VRAM_BYTE_COUNT } from '../../machine/ts/machine/devices/gx/vram_address';
import { GX_GTE_CONTROL_REGISTER_COUNT, GX_GTE_DATA_REGISTER_COUNT, GX_GTE_PLUS_REGISTER_COUNT } from '../../machine/ts/machine/devices/gx/gte';
import { INPUT_CONTROLLER_KEY_WORD_COUNT, INPUT_CONTROLLER_PAD_AXIS_COUNT, INPUT_CONTROLLER_PAD_COUNT } from '../../machine/ts/machine/devices/input/contracts';
import { PSX_GPU_DISPLAY_MODE_PAL_WORD } from '../../machine/ts/machine/model_registry';

import type { RuntimeSaveState } from '../../machine/ts/machine/runtime/save_state';
import {
	decodeRuntimeSaveState,
	encodeRuntimeSaveState,
	runtimeSaveStateWireCapacity,
} from '../../machine/ts/machine/runtime/save_state/codec';
import { decodeBinaryWithPropTable } from '../../machine/ts/common/serializer/binencoder';
import { RUNTIME_SAVE_STATE_PROP_NAMES } from '../../machine/ts/machine/runtime/save_state/schema';
import { BuiltinFunctionId, ProtectedCallKind } from '../../machine/ts/machine/cpu/cpu';
import { CPU_STATUS_CART_ENTRY } from '../../machine/ts/machine/cpu/cop0';
import { DMA_STATUS_BUSY, SYS_PRINT_BUFFER_BYTES } from '../../machine/ts/machine/bus/io';
import { RAM_BASE, RAM_END } from '../../machine/ts/machine/memory/map';

const codecTestGxVram = new Uint8Array(GX_GPU_VRAM_BYTE_COUNT);
codecTestGxVram[0] = 0x34;
codecTestGxVram[1] = 0x12;
codecTestGxVram[1024] = 0xcd;
codecTestGxVram[1025] = 0xab;

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
	const audioSampleRam = new Uint8Array(APU_SAMPLE_RAM_BYTES);
	audioSampleRam.set([9, 8, 7, 6], 0x20);
	const printBuffer = new Uint8Array(SYS_PRINT_BUFFER_BYTES);
	printBuffer.set([0x68, 0x69, 0x0a], 17);
	return {
		machineState: {
			machine: {
				memory: {
					ram,
					busFaultCode: 2,
					busFaultAddr: 0x12345678,
					busFaultAccess: 0x400,
				},
				cartridge: {
					selectionWord: 0xa5a50001,
					slots: [
						{
							ram: new Uint8Array([1, 3, 5, 7]),
							mailboxDataWord: 0x11223344,
							mailboxControlWord: 2,
							mailboxIrqPending: true,
						},
						{
							ram: new Uint8Array([2, 4, 6, 8, 10, 12]),
							mailboxDataWord: 0xaabbccdd,
							mailboxControlWord: 4,
							mailboxIrqPending: false,
						},
					],
				},
				dma: {
					channels: [
						{
							readAddressWord: 0x01002010,
							writeAddressWord: 0x08010240,
							transferCountWord: 5,
							controlWord: 5,
							statusWord: DMA_STATUS_BUSY,
						},
						{
							readAddressWord: 0x08010418,
							writeAddressWord: 0x08010240,
							transferCountWord: 11,
							controlWord: 0x00003c58,
							statusWord: DMA_STATUS_BUSY,
						},
					],
					activeChannel: 0,
					nextChannel: 1,
					scheduledBlockWords: 5,
					scheduledBlockCycles: 17,
					scheduledReadAddressWord: 0x01002010,
					scheduledWriteAddressWord: 0x08010240,
					scheduledTransferCountWord: 5,
					scheduledControlWord: 5,
					supervisorQuiesceRequested: true,
					supervisorAdmissionQuiesceRequested: true,
					userChannels: [
						{
							readAddressWord: 0x01002020,
							writeAddressWord: 0x08010240,
							transferCountWord: 9,
							controlWord: 4,
							statusWord: DMA_STATUS_BUSY,
						},
						{
							readAddressWord: 0,
							writeAddressWord: 0,
							transferCountWord: 0,
							controlWord: 0,
							statusWord: 0,
						},
					],
					userNextChannel: 0,
				},
				imgDec: {
					inputWordCountWord: 37,
					textureDestinationWord: 0x00200040,
					textureSizeWord: 0x00010040,
					clutDestinationWord: 0x00400100,
					controlWord: 0,
					statusWord: 0x00000001,
					dataWord: 0x12345678,
					inputWordsReceived: 32,
					decodedWordCount: 24,
					textureWordCount: 40,
					clutWordCount: 8,
					outputWordsRead: 13,
					decodePhase: 7,
					outputStage: 1,
					runWordsRemaining: 16,
					repeatWord: 0x87654321,
					backReferenceDistance: 8,
					supervisorQuiesceRequested: true,
					inputWords: [0x11111111, 0x22222222],
					outputWords: [0x33333333, 0x44444444],
					historyWords: [1, 2, 3, 4, 5, 6, 7, 8],
					scheduledDecodeWords: 2,
					scheduledDecodeCycles: 4,
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
					supervisorQuiesceRequested: true,
				},
				gxGpu: {
					gp0Word: 0x12345678,
					gp1Word: 0x08000008,
					displayModeWord: PSX_GPU_DISPLAY_MODE_PAL_WORD,
					statusWord: 0x1c100000,
					gp0CommandWordCount: 2,
					gp0CommandTargetWordCount: 4,
					gp0CommandWords: [0x200000ff, 0x00010002],
					gp0FifoWords: [0xe1000123, 0xe6000003],
					gp0DmaIngressWords: [0x03000001],
					gp0IngressPhase: GX_GPU_GP0_INGRESS_POLYLINE_PAYLOAD,
					gp0IngressWordsRemaining: 0,
					gp0IngressPolylineWordsPerVertex: 2,
					gp0IngressPolylinePayloadPhase: 1,
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
					vramYAddressExtensionWord: 1,
					presentStatusWord: 0x1c100001,
					presentDisplayModeWord: PSX_GPU_DISPLAY_MODE_PAL_WORD,
					presentDisplayStartWord: 0x00011844,
					presentHorizontalDisplayRangeWord: 0x00c60260,
					presentVerticalDisplayRangeWord: 0x0003fc10,
					presentVramYAddressExtensionWord: 1,
					pcrtc: {
						registerWords: numberedWords(GX_GPU_PCRTC_CONFIG_WORD_COUNT),
						presentWords: numberedWords(GX_GPU_PCRTC_CONFIG_WORD_COUNT).reverse(),
						csrWord: 0x551b6008,
						imrWord: 0x00006f00,
						beamCycleOffset: -17,
						beamRemainder: 23,
						beamHalfLine: 29,
						nextHsyncHalfLine: 31,
						verticalStage: 1,
						vblankActive: true,
					},
					pcrtcPresentationPending: true,
					vramPresentationPending: false,
					supervisorQuiesceRequested: true,
					supervisorIngressQuiesceRequested: true,
					supervisorIngressStopped: true,
					userContext: {
						gp0Word: 0x87654321,
						gp1Word: 0x05011844,
						displayModeWord: PSX_GPU_DISPLAY_MODE_PAL_WORD,
						statusWord: 0x1c100001,
						gpuReadWord: 0x00000200,
						drawModeWord: 0x00000083,
						textureWindowWord: 0x00000101,
						drawingAreaTopLeftWord: 0x00000804,
						drawingAreaBottomRightWord: 0x00028140,
						drawingOffsetWord: 0x00200040,
						maskBitModeWord: 0x00000001,
						displayStartWord: 0x00011844,
						horizontalDisplayRangeWord: 0x00c60260,
						verticalDisplayRangeWord: 0x0003fc10,
						vramYAddressExtensionWord: 1,
						presentStatusWord: 0x1c100001,
						presentDisplayModeWord: PSX_GPU_DISPLAY_MODE_PAL_WORD,
						presentDisplayStartWord: 0x00011844,
						presentVramYAddressExtensionWord: 1,
						presentHorizontalDisplayRangeWord: 0x00c60260,
						presentVerticalDisplayRangeWord: 0x0003fc10,
						pcrtcRegisterWords: numberedWords(GX_GPU_PCRTC_COMPOSITION_WORD_COUNT),
						pcrtcPresentWords: numberedWords(GX_GPU_PCRTC_COMPOSITION_WORD_COUNT).reverse(),
						vramPresentationPending: true,
					},
					userIngressContext: {
						gp0CommandTargetWordCount: 3,
						gp0CommandWords: [0x0200001f],
						gp0IngressPhase: 1,
						gp0IngressWordsRemaining: 2,
						gp0IngressPolylineWordsPerVertex: 0,
						gp0IngressPolylinePayloadPhase: 0,
						gp0ImageLoadWordsRemaining: 0,
						gp0ImageLoadCommandWordStart: 0,
						gp0ImageLoadCommandWordCount: 0,
						gp0ImageLoadCommandOpcode: 0,
						gp0PolylineWordsPerVertex: 0,
						gp0PolylinePayloadPhase: 0,
						gp0PolylineCommandWordStart: 0,
						gp0PolylineCommandWordCount: 0,
						gp0PolylineCommandOpcode: 0,
						commandBufferWords: [],
					},
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
						commandVramYAddressExtensionWord: [0, 1],
						commandTextureWindowWord: [0x0f0f, 0x0f0f],
						commandDrawingAreaTopLeftWord: [0, 0],
						commandDrawingAreaBottomRightWord: [0x00ef013f, 0x00ef013f],
						commandDrawingOffsetWord: [0, 0],
						commandMaskBitModeWord: [0, 0],
						commandSkippedLineParity: [2, 1],
						words: [0x200000ff, 0, 1, 2, 0x0200001f, 0, 0x00100010],
						readbackPhase: 0,
						readbackFenceCommandCount: 0,
						readbackX: 0,
						readbackY: 0,
						readbackVramYAddressExtensionWord: 0,
						readbackWidth: 0,
						readbackHeight: 0,
						readbackPixelCursor: 0,
						readbackPixelBytes: new Uint8Array(),
					},
					vramBytes: codecTestGxVram,
				},
				gxGte: {
					dataRegisterWords: numberedWords(GX_GTE_DATA_REGISTER_COUNT),
					controlRegisterWords: numberedWords(GX_GTE_CONTROL_REGISTER_COUNT),
					plusRegisterWords: numberedWords(GX_GTE_PLUS_REGISTER_COUNT),
					mac0: 1,
					mac1: -2,
					mac2: 3,
					mac3: -4,
					currentSf: 1,
					lastCycles: 8,
					plusPendingCycles: 4,
					plusInterlockArmed: true,
					plusPendingResultXy: 0x000efff2,
					plusPendingResultZ: 28,
					plusPendingFlag: 0x84000000,
				},
				irq: {
					mask: 0x00ff,
					pendingFlags: 0xa5a5,
					userMask: 0x0f0f,
					userPendingFlags: 0x5a5a,
					supervisorContextActive: true,
				},
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
					sampleRam: audioSampleRam,
					sampleTransfer: {
						fifoWords: numberedWords(APU_TRANSFER_FIFO_WORD_CAPACITY),
						fifoReadIndex: 1,
						fifoWriteIndex: 4,
						fifoCount: 3,
						transferAddressWord: 0x20,
						transferDataWord: 0x44332211,
						transferControlWord: 2,
						currentAddress: 0x20,
						timingCarry: 123,
						scheduledWords: 3,
						scheduledCycles: 7,
					},
					output: {
						voices: [
							{
								slot: 1,
								sourceCartridgeSlot: 1,
								cursorQ16: 2 * APU_RATE_STEP_Q16_ONE,
								phaseRemainder: 22050,
								gainQ12: 1954,
								fadeStepQ12: 279,
								fadeStepRemainder: 3,
								fadeError: 0,
								fadeSamplesRemaining: 7,
								fadeSamplesTotal: 11,
								filter: {
									l1: 0x12345678,
									l2: -0x12345678,
									r1: 0x76543210,
									r2: -0x76543210,
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
									previousDecodedFrame: 10,
									previousDecodedLeft: -11,
									previousDecodedRight: 12,
								},
							},
						],
					},
					sampleCarry: 8,
					sampleSequence: 9,
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
					supervisorRequestLineHigh: true,
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
					supervisorPhase: 3,
					supervisorTransitionTarget: 1,
					supervisorResumable: true,
					supervisorExitRequested: false,
					printBuffer,
					printReadIndex: 17,
					printByteCount: 3,
				},
			},
			frameScheduler: {
				accumulatedHostTimeMs: 1.5,
				cycleGrantRemainder: 0.5,
				carriedCycleBudget: 22,
				tickCompletionPending: true,
				tickCompletionVisualCommitted: true,
				lastTickSequence: 44,
				lastTickBudgetGranted: 55,
				lastTickCpuBudgetGranted: 66,
				lastTickCpuUsedCycles: 77,
				lastTickBudgetRemaining: 88,
				lastTickVisualFrameCommitted: true,
				lastTickCompleted: true,
				lastTickConsumedSequence: 111,
			},
			frameLoop: {
				frameState: {
					updateExecuted: true,
					luaFaulted: false,
					cycleBudgetRemaining: 12_345,
					cycleBudgetGranted: 23_456,
					cycleCarryGranted: 34_567,
					activeCpuUsedCycles: 45_678,
				},
				frameActive: true,
				frameDeltaMs: 20.096,
			},
			schedulerNowCycles: 1234,
			},
			cpuState: {
				executionCartridgeSlot: 0,
				systemGlobals: [
				{ name: 'irq', value: { tag: 'number', value: 7 } },
			],
				globals: [
					{ name: 'answer', value: { tag: 'number', value: 42 } },
				],
				frames: [],
			protectedCalls: [{
				kind: ProtectedCallKind.XPCallHandler,
				callerFrameIndex: 2,
				targetFrameIndex: -1,
				returnsToProtectedParent: true,
				callBase: 4,
				returnCount: 3,
				handlerRegister: 7,
			}],
			lastReturnValues: [],
			objects: [],
			openUpvalues: [],
			lastPc: 0,
			lastInstruction: 0,
			instructionBudgetRemaining: 0,
			haltedUntilIrq: false,
			interruptEventPending: false,
			memoryWriteBlocked: false,
			memoryWriteBlockedAddress: 0,
			statusWord: CPU_STATUS_CART_ENTRY,
			causeWord: 0,
			epcWord: 0,
			badAddressWord: 0,
			luaFaultReasonWord: 0,
			nmiReturnCauseWord: 0,
			nmiReturnEpcWord: 0,
			nmiReturnBadAddressWord: 0,
			nmiReturnLuaFaultReasonWord: 0,
			nonMaskableInterruptPending: false,
			yieldRequested: false,
		},
			luaInitialized: true,
		luaRuntimeFailed: false,
		pendingEntryCall: false,
	} as unknown as RuntimeSaveState;
}

function cartridgeRamByteCount(state: RuntimeSaveState): number {
	let byteCount = 0;
	for (const slot of state.machineState.machine.cartridge.slots) {
		byteCount += slot.ram.byteLength;
	}
	return byteCount;
}

test('runtime save-state codec preserves string pool ROM/runtime ownership', () => {
	const state = createRuntimeSaveState();

	const decoded = decodeRuntimeSaveState(encodeRuntimeSaveState(state), cartridgeRamByteCount(state));

	assert.deepEqual(decoded.machineState.machine.stringPool.entries, state.machineState.machine.stringPool.entries);
	assert.deepEqual(decoded.machineState.machine.cartridge, state.machineState.machine.cartridge);
	assert.deepEqual(decoded.machineState.machine.irq, state.machineState.machine.irq);
	assert.deepEqual(decoded.machineState.machine.dma, state.machineState.machine.dma);
	assert.deepEqual(decoded.machineState.machine.imgDec, state.machineState.machine.imgDec);
	assert.deepEqual(decoded.machineState.machine.geometry, state.machineState.machine.geometry);
	assert.deepEqual(decoded.machineState.machine.gxGpu, state.machineState.machine.gxGpu);
	assert.deepEqual(decoded.machineState.machine.gxGte, state.machineState.machine.gxGte);
	assert.deepEqual(decoded.machineState.machine.audio, state.machineState.machine.audio);
	assert.deepEqual(decoded.machineState.machine.input, state.machineState.machine.input);
	assert.deepEqual(decoded.machineState.machine.systemControl, state.machineState.machine.systemControl);
	assert.deepEqual(decoded.machineState.frameScheduler, state.machineState.frameScheduler);
	assert.deepEqual(decoded.machineState.frameLoop, state.machineState.frameLoop);
	assert.deepEqual(decoded.cpuState.systemGlobals, state.cpuState.systemGlobals);
});

test('runtime save-state codec rejects a nonnumeric scheduler grant remainder', () => {
	const state = createRuntimeSaveState();
	(state.machineState.frameScheduler as unknown as { cycleGrantRemainder: string }).cycleGrantRemainder = '0.5';

	assert.throws(
		() => decodeRuntimeSaveState(encodeRuntimeSaveState(state), cartridgeRamByteCount(state)),
		/frameScheduler\.cycleGrantRemainder must be a numeric value/,
	);
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
	const decodedReady = decodeRuntimeSaveState(
		encodeRuntimeSaveState(ready),
		cartridgeRamByteCount(ready),
	).machineState.machine.gxGpu.commandBuffer;
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
		() => decodeRuntimeSaveState(encodeRuntimeSaveState(submitted), cartridgeRamByteCount(submitted)),
		/backend-submitted phase/,
	);

	const oversized = createRuntimeSaveState();
	const wireCapacity = runtimeSaveStateWireCapacity(cartridgeRamByteCount(oversized));
	oversized.machineState.machine.gxGpu.vramBytes = new Uint8Array(wireCapacity);
	assert.throws(
		() => encodeRuntimeSaveState(oversized),
		/current-format wire capacity/,
	);
	assert.throws(
		() => decodeRuntimeSaveState(new Uint8Array(wireCapacity + 1), cartridgeRamByteCount(oversized)),
		/current-format wire capacity/,
	);
});

test('runtime save-state codec preserves exception frame metadata', () => {
	const state = createRuntimeSaveState();
	state.cpuState.frames = [{
		functionAddress: 0x10000120,
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
		isNonMaskableExceptionFrame: true,
	}];

	const decoded = decodeRuntimeSaveState(encodeRuntimeSaveState(state), cartridgeRamByteCount(state));

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

	const decoded = decodeRuntimeSaveState(encodeRuntimeSaveState(state), cartridgeRamByteCount(state));

	assert.deepEqual(decoded.cpuState.globals, state.cpuState.globals);
	assert.deepEqual(decoded.cpuState.lastReturnValues, state.cpuState.lastReturnValues);
});

test('runtime save-state bytes start at the current property-table payload', () => {
	const encoded = encodeRuntimeSaveState(createRuntimeSaveState());

	assert.doesNotThrow(() => decodeBinaryWithPropTable(encoded, RUNTIME_SAVE_STATE_PROP_NAMES));
	assert.throws(() => decodeBinaryWithPropTable(encoded.subarray(2), RUNTIME_SAVE_STATE_PROP_NAMES));
});
