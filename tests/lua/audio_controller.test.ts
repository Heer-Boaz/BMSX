import { cartridgeSlots } from '../helpers/cartridge';
import assert from 'node:assert/strict';
import { test } from 'node:test';

import { readLE32, writeLE16, writeLE32 } from '../../machine/ts/common/endian';
import {
	APU_COMMAND_FIFO_CAPACITY,
	APU_CMD_PLAY,
	APU_CMD_SET_SLOT_GAIN,
	APU_CMD_STOP_SLOT,
	APU_EVENT_SLOT_ENDED,
	APU_FILTER_COEFFICIENT_ONE,
	APU_FILTER_CONTROL_ENABLE,
	APU_GAIN_Q12_FRACTION_BITS,
	APU_GAIN_Q12_ONE,
	APU_FAULT_BAD_CMD,
	APU_FAULT_NONE,
	APU_FAULT_SOURCE_RANGE,
	APU_FAULT_UNSUPPORTED_FORMAT,
	APU_GENERATOR_SQUARE,
	APU_PARAMETER_GENERATOR_DUTY_Q12_INDEX,
	APU_PARAMETER_GENERATOR_KIND_INDEX,
	APU_PARAMETER_FILTER_B0_B1_INDEX,
	APU_PARAMETER_FILTER_CONTROL_INDEX,
	APU_PARAMETER_REGISTER_COUNT,
	APU_PARAMETER_GAIN_Q12_INDEX,
	APU_PARAMETER_RATE_STEP_Q16_INDEX,
	APU_PARAMETER_START_SAMPLE_INDEX,
	APU_RATE_STEP_Q16_ONE,
	APU_PARAMETER_SLOT_INDEX,
	APU_SAMPLE_RAM_BASE,
	APU_SAMPLE_RAM_BYTES,
	APU_SLOT_REGISTER_WORD_COUNT,
	APU_PARAMETER_SOURCE_ADDR_INDEX,
	APU_PARAMETER_SOURCE_SAMPLE_RATE_HZ_INDEX,
	APU_SAMPLE_RATE_HZ,
	APU_SLOT_INDEX_MASK,
	APU_STATUS_BUSY,
	APU_STATUS_CMD_FIFO_EMPTY,
	APU_STATUS_CMD_FIFO_FULL,
	APU_STATUS_DMA_READ_REQUEST,
	APU_STATUS_DMA_WRITE_REQUEST,
	APU_STATUS_FAULT,
	APU_STATUS_SELECTED_SLOT_ACTIVE,
	APU_TRANSFER_FIFO_WORD_CAPACITY,
	APU_TRANSFER_MODE_DMA_READ,
	APU_TRANSFER_MODE_DMA_WRITE,
	APU_TRANSFER_MODE_MANUAL_WRITE,
	APU_TRANSFER_WORDS_PER_SECOND,
	apuSlotRegisterWordIndex,
} from '../../machine/ts/spec/audio/apu';
import {
	APU_SLOT_PHASE_FADING,
	APU_SLOT_PHASE_IDLE,
	APU_SLOT_PHASE_PLAYING,
} from '../../machine/ts/machine/devices/audio/contracts';
import {
	DMA_STATUS_BUSY,
	DMA_STATUS_DONE,
	DMA_TRIGGER_START,
	IO_APU_CMD,
	IO_APU_CMD_CAPACITY,
	IO_APU_CMD_FREE,
	IO_APU_CMD_QUEUED,
	IO_APU_EVENT_KIND,
	IO_APU_EVENT_SEQ,
	IO_APU_EVENT_SLOT,
	IO_APU_EVENT_SOURCE_ADDR,
	IO_APU_ACTIVE_MASK,
	IO_APU_FADE_SAMPLES,
	IO_APU_FAULT_ACK,
	IO_APU_FAULT_CODE,
	IO_APU_FILTER_B0_B1,
	IO_APU_FILTER_A2,
	IO_APU_FILTER_CONTROL,
	IO_APU_FILTER_B2_A1,
	IO_APU_GAIN_Q12,
	IO_APU_GENERATOR_DUTY_Q12,
	IO_APU_GENERATOR_KIND,
	IO_APU_PARAMETER_REGISTER_ADDRS,
	IO_APU_RATE_STEP_Q16,
	IO_APU_STATUS,
	IO_APU_START_SAMPLE,
	IO_APU_SOURCE_ADDR,
	IO_APU_SOURCE_BITS_PER_SAMPLE,
	IO_APU_SOURCE_BYTES,
	IO_APU_SOURCE_CHANNELS,
	IO_APU_SOURCE_DATA_BYTES,
	IO_APU_SOURCE_DATA_OFFSET,
	IO_APU_SOURCE_FRAME_COUNT,
	IO_APU_SOURCE_LOOP_END_SAMPLE,
	IO_APU_SOURCE_LOOP_START_SAMPLE,
	IO_APU_SOURCE_SAMPLE_RATE_HZ,
	IO_APU_SELECTED_SOURCE_ADDR,
	IO_APU_SELECTED_SLOT_REG0,
	IO_APU_SELECTED_SLOT_REG_COUNT,
	IO_APU_SLOT,
	IO_APU_TRANSFER_ADDRESS,
	IO_APU_TRANSFER_CONTROL,
	IO_APU_TRANSFER_DATA,
	IO_ARG_STRIDE,
	IO_CART_SELECT,
	IO_DMA0_CONTROL,
	IO_DMA0_READ_ADDR,
	IO_DMA0_STATUS,
	IO_DMA0_TRANSFER_COUNT,
	IO_DMA0_TRIGGER,
	IO_DMA0_WRITE_ADDR,
	IO_IRQ_FLAGS,
	IRQ_APU,
} from '../../machine/ts/spec/bmsx/io';
import { AudioController } from '../../machine/ts/machine/devices/audio/controller';
import { BiquadFilterState, configureBiquadFilter } from '../../machine/ts/machine/devices/audio/biquad_filter';
import { ApuOutputMixer } from '../../machine/ts/machine/devices/audio/output';
import { APU_OUTPUT_RING_CAPACITY_FRAMES } from '../../machine/ts/machine/devices/audio/output_ring';
import { interpolateApuPcmSample } from '../../machine/ts/machine/devices/audio/pcm_decoder_hot_path';
import { resolveApuPhaseStep } from '../../machine/ts/machine/devices/audio/playback';
import { ApuSampleMemory } from '../../machine/ts/machine/devices/audio/sample_memory';
import type { ApuSourceByteView } from '../../machine/ts/machine/devices/audio/source';
import type { AudioControllerState, ApuOutputState, ApuOutputVoiceState } from '../../machine/ts/machine/devices/audio/save_state';
import { CPU } from '../../machine/ts/machine/cpu/cpu';
import { ExecutionAddressSpace } from '../../machine/ts/machine/execution_address_space';
import { DmaController } from '../../machine/ts/machine/devices/dma/controller';
import { IrqController } from '../../machine/ts/machine/devices/irq/controller';
import { CART_ROM_BASE, DYNAMIC_RAM_BASE, RAM_BASE, SYSTEM_ROM_BASE } from '../../machine/ts/spec/bmsx/memory_map';
import { Memory } from '../../machine/ts/machine/memory/memory';
import { DeviceScheduler } from '../../machine/ts/machine/scheduler/device';
import { cyclesUntilBudgetUnits } from '../../machine/ts/machine/scheduler/budget';
import { AudioOutputResampler } from '../../machine/ts/audio/output_resampler';
import { Machine } from '../../machine/ts/machine/machine';
import { captureMachineSaveState, captureMachineState } from '../../machine/ts/machine/save_state';
import type { InputControllerInputSource, InputControllerSnapshot } from '../../machine/ts/machine/devices/input/contracts';

type FakeVoiceInfo = { slot: number; sourceAddr: number; registerWords: readonly number[]; playbackCursorQ16: number; stopFadeSamples: number };

function createFakeOutputVoiceState(voice: FakeVoiceInfo): ApuOutputVoiceState {
	return {
		slot: voice.slot,
		sourceCartridgeSlot: 0,
		cursorQ16: voice.playbackCursorQ16,
		phaseRemainder: 0,
		gainQ12: 0x1000,
		fadeStepQ12: 0,
		fadeStepRemainder: 0,
		fadeError: 0,
		fadeSamplesRemaining: voice.stopFadeSamples,
		fadeSamplesTotal: voice.stopFadeSamples,
		filter: {
			l1: 0,
			l2: 0,
			r1: 0,
			r2: 0,
		},
		badp: {
			predictors: [0, 0],
			stepIndices: [0, 0],
			nextFrame: 0,
			blockEnd: 0,
			blockFrames: 0,
			blockFrameIndex: 0,
			payloadOffset: 0,
			nibbleCursor: 0,
			decodedFrame: -1,
			decodedLeft: 0,
			decodedRight: 0,
			previousDecodedFrame: -1,
			previousDecodedLeft: 0,
			previousDecodedRight: 0,
		},
	};
}

function createAudioControllerHarness(
	audioOutput: object,
	memory = new Memory({ systemRom: new Uint8Array(0), cartridgeSlots: cartridgeSlots() }),
): { memory: Memory; audio: AudioController; dma: DmaController; scheduler: DeviceScheduler } {
	const irq = new IrqController(memory);
	const cpu = new CPU(memory, irq, new ExecutionAddressSpace(memory));
	const scheduler = new DeviceScheduler(cpu);
	const dma = new DmaController(memory, cpu, irq, scheduler);
	memory.cartridgeController.connect(memory, irq, dma);
	const audio = new AudioController(memory, audioOutput as ApuOutputMixer, dma, irq, scheduler);
	dma.reset();
	memory.cartridgeController.reset();
	audio.reset();
	audio.setTiming(APU_SAMPLE_RATE_HZ, 0);
	return { memory, audio, dma, scheduler };
}

function createAudioHarness(): { memory: Memory; audio: AudioController; dma: DmaController; scheduler: DeviceScheduler } {
	const audioOutput = {
		playVoice: () => {},
		replaceVoiceSource: () => {},
		writeSlotRegisterWord: () => {},
		stopAllVoices: () => {},
		resetPlaybackState: () => {},
		stopSlot: () => {},
		captureState: (): ApuOutputState => ({ voices: [] }),
		restoreVoice: () => {},
		samplesUntilNextEvent: (limit: number) => limit,
		renderMachineFrames: () => 0,
	};
	return createAudioControllerHarness(audioOutput);
}

function createRealAudioHarness(
	memory = new Memory({ systemRom: new Uint8Array(0), cartridgeSlots: cartridgeSlots() }),
): { memory: Memory; audio: AudioController; dma: DmaController; scheduler: DeviceScheduler; audioOutput: ApuOutputMixer; hostOutput: AudioOutputResampler } {
	const audioOutput = new ApuOutputMixer();
	return { ...createAudioControllerHarness(audioOutput, memory), audioOutput, hostOutput: new AudioOutputResampler() };
}

const SILENT_INPUT_SOURCE: InputControllerInputSource = {
	sampleInputControllerSnapshot(_currentTimeMs: number, _snapshot: InputControllerSnapshot): void {},
	supervisorRequestLineHigh(): boolean { return false; },
	applyInputControllerVibrationEffect(_padIndex: number, _durationMs: number, _intensity: number): void {},
};

function createAudioMachine(): Machine {
	const machine = new Machine(new Memory({ systemRom: new Uint8Array(0), cartridgeSlots: cartridgeSlots() }), SILENT_INPUT_SOURCE);
	machine.resetDevices();
	machine.audioController.setTiming(APU_SAMPLE_RATE_HZ, 0);
	return machine;
}

function restoreRealAudioHarness(state: AudioControllerState, nowCycles = 0): { memory: Memory; audio: AudioController; scheduler: DeviceScheduler; audioOutput: ApuOutputMixer; hostOutput: AudioOutputResampler } {
	const restored = createRealAudioHarness();
	restored.scheduler.advanceTo(nowCycles);
	restored.audio.restoreState(state, nowCycles);
	return restored;
}

function createActiveVoiceAudioHarness(stopSlotWithFade = false): {
	memory: Memory;
	audio: AudioController;
	activeVoice: () => FakeVoiceInfo | null;
	stoppedFadeSamples: () => number;
	slotGainQ12: () => number;
} {
	let activeVoice: FakeVoiceInfo | null = null;
	let stoppedFadeSamples = 0;
	let slotGainQ12 = 0;
	const audioOutput = {
		playVoice: (slot: number, source: { sourceAddr: number }, _sourceBytes: ApuSourceByteView, registerWords: readonly number[]) => {
			activeVoice = { slot, sourceAddr: source.sourceAddr, registerWords, playbackCursorQ16: registerWords[APU_PARAMETER_START_SAMPLE_INDEX]! * APU_RATE_STEP_Q16_ONE, stopFadeSamples: 0 };
		},
		replaceVoiceSource: (slot: number, source: { sourceAddr: number }, _sourceBytes: ApuSourceByteView, registerWords: readonly number[]) => {
			const playbackCursorQ16 = activeVoice === null ? 0 : activeVoice.playbackCursorQ16;
			activeVoice = { slot, sourceAddr: source.sourceAddr, registerWords, playbackCursorQ16, stopFadeSamples: stoppedFadeSamples };
		},
		writeSlotRegisterWord: (_slot: number, _source: object, registerWords: readonly number[], parameterIndex: number) => {
			if (parameterIndex === APU_PARAMETER_GAIN_Q12_INDEX) {
				slotGainQ12 = registerWords[APU_PARAMETER_GAIN_Q12_INDEX]!;
			}
		},
		stopAllVoices: () => {
			activeVoice = null;
		},
		resetPlaybackState: () => {
			activeVoice = null;
			stoppedFadeSamples = 0;
		},
		stopSlot: (slot: number, fadeSamples = 0) => {
			const slotActive = activeVoice !== null && activeVoice.slot === slot;
			if (fadeSamples === 0) {
				activeVoice = null;
				return slotActive;
			}
			if (!stopSlotWithFade) {
				return false;
			}
			stoppedFadeSamples = fadeSamples;
			return slotActive;
		},
		captureState: (): ApuOutputState => ({
			voices: activeVoice === null ? [] : [createFakeOutputVoiceState(activeVoice)],
		}),
		restoreVoice: (slot: number, source: { sourceAddr: number }, _sourceBytes: ApuSourceByteView, registerWords: readonly number[], state: ApuOutputVoiceState) => {
			activeVoice = { slot, sourceAddr: source.sourceAddr, registerWords, playbackCursorQ16: state.cursorQ16, stopFadeSamples: state.fadeSamplesRemaining };
		},
		samplesUntilNextEvent: (limit: number) => stoppedFadeSamples !== 0 && stoppedFadeSamples < limit ? stoppedFadeSamples : limit,
		renderMachineFrames: () => 0,
	};
	const { memory, audio } = createAudioControllerHarness(audioOutput);
	return {
		memory,
		audio,
		activeVoice: () => activeVoice,
		stoppedFadeSamples: () => stoppedFadeSamples,
		slotGainQ12: () => slotGainQ12,
	};
}

test('APU contract constants keep hardware command values', () => {
	assert.equal(APU_CMD_PLAY, 1);
	assert.equal(APU_CMD_STOP_SLOT, 2);
	assert.equal(APU_CMD_SET_SLOT_GAIN, 3);
	assert.equal(APU_SAMPLE_RATE_HZ, 44100);
	assert.equal(APU_STATUS_FAULT, 1);
	assert.equal(APU_STATUS_SELECTED_SLOT_ACTIVE, 2);
	assert.equal(APU_STATUS_BUSY, 4);
	assert.equal(APU_STATUS_CMD_FIFO_EMPTY, 32);
	assert.equal(APU_STATUS_CMD_FIFO_FULL, 64);
	assert.equal(APU_COMMAND_FIFO_CAPACITY, 16);
	assert.equal(APU_SLOT_INDEX_MASK, 15);
	assert.equal(APU_SLOT_PHASE_PLAYING, 1);
	assert.equal(APU_SLOT_PHASE_FADING, 2);
	assert.equal(APU_FAULT_SOURCE_RANGE, 0x0102);
	assert.equal(APU_FAULT_UNSUPPORTED_FORMAT, 0x0201);
	assert.equal(APU_FILTER_CONTROL_ENABLE, 1);
	assert.equal(APU_FILTER_COEFFICIENT_ONE, 0x4000);
	assert.equal(APU_EVENT_SLOT_ENDED, 1);
	assert.equal(APU_GENERATOR_SQUARE, 1);
	assert.equal(APU_PARAMETER_REGISTER_COUNT, 21);
	assert.equal(APU_PARAMETER_SOURCE_ADDR_INDEX, 0);
	assert.equal(APU_PARAMETER_SLOT_INDEX, 10);
	assert.equal(APU_PARAMETER_GENERATOR_KIND_INDEX, 19);
	assert.equal(APU_PARAMETER_GENERATOR_DUTY_Q12_INDEX, 20);
	assert.equal(APU_SLOT_REGISTER_WORD_COUNT, 336);
	assert.equal(IO_APU_PARAMETER_REGISTER_ADDRS.length, APU_PARAMETER_REGISTER_COUNT);
	assert.equal(IO_APU_SELECTED_SLOT_REG_COUNT, APU_PARAMETER_REGISTER_COUNT);
});

test('APU raw Q14 biquad has exact signed decode, wrap, saturation, and retained delay state', () => {
	const filter = new BiquadFilterState();
	configureBiquadFilter(filter, 0xffff0001, 0x10002000, 0xe000f000, 0xdead0800);
	assert.equal(filter.enabled, true);
	assert.deepEqual([filter.b0, filter.b1, filter.b2, filter.a1, filter.a2], [8192, 4096, -4096, -8192, 2048]);
	filter.processStereo(16384, -16384);
	assert.deepEqual(
		[filter.outputLeft, filter.outputRight, filter.l1, filter.l2, filter.r1, filter.r2],
		[8192, -8192, 134217728, -83886080, -134217728, 83886080],
	);

	configureBiquadFilter(filter, 0, 0x80008000, 0x80008000, 0xbeef8000);
	assert.equal(filter.enabled, false);
	assert.deepEqual([filter.l1, filter.l2, filter.r1, filter.r2], [134217728, -83886080, -134217728, 83886080]);

	filter.l1 = 0;
	filter.l2 = 0x7fffffff;
	filter.r1 = 0;
	filter.r2 = 0x7fffffff;
	filter.processStereo(-0x8000, -0x8000);
	assert.deepEqual(
		[filter.outputLeft, filter.outputRight, filter.l1, filter.l2, filter.r1, filter.r2],
		[0x7fff, 0x7fff, 0x3fffffff, -0x40000000, 0x3fffffff, -0x40000000],
	);
	assert.equal(interpolateApuPcmSample(0x7fff, -0x8000, 0x8000), -1);
});

test('APU sample bus binds ROM directly, owns sample RAM, and rejects CPU memory', () => {
	const systemRom = new Uint8Array([0xa1, 0xa2, 0xa3, 0xa4, 0xa5, 0xa6]);
	const cartRom = new Uint8Array([0xb1, 0xb2, 0xb3, 0xb4, 0xb5, 0xb6, 0xb7, 0xb8]);
	const memory = new Memory({ systemRom, cartridgeSlots: cartridgeSlots(cartRom) });
	const sampleMemory = new ApuSampleMemory(memory);
	const view: ApuSourceByteView = {
		bytes: new Uint8Array(0),
		byteOffset: 0,
		byteLength: 0,
		cartridgeSlot: 0,
	};

	assert.equal(sampleMemory.bindSource(SYSTEM_ROM_BASE + 1, 4, 0, view), true);
	assert.equal(view.bytes, systemRom);
	assert.deepEqual(Array.from(view.bytes.subarray(view.byteOffset, view.byteOffset + view.byteLength)), [0xa2, 0xa3, 0xa4, 0xa5]);
	assert.equal(sampleMemory.bindSource(CART_ROM_BASE + 2, 4, 0, view), true);
	assert.equal(view.bytes, cartRom);
	assert.deepEqual(Array.from(view.bytes.subarray(view.byteOffset, view.byteOffset + view.byteLength)), [0xb3, 0xb4, 0xb5, 0xb6]);

	sampleMemory.writeWord(0, 0x44332211);
	assert.equal(sampleMemory.bindSource(APU_SAMPLE_RAM_BASE, 4, 0, view), true);
	assert.deepEqual(Array.from(view.bytes.subarray(view.byteOffset, view.byteOffset + view.byteLength)), [0x11, 0x22, 0x33, 0x44]);
	sampleMemory.writeWord(0, 0x88776655);
	assert.deepEqual(Array.from(view.bytes.subarray(view.byteOffset, view.byteOffset + view.byteLength)), [0x55, 0x66, 0x77, 0x88]);
	memory.writeU32(RAM_BASE, 0xccbbaa99);
	assert.equal(sampleMemory.bindSource(RAM_BASE, 4, 0, view), false);
});

function writeSampleRamBytes(memory: Memory, bytes: Uint8Array): void {
	memory.writeMappedWord(IO_APU_TRANSFER_ADDRESS, 0);
	memory.writeMappedWord(IO_APU_TRANSFER_CONTROL, 1);
	for (let offset = 0; offset < bytes.byteLength; offset += 4) {
		memory.writeMappedWord(IO_APU_TRANSFER_DATA, readLE32(bytes, offset));
	}
	memory.writeMappedWord(IO_APU_TRANSFER_CONTROL, 0);
}

function writePcmSourceRegisters(memory: Memory, sourceAddr: number, sourceBytes: number): void {
	memory.writeMappedWord(IO_APU_SOURCE_ADDR, sourceAddr);
	memory.writeMappedWord(IO_APU_SOURCE_BYTES, sourceBytes);
	memory.writeMappedWord(IO_APU_SOURCE_SAMPLE_RATE_HZ, APU_SAMPLE_RATE_HZ);
	memory.writeMappedWord(IO_APU_SOURCE_CHANNELS, 1);
	memory.writeMappedWord(IO_APU_SOURCE_BITS_PER_SAMPLE, 8);
	memory.writeMappedWord(IO_APU_SOURCE_FRAME_COUNT, sourceBytes);
	memory.writeMappedWord(IO_APU_SOURCE_DATA_OFFSET, 0);
	memory.writeMappedWord(IO_APU_SOURCE_DATA_BYTES, sourceBytes);
}

function writeValidSourceRegisters(memory: Memory): void {
	writeSampleRamBytes(memory, new Uint8Array([0x44, 0x33, 0x22, 0x11]));
	writePcmSourceRegisters(memory, APU_SAMPLE_RAM_BASE, 4);
}

test('APU voices read cart sample ROM directly and reject CPU RAM addresses', () => {
	const cartMemory = new Memory({
		systemRom: new Uint8Array(0),
		cartridgeSlots: cartridgeSlots(new Uint8Array([0x44, 0x33, 0x22, 0x11])),
	});
	const cartHarness = createAudioControllerHarness(new ApuOutputMixer(), cartMemory);
	writePcmSourceRegisters(cartMemory, CART_ROM_BASE, 4);
	cartMemory.writeMappedWord(IO_APU_SLOT, 1);
	cartMemory.writeMappedWord(IO_APU_CMD, APU_CMD_PLAY);
	cartHarness.audio.onService(0);
	const cartState = cartHarness.audio.captureState();
	assert.equal(cartState.output.voices.length, 1);
	assert.equal(cartState.slotRegisterWords[apuSlotRegisterWordIndex(1, APU_PARAMETER_SOURCE_ADDR_INDEX)], CART_ROM_BASE);
	assert.deepEqual(cartState.sampleRam.subarray(0, 4), new Uint8Array(4));

	const cpuHarness = createAudioHarness();
	cpuHarness.memory.writeMappedU32LE(DYNAMIC_RAM_BASE, 0x11223344);
	writePcmSourceRegisters(cpuHarness.memory, DYNAMIC_RAM_BASE, 4);
	cpuHarness.memory.writeMappedWord(IO_APU_SLOT, 1);
	cpuHarness.memory.writeMappedWord(IO_APU_CMD, APU_CMD_PLAY);
	cpuHarness.audio.onService(0);
	assertApuFaultLatch(cpuHarness.memory, APU_FAULT_SOURCE_RANGE);
	assert.equal(cpuHarness.memory.readIoU32(IO_APU_ACTIVE_MASK), 0);
});

test('APU voices latch their cartridge socket across CPU selection changes and restore', () => {
	const memory = new Memory({
		systemRom: new Uint8Array(0),
		cartridgeSlots: [
			{
				rom: new Uint8Array([0x00, 0x00, 0x00, 0x00]),
				boardWord: 0,
				ramByteCount: 0,
				present: true,
			},
			{
				rom: new Uint8Array([0xff, 0xff, 0xff, 0xff]),
				boardWord: 0,
				ramByteCount: 0,
				present: true,
			},
		],
	});
	const harness = createRealAudioHarness(memory);
	memory.writeMappedU32LE(IO_CART_SELECT, 1);
	writePcmSourceRegisters(memory, CART_ROM_BASE, 4);
	memory.writeMappedWord(IO_APU_RATE_STEP_Q16, APU_RATE_STEP_Q16_ONE);
	memory.writeMappedWord(IO_APU_GAIN_Q12, APU_GAIN_Q12_ONE);
	memory.writeMappedWord(IO_APU_SLOT, 1);
	writeApuCommand(memory, harness.audio, APU_CMD_PLAY);
	const saved = harness.audio.captureState();
	assert.equal(saved.output.voices[0]!.sourceCartridgeSlot, 1);

	memory.writeMappedU32LE(IO_CART_SELECT, 0);
	harness.audio.restoreState(saved, 0);
	advanceRealApu(harness, 1);
	assert.equal(harness.audioOutput.outputRing.readFramePacked(), 0x7f00_7f00);
});

function serviceScheduledDmaBlock(harness: ReturnType<typeof createAudioHarness>): void {
	const state = harness.dma.captureState();
	assert.notEqual(state.scheduledBlockWords, 0);
	const deadline = harness.scheduler.nowCycles + state.scheduledBlockCycles;
	harness.scheduler.advanceTo(deadline);
	harness.dma.onService(deadline);
}

function serviceScheduledSampleTransfer(harness: ReturnType<typeof createAudioHarness>): void {
	const state = harness.audio.captureState().sampleTransfer;
	assert.notEqual(state.scheduledWords, 0);
	const deadline = harness.scheduler.nowCycles + state.scheduledCycles;
	harness.scheduler.advanceTo(deadline);
	harness.audio.onTransferService(deadline);
}

function finishDmaWriteToSampleRam(harness: ReturnType<typeof createAudioHarness>): void {
	serviceScheduledSampleTransfer(harness);
	serviceScheduledDmaBlock(harness);
	serviceScheduledSampleTransfer(harness);
}

function createTransferEdgeHarness(): ReturnType<typeof createAudioControllerHarness> & { audioOutput: ApuOutputMixer } {
	const audioOutput = new ApuOutputMixer();
	const harness = createAudioControllerHarness(audioOutput);
	harness.dma.setTiming(1, 0, 1, 0, 0, 0);
	harness.audio.setTiming(APU_TRANSFER_WORDS_PER_SECOND, 0);
	writeSampleRamBytes(harness.memory, new Uint8Array([0x40, 0x40, 0x40, 0x40]));
	writePcmSourceRegisters(harness.memory, APU_SAMPLE_RAM_BASE, 4);
	harness.memory.writeMappedWord(IO_APU_SLOT, 1);
	harness.memory.writeMappedWord(IO_APU_CMD, APU_CMD_PLAY);
	harness.audio.onService(0);
	const dmaSource = DYNAMIC_RAM_BASE + 0x300;
	harness.memory.writeMappedU32LE(dmaSource, 0xc0c0c0c0);
	harness.scheduler.advanceTo(46);
	harness.memory.writeMappedU32LE(IO_APU_TRANSFER_ADDRESS, 0);
	harness.memory.writeMappedU32LE(IO_APU_TRANSFER_CONTROL, APU_TRANSFER_MODE_DMA_WRITE);
	harness.memory.writeMappedU32LE(IO_DMA0_READ_ADDR, dmaSource);
	harness.memory.writeMappedU32LE(IO_DMA0_WRITE_ADDR, IO_APU_TRANSFER_DATA);
	harness.memory.writeMappedU32LE(IO_DMA0_TRANSFER_COUNT, 1);
	harness.memory.writeMappedU32LE(IO_DMA0_CONTROL, 0x000000c0);
	harness.memory.writeMappedU32LE(IO_DMA0_TRIGGER, DMA_TRIGGER_START);
	serviceScheduledDmaBlock(harness);
	return { ...harness, audioOutput };
}

test('APU transfer clock makes RAM writes visible on their exact DAC edge', () => {
	const scheduled = createTransferEdgeHarness();
	const status = createTransferEdgeHarness();
	const captured = createTransferEdgeHarness();

	scheduled.scheduler.advanceTo(48);
	scheduled.audio.onTransferService(48);
	status.scheduler.advanceTo(48);
	status.memory.readIoU32(IO_APU_STATUS);
	captured.scheduler.advanceTo(48);
	const capturedState = captured.audio.captureState();

	const scheduledRing = scheduled.audio.synchronizeOutput();
	const statusRing = status.audio.synchronizeOutput();
	const capturedRing = captured.audio.synchronizeOutput();
	assert.equal(scheduledRing.queuedFrames(), 2);
	assert.equal(statusRing.queuedFrames(), 2);
	assert.equal(capturedRing.queuedFrames(), 2);
	const scheduledBefore = scheduledRing.readFramePacked();
	const scheduledAtEdge = scheduledRing.readFramePacked();
	assert.ok((scheduledBefore << 16 >> 16) < 0);
	assert.ok((scheduledAtEdge << 16 >> 16) > 0);
	assert.equal(statusRing.readFramePacked(), scheduledBefore);
	assert.equal(statusRing.readFramePacked(), scheduledAtEdge);
	assert.equal(capturedRing.readFramePacked(), scheduledBefore);
	assert.equal(capturedRing.readFramePacked(), scheduledAtEdge);
	assert.equal(readLE32(capturedState.sampleRam, 0), 0xc0c0c0c0);
});

test('APU manual RAM writes precede a same-cycle DAC sample', () => {
	const harness = createRealAudioHarness();
	harness.audio.setTiming(APU_TRANSFER_WORDS_PER_SECOND, 0);
	writeSampleRamBytes(harness.memory, new Uint8Array([0x40, 0x40, 0x40, 0x40]));
	writePcmSourceRegisters(harness.memory, APU_SAMPLE_RAM_BASE, 4);
	harness.memory.writeMappedWord(IO_APU_SLOT, 1);
	harness.memory.writeMappedWord(IO_APU_CMD, APU_CMD_PLAY);
	harness.audio.onService(0);
	harness.memory.writeMappedU32LE(IO_APU_TRANSFER_ADDRESS, 0);
	harness.memory.writeMappedU32LE(IO_APU_TRANSFER_CONTROL, APU_TRANSFER_MODE_MANUAL_WRITE);
	harness.scheduler.advanceTo(24);
	harness.memory.writeMappedU32LE(IO_APU_TRANSFER_DATA, 0xc0c0c0c0);
	const ring = harness.audio.synchronizeOutput();
	assert.equal(ring.queuedFrames(), 1);
	assert.ok((ring.readFramePacked() << 16 >> 16) > 0);
});

test('APU DMA round-trip obeys FIFO timing, RAM wrap, and mid-transfer restore', () => {
	const live = createAudioHarness();
	live.dma.setTiming(1, 0, 1, 0, 0, 0);
	live.audio.setTiming(APU_TRANSFER_WORDS_PER_SECOND, 0);
	const source = DYNAMIC_RAM_BASE + 0x100;
	const target = DYNAMIC_RAM_BASE + 0x200;
	const transferAddress = APU_SAMPLE_RAM_BYTES - 8;
	for (let index = 0; index < 32; index += 1) {
		live.memory.writeMappedU32LE(source + index * 4, (0x5a000000 | index) >>> 0);
	}

	live.memory.writeMappedU32LE(IO_APU_TRANSFER_ADDRESS, transferAddress);
	live.memory.writeMappedU32LE(IO_APU_TRANSFER_CONTROL, APU_TRANSFER_MODE_DMA_WRITE);
	assert.equal(live.memory.readIoU32(IO_APU_STATUS) & APU_STATUS_DMA_WRITE_REQUEST, APU_STATUS_DMA_WRITE_REQUEST);
	live.memory.writeMappedU32LE(IO_DMA0_READ_ADDR, source);
	live.memory.writeMappedU32LE(IO_DMA0_WRITE_ADDR, IO_APU_TRANSFER_DATA);
	live.memory.writeMappedU32LE(IO_DMA0_TRANSFER_COUNT, 32);
	live.memory.writeMappedU32LE(IO_DMA0_CONTROL, 0x00003cc1);
	live.memory.writeMappedU32LE(IO_DMA0_TRIGGER, DMA_TRIGGER_START);
	assert.equal(live.memory.readIoU32(IO_DMA0_STATUS), DMA_STATUS_BUSY);
	serviceScheduledDmaBlock(live);
	assert.equal(live.memory.readIoU32(IO_DMA0_TRANSFER_COUNT), 16);
	assert.equal(live.memory.readIoU32(IO_APU_STATUS) & APU_STATUS_DMA_WRITE_REQUEST, 0);

	const savedNow = live.scheduler.nowCycles;
	const savedMemory = live.memory.captureSaveState();
	const savedAudio = live.audio.captureState();
	const savedDma = live.dma.captureState();
	assert.equal(readLE32(savedAudio.sampleRam, transferAddress), 0);
	assert.equal(savedAudio.sampleTransfer.fifoCount, 16);
	assert.equal(savedAudio.sampleTransfer.scheduledWords, 16);

	const restored = createAudioHarness();
	restored.dma.setTiming(1, 0, 1, 0, 0, 0);
	restored.audio.setTiming(APU_TRANSFER_WORDS_PER_SECOND, 0);
	restored.scheduler.advanceTo(savedNow);
	restored.memory.restoreSaveState(savedMemory);
	restored.dma.restoreState(savedDma, savedNow);
	restored.audio.restoreState(savedAudio, savedNow);
	restored.dma.postLoad();

	serviceScheduledSampleTransfer(live);
	assert.equal(readLE32(live.audio.captureState().sampleRam, transferAddress), 0x5a000000);
	serviceScheduledDmaBlock(live);
	serviceScheduledSampleTransfer(live);
	finishDmaWriteToSampleRam(restored);
	assert.equal(live.memory.readIoU32(IO_DMA0_STATUS), DMA_STATUS_DONE);
	assert.equal(restored.memory.readIoU32(IO_DMA0_STATUS), DMA_STATUS_DONE);
	const liveCompleted = live.audio.captureState();
	const restoredCompleted = restored.audio.captureState();
	assert.deepEqual(restoredCompleted.sampleRam.subarray(0, 120), liveCompleted.sampleRam.subarray(0, 120));
	assert.deepEqual(restoredCompleted.sampleRam.subarray(transferAddress), liveCompleted.sampleRam.subarray(transferAddress));
	assert.deepEqual(restoredCompleted.sampleTransfer, liveCompleted.sampleTransfer);
	assert.equal(restoredCompleted.sampleCarry, liveCompleted.sampleCarry);
	assert.equal(restoredCompleted.sampleSequence, liveCompleted.sampleSequence);

	live.memory.writeMappedU32LE(IO_APU_TRANSFER_ADDRESS, transferAddress);
	live.memory.writeMappedU32LE(IO_APU_TRANSFER_CONTROL, APU_TRANSFER_MODE_DMA_READ);
	live.memory.writeMappedU32LE(IO_DMA0_READ_ADDR, IO_APU_TRANSFER_DATA);
	live.memory.writeMappedU32LE(IO_DMA0_WRITE_ADDR, target);
	live.memory.writeMappedU32LE(IO_DMA0_TRANSFER_COUNT, 32);
	live.memory.writeMappedU32LE(IO_DMA0_CONTROL, 0x00003c12);
	live.memory.writeMappedU32LE(IO_DMA0_TRIGGER, DMA_TRIGGER_START);
	assert.equal(live.memory.readIoU32(IO_DMA0_STATUS), DMA_STATUS_BUSY);
	serviceScheduledSampleTransfer(live);
	assert.equal(live.memory.readIoU32(IO_APU_STATUS) & APU_STATUS_DMA_READ_REQUEST, APU_STATUS_DMA_READ_REQUEST);
	assert.equal(live.audio.captureState().sampleTransfer.fifoCount, 16);
	live.memory.readMappedU32LE(IO_APU_TRANSFER_DATA);
	assert.equal(live.audio.captureState().sampleTransfer.fifoCount, 16);
	serviceScheduledDmaBlock(live);
	serviceScheduledSampleTransfer(live);
	serviceScheduledDmaBlock(live);
	live.memory.writeMappedU32LE(IO_APU_TRANSFER_CONTROL, 0);
	assert.equal(live.memory.readIoU32(IO_DMA0_STATUS), DMA_STATUS_DONE);
	for (let index = 0; index < 32; index += 1) {
		assert.equal(live.memory.readMappedU32LE(target + index * 4), (0x5a000000 | index) >>> 0);
	}
	assert.equal(live.memory.mappedWriteReady(IO_APU_TRANSFER_DATA), true);
	live.memory.writeMappedU32LE(IO_DMA0_READ_ADDR, IO_APU_TRANSFER_DATA);
	live.memory.writeMappedU32LE(IO_DMA0_WRITE_ADDR, target);
	live.memory.writeMappedU32LE(IO_DMA0_TRANSFER_COUNT, 1);
	live.memory.writeMappedU32LE(IO_DMA0_CONTROL, 0x000003fc);
	live.memory.writeMappedU32LE(IO_DMA0_TRIGGER, DMA_TRIGGER_START);
	assert.equal(live.memory.mappedWriteReady(IO_APU_TRANSFER_DATA), false);
});

test('APU transfer FIFO is not consumed by a forced wrong-direction DMA block', () => {
	const harness = createAudioHarness();
	harness.dma.setTiming(0, 8, 0, 0, 0, 0);
	harness.audio.setTiming(APU_TRANSFER_WORDS_PER_SECOND, 0);
	const source = DYNAMIC_RAM_BASE + 0x500;
	const target = DYNAMIC_RAM_BASE + 0x600;
	for (let index = 0; index < 32; index += 1) {
		harness.memory.writeMappedU32LE(source + index * 4, (0x66000000 | index) >>> 0);
	}

	harness.memory.writeMappedU32LE(IO_APU_TRANSFER_CONTROL, APU_TRANSFER_MODE_DMA_WRITE);
	harness.memory.writeMappedU32LE(IO_DMA0_READ_ADDR, source);
	harness.memory.writeMappedU32LE(IO_DMA0_WRITE_ADDR, IO_APU_TRANSFER_DATA);
	harness.memory.writeMappedU32LE(IO_DMA0_TRANSFER_COUNT, 32);
	harness.memory.writeMappedU32LE(IO_DMA0_CONTROL, 0x00003cc1);
	harness.memory.writeMappedU32LE(IO_DMA0_TRIGGER, DMA_TRIGGER_START);
	serviceScheduledDmaBlock(harness);
	const before = harness.audio.captureState().sampleTransfer;
	assert.equal(before.fifoCount, APU_TRANSFER_FIFO_WORD_CAPACITY);
	assert.equal(before.scheduledWords, APU_TRANSFER_FIFO_WORD_CAPACITY);

	harness.memory.writeMappedU32LE(IO_DMA0_READ_ADDR, IO_APU_TRANSFER_DATA);
	harness.memory.writeMappedU32LE(IO_DMA0_WRITE_ADDR, target);
	harness.memory.writeMappedU32LE(IO_DMA0_CONTROL, 0x00003c02);
	serviceScheduledDmaBlock(harness);
	const afterReverseBlock = harness.audio.captureState().sampleTransfer;
	assert.equal(afterReverseBlock.fifoCount, APU_TRANSFER_FIFO_WORD_CAPACITY);
	assert.equal(afterReverseBlock.scheduledWords, APU_TRANSFER_FIFO_WORD_CAPACITY);

	serviceScheduledSampleTransfer(harness);
	const completed = harness.audio.captureState();
	assert.equal(completed.sampleTransfer.fifoCount, 0);
	assert.equal(completed.sampleTransfer.scheduledWords, 0);
	assert.equal(readLE32(completed.sampleRam, 0), 0x66000000);
});

function writeSquareGeneratorRegisters(memory: Memory): void {
	memory.writeMappedWord(IO_APU_SOURCE_ADDR, 0);
	memory.writeMappedWord(IO_APU_SOURCE_BYTES, 0);
	memory.writeMappedWord(IO_APU_SOURCE_SAMPLE_RATE_HZ, APU_SAMPLE_RATE_HZ / 4);
	memory.writeMappedWord(IO_APU_SOURCE_CHANNELS, 1);
	memory.writeMappedWord(IO_APU_SOURCE_BITS_PER_SAMPLE, 0);
	memory.writeMappedWord(IO_APU_SOURCE_FRAME_COUNT, 2);
	memory.writeMappedWord(IO_APU_SOURCE_DATA_OFFSET, 0);
	memory.writeMappedWord(IO_APU_SOURCE_DATA_BYTES, 0);
	memory.writeMappedWord(IO_APU_SOURCE_LOOP_START_SAMPLE, 0);
	memory.writeMappedWord(IO_APU_SOURCE_LOOP_END_SAMPLE, 2);
	memory.writeMappedWord(IO_APU_GENERATOR_KIND, APU_GENERATOR_SQUARE);
	memory.writeMappedWord(IO_APU_GENERATOR_DUTY_Q12, 0x0800);
}

function startConstantSquareVoice(harness: ReturnType<typeof createRealAudioHarness>, slot: number, gainQ12Word: number): void {
	writeSquareGeneratorRegisters(harness.memory);
	harness.memory.writeMappedWord(IO_APU_RATE_STEP_Q16, 0);
	harness.memory.writeMappedWord(IO_APU_GAIN_Q12, gainQ12Word);
	harness.memory.writeMappedWord(IO_APU_SLOT, slot);
	writeApuCommand(harness.memory, harness.audio, APU_CMD_PLAY);
}

function writeBadpSourceRegisters(memory: Memory, sampleRateHz: number): void {
	const bytes = new Uint8Array(60);
	bytes.set([0x42, 0x41, 0x44, 0x50], 0);
	writeLE16(bytes, 4, 1);
	writeLE16(bytes, 6, 1);
	writeLE32(bytes, 8, sampleRateHz);
	writeLE32(bytes, 12, 8);
	writeLE32(bytes, 36, 48);
	writeLE16(bytes, 48, 8);
	writeLE16(bytes, 50, 12);
	writeLE16(bytes, 52, 0);
	bytes.set([0x11, 0x11, 0x11, 0x11], 56);
	writeSampleRamBytes(memory, bytes);
	memory.writeMappedWord(IO_APU_SOURCE_ADDR, APU_SAMPLE_RAM_BASE);
	memory.writeMappedWord(IO_APU_SOURCE_BYTES, bytes.byteLength);
	memory.writeMappedWord(IO_APU_SOURCE_SAMPLE_RATE_HZ, sampleRateHz);
	memory.writeMappedWord(IO_APU_SOURCE_CHANNELS, 1);
	memory.writeMappedWord(IO_APU_SOURCE_BITS_PER_SAMPLE, 4);
	memory.writeMappedWord(IO_APU_SOURCE_FRAME_COUNT, 8);
	memory.writeMappedWord(IO_APU_SOURCE_DATA_OFFSET, 48);
	memory.writeMappedWord(IO_APU_SOURCE_DATA_BYTES, 12);
}

function writeApuCommand(memory: Memory, audio: AudioController, command: number): void {
	memory.writeMappedWord(IO_APU_CMD, command);
	audio.onService(0);
}

function beginApuPlay(memory: Memory, audio: AudioController, slot: number): void {
	writeValidSourceRegisters(memory);
	memory.writeMappedWord(IO_APU_SLOT, slot);
	writeApuCommand(memory, audio, APU_CMD_PLAY);
}

function enqueueApuPlayWithoutService(memory: Memory, slot: number): void {
	writeValidSourceRegisters(memory);
	memory.writeMappedWord(IO_APU_SLOT, slot);
	memory.writeMappedWord(IO_APU_CMD, APU_CMD_PLAY);
}

async function playApuSlot(memory: Memory, audio: AudioController, slot: number): Promise<void> {
	beginApuPlay(memory, audio, slot);
	await Promise.resolve();
}

function assertApuFaultLatch(memory: Memory, faultCode: number): void {
	assert.equal(memory.readIoU32(IO_APU_FAULT_CODE), faultCode);
	const status = memory.readIoU32(IO_APU_STATUS);
	assert.equal((status & APU_STATUS_FAULT) !== 0, true);
}

function assertApuSlotOneActiveReadback(memory: Memory, slotRegisterWord = 1): void {
	const status = memory.readIoU32(IO_APU_STATUS);
	assert.equal((status & APU_STATUS_SELECTED_SLOT_ACTIVE) !== 0, true);
	assert.equal((status & APU_STATUS_BUSY) !== 0, true);
	assert.equal(memory.readIoU32(IO_APU_SELECTED_SOURCE_ADDR), APU_SAMPLE_RAM_BASE);
	assert.equal(memory.readIoU32(IO_APU_ACTIVE_MASK), 2);
	assert.equal(memory.readIoU32(IO_APU_SELECTED_SLOT_REG0), APU_SAMPLE_RAM_BASE);
	assert.equal(memory.readIoU32(IO_APU_SELECTED_SLOT_REG0 + APU_PARAMETER_SLOT_INDEX * IO_ARG_STRIDE), slotRegisterWord);
}

function assertApuSelectedSlotInactive(memory: Memory): void {
	const status = memory.readIoU32(IO_APU_STATUS);
	assert.equal(status & APU_STATUS_SELECTED_SLOT_ACTIVE, 0);
	assert.equal(memory.readIoU32(IO_APU_SELECTED_SOURCE_ADDR), 0);
	assert.equal(memory.readIoU32(IO_APU_SELECTED_SLOT_REG0), 0);
}

function assertApuIdleReadback(memory: Memory): void {
	const status = memory.readIoU32(IO_APU_STATUS);
	assert.equal(status & APU_STATUS_SELECTED_SLOT_ACTIVE, 0);
	assert.equal(status & APU_STATUS_BUSY, 0);
	assert.equal(memory.readIoU32(IO_APU_SELECTED_SOURCE_ADDR), 0);
	assert.equal(memory.readIoU32(IO_APU_ACTIVE_MASK), 0);
	assert.equal(memory.readIoU32(IO_APU_SELECTED_SLOT_REG0), 0);
}

function assertApuSlotEndedEvent(memory: Memory, eventSequence: number): void {
	assert.equal(memory.readIoU32(IO_APU_EVENT_KIND), APU_EVENT_SLOT_ENDED);
	assert.equal(memory.readIoU32(IO_APU_EVENT_SLOT), 1);
	assert.equal(memory.readIoU32(IO_APU_EVENT_SOURCE_ADDR), APU_SAMPLE_RAM_BASE);
	assert.equal(memory.readIoU32(IO_APU_EVENT_SEQ), eventSequence);
}

test('APU command faults latch in MMIO and ACK self-clears', () => {
	const { memory, audio } = createAudioHarness();

	assert.doesNotThrow(() => memory.writeMappedWord(IO_APU_CMD, 0xffff));
	assertApuFaultLatch(memory, APU_FAULT_BAD_CMD);

	writeApuCommand(memory, audio, APU_CMD_STOP_SLOT);
	assert.equal(memory.readIoU32(IO_APU_FAULT_CODE), APU_FAULT_BAD_CMD, 'APU fault latch should be sticky-first until ACK');

	memory.writeMappedWord(IO_APU_FAULT_ACK, 1);
	assert.equal(memory.readIoU32(IO_APU_FAULT_CODE), APU_FAULT_NONE);
	assert.equal(memory.readIoU32(IO_APU_STATUS) & APU_STATUS_FAULT, 0);
	assert.equal(memory.readIoU32(IO_APU_FAULT_ACK), 0);
});

test('APU command doorbell enqueues a device-owned FIFO snapshot', () => {
	const { memory, audio } = createAudioHarness();

	enqueueApuPlayWithoutService(memory, 1);

	assert.equal(memory.readIoU32(IO_APU_CMD_QUEUED), 1);
	assert.equal(memory.readIoU32(IO_APU_CMD_FREE), APU_COMMAND_FIFO_CAPACITY - 1);
	assert.equal(memory.readIoU32(IO_APU_CMD_CAPACITY), APU_COMMAND_FIFO_CAPACITY);
	const queuedStatus = memory.readIoU32(IO_APU_STATUS);
	assert.equal(queuedStatus & APU_STATUS_BUSY, APU_STATUS_BUSY);
	assert.equal(queuedStatus & APU_STATUS_CMD_FIFO_EMPTY, 0);
	assert.equal(queuedStatus & APU_STATUS_CMD_FIFO_FULL, 0);
	assert.equal(memory.readIoU32(IO_APU_ACTIVE_MASK), 0);
	assert.equal(memory.readIoU32(IO_APU_SLOT), 0);

	audio.onService(0);
	memory.writeMappedWord(IO_APU_SLOT, 1);
	assert.equal(memory.readIoU32(IO_APU_CMD_QUEUED), 0);
	assert.equal(memory.readIoU32(IO_APU_CMD_FREE), APU_COMMAND_FIFO_CAPACITY);
	assert.equal(memory.readIoU32(IO_APU_STATUS) & APU_STATUS_CMD_FIFO_EMPTY, APU_STATUS_CMD_FIFO_EMPTY);
	assertApuSlotOneActiveReadback(memory);
});

test('APU command FIFO full stays a deterministic ring write', () => {
	const { memory, audio } = createAudioHarness();

	for (let index = 0; index < APU_COMMAND_FIFO_CAPACITY; index += 1) {
		memory.writeMappedWord(IO_APU_SLOT, index);
		memory.writeMappedWord(IO_APU_CMD, APU_CMD_STOP_SLOT);
	}
	assert.equal(memory.readIoU32(IO_APU_CMD_QUEUED), APU_COMMAND_FIFO_CAPACITY);
	assert.equal(memory.readIoU32(IO_APU_CMD_FREE), 0);
	assert.equal(memory.readIoU32(IO_APU_STATUS) & APU_STATUS_CMD_FIFO_FULL, APU_STATUS_CMD_FIFO_FULL);

	memory.writeMappedWord(IO_APU_SLOT, 1);
	memory.writeMappedWord(IO_APU_CMD, APU_CMD_STOP_SLOT);
	assert.equal(memory.readIoU32(IO_APU_FAULT_CODE), APU_FAULT_NONE);
	const state = audio.captureState().commandFifo;
	assert.equal(state.count, APU_COMMAND_FIFO_CAPACITY);
	assert.equal(state.readIndex, 1);
	assert.equal(state.writeIndex, 1);
	assert.equal(state.registerWords[APU_PARAMETER_SLOT_INDEX], 1);

	audio.onService(0);
	assert.equal(memory.readIoU32(IO_APU_CMD_QUEUED), 0);
	assert.equal(memory.readIoU32(IO_APU_STATUS) & APU_STATUS_CMD_FIFO_EMPTY, APU_STATUS_CMD_FIFO_EMPTY);
});

test('APU save-state restores pending command FIFO work', () => {
	const { memory, audio } = createAudioHarness();

	enqueueApuPlayWithoutService(memory, 1);
	const saved = audio.captureState();
	assert.equal(saved.commandFifo.count, 1);
	assert.equal(memory.readIoU32(IO_APU_ACTIVE_MASK), 0);

	const restored = createAudioHarness();
	restored.audio.restoreState(saved, 0);
	assert.equal(restored.memory.readIoU32(IO_APU_CMD_QUEUED), 1);
	assert.equal(restored.memory.readIoU32(IO_APU_ACTIVE_MASK), 0);
	restored.audio.onService(0);
	restored.memory.writeMappedWord(IO_APU_SLOT, 1);
	assertApuSlotOneActiveReadback(restored.memory);
});

test('APU output playback parameters flow as raw slot state', () => {
	const { memory, audio } = createRealAudioHarness();

	writeValidSourceRegisters(memory);
	memory.writeMappedWord(IO_APU_RATE_STEP_Q16, 0);
	memory.writeMappedWord(IO_APU_SLOT, 1);
	assert.doesNotThrow(() => writeApuCommand(memory, audio, APU_CMD_PLAY));
	memory.writeMappedWord(IO_APU_SLOT, 1);

	assert.equal(memory.readIoU32(IO_APU_FAULT_CODE), APU_FAULT_NONE);
	assertApuSlotOneActiveReadback(memory);
});

test('APU selected-slot active status is device-owned and saved', async () => {
	const { memory, audio } = createAudioHarness();
	const slotOneSourceRegister = apuSlotRegisterWordIndex(1, APU_PARAMETER_SOURCE_ADDR_INDEX);

	beginApuPlay(memory, audio, 1);
	const activeStatus = memory.readIoU32(IO_APU_STATUS);
	assert.equal((activeStatus & APU_STATUS_BUSY) !== 0, true);
	assertApuSelectedSlotInactive(memory);
	memory.writeMappedWord(IO_APU_SLOT, 1);
	assertApuSlotOneActiveReadback(memory);
	const activeState = audio.captureState();
	assert.equal(activeState.registerWords[APU_PARAMETER_SLOT_INDEX], 1);
	assert.equal(memory.readIoU32(IO_APU_ACTIVE_MASK), 2);
	assert.equal(activeState.slotPhases[1], APU_SLOT_PHASE_PLAYING);
	assert.equal(activeState.slotRegisterWords[slotOneSourceRegister], APU_SAMPLE_RAM_BASE);
	assert.deepEqual(Array.from(activeState.sampleRam.subarray(0, 4)), [0x44, 0x33, 0x22, 0x11]);

	memory.writeMappedWord(IO_APU_SLOT, 0);
	assertApuSelectedSlotInactive(memory);
	memory.writeMappedWord(IO_APU_SLOT, 1);
	assertApuSlotOneActiveReadback(memory);

	const saved = audio.captureState();
	const restored = createAudioHarness();
	restored.audio.restoreState(saved, 0);
	const restoredActiveState = restored.audio.captureState();
	assert.equal(restoredActiveState.registerWords[APU_PARAMETER_SLOT_INDEX], 1);
	assert.equal(restored.memory.readIoU32(IO_APU_ACTIVE_MASK), 2);
	assert.equal(restoredActiveState.slotPhases[1], APU_SLOT_PHASE_PLAYING);
	assert.equal(restored.memory.readIoU32(IO_APU_SLOT), 1);
	assert.equal(restoredActiveState.slotRegisterWords[slotOneSourceRegister], APU_SAMPLE_RAM_BASE);
	assert.deepEqual(Array.from(restoredActiveState.sampleRam.subarray(0, 4)), [0x44, 0x33, 0x22, 0x11]);
	assertApuSlotOneActiveReadback(restored.memory);

	writeApuCommand(restored.memory, restored.audio, APU_CMD_STOP_SLOT);
	assertApuIdleReadback(restored.memory);
	const restoredStoppedState = restored.audio.captureState();
	assert.equal(restored.memory.readIoU32(IO_APU_ACTIVE_MASK), 0);
	assert.equal(restoredStoppedState.slotPhases[1], APU_SLOT_PHASE_IDLE);
	assert.equal(restoredStoppedState.slotRegisterWords[slotOneSourceRegister], 0);
	assert.deepEqual(Array.from(restoredStoppedState.sampleRam.subarray(0, 4)), [0x44, 0x33, 0x22, 0x11]);
});

test('APU slot selectors decode low register bits without bad-slot guards', () => {
	const { memory, audio } = createAudioHarness();
	const rawSlotWord = APU_SLOT_INDEX_MASK + 2;

	beginApuPlay(memory, audio, rawSlotWord);

	const state = audio.captureState();
	assert.equal(memory.readIoU32(IO_APU_FAULT_CODE), APU_FAULT_NONE);
	assert.equal(memory.readIoU32(IO_APU_ACTIVE_MASK), 2);
	assert.equal(state.slotPhases[1], APU_SLOT_PHASE_PLAYING);
	assert.equal(state.slotRegisterWords[apuSlotRegisterWordIndex(1, APU_PARAMETER_SLOT_INDEX)], rawSlotWord);

	memory.writeMappedWord(IO_APU_SLOT, rawSlotWord);
	assertApuSlotOneActiveReadback(memory, rawSlotWord);
});

test('APU parameter registerfile is device-owned and saved', () => {
	const { memory, audio } = createAudioHarness();

	memory.writeMappedWord(IO_APU_SOURCE_ADDR, RAM_BASE + 0x80);
	memory.writeMappedWord(IO_APU_SOURCE_BYTES, 128);
	memory.writeMappedWord(IO_APU_SOURCE_SAMPLE_RATE_HZ, 22050);
	memory.writeMappedWord(IO_APU_SOURCE_CHANNELS, 2);
	memory.writeMappedWord(IO_APU_SOURCE_BITS_PER_SAMPLE, 16);
	memory.writeMappedWord(IO_APU_SOURCE_FRAME_COUNT, 32);
	memory.writeMappedWord(IO_APU_SOURCE_DATA_OFFSET, 12);
	memory.writeMappedWord(IO_APU_SOURCE_DATA_BYTES, 96);
	memory.writeMappedWord(IO_APU_SOURCE_LOOP_START_SAMPLE, 4);
	memory.writeMappedWord(IO_APU_SOURCE_LOOP_END_SAMPLE, 28);
	memory.writeMappedWord(IO_APU_SLOT, 3);
	memory.writeMappedWord(IO_APU_RATE_STEP_Q16, 0x18000);
	memory.writeMappedWord(IO_APU_GAIN_Q12, 0x0800);
	memory.writeMappedWord(IO_APU_START_SAMPLE, 6);
	memory.writeMappedWord(IO_APU_FILTER_CONTROL, 0xa5a50001);
	memory.writeMappedWord(IO_APU_FILTER_B0_B1, 0x1234abcd);
	memory.writeMappedWord(IO_APU_FILTER_B2_A1, 0x89abcdef);
	memory.writeMappedWord(IO_APU_FILTER_A2, 0x76543210);
	memory.writeMappedWord(IO_APU_FADE_SAMPLES, APU_SAMPLE_RATE_HZ);
	memory.writeMappedWord(IO_APU_GENERATOR_KIND, APU_GENERATOR_SQUARE);
	memory.writeMappedWord(IO_APU_GENERATOR_DUTY_Q12, 0x0800);

	const saved = audio.captureState();
	const restored = createAudioHarness();
	restored.audio.restoreState(saved, 0);

	assert.equal(restored.memory.readIoU32(IO_APU_SOURCE_ADDR), RAM_BASE + 0x80);
	assert.equal(restored.memory.readIoU32(IO_APU_SOURCE_BYTES), 128);
	assert.equal(restored.memory.readIoU32(IO_APU_SOURCE_SAMPLE_RATE_HZ), 22050);
	assert.equal(restored.memory.readIoU32(IO_APU_SOURCE_CHANNELS), 2);
	assert.equal(restored.memory.readIoU32(IO_APU_SOURCE_BITS_PER_SAMPLE), 16);
	assert.equal(restored.memory.readIoU32(IO_APU_SOURCE_FRAME_COUNT), 32);
	assert.equal(restored.memory.readIoU32(IO_APU_SOURCE_DATA_OFFSET), 12);
	assert.equal(restored.memory.readIoU32(IO_APU_SOURCE_DATA_BYTES), 96);
	assert.equal(restored.memory.readIoU32(IO_APU_SOURCE_LOOP_START_SAMPLE), 4);
	assert.equal(restored.memory.readIoU32(IO_APU_SOURCE_LOOP_END_SAMPLE), 28);
	assert.equal(restored.memory.readIoU32(IO_APU_SLOT), 3);
	assert.equal(restored.memory.readIoU32(IO_APU_RATE_STEP_Q16), 0x18000);
	assert.equal(restored.memory.readIoU32(IO_APU_GAIN_Q12), 0x0800);
	assert.equal(restored.memory.readIoU32(IO_APU_START_SAMPLE), 6);
	assert.equal(restored.memory.readIoU32(IO_APU_FILTER_CONTROL), 0xa5a50001);
	assert.equal(restored.memory.readIoU32(IO_APU_FILTER_B0_B1), 0x1234abcd);
	assert.equal(restored.memory.readIoU32(IO_APU_FILTER_B2_A1), 0x89abcdef);
	assert.equal(restored.memory.readIoU32(IO_APU_FILTER_A2), 0x76543210);
	assert.equal(restored.memory.readIoU32(IO_APU_FADE_SAMPLES), APU_SAMPLE_RATE_HZ);
	assert.equal(restored.memory.readIoU32(IO_APU_GENERATOR_KIND), APU_GENERATOR_SQUARE);
	assert.equal(restored.memory.readIoU32(IO_APU_GENERATOR_DUTY_Q12), 0x0800);
	assert.equal(restored.audio.captureState().registerWords[APU_PARAMETER_SLOT_INDEX], 3);
});

test('APU same-source slot replay keeps the new voice latch active', async () => {
	const { memory, audio, activeVoice } = createActiveVoiceAudioHarness();
	const slotOneSourceRegister = apuSlotRegisterWordIndex(1, APU_PARAMETER_SOURCE_ADDR_INDEX);
	const slotOneGainRegister = apuSlotRegisterWordIndex(1, APU_PARAMETER_GAIN_Q12_INDEX);
	const selectedGainAddr = IO_APU_SELECTED_SLOT_REG0 + APU_PARAMETER_GAIN_Q12_INDEX * IO_ARG_STRIDE;

	await playApuSlot(memory, audio, 1);
	memory.writeMappedWord(IO_APU_SLOT, 1);
	assertApuSlotOneActiveReadback(memory);
	memory.writeMappedU32LE(IO_APU_ACTIVE_MASK, 0xffffffff);
	assert.equal(memory.readIoU32(IO_APU_ACTIVE_MASK), 2);
	memory.writeMappedU32LE(selectedGainAddr, 0x0800);
	assert.equal(memory.readIoU32(selectedGainAddr), 0x0800);
	const selectedSlotWriteState = audio.captureState();
	assert.equal(selectedSlotWriteState.slotRegisterWords[slotOneGainRegister], 0x0800);

	await playApuSlot(memory, audio, 1);
	memory.writeMappedWord(IO_APU_SLOT, 1);
	assertApuSlotOneActiveReadback(memory);
	const replayState = audio.captureState();
	assert.equal(memory.readIoU32(IO_APU_ACTIVE_MASK), 2);
	assert.equal(replayState.slotRegisterWords[slotOneSourceRegister], APU_SAMPLE_RAM_BASE);

	const staleVoice = activeVoice();
	assert.notEqual(staleVoice, null);
	assert.equal((staleVoice as FakeVoiceInfo).registerWords[APU_PARAMETER_SLOT_INDEX], 1);
	audio.restoreState(replayState, 0);
	memory.writeMappedWord(IO_APU_SLOT, 1);
	assertApuSlotOneActiveReadback(memory);
});

test('APU SET_SLOT_GAIN writes the device-owned current-gain latch directly', async () => {
	const { memory, audio, slotGainQ12 } = createActiveVoiceAudioHarness();

	await playApuSlot(memory, audio, 1);
	memory.writeMappedWord(IO_APU_SLOT, 1);
	memory.writeMappedWord(IO_APU_FADE_SAMPLES, APU_SAMPLE_RATE_HZ);
	memory.writeMappedWord(IO_APU_GAIN_Q12, 0x0800);
	writeApuCommand(memory, audio, APU_CMD_SET_SLOT_GAIN);
	memory.writeMappedWord(IO_APU_SLOT, 1);

	assert.equal(slotGainQ12(), 0x0800);
	assert.equal(memory.readIoU32(IO_APU_SELECTED_SLOT_REG0 + APU_PARAMETER_GAIN_Q12_INDEX * IO_ARG_STRIDE), 0x0800);
	assert.equal(audio.captureState().slotRegisterWords[apuSlotRegisterWordIndex(1, APU_PARAMETER_GAIN_Q12_INDEX)], 0x0800);
});


function advanceRealApu(harness: ReturnType<typeof createRealAudioHarness>, nowCycles: number): void {
	harness.scheduler.advanceTo(nowCycles);
	harness.audio.onService(nowCycles);
}

function advanceScheduledApuTo(harness: ReturnType<typeof createRealAudioHarness>, targetCycle: number): void {
	while (harness.scheduler.nextDeadline() <= targetCycle) {
		const deadline = harness.scheduler.nextDeadline();
		harness.scheduler.advanceTo(deadline);
		harness.audio.onService(deadline);
	}
	harness.scheduler.advanceTo(targetCycle);
}

function programLongPcmVoice(memory: Memory, slot = 1): void {
	const frames = 32;
	const bytes = new Uint8Array(frames);
	for (let frame = 0; frame < frames; frame += 1) {
		bytes[frame] = (frame * 7 + 16) & 0xff;
	}
	writeSampleRamBytes(memory, bytes);
	memory.writeMappedWord(IO_APU_SOURCE_ADDR, APU_SAMPLE_RAM_BASE);
	memory.writeMappedWord(IO_APU_SOURCE_BYTES, bytes.byteLength);
	memory.writeMappedWord(IO_APU_SOURCE_SAMPLE_RATE_HZ, APU_SAMPLE_RATE_HZ);
	memory.writeMappedWord(IO_APU_SOURCE_CHANNELS, 1);
	memory.writeMappedWord(IO_APU_SOURCE_BITS_PER_SAMPLE, 8);
	memory.writeMappedWord(IO_APU_SOURCE_FRAME_COUNT, frames);
	memory.writeMappedWord(IO_APU_SOURCE_DATA_OFFSET, 0);
	memory.writeMappedWord(IO_APU_SOURCE_DATA_BYTES, bytes.byteLength);
	memory.writeMappedWord(IO_APU_RATE_STEP_Q16, APU_RATE_STEP_Q16_ONE);
	memory.writeMappedWord(IO_APU_GAIN_Q12, 0x1000);
	memory.writeMappedWord(IO_APU_SLOT, slot);
}

function beginLongPcmVoice(harness: ReturnType<typeof createRealAudioHarness>): void {
	programLongPcmVoice(harness.memory);
	writeApuCommand(harness.memory, harness.audio, APU_CMD_PLAY);
}

test('APU machine clock advances voices and emits END without host pulls', () => {
	const harness = createRealAudioHarness();
	writeValidSourceRegisters(harness.memory);
	harness.memory.writeMappedWord(IO_APU_RATE_STEP_Q16, APU_RATE_STEP_Q16_ONE);
	harness.memory.writeMappedWord(IO_APU_GAIN_Q12, 0x1000);
	harness.memory.writeMappedWord(IO_APU_SLOT, 1);
	writeApuCommand(harness.memory, harness.audio, APU_CMD_PLAY);

	assert.equal(harness.scheduler.nextDeadline(), 4);
	advanceRealApu(harness, 2);
	const midState = harness.audio.captureState();
	assert.equal(midState.output.voices[0]!.cursorQ16, 2 * APU_RATE_STEP_Q16_ONE);
	assert.equal(harness.audioOutput.outputRing.queuedFrames(), 2);
	assert.equal(harness.memory.readIoU32(IO_APU_ACTIVE_MASK), 2);

	advanceRealApu(harness, 4);
	assert.equal(harness.memory.readIoU32(IO_APU_ACTIVE_MASK), 0);
	assertApuSlotEndedEvent(harness.memory, 1);
	assert.equal(harness.memory.readIoU32(IO_IRQ_FLAGS) & IRQ_APU, IRQ_APU);
});

test('machine capture includes an APU END interrupt materialized at the capture cycle', () => {
	const runtimeMachine = createAudioMachine();
	writeValidSourceRegisters(runtimeMachine.memory);
	runtimeMachine.memory.writeMappedWord(IO_APU_RATE_STEP_Q16, APU_RATE_STEP_Q16_ONE);
	runtimeMachine.memory.writeMappedWord(IO_APU_GAIN_Q12, 0x1000);
	runtimeMachine.memory.writeMappedWord(IO_APU_SLOT, 1);
	writeApuCommand(runtimeMachine.memory, runtimeMachine.audioController, APU_CMD_PLAY);
	runtimeMachine.scheduler.advanceTo(4);
	const runtimeState = captureMachineState(runtimeMachine);
	assert.equal(runtimeState.audio.output.voices.length, 0);
	assert.equal(runtimeState.irq.pendingFlags & IRQ_APU, IRQ_APU);

	const saveMachine = createAudioMachine();
	writeValidSourceRegisters(saveMachine.memory);
	saveMachine.memory.writeMappedWord(IO_APU_RATE_STEP_Q16, APU_RATE_STEP_Q16_ONE);
	saveMachine.memory.writeMappedWord(IO_APU_GAIN_Q12, 0x1000);
	saveMachine.memory.writeMappedWord(IO_APU_SLOT, 1);
	writeApuCommand(saveMachine.memory, saveMachine.audioController, APU_CMD_PLAY);
	saveMachine.scheduler.advanceTo(4);
	const saveState = captureMachineSaveState(saveMachine);
	assert.equal(saveState.audio.output.voices.length, 0);
	assert.equal(saveState.irq.pendingFlags & IRQ_APU, IRQ_APU);
});

test('APU state is invariant under host pull chunking and underflow', () => {
	const untouched = createRealAudioHarness();
	const drained = createRealAudioHarness();
	beginLongPcmVoice(untouched);
	beginLongPcmVoice(drained);
	advanceRealApu(untouched, 8);
	advanceRealApu(drained, 8);

	const first = new Int16Array(6);
	const second = new Int16Array(4);
	drained.hostOutput.pull(drained.audioOutput.outputRing, first, 3, 48000);
	drained.hostOutput.pull(drained.audioOutput.outputRing, second, 2, 48000);
	drained.hostOutput.pull(drained.audioOutput.outputRing, new Int16Array(128), 64, 48000);

	assert.deepEqual(drained.audio.captureState(), untouched.audio.captureState());
});

test('APU host synchronization exposes every elapsed PAL sample without changing device cadence', () => {
	const scheduledOnly = createRealAudioHarness();
	const hostSynchronized = createRealAudioHarness();
	beginLongPcmVoice(scheduledOnly);
	beginLongPcmVoice(hostSynchronized);
	const samplesPerPalFrame = APU_SAMPLE_RATE_HZ / 50;

	advanceScheduledApuTo(scheduledOnly, samplesPerPalFrame * 2);
	const scheduledOutputRing = scheduledOnly.audio.synchronizeOutput();

	advanceScheduledApuTo(hostSynchronized, samplesPerPalFrame);
	const synchronizedOutputRing = hostSynchronized.audio.synchronizeOutput();
	assert.equal(synchronizedOutputRing.queuedFrames(), samplesPerPalFrame);
	advanceScheduledApuTo(hostSynchronized, samplesPerPalFrame * 2);
	assert.equal(hostSynchronized.audio.synchronizeOutput().queuedFrames(), samplesPerPalFrame * 2);

	assert.deepEqual(hostSynchronized.audio.captureState(), scheduledOnly.audio.captureState());
	assert.equal(hostSynchronized.memory.readIoU32(IO_IRQ_FLAGS), scheduledOnly.memory.readIoU32(IO_IRQ_FLAGS));
	assert.equal(scheduledOutputRing.queuedFrames(), samplesPerPalFrame * 2);
	while (scheduledOutputRing.queuedFrames() !== 0) {
		assert.equal(synchronizedOutputRing.readFramePacked(), scheduledOutputRing.readFramePacked());
	}
});

test('APU machine output preserves the silent interval between voices', () => {
	const harness = createRealAudioHarness();
	writeSquareGeneratorRegisters(harness.memory);
	harness.memory.writeMappedWord(IO_APU_RATE_STEP_Q16, APU_RATE_STEP_Q16_ONE);
	harness.memory.writeMappedWord(IO_APU_GAIN_Q12, 0x1000);
	harness.memory.writeMappedWord(IO_APU_SLOT, 1);
	writeApuCommand(harness.memory, harness.audio, APU_CMD_PLAY);
	advanceRealApu(harness, 4);

	harness.memory.writeMappedWord(IO_APU_SLOT, 1);
	harness.memory.writeMappedWord(IO_APU_FADE_SAMPLES, 0);
	harness.memory.writeMappedWord(IO_APU_CMD, APU_CMD_STOP_SLOT);
	harness.audio.onService(4);
	harness.scheduler.advanceTo(8);
	writeSquareGeneratorRegisters(harness.memory);
	harness.memory.writeMappedWord(IO_APU_RATE_STEP_Q16, APU_RATE_STEP_Q16_ONE);
	harness.memory.writeMappedWord(IO_APU_GAIN_Q12, 0x1000);
	harness.memory.writeMappedWord(IO_APU_SLOT, 1);
	harness.memory.writeMappedWord(IO_APU_CMD, APU_CMD_PLAY);
	harness.audio.onService(8);
	advanceRealApu(harness, 12);

	const left = new Int16Array(12);
	for (let frame = 0; frame < left.length; frame += 1) {
		left[frame] = (harness.audioOutput.outputRing.readFramePacked() << 16) >> 16;
	}
	assert.notEqual(left[0], 0);
	assert.deepEqual(left.slice(4, 8), new Int16Array(4));
	assert.notEqual(left[8], 0);
});

test('APU signed-Q12 gain, wide mixing, fade, and save restore follow exact raw vectors', () => {
	assert.equal(APU_GAIN_Q12_FRACTION_BITS, 12);

	const negative = createRealAudioHarness();
	startConstantSquareVoice(negative, 1, 0xffff_f000);
	advanceRealApu(negative, 1);
	assert.equal(negative.audio.captureState().output.voices[0]!.gainQ12, -APU_GAIN_Q12_ONE);
	assert.equal(negative.audioOutput.outputRing.readFramePacked(), 0x8001_8001);

	const overrange = createRealAudioHarness();
	startConstantSquareVoice(overrange, 1, 0x0000_2000);
	advanceRealApu(overrange, 1);
	assert.equal(overrange.audio.captureState().output.voices[0]!.gainQ12, 2 * APU_GAIN_Q12_ONE);
	assert.equal(overrange.audioOutput.outputRing.readFramePacked(), 0x7fff_7fff);

	const cancellation = createRealAudioHarness();
	startConstantSquareVoice(cancellation, 1, 0x0000_2000);
	startConstantSquareVoice(cancellation, 2, 0xffff_e000);
	advanceRealApu(cancellation, 1);
	assert.equal(cancellation.audioOutput.outputRing.readFramePacked(), 0);

	const saturatedMix = createRealAudioHarness();
	startConstantSquareVoice(saturatedMix, 1, APU_GAIN_Q12_ONE);
	startConstantSquareVoice(saturatedMix, 2, APU_GAIN_Q12_ONE);
	advanceRealApu(saturatedMix, 1);
	assert.equal(saturatedMix.audioOutput.outputRing.readFramePacked(), 0x7fff_7fff);

	const wrappedFadeSource = createRealAudioHarness();
	startConstantSquareVoice(wrappedFadeSource, 1, APU_GAIN_Q12_ONE);
	const wrappedFadeState = wrappedFadeSource.audio.captureState();
	wrappedFadeState.output.voices[0]!.gainQ12 = 0x7fff_ffff;
	wrappedFadeState.output.voices[0]!.fadeStepQ12 = -0x8000_0000;
	wrappedFadeState.output.voices[0]!.fadeStepRemainder = -0x8000_0000;
	wrappedFadeState.output.voices[0]!.fadeError = 0xffff_ffff;
	wrappedFadeState.output.voices[0]!.fadeSamplesRemaining = 3;
	wrappedFadeState.output.voices[0]!.fadeSamplesTotal = 1;
	const wrappedFade = restoreRealAudioHarness(wrappedFadeState, 0);
	advanceRealApu(wrappedFade, 2);
	assert.equal(wrappedFade.audioOutput.outputRing.readFramePacked(), 0x7fff_7fff);
	assert.equal(wrappedFade.audioOutput.outputRing.readFramePacked(), 0);
	const wrappedFadeResult = wrappedFade.audio.captureState().output.voices[0]!;
	assert.deepEqual(
		{
			gainQ12: wrappedFadeResult.gainQ12,
			fadeError: wrappedFadeResult.fadeError,
			fadeSamplesRemaining: wrappedFadeResult.fadeSamplesRemaining,
		},
		{
			gainQ12: -0x7fff_ffff,
			fadeError: 0xffff_fffd,
			fadeSamplesRemaining: 1,
		},
	);

	const live = createRealAudioHarness();
	startConstantSquareVoice(live, 1, 0xffff_efff);
	live.memory.writeMappedWord(IO_APU_SLOT, 1);
	live.memory.writeMappedWord(IO_APU_FADE_SAMPLES, 4);
	live.memory.writeMappedWord(IO_APU_CMD, APU_CMD_STOP_SLOT);
	live.audio.onService(0);
	advanceRealApu(live, 2);
	assert.equal(live.audioOutput.outputRing.readFramePacked(), 0x8000_8000);
	assert.equal(live.audioOutput.outputRing.readFramePacked(), 0xa000_a000);
	const saved = live.audio.captureState();
	assert.deepEqual(
		{
			gainQ12: saved.output.voices[0]!.gainQ12,
			fadeStepQ12: saved.output.voices[0]!.fadeStepQ12,
			fadeStepRemainder: saved.output.voices[0]!.fadeStepRemainder,
			fadeError: saved.output.voices[0]!.fadeError,
			fadeSamplesRemaining: saved.output.voices[0]!.fadeSamplesRemaining,
			fadeSamplesTotal: saved.output.voices[0]!.fadeSamplesTotal,
		},
		{
			gainQ12: -0x0800,
			fadeStepQ12: -0x0400,
			fadeStepRemainder: -1,
			fadeError: 1,
			fadeSamplesRemaining: 2,
			fadeSamplesTotal: 4,
		},
	);

	live.audioOutput.outputRing.clear();
	const restored = restoreRealAudioHarness(saved, 2);
	advanceRealApu(live, 4);
	advanceRealApu(restored, 4);
	for (const expected of [0xc000_c000, 0xe000_e000]) {
		assert.equal(live.audioOutput.outputRing.readFramePacked(), expected);
		assert.equal(restored.audioOutput.outputRing.readFramePacked(), expected);
	}
	assert.equal(restored.audio.captureState().output.voices.length, 0);
	assert.deepEqual(restored.audio.captureState(), live.audio.captureState());
});

test('APU save restore resumes the exact future PCM phase while transport stays unsaved', () => {
	const live = createRealAudioHarness();
	beginLongPcmVoice(live);
	advanceRealApu(live, 7);
	const saved = live.audio.captureState();
	assert.equal(saved.sampleSequence, 7);
	const restored = restoreRealAudioHarness(saved, 7);

	assert.equal(restored.audioOutput.outputRing.queuedFrames(), 0);
	live.audioOutput.outputRing.clear();
	advanceRealApu(live, 12);
	advanceRealApu(restored, 12);
	assert.deepEqual(restored.audio.captureState(), live.audio.captureState());

	const liveOutput = new Int16Array(4);
	const restoredOutput = new Int16Array(4);
	live.hostOutput.pull(live.audioOutput.outputRing, liveOutput, 2, APU_SAMPLE_RATE_HZ);
	restored.hostOutput.pull(restored.audioOutput.outputRing, restoredOutput, 2, APU_SAMPLE_RATE_HZ);
	assert.deepEqual(restoredOutput, liveOutput);
});

test('APU BADP interpolation window and selected-slot seek survive save restore', () => {
	const live = createRealAudioHarness();
	writeBadpSourceRegisters(live.memory, APU_SAMPLE_RATE_HZ / 2);
	live.memory.writeMappedWord(IO_APU_RATE_STEP_Q16, APU_RATE_STEP_Q16_ONE);
	live.memory.writeMappedWord(IO_APU_GAIN_Q12, 0x1000);
	live.memory.writeMappedWord(IO_APU_SLOT, 1);
	writeApuCommand(live.memory, live.audio, APU_CMD_PLAY);
	advanceRealApu(live, 3);

	const saved = live.audio.captureState();
	const savedBadp = saved.output.voices[0]!.badp;
	assert.equal(savedBadp.decodedFrame, 2);
	assert.equal(savedBadp.previousDecodedFrame, 1);
	assert.equal(savedBadp.nextFrame, 3);
	live.audioOutput.outputRing.clear();
	const restored = restoreRealAudioHarness(saved, 3);
	advanceRealApu(live, 6);
	advanceRealApu(restored, 6);
	assert.deepEqual(restored.audio.captureState(), live.audio.captureState());
	for (let frame = 0; frame < 3; frame += 1) {
		assert.equal(restored.audioOutput.outputRing.readFramePacked(), live.audioOutput.outputRing.readFramePacked());
	}

	restored.memory.writeMappedWord(IO_APU_SLOT, 1);
	restored.memory.writeMappedU32LE(IO_APU_SELECTED_SLOT_REG0 + APU_PARAMETER_START_SAMPLE_INDEX * IO_ARG_STRIDE, 5);
	const seekBadp = restored.audio.captureState().output.voices[0]!.badp;
	assert.equal(seekBadp.decodedFrame, 5);
	assert.equal(seekBadp.previousDecodedFrame, 4);
	assert.equal(seekBadp.nextFrame, 6);
	restored.audioOutput.outputRing.clear();
	advanceRealApu(restored, 7);
	assert.equal((restored.audioOutput.outputRing.readFramePacked() << 16) >> 16, 6);

	restored.memory.writeMappedU32LE(IO_APU_SELECTED_SLOT_REG0 + APU_PARAMETER_START_SAMPLE_INDEX * IO_ARG_STRIDE, 20);
	const pastEndBadp = restored.audio.captureState().output.voices[0]!.badp;
	assert.equal(pastEndBadp.nextFrame, 8);
	assert.equal(pastEndBadp.decodedFrame, -1);
	assert.equal(pastEndBadp.previousDecodedFrame, -1);
	advanceRealApu(restored, 8);
	assert.equal(restored.audio.captureState().output.voices.length, 0);
});

test('APU filter history and STOP fade resume at the exact saved sample', () => {
	const live = createRealAudioHarness();
	writeSquareGeneratorRegisters(live.memory);
	live.memory.writeMappedWord(IO_APU_RATE_STEP_Q16, APU_RATE_STEP_Q16_ONE);
	live.memory.writeMappedWord(IO_APU_GAIN_Q12, 0x1000);
	live.memory.writeMappedWord(IO_APU_FILTER_CONTROL, APU_FILTER_CONTROL_ENABLE);
	live.memory.writeMappedWord(IO_APU_FILTER_B0_B1, 0x10002000);
	live.memory.writeMappedWord(IO_APU_FILTER_B2_A1, 0xe000f000);
	live.memory.writeMappedWord(IO_APU_FILTER_A2, 0x0800);
	live.memory.writeMappedWord(IO_APU_SLOT, 1);
	writeApuCommand(live.memory, live.audio, APU_CMD_PLAY);
	advanceRealApu(live, 3);

	live.memory.writeMappedWord(IO_APU_SLOT, 1);
	const history = live.audio.captureState().output.voices[0]!.filter;
	live.memory.writeMappedU32LE(IO_APU_SELECTED_SLOT_REG0 + APU_PARAMETER_FILTER_B0_B1_INDEX * IO_ARG_STRIDE, 0x10002000);
	assert.deepEqual(live.audio.captureState().output.voices[0]!.filter, history);
	live.memory.writeMappedU32LE(IO_APU_SELECTED_SLOT_REG0 + APU_PARAMETER_SOURCE_SAMPLE_RATE_HZ_INDEX * IO_ARG_STRIDE, APU_SAMPLE_RATE_HZ / 4);
	assert.deepEqual(live.audio.captureState().output.voices[0]!.filter, history);
	live.memory.writeMappedU32LE(IO_APU_SELECTED_SLOT_REG0 + APU_PARAMETER_FILTER_CONTROL_INDEX * IO_ARG_STRIDE, 0);
	advanceRealApu(live, 4);
	assert.deepEqual(live.audio.captureState().output.voices[0]!.filter, history);
	live.memory.writeMappedU32LE(IO_APU_SELECTED_SLOT_REG0 + APU_PARAMETER_FILTER_CONTROL_INDEX * IO_ARG_STRIDE, APU_FILTER_CONTROL_ENABLE);
	live.memory.writeMappedWord(IO_APU_FADE_SAMPLES, 4);
	live.memory.writeMappedWord(IO_APU_CMD, APU_CMD_STOP_SLOT);
	live.audio.onService(4);
	advanceRealApu(live, 6);
	const saved = live.audio.captureState();
	const savedVoice = saved.output.voices[0]!;
	assert.equal(savedVoice.fadeSamplesRemaining, 2);
	assert.notEqual(savedVoice.filter.l1, 0);
	live.audioOutput.outputRing.clear();
	const restored = restoreRealAudioHarness(saved, 6);
	advanceRealApu(live, 8);
	advanceRealApu(restored, 8);
	assert.deepEqual(restored.audio.captureState(), live.audio.captureState());
	for (let frame = 0; frame < 2; frame += 1) {
		assert.equal(restored.audioOutput.outputRing.readFramePacked(), live.audioOutput.outputRing.readFramePacked());
	}
});

test('APU fixed-point phase remainder is independent of synchronization batch size', () => {
	const split = createRealAudioHarness();
	const batched = createRealAudioHarness();
	beginLongPcmVoice(split);
	beginLongPcmVoice(batched);
	split.memory.writeMappedWord(IO_APU_SLOT, 1);
	batched.memory.writeMappedWord(IO_APU_SLOT, 1);
	split.memory.writeMappedU32LE(IO_APU_SELECTED_SLOT_REG0 + APU_PARAMETER_SOURCE_SAMPLE_RATE_HZ_INDEX * IO_ARG_STRIDE, APU_SAMPLE_RATE_HZ / 2);
	batched.memory.writeMappedU32LE(IO_APU_SELECTED_SLOT_REG0 + APU_PARAMETER_SOURCE_SAMPLE_RATE_HZ_INDEX * IO_ARG_STRIDE, APU_SAMPLE_RATE_HZ / 2);

	advanceRealApu(split, 1);
	advanceRealApu(split, 2);
	advanceRealApu(batched, 2);
	assert.deepEqual(split.audio.captureState().output, batched.audio.captureState().output);
	assert.equal(split.audio.captureState().output.voices[0]!.cursorQ16, APU_RATE_STEP_Q16_ONE);
	assert.equal(split.audio.captureState().output.voices[0]!.phaseRemainder, 0);
});

test('APU phase-step conversion preserves the signed register product', () => {
	const phaseStep = { wholeQ16: 0, remainder: 0 };
	for (const [rateStepQ16Word, sourceSampleRateHz] of [[0x7fff_ffff, 0xffff_ffff], [0x8000_0000, 0xffff_ffff], [0xedcb_a988, 0x9abc_def0], [0x0001_0000, 22050]]) {
		resolveApuPhaseStep(phaseStep, rateStepQ16Word, sourceSampleRateHz);
		const signedRateStep = BigInt(rateStepQ16Word | 0);
		const product = signedRateStep * BigInt(sourceSampleRateHz);
		assert.equal(phaseStep.wholeQ16, Number(product / BigInt(APU_SAMPLE_RATE_HZ)));
		assert.equal(phaseStep.remainder, Number(product % BigInt(APU_SAMPLE_RATE_HZ)));
	}
});

test('APU output-ring overflow drops presentation history without stalling hardware', () => {
	const harness = createRealAudioHarness();
	writeSquareGeneratorRegisters(harness.memory);
	harness.memory.writeMappedWord(IO_APU_RATE_STEP_Q16, APU_RATE_STEP_Q16_ONE);
	harness.memory.writeMappedWord(IO_APU_GAIN_Q12, 0x1000);
	harness.memory.writeMappedWord(IO_APU_SLOT, 1);
	writeApuCommand(harness.memory, harness.audio, APU_CMD_PLAY);

	advanceRealApu(harness, 20000);
	assert.equal(harness.audioOutput.outputRing.queuedFrames(), APU_OUTPUT_RING_CAPACITY_FRAMES);
	assert.equal(harness.memory.readIoU32(IO_APU_ACTIVE_MASK), 2);
	assert.equal(harness.audio.captureState().output.voices.length, 1);
});

test('APU output reaches a 48 kHz PAL host within the bounded presentation window after one idle second', () => {
	const cpuHz = 33_868_800;
	const hostSampleRate = 48000;
	const hostFramesPerPalFrame = 960;
	const harness = createRealAudioHarness();
	harness.audio.setTiming(cpuHz, 0);
	const primeCycle = cyclesUntilBudgetUnits(cpuHz, APU_SAMPLE_RATE_HZ, 0, 2);
	advanceRealApu(harness, primeCycle);
	const primedOutput = new Int16Array(2);
	assert.equal(harness.hostOutput.pull(harness.audioOutput.outputRing, primedOutput, 1, hostSampleRate), 1);
	assert.deepEqual(primedOutput, new Int16Array(2));

	const playCycle = primeCycle + cpuHz;
	advanceRealApu(harness, playCycle);
	assert.equal(harness.audio.captureState().sampleSequence, APU_SAMPLE_RATE_HZ + 2);
	assert.equal(harness.audioOutput.outputRing.queuedFrames(), APU_OUTPUT_RING_CAPACITY_FRAMES);

	writeSquareGeneratorRegisters(harness.memory);
	harness.memory.writeMappedWord(IO_APU_RATE_STEP_Q16, APU_RATE_STEP_Q16_ONE);
	harness.memory.writeMappedWord(IO_APU_GAIN_Q12, 0x1000);
	harness.memory.writeMappedWord(IO_APU_SLOT, 1);
	harness.memory.writeMappedWord(IO_APU_CMD, APU_CMD_PLAY);
	harness.audio.onService(playCycle);
	const carry = harness.audio.captureState().sampleCarry;
	advanceRealApu(harness, playCycle + cyclesUntilBudgetUnits(cpuHz, APU_SAMPLE_RATE_HZ, carry, 2));

	const output = new Int16Array(hostFramesPerPalFrame * 2);
	const historyNumerator = APU_OUTPUT_RING_CAPACITY_FRAMES * hostSampleRate + APU_SAMPLE_RATE_HZ - 1;
	const historyAtHostRate = (historyNumerator - historyNumerator % APU_SAMPLE_RATE_HZ) / APU_SAMPLE_RATE_HZ;
	const publicationBound = historyAtHostRate + hostFramesPerPalFrame;
	let publishedFrames = 0;
	let firstAudibleFrame = -1;
	while (publishedFrames < publicationBound && firstAudibleFrame < 0) {
		const produced = harness.hostOutput.pull(harness.audioOutput.outputRing, output, hostFramesPerPalFrame, hostSampleRate);
		assert.notEqual(produced, 0, 'host drain must keep making progress through retained presentation');
		for (let frame = 0; frame < produced; frame += 1) {
			if (output[frame * 2] !== 0 || output[frame * 2 + 1] !== 0) {
				firstAudibleFrame = publishedFrames + frame;
				break;
			}
		}
		publishedFrames += produced;
	}
	assert.notEqual(firstAudibleFrame, -1, 'post-command audio must reach the host resampler');
	assert.ok(firstAudibleFrame < publicationBound, 'post-command audio must stay within AOUT history plus one host publication quantum');
});
