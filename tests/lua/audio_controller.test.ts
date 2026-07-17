import assert from 'node:assert/strict';
import { test } from 'node:test';

import { writeLE16, writeLE32 } from '../../machine/ts/common/endian';
import {
	APU_COMMAND_FIFO_CAPACITY,
	APU_CMD_PLAY,
	APU_CMD_SET_SLOT_GAIN,
	APU_CMD_STOP_SLOT,
	APU_EVENT_SLOT_ENDED,
	APU_FILTER_HIGHSHELF,
	APU_FILTER_LOWPASS,
	APU_FAULT_BAD_CMD,
	APU_FAULT_NONE,
	APU_FAULT_SOURCE_RANGE,
	APU_FAULT_UNSUPPORTED_FORMAT,
	APU_GENERATOR_NONE,
	APU_GENERATOR_SQUARE,
	APU_PARAMETER_GENERATOR_DUTY_Q12_INDEX,
	APU_PARAMETER_GENERATOR_KIND_INDEX,
	APU_PARAMETER_REGISTER_COUNT,
	APU_PARAMETER_GAIN_Q12_INDEX,
	APU_PARAMETER_RATE_STEP_Q16_INDEX,
	APU_PARAMETER_START_SAMPLE_INDEX,
	APU_RATE_STEP_Q16_ONE,
	APU_PARAMETER_SLOT_INDEX,
	APU_SLOT_REGISTER_WORD_COUNT,
	APU_PARAMETER_SOURCE_ADDR_INDEX,
	APU_PARAMETER_SOURCE_SAMPLE_RATE_HZ_INDEX,
	APU_SAMPLE_RATE_HZ,
	APU_SLOT_INDEX_MASK,
	APU_SLOT_PHASE_FADING,
	APU_SLOT_PHASE_IDLE,
	APU_SLOT_PHASE_PLAYING,
	APU_STATUS_BUSY,
	APU_STATUS_CMD_FIFO_EMPTY,
	APU_STATUS_CMD_FIFO_FULL,
	APU_STATUS_FAULT,
	APU_STATUS_SELECTED_SLOT_ACTIVE,
	apuSlotRegisterWordIndex,
} from '../../machine/ts/machine/devices/audio/contracts';
import {
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
	IO_APU_FILTER_FREQ_HZ,
	IO_APU_FILTER_GAIN_MILLIDB,
	IO_APU_FILTER_KIND,
	IO_APU_FILTER_Q_MILLI,
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
	IO_ARG_STRIDE,
	IO_IRQ_FLAGS,
	IRQ_APU,
} from '../../machine/ts/machine/bus/io';
import { AudioController } from '../../machine/ts/machine/devices/audio/controller';
import { ApuOutputMixer } from '../../machine/ts/machine/devices/audio/output';
import { resolveApuPhaseStep } from '../../machine/ts/machine/devices/audio/playback';
import { ApuSourceDma } from '../../machine/ts/machine/devices/audio/source';
import type { AudioControllerState, ApuOutputState, ApuOutputVoiceState } from '../../machine/ts/machine/devices/audio/save_state';
import { CPU } from '../../machine/ts/machine/cpu/cpu';
import { IrqController } from '../../machine/ts/machine/devices/irq/controller';
import { CART_ROM_BASE, PROGRAM_ROM_BASE, RAM_BASE, SYSTEM_ROM_BASE } from '../../machine/ts/machine/memory/map';
import { Memory } from '../../machine/ts/machine/memory/memory';
import { DeviceScheduler } from '../../machine/ts/machine/scheduler/device';
import { AudioOutputResampler } from '../../machine/ts/audio/output_resampler';
import { Machine } from '../../machine/ts/machine/machine';
import { captureMachineSaveState, captureMachineState } from '../../machine/ts/machine/save_state';
import type { InputControllerInputSource, InputControllerSnapshot } from '../../machine/ts/machine/devices/input/contracts';

type FakeVoiceInfo = { slot: number; sourceAddr: number; registerWords: readonly number[]; playbackCursorQ16: number; stopFadeSamples: number };

function createFakeOutputVoiceState(voice: FakeVoiceInfo): ApuOutputVoiceState {
	return {
		slot: voice.slot,
		cursorQ16: voice.playbackCursorQ16,
		phaseRemainder: 0,
		gain: 1,
		fadeStartGain: 1,
		fadeSamplesRemaining: voice.stopFadeSamples,
		fadeSamplesTotal: voice.stopFadeSamples,
		filter: {
			enabled: false,
			b0: 1,
			b1: 0,
			b2: 0,
			a1: 0,
			a2: 0,
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

function createAudioControllerHarness(audioOutput: object): { memory: Memory; audio: AudioController; scheduler: DeviceScheduler } {
	const memory = new Memory({ systemRom: new Uint8Array(0), cartRom: new Uint8Array(0) });
	const irq = new IrqController(memory);
	const cpu = new CPU(memory, irq);
	const scheduler = new DeviceScheduler(cpu);
	const audio = new AudioController(memory, audioOutput as ApuOutputMixer, irq, scheduler);
	audio.reset();
	audio.setTiming(APU_SAMPLE_RATE_HZ, 0);
	return { memory, audio, scheduler };
}

function createAudioHarness(): { memory: Memory; audio: AudioController; scheduler: DeviceScheduler } {
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

function createRealAudioHarness(): { memory: Memory; audio: AudioController; scheduler: DeviceScheduler; audioOutput: ApuOutputMixer; hostOutput: AudioOutputResampler } {
	const audioOutput = new ApuOutputMixer();
	return { ...createAudioControllerHarness(audioOutput), audioOutput, hostOutput: new AudioOutputResampler() };
}

const SILENT_INPUT_SOURCE: InputControllerInputSource = {
	sampleInputControllerSnapshot(_currentTimeMs: number, _snapshot: InputControllerSnapshot): void {},
	supervisorRequestLineHigh(): boolean { return false; },
	applyInputControllerVibrationEffect(_padIndex: number, _durationMs: number, _intensity: number): void {},
};

function createAudioMachine(): Machine {
	const machine = new Machine(new Memory({ systemRom: new Uint8Array(0), cartRom: new Uint8Array(0) }), SILENT_INPUT_SOURCE);
	machine.initializeSystemIo();
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
		playVoice: (slot: number, source: { sourceAddr: number }, _runtimeBytes: Uint8Array, registerWords: readonly number[]) => {
			activeVoice = { slot, sourceAddr: source.sourceAddr, registerWords, playbackCursorQ16: registerWords[APU_PARAMETER_START_SAMPLE_INDEX]! * APU_RATE_STEP_Q16_ONE, stopFadeSamples: 0 };
		},
		replaceVoiceSource: (slot: number, source: { sourceAddr: number }, _runtimeBytes: Uint8Array, registerWords: readonly number[]) => {
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
		restoreVoice: (slot: number, source: { sourceAddr: number }, _runtimeBytes: Uint8Array, registerWords: readonly number[], state: ApuOutputVoiceState) => {
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
	assert.equal(APU_FILTER_HIGHSHELF, 8);
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

test('APU source DMA views mapped BIOS/cart ROM and owns RAM samples', () => {
	const systemRom = new Uint8Array([0xa1, 0xa2, 0xa3, 0xa4, 0xa5, 0xa6]);
	const cartRom = new Uint8Array([0xb1, 0xb2, 0xb3, 0xb4, 0xb5, 0xb6, 0xb7, 0xb8]);
	const memory = new Memory({ systemRom, cartRom });
	const sourceDma = new ApuSourceDma(memory);
	const source = {
		sourceAddr: SYSTEM_ROM_BASE + 1,
		sourceBytes: 4,
		sampleRateHz: 44100,
		channels: 1,
		bitsPerSample: 8,
		frameCount: 4,
		dataOffset: 0,
		dataBytes: 4,
		loopStartSample: 0,
		loopEndSample: 0,
		generatorKind: APU_GENERATOR_NONE,
		generatorDutyQ12: 0,
	};

	sourceDma.loadSlot(1, source);
	const biosBytes = sourceDma.bytesForSlot(1);
	assert.deepEqual(Array.from(biosBytes.bytes.subarray(biosBytes.byteOffset, biosBytes.byteOffset + biosBytes.byteLength)), [0xa2, 0xa3, 0xa4, 0xa5]);
	assert.equal(biosBytes.bytes.buffer, systemRom.buffer);

	source.sourceAddr = CART_ROM_BASE + 2;
	sourceDma.loadSlot(1, source);
	const cartBytes = sourceDma.bytesForSlot(1);
	assert.deepEqual(Array.from(cartBytes.bytes.subarray(cartBytes.byteOffset, cartBytes.byteOffset + cartBytes.byteLength)), [0xb3, 0xb4, 0xb5, 0xb6]);
	assert.equal(cartBytes.bytes.buffer, cartRom.buffer);

	assert.equal(memory.readMappedU32LE(CART_ROM_BASE + 6), 0x0000b8b7);
	assert.equal(memory.readU8(CART_ROM_BASE + 0x1000), 0);
	assert.equal(memory.isReadableMainMemoryRange(CART_ROM_BASE + 0x1000, 4), true);
	assert.equal(memory.isImmutableMainMemoryRange(CART_ROM_BASE + 0x1000, 4), false);
	source.sourceAddr = CART_ROM_BASE + 6;
	sourceDma.loadSlot(1, source);
	const cartTailBytes = sourceDma.bytesForSlot(1);
	assert.deepEqual(Array.from(cartTailBytes.bytes.subarray(cartTailBytes.byteOffset, cartTailBytes.byteOffset + cartTailBytes.byteLength)), [0xb7, 0xb8, 0x00, 0x00]);
	assert.notEqual(cartTailBytes.bytes.buffer, cartRom.buffer);

	memory.writeU32(RAM_BASE, 0x44332211);
	source.sourceAddr = RAM_BASE;
	sourceDma.loadSlot(1, source);
	const ramBytes = sourceDma.bytesForSlot(1);
	memory.writeU8(RAM_BASE, 0xee);
	assert.deepEqual(Array.from(ramBytes.bytes.subarray(ramBytes.byteOffset, ramBytes.byteOffset + ramBytes.byteLength)), [0x11, 0x22, 0x33, 0x44]);
	assert.notEqual(ramBytes.bytes.buffer, systemRom.buffer);
	assert.notEqual(ramBytes.bytes.buffer, cartRom.buffer);

	memory.setProgramRom(new Uint8Array([0xc1, 0xc2, 0xc3, 0xc4]), 0);
	assert.equal(memory.isImmutableMainMemoryRange(PROGRAM_ROM_BASE, 4), false);
});

function writeValidSourceRegisters(memory: Memory): void {
	memory.writeU32(RAM_BASE, 0x11223344);
	memory.writeValue(IO_APU_SOURCE_ADDR, RAM_BASE);
	memory.writeValue(IO_APU_SOURCE_BYTES, 4);
	memory.writeValue(IO_APU_SOURCE_SAMPLE_RATE_HZ, 44100);
	memory.writeValue(IO_APU_SOURCE_CHANNELS, 1);
	memory.writeValue(IO_APU_SOURCE_BITS_PER_SAMPLE, 8);
	memory.writeValue(IO_APU_SOURCE_FRAME_COUNT, 4);
	memory.writeValue(IO_APU_SOURCE_DATA_OFFSET, 0);
	memory.writeValue(IO_APU_SOURCE_DATA_BYTES, 4);
}

function writeSquareGeneratorRegisters(memory: Memory): void {
	memory.writeValue(IO_APU_SOURCE_ADDR, 0);
	memory.writeValue(IO_APU_SOURCE_BYTES, 0);
	memory.writeValue(IO_APU_SOURCE_SAMPLE_RATE_HZ, APU_SAMPLE_RATE_HZ / 4);
	memory.writeValue(IO_APU_SOURCE_CHANNELS, 1);
	memory.writeValue(IO_APU_SOURCE_BITS_PER_SAMPLE, 0);
	memory.writeValue(IO_APU_SOURCE_FRAME_COUNT, 2);
	memory.writeValue(IO_APU_SOURCE_DATA_OFFSET, 0);
	memory.writeValue(IO_APU_SOURCE_DATA_BYTES, 0);
	memory.writeValue(IO_APU_SOURCE_LOOP_START_SAMPLE, 0);
	memory.writeValue(IO_APU_SOURCE_LOOP_END_SAMPLE, 2);
	memory.writeValue(IO_APU_GENERATOR_KIND, APU_GENERATOR_SQUARE);
	memory.writeValue(IO_APU_GENERATOR_DUTY_Q12, 0x0800);
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
	memory.writeBytes(RAM_BASE, bytes);
	memory.writeValue(IO_APU_SOURCE_ADDR, RAM_BASE);
	memory.writeValue(IO_APU_SOURCE_BYTES, bytes.byteLength);
	memory.writeValue(IO_APU_SOURCE_SAMPLE_RATE_HZ, sampleRateHz);
	memory.writeValue(IO_APU_SOURCE_CHANNELS, 1);
	memory.writeValue(IO_APU_SOURCE_BITS_PER_SAMPLE, 4);
	memory.writeValue(IO_APU_SOURCE_FRAME_COUNT, 8);
	memory.writeValue(IO_APU_SOURCE_DATA_OFFSET, 48);
	memory.writeValue(IO_APU_SOURCE_DATA_BYTES, 12);
}

function writeApuCommand(memory: Memory, audio: AudioController, command: number): void {
	memory.writeValue(IO_APU_CMD, command);
	audio.onService(0);
}

function beginApuPlay(memory: Memory, audio: AudioController, slot: number): void {
	writeValidSourceRegisters(memory);
	memory.writeValue(IO_APU_SLOT, slot);
	writeApuCommand(memory, audio, APU_CMD_PLAY);
}

function enqueueApuPlayWithoutService(memory: Memory, slot: number): void {
	writeValidSourceRegisters(memory);
	memory.writeValue(IO_APU_SLOT, slot);
	memory.writeValue(IO_APU_CMD, APU_CMD_PLAY);
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
	assert.equal(memory.readIoU32(IO_APU_SELECTED_SOURCE_ADDR), RAM_BASE);
	assert.equal(memory.readIoU32(IO_APU_ACTIVE_MASK), 2);
	assert.equal(memory.readIoU32(IO_APU_SELECTED_SLOT_REG0), RAM_BASE);
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
	assert.equal(memory.readIoU32(IO_APU_EVENT_SOURCE_ADDR), RAM_BASE);
	assert.equal(memory.readIoU32(IO_APU_EVENT_SEQ), eventSequence);
}

test('APU command faults latch in MMIO and ACK self-clears', () => {
	const { memory, audio } = createAudioHarness();

	assert.doesNotThrow(() => memory.writeValue(IO_APU_CMD, 0xffff));
	assertApuFaultLatch(memory, APU_FAULT_BAD_CMD);

	writeApuCommand(memory, audio, APU_CMD_STOP_SLOT);
	assert.equal(memory.readIoU32(IO_APU_FAULT_CODE), APU_FAULT_BAD_CMD, 'APU fault latch should be sticky-first until ACK');

	memory.writeValue(IO_APU_FAULT_ACK, 1);
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
	memory.writeValue(IO_APU_SLOT, 1);
	assert.equal(memory.readIoU32(IO_APU_CMD_QUEUED), 0);
	assert.equal(memory.readIoU32(IO_APU_CMD_FREE), APU_COMMAND_FIFO_CAPACITY);
	assert.equal(memory.readIoU32(IO_APU_STATUS) & APU_STATUS_CMD_FIFO_EMPTY, APU_STATUS_CMD_FIFO_EMPTY);
	assertApuSlotOneActiveReadback(memory);
});

test('APU command FIFO full stays a deterministic ring write', () => {
	const { memory, audio } = createAudioHarness();

	for (let index = 0; index < APU_COMMAND_FIFO_CAPACITY; index += 1) {
		memory.writeValue(IO_APU_SLOT, index);
		memory.writeValue(IO_APU_CMD, APU_CMD_STOP_SLOT);
	}
	assert.equal(memory.readIoU32(IO_APU_CMD_QUEUED), APU_COMMAND_FIFO_CAPACITY);
	assert.equal(memory.readIoU32(IO_APU_CMD_FREE), 0);
	assert.equal(memory.readIoU32(IO_APU_STATUS) & APU_STATUS_CMD_FIFO_FULL, APU_STATUS_CMD_FIFO_FULL);

	memory.writeValue(IO_APU_SLOT, 1);
	memory.writeValue(IO_APU_CMD, APU_CMD_STOP_SLOT);
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
	restored.memory.writeValue(IO_APU_SLOT, 1);
	assertApuSlotOneActiveReadback(restored.memory);
});

test('APU output playback parameters flow as raw slot state', () => {
	const { memory, audio } = createRealAudioHarness();

	writeValidSourceRegisters(memory);
	memory.writeValue(IO_APU_RATE_STEP_Q16, 0);
	memory.writeValue(IO_APU_SLOT, 1);
	assert.doesNotThrow(() => writeApuCommand(memory, audio, APU_CMD_PLAY));
	memory.writeValue(IO_APU_SLOT, 1);

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
	memory.writeValue(IO_APU_SLOT, 1);
	assertApuSlotOneActiveReadback(memory);
	const activeState = audio.captureState();
	assert.equal(activeState.registerWords[APU_PARAMETER_SLOT_INDEX], 1);
	assert.equal(memory.readIoU32(IO_APU_ACTIVE_MASK), 2);
	assert.equal(activeState.slotPhases[1], APU_SLOT_PHASE_PLAYING);
	assert.equal(activeState.slotRegisterWords[slotOneSourceRegister], RAM_BASE);
	assert.deepEqual(Array.from(activeState.slotSourceBytes[1]!), [0x44, 0x33, 0x22, 0x11]);

	memory.writeValue(IO_APU_SLOT, 0);
	assertApuSelectedSlotInactive(memory);
	memory.writeValue(IO_APU_SLOT, 1);
	assertApuSlotOneActiveReadback(memory);

	const saved = audio.captureState();
	const restored = createAudioHarness();
	restored.audio.restoreState(saved, 0);
	const restoredActiveState = restored.audio.captureState();
	assert.equal(restoredActiveState.registerWords[APU_PARAMETER_SLOT_INDEX], 1);
	assert.equal(restored.memory.readIoU32(IO_APU_ACTIVE_MASK), 2);
	assert.equal(restoredActiveState.slotPhases[1], APU_SLOT_PHASE_PLAYING);
	assert.equal(restored.memory.readIoU32(IO_APU_SLOT), 1);
	assert.equal(restoredActiveState.slotRegisterWords[slotOneSourceRegister], RAM_BASE);
	assert.deepEqual(Array.from(restoredActiveState.slotSourceBytes[1]!), [0x44, 0x33, 0x22, 0x11]);
	assertApuSlotOneActiveReadback(restored.memory);

	writeApuCommand(restored.memory, restored.audio, APU_CMD_STOP_SLOT);
	assertApuIdleReadback(restored.memory);
	const restoredStoppedState = restored.audio.captureState();
	assert.equal(restored.memory.readIoU32(IO_APU_ACTIVE_MASK), 0);
	assert.equal(restoredStoppedState.slotPhases[1], APU_SLOT_PHASE_IDLE);
	assert.equal(restoredStoppedState.slotRegisterWords[slotOneSourceRegister], 0);
	assert.equal(restoredStoppedState.slotSourceBytes[1]!.byteLength, 0);
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

	memory.writeValue(IO_APU_SLOT, rawSlotWord);
	assertApuSlotOneActiveReadback(memory, rawSlotWord);
});

test('APU parameter registerfile is device-owned and saved', () => {
	const { memory, audio } = createAudioHarness();

	memory.writeValue(IO_APU_SOURCE_ADDR, RAM_BASE + 0x80);
	memory.writeValue(IO_APU_SOURCE_BYTES, 128);
	memory.writeValue(IO_APU_SOURCE_SAMPLE_RATE_HZ, 22050);
	memory.writeValue(IO_APU_SOURCE_CHANNELS, 2);
	memory.writeValue(IO_APU_SOURCE_BITS_PER_SAMPLE, 16);
	memory.writeValue(IO_APU_SOURCE_FRAME_COUNT, 32);
	memory.writeValue(IO_APU_SOURCE_DATA_OFFSET, 12);
	memory.writeValue(IO_APU_SOURCE_DATA_BYTES, 96);
	memory.writeValue(IO_APU_SOURCE_LOOP_START_SAMPLE, 4);
	memory.writeValue(IO_APU_SOURCE_LOOP_END_SAMPLE, 28);
	memory.writeValue(IO_APU_SLOT, 3);
	memory.writeValue(IO_APU_RATE_STEP_Q16, 0x18000);
	memory.writeValue(IO_APU_GAIN_Q12, 0x0800);
	memory.writeValue(IO_APU_START_SAMPLE, 6);
	memory.writeValue(IO_APU_FILTER_KIND, APU_FILTER_HIGHSHELF);
	memory.writeValue(IO_APU_FILTER_FREQ_HZ, 1200);
	memory.writeValue(IO_APU_FILTER_Q_MILLI, 700);
	memory.writeValue(IO_APU_FILTER_GAIN_MILLIDB, 3000);
	memory.writeValue(IO_APU_FADE_SAMPLES, APU_SAMPLE_RATE_HZ);
	memory.writeValue(IO_APU_GENERATOR_KIND, APU_GENERATOR_SQUARE);
	memory.writeValue(IO_APU_GENERATOR_DUTY_Q12, 0x0800);

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
	assert.equal(restored.memory.readIoU32(IO_APU_FILTER_KIND), APU_FILTER_HIGHSHELF);
	assert.equal(restored.memory.readIoU32(IO_APU_FILTER_FREQ_HZ), 1200);
	assert.equal(restored.memory.readIoU32(IO_APU_FILTER_Q_MILLI), 700);
	assert.equal(restored.memory.readIoU32(IO_APU_FILTER_GAIN_MILLIDB), 3000);
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
	memory.writeValue(IO_APU_SLOT, 1);
	assertApuSlotOneActiveReadback(memory);
	memory.writeMappedU32LE(IO_APU_ACTIVE_MASK, 0xffffffff);
	assert.equal(memory.readIoU32(IO_APU_ACTIVE_MASK), 2);
	memory.writeMappedU32LE(selectedGainAddr, 0x0800);
	assert.equal(memory.readIoU32(selectedGainAddr), 0x0800);
	const selectedSlotWriteState = audio.captureState();
	assert.equal(selectedSlotWriteState.slotRegisterWords[slotOneGainRegister], 0x0800);

	await playApuSlot(memory, audio, 1);
	memory.writeValue(IO_APU_SLOT, 1);
	assertApuSlotOneActiveReadback(memory);
	const replayState = audio.captureState();
	assert.equal(memory.readIoU32(IO_APU_ACTIVE_MASK), 2);
	assert.equal(replayState.slotRegisterWords[slotOneSourceRegister], RAM_BASE);

	const staleVoice = activeVoice();
	assert.notEqual(staleVoice, null);
	assert.equal((staleVoice as FakeVoiceInfo).registerWords[APU_PARAMETER_SLOT_INDEX], 1);
	audio.restoreState(replayState, 0);
	memory.writeValue(IO_APU_SLOT, 1);
	assertApuSlotOneActiveReadback(memory);
});

test('APU SET_SLOT_GAIN writes the device-owned current-gain latch directly', async () => {
	const { memory, audio, slotGainQ12 } = createActiveVoiceAudioHarness();

	await playApuSlot(memory, audio, 1);
	memory.writeValue(IO_APU_SLOT, 1);
	memory.writeValue(IO_APU_FADE_SAMPLES, APU_SAMPLE_RATE_HZ);
	memory.writeValue(IO_APU_GAIN_Q12, 0x0800);
	writeApuCommand(memory, audio, APU_CMD_SET_SLOT_GAIN);
	memory.writeValue(IO_APU_SLOT, 1);

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
	memory.writeBytes(RAM_BASE, bytes);
	memory.writeValue(IO_APU_SOURCE_ADDR, RAM_BASE);
	memory.writeValue(IO_APU_SOURCE_BYTES, bytes.byteLength);
	memory.writeValue(IO_APU_SOURCE_SAMPLE_RATE_HZ, APU_SAMPLE_RATE_HZ);
	memory.writeValue(IO_APU_SOURCE_CHANNELS, 1);
	memory.writeValue(IO_APU_SOURCE_BITS_PER_SAMPLE, 8);
	memory.writeValue(IO_APU_SOURCE_FRAME_COUNT, frames);
	memory.writeValue(IO_APU_SOURCE_DATA_OFFSET, 0);
	memory.writeValue(IO_APU_SOURCE_DATA_BYTES, bytes.byteLength);
	memory.writeValue(IO_APU_RATE_STEP_Q16, APU_RATE_STEP_Q16_ONE);
	memory.writeValue(IO_APU_GAIN_Q12, 0x1000);
	memory.writeValue(IO_APU_SLOT, slot);
}

function beginLongPcmVoice(harness: ReturnType<typeof createRealAudioHarness>): void {
	programLongPcmVoice(harness.memory);
	writeApuCommand(harness.memory, harness.audio, APU_CMD_PLAY);
}

test('APU machine clock advances voices and emits END without host pulls', () => {
	const harness = createRealAudioHarness();
	writeValidSourceRegisters(harness.memory);
	harness.memory.writeValue(IO_APU_RATE_STEP_Q16, APU_RATE_STEP_Q16_ONE);
	harness.memory.writeValue(IO_APU_GAIN_Q12, 0x1000);
	harness.memory.writeValue(IO_APU_SLOT, 1);
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
	runtimeMachine.memory.writeValue(IO_APU_RATE_STEP_Q16, APU_RATE_STEP_Q16_ONE);
	runtimeMachine.memory.writeValue(IO_APU_GAIN_Q12, 0x1000);
	runtimeMachine.memory.writeValue(IO_APU_SLOT, 1);
	writeApuCommand(runtimeMachine.memory, runtimeMachine.audioController, APU_CMD_PLAY);
	runtimeMachine.scheduler.advanceTo(4);
	const runtimeState = captureMachineState(runtimeMachine);
	assert.equal(runtimeState.audio.output.voices.length, 0);
	assert.equal(runtimeState.irq.pendingFlags & IRQ_APU, IRQ_APU);

	const saveMachine = createAudioMachine();
	writeValidSourceRegisters(saveMachine.memory);
	saveMachine.memory.writeValue(IO_APU_RATE_STEP_Q16, APU_RATE_STEP_Q16_ONE);
	saveMachine.memory.writeValue(IO_APU_GAIN_Q12, 0x1000);
	saveMachine.memory.writeValue(IO_APU_SLOT, 1);
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
	drained.hostOutput.pull(drained.audioOutput.outputRing, first, 3, 48000, 0.75);
	drained.hostOutput.pull(drained.audioOutput.outputRing, second, 2, 48000, 0.75);
	drained.hostOutput.pull(drained.audioOutput.outputRing, new Int16Array(128), 64, 48000, 0.75);

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
	harness.memory.writeValue(IO_APU_RATE_STEP_Q16, APU_RATE_STEP_Q16_ONE);
	harness.memory.writeValue(IO_APU_GAIN_Q12, 0x1000);
	harness.memory.writeValue(IO_APU_SLOT, 1);
	writeApuCommand(harness.memory, harness.audio, APU_CMD_PLAY);
	advanceRealApu(harness, 4);

	harness.memory.writeValue(IO_APU_SLOT, 1);
	harness.memory.writeValue(IO_APU_FADE_SAMPLES, 0);
	harness.memory.writeValue(IO_APU_CMD, APU_CMD_STOP_SLOT);
	harness.audio.onService(4);
	harness.scheduler.advanceTo(8);
	writeSquareGeneratorRegisters(harness.memory);
	harness.memory.writeValue(IO_APU_RATE_STEP_Q16, APU_RATE_STEP_Q16_ONE);
	harness.memory.writeValue(IO_APU_GAIN_Q12, 0x1000);
	harness.memory.writeValue(IO_APU_SLOT, 1);
	harness.memory.writeValue(IO_APU_CMD, APU_CMD_PLAY);
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

test('APU save restore resumes the exact future PCM phase while transport stays unsaved', () => {
	const live = createRealAudioHarness();
	beginLongPcmVoice(live);
	advanceRealApu(live, 7);
	const saved = live.audio.captureState();
	const restored = restoreRealAudioHarness(saved, 7);

	assert.equal(restored.audioOutput.outputRing.queuedFrames(), 0);
	live.audioOutput.outputRing.clear();
	advanceRealApu(live, 12);
	advanceRealApu(restored, 12);
	assert.deepEqual(restored.audio.captureState(), live.audio.captureState());

	const liveOutput = new Int16Array(4);
	const restoredOutput = new Int16Array(4);
	live.hostOutput.pull(live.audioOutput.outputRing, liveOutput, 2, APU_SAMPLE_RATE_HZ, 1);
	restored.hostOutput.pull(restored.audioOutput.outputRing, restoredOutput, 2, APU_SAMPLE_RATE_HZ, 1);
	assert.deepEqual(restoredOutput, liveOutput);
});

test('APU BADP interpolation window and selected-slot seek survive save restore', () => {
	const live = createRealAudioHarness();
	writeBadpSourceRegisters(live.memory, APU_SAMPLE_RATE_HZ / 2);
	live.memory.writeValue(IO_APU_RATE_STEP_Q16, APU_RATE_STEP_Q16_ONE);
	live.memory.writeValue(IO_APU_GAIN_Q12, 0x1000);
	live.memory.writeValue(IO_APU_SLOT, 1);
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

	restored.memory.writeValue(IO_APU_SLOT, 1);
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
	live.memory.writeValue(IO_APU_RATE_STEP_Q16, APU_RATE_STEP_Q16_ONE);
	live.memory.writeValue(IO_APU_GAIN_Q12, 0x1000);
	live.memory.writeValue(IO_APU_FILTER_KIND, APU_FILTER_LOWPASS);
	live.memory.writeValue(IO_APU_FILTER_FREQ_HZ, 1200);
	live.memory.writeValue(IO_APU_FILTER_Q_MILLI, 700);
	live.memory.writeValue(IO_APU_SLOT, 1);
	writeApuCommand(live.memory, live.audio, APU_CMD_PLAY);
	advanceRealApu(live, 3);

	live.memory.writeValue(IO_APU_SLOT, 1);
	live.memory.writeValue(IO_APU_FADE_SAMPLES, 4);
	live.memory.writeValue(IO_APU_CMD, APU_CMD_STOP_SLOT);
	live.audio.onService(3);
	advanceRealApu(live, 5);
	const saved = live.audio.captureState();
	const savedVoice = saved.output.voices[0]!;
	assert.equal(savedVoice.fadeSamplesRemaining, 2);
	assert.equal(savedVoice.filter.enabled, true);
	assert.notEqual(savedVoice.filter.l1, 0);
	live.audioOutput.outputRing.clear();
	const restored = restoreRealAudioHarness(saved, 5);
	advanceRealApu(live, 7);
	advanceRealApu(restored, 7);
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
	split.memory.writeValue(IO_APU_SLOT, 1);
	batched.memory.writeValue(IO_APU_SLOT, 1);
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
	harness.memory.writeValue(IO_APU_RATE_STEP_Q16, APU_RATE_STEP_Q16_ONE);
	harness.memory.writeValue(IO_APU_GAIN_Q12, 0x1000);
	harness.memory.writeValue(IO_APU_SLOT, 1);
	writeApuCommand(harness.memory, harness.audio, APU_CMD_PLAY);

	advanceRealApu(harness, 20000);
	assert.equal(harness.audioOutput.outputRing.queuedFrames(), 16384);
	assert.equal(harness.memory.readIoU32(IO_APU_ACTIVE_MASK), 2);
	assert.equal(harness.audio.captureState().output.voices.length, 1);
});
