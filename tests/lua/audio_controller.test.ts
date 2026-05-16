import assert from 'node:assert/strict';
import { test } from 'node:test';

import { writeLE16, writeLE32 } from '../../src/bmsx/common/endian';
import {
	APU_COMMAND_FIFO_CAPACITY,
	APU_CMD_PLAY,
	APU_CMD_SET_SLOT_GAIN,
	APU_CMD_STOP_SLOT,
	APU_EVENT_SLOT_ENDED,
	APU_FILTER_HIGHSHELF,
	APU_FILTER_LOWPASS,
	APU_FAULT_BAD_CMD,
	APU_FAULT_CMD_FIFO_FULL,
	APU_FAULT_NONE,
	APU_FAULT_OUTPUT_PLAYBACK_RATE,
	APU_FAULT_SOURCE_RANGE,
	APU_FAULT_UNSUPPORTED_FORMAT,
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
	APU_OUTPUT_QUEUE_CAPACITY_FRAMES,
	APU_SAMPLE_RATE_HZ,
	APU_SLOT_PHASE_FADING,
	APU_SLOT_PHASE_IDLE,
	APU_SLOT_PHASE_PLAYING,
	APU_STATUS_BUSY,
	APU_STATUS_CMD_FIFO_EMPTY,
	APU_STATUS_CMD_FIFO_FULL,
	APU_STATUS_FAULT,
	APU_STATUS_OUTPUT_EMPTY,
	APU_STATUS_OUTPUT_FULL,
	APU_STATUS_SELECTED_SLOT_ACTIVE,
	apuSlotRegisterWordIndex,
} from '../../src/bmsx/machine/devices/audio/contracts';
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
	IO_APU_OUTPUT_CAPACITY_FRAMES,
	IO_APU_OUTPUT_FREE_FRAMES,
	IO_APU_OUTPUT_QUEUED_FRAMES,
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
} from '../../src/bmsx/machine/bus/io';
import { AudioController } from '../../src/bmsx/machine/devices/audio/controller';
import { ApuOutputMixer } from '../../src/bmsx/machine/devices/audio/output';
import type { ApuOutputState, ApuOutputVoiceState } from '../../src/bmsx/machine/devices/audio/save_state';
import { CPU } from '../../src/bmsx/machine/cpu/cpu';
import { IrqController } from '../../src/bmsx/machine/devices/irq/controller';
import { DEFAULT_LUA_BUILTIN_NAMES } from '../../src/bmsx/machine/firmware/builtin_descriptors';
import { SYSTEM_ROM_GLOBAL_NAME_SET } from '../../src/bmsx/machine/firmware/system_globals';
import { RAM_BASE } from '../../src/bmsx/machine/memory/map';
import { Memory } from '../../src/bmsx/machine/memory/memory';
import { DeviceScheduler } from '../../src/bmsx/machine/scheduler/device';

type FakeVoiceInfo = { slot: number; voiceId: number; sourceAddr: number; registerWords: readonly number[]; playbackCursorQ16: number; stopFadeSamples: number };

function createFakeOutputVoiceState(voice: FakeVoiceInfo): ApuOutputVoiceState {
	return {
		slot: voice.slot,
		position: voice.playbackCursorQ16 / APU_RATE_STEP_Q16_ONE,
		step: voice.registerWords[APU_PARAMETER_RATE_STEP_Q16_INDEX]! / APU_RATE_STEP_Q16_ONE,
		gain: 1,
		targetGain: 1,
		gainRampRemaining: 0,
		stopAfter: voice.stopFadeSamples > 0 ? voice.stopFadeSamples / APU_SAMPLE_RATE_HZ : -1,
		filterSampleRate: 0,
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
		},
	};
}

function createAudioControllerHarness(audioOutput: object): { memory: Memory; audio: AudioController } {
	const memory = new Memory({ systemRom: new Uint8Array(0) });
	const cpu = new CPU(memory);
	const scheduler = new DeviceScheduler(cpu);
	const irq = new IrqController(memory);
	const audio = new AudioController(memory, audioOutput as ApuOutputMixer, irq, scheduler);
	audio.reset();
	audio.setTiming(APU_SAMPLE_RATE_HZ, 0);
	return { memory, audio };
}

function createAudioHarness(): { memory: Memory; audio: AudioController } {
	const audioOutput = {
		playVoice: () => ({ faultCode: APU_FAULT_NONE, faultDetail: 0 }),
		writeSlotRegisterWord: () => ({ faultCode: APU_FAULT_NONE, faultDetail: 0 }),
		stopAllVoices: () => {},
		resetPlaybackState: () => {},
		stopSlot: () => {},
		captureState: (): ApuOutputState => ({ voices: [] }),
		restoreVoiceState: () => {},
		outputRing: {
			queuedFrames: () => 0,
			freeFrames: () => APU_OUTPUT_QUEUE_CAPACITY_FRAMES,
			capacityFrames: () => APU_OUTPUT_QUEUE_CAPACITY_FRAMES,
		},
	};
	return createAudioControllerHarness(audioOutput);
}

function createRealAudioHarness(): { memory: Memory; audio: AudioController; audioOutput: ApuOutputMixer } {
	const audioOutput = new ApuOutputMixer();
	return { ...createAudioControllerHarness(audioOutput), audioOutput };
}

function renderPastAoutVoiceEnd(audioOutput: ApuOutputMixer): void {
	const output = new Int16Array(10);
	audioOutput.renderSamples(output, 5, APU_SAMPLE_RATE_HZ, 1);
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
		playVoice: (slot: number, voiceId: number, source: { sourceAddr: number }, _runtimeBytes: Uint8Array, registerWords: readonly number[], playbackCursorQ16: number, stopFadeSamples = 0) => {
			activeVoice = { slot, voiceId, sourceAddr: source.sourceAddr, registerWords, playbackCursorQ16, stopFadeSamples };
			return { faultCode: APU_FAULT_NONE, faultDetail: 0 };
		},
		writeSlotRegisterWord: (_slot: number, _source: object, registerWords: readonly number[], parameterIndex: number) => {
			if (parameterIndex === APU_PARAMETER_GAIN_Q12_INDEX) {
				slotGainQ12 = registerWords[APU_PARAMETER_GAIN_Q12_INDEX]!;
			}
			return { faultCode: APU_FAULT_NONE, faultDetail: 0 };
		},
		stopAllVoices: () => {
			activeVoice = null;
		},
		resetPlaybackState: () => {
			activeVoice = null;
			stoppedFadeSamples = 0;
		},
		stopSlot: (slot: number, fadeSamples = 0) => {
			if (fadeSamples === 0) {
				const stopped = activeVoice !== null && activeVoice.slot === slot;
				activeVoice = null;
				return stopped;
			}
			if (!stopSlotWithFade) {
				return false;
			}
			stoppedFadeSamples = fadeSamples;
			return activeVoice !== null && activeVoice.slot === slot;
		},
		captureState: (): ApuOutputState => ({
			voices: activeVoice === null ? [] : [createFakeOutputVoiceState(activeVoice)],
		}),
		restoreVoiceState: () => {},
		outputRing: {
			queuedFrames: () => 0,
			freeFrames: () => APU_OUTPUT_QUEUE_CAPACITY_FRAMES,
			capacityFrames: () => APU_OUTPUT_QUEUE_CAPACITY_FRAMES,
		},
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
	assert.equal(APU_STATUS_OUTPUT_EMPTY, 8);
	assert.equal(APU_STATUS_OUTPUT_FULL, 16);
	assert.equal(APU_STATUS_CMD_FIFO_EMPTY, 32);
	assert.equal(APU_STATUS_CMD_FIFO_FULL, 64);
	assert.equal(APU_OUTPUT_QUEUE_CAPACITY_FRAMES, 16384);
	assert.equal(APU_COMMAND_FIFO_CAPACITY, 16);
	assert.equal(APU_SLOT_PHASE_PLAYING, 1);
	assert.equal(APU_SLOT_PHASE_FADING, 2);
	assert.equal(APU_FAULT_SOURCE_RANGE, 0x0102);
	assert.equal(APU_FAULT_CMD_FIFO_FULL, 0x0003);
	assert.equal(APU_FAULT_UNSUPPORTED_FORMAT, 0x0201);
	assert.equal(APU_FAULT_OUTPUT_PLAYBACK_RATE, 0x0204);
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

test('APU firmware descriptors expose status and fault ABI', () => {
	assert.equal(DEFAULT_LUA_BUILTIN_NAMES.includes('sys_apu_fault_code'), true);
	assert.equal(DEFAULT_LUA_BUILTIN_NAMES.includes('sys_apu_fault_detail'), true);
	assert.equal(DEFAULT_LUA_BUILTIN_NAMES.includes('sys_apu_fault_ack'), true);
	assert.equal(DEFAULT_LUA_BUILTIN_NAMES.includes('apu_status_fault'), true);
	assert.equal(DEFAULT_LUA_BUILTIN_NAMES.includes('apu_status_selected_slot_active'), true);
	assert.equal(DEFAULT_LUA_BUILTIN_NAMES.includes('apu_status_busy'), true);
	assert.equal(DEFAULT_LUA_BUILTIN_NAMES.includes('apu_status_output_empty'), true);
	assert.equal(DEFAULT_LUA_BUILTIN_NAMES.includes('apu_status_output_full'), true);
	assert.equal(DEFAULT_LUA_BUILTIN_NAMES.includes('apu_output_queue_capacity_frames'), true);
	assert.equal(DEFAULT_LUA_BUILTIN_NAMES.includes('sys_apu_selected_source_addr'), true);
	assert.equal(DEFAULT_LUA_BUILTIN_NAMES.includes('sys_apu_active_mask'), true);
	assert.equal(DEFAULT_LUA_BUILTIN_NAMES.includes('sys_apu_selected_slot_regs'), true);
	assert.equal(DEFAULT_LUA_BUILTIN_NAMES.includes('sys_apu_selected_slot_reg_count'), true);
	assert.equal(DEFAULT_LUA_BUILTIN_NAMES.includes('sys_apu_generator_kind'), true);
	assert.equal(DEFAULT_LUA_BUILTIN_NAMES.includes('sys_apu_generator_duty_q12'), true);
	assert.equal(DEFAULT_LUA_BUILTIN_NAMES.includes('apu_generator_none'), true);
	assert.equal(DEFAULT_LUA_BUILTIN_NAMES.includes('apu_generator_square'), true);
	assert.equal(DEFAULT_LUA_BUILTIN_NAMES.includes('sys_apu_output_queued_frames'), true);
	assert.equal(DEFAULT_LUA_BUILTIN_NAMES.includes('sys_apu_output_free_frames'), true);
	assert.equal(DEFAULT_LUA_BUILTIN_NAMES.includes('sys_apu_output_capacity_frames'), true);
	assert.equal(DEFAULT_LUA_BUILTIN_NAMES.includes('sys_apu_cmd_queued'), true);
	assert.equal(DEFAULT_LUA_BUILTIN_NAMES.includes('sys_apu_cmd_free'), true);
	assert.equal(DEFAULT_LUA_BUILTIN_NAMES.includes('sys_apu_cmd_capacity'), true);
	assert.equal(DEFAULT_LUA_BUILTIN_NAMES.includes('apu_fault_source_range'), true);
	assert.equal(DEFAULT_LUA_BUILTIN_NAMES.includes('apu_fault_unsupported_format'), true);
	assert.equal(DEFAULT_LUA_BUILTIN_NAMES.includes('apu_fault_output_playback_rate'), true);
	assert.equal(SYSTEM_ROM_GLOBAL_NAME_SET.has('sys_apu_status'), true);
	assert.equal(SYSTEM_ROM_GLOBAL_NAME_SET.has('sys_apu_selected_source_addr'), true);
	assert.equal(SYSTEM_ROM_GLOBAL_NAME_SET.has('sys_apu_active_mask'), true);
	assert.equal(SYSTEM_ROM_GLOBAL_NAME_SET.has('sys_apu_selected_slot_regs'), true);
	assert.equal(SYSTEM_ROM_GLOBAL_NAME_SET.has('sys_apu_selected_slot_reg_count'), true);
	assert.equal(SYSTEM_ROM_GLOBAL_NAME_SET.has('sys_apu_generator_kind'), true);
	assert.equal(SYSTEM_ROM_GLOBAL_NAME_SET.has('sys_apu_generator_duty_q12'), true);
	assert.equal(SYSTEM_ROM_GLOBAL_NAME_SET.has('apu_generator_none'), true);
	assert.equal(SYSTEM_ROM_GLOBAL_NAME_SET.has('apu_generator_square'), true);
	assert.equal(SYSTEM_ROM_GLOBAL_NAME_SET.has('sys_apu_output_queued_frames'), true);
	assert.equal(SYSTEM_ROM_GLOBAL_NAME_SET.has('sys_apu_output_free_frames'), true);
	assert.equal(SYSTEM_ROM_GLOBAL_NAME_SET.has('sys_apu_output_capacity_frames'), true);
	assert.equal(SYSTEM_ROM_GLOBAL_NAME_SET.has('sys_apu_cmd_queued'), true);
	assert.equal(SYSTEM_ROM_GLOBAL_NAME_SET.has('sys_apu_cmd_free'), true);
	assert.equal(SYSTEM_ROM_GLOBAL_NAME_SET.has('sys_apu_cmd_capacity'), true);
	assert.equal(SYSTEM_ROM_GLOBAL_NAME_SET.has('apu_status_selected_slot_active'), true);
	assert.equal(SYSTEM_ROM_GLOBAL_NAME_SET.has('apu_status_busy'), true);
	assert.equal(SYSTEM_ROM_GLOBAL_NAME_SET.has('apu_status_output_empty'), true);
	assert.equal(SYSTEM_ROM_GLOBAL_NAME_SET.has('apu_status_output_full'), true);
	assert.equal(SYSTEM_ROM_GLOBAL_NAME_SET.has('apu_status_cmd_fifo_empty'), true);
	assert.equal(SYSTEM_ROM_GLOBAL_NAME_SET.has('apu_status_cmd_fifo_full'), true);
	assert.equal(SYSTEM_ROM_GLOBAL_NAME_SET.has('apu_output_queue_capacity_frames'), true);
	assert.equal(SYSTEM_ROM_GLOBAL_NAME_SET.has('apu_command_fifo_capacity'), true);
	assert.equal(SYSTEM_ROM_GLOBAL_NAME_SET.has('apu_fault_cmd_fifo_full'), true);
	assert.equal(SYSTEM_ROM_GLOBAL_NAME_SET.has('apu_fault_unsupported_format'), true);
	assert.equal(SYSTEM_ROM_GLOBAL_NAME_SET.has('apu_fault_output_playback_rate'), true);
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

function createBadpFixture(): Uint8Array {
	const bytes = new Uint8Array(60);
	bytes.set([0x42, 0x41, 0x44, 0x50], 0);
	writeLE16(bytes, 4, 1);
	writeLE16(bytes, 6, 1);
	writeLE32(bytes, 8, APU_SAMPLE_RATE_HZ);
	writeLE32(bytes, 12, 8);
	writeLE32(bytes, 36, 48);
	writeLE16(bytes, 48, 8);
	writeLE16(bytes, 50, 12);
	writeLE16(bytes, 52, 0);
	bytes.set([0x11, 0x11, 0x11, 0x11], 56);
	return bytes;
}

function writeBadpSourceRegisters(memory: Memory, sourceAddr = RAM_BASE): void {
	const bytes = createBadpFixture();
	memory.writeBytes(sourceAddr, bytes);
	memory.writeValue(IO_APU_SOURCE_ADDR, sourceAddr);
	memory.writeValue(IO_APU_SOURCE_BYTES, bytes.byteLength);
	memory.writeValue(IO_APU_SOURCE_SAMPLE_RATE_HZ, APU_SAMPLE_RATE_HZ);
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

function assertApuSlotOneActiveReadback(memory: Memory): void {
	const status = memory.readIoU32(IO_APU_STATUS);
	assert.equal((status & APU_STATUS_SELECTED_SLOT_ACTIVE) !== 0, true);
	assert.equal((status & APU_STATUS_BUSY) !== 0, true);
	assert.equal(memory.readIoU32(IO_APU_SELECTED_SOURCE_ADDR), RAM_BASE);
	assert.equal(memory.readIoU32(IO_APU_ACTIVE_MASK), 2);
	assert.equal(memory.readIoU32(IO_APU_SELECTED_SLOT_REG0), RAM_BASE);
	assert.equal(memory.readIoU32(IO_APU_SELECTED_SLOT_REG0 + APU_PARAMETER_SLOT_INDEX * IO_ARG_STRIDE), 1);
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

function assertNoCapturedSlotOneSource(audio: AudioController): void {
	const state = audio.captureState();
	assert.equal(state.slotRegisterWords[apuSlotRegisterWordIndex(1, APU_PARAMETER_SOURCE_ADDR_INDEX)], 0);
	assert.equal(state.slotSourceBytes[1]!.byteLength, 0);
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

test('APU command FIFO full latches a hardware fault without executing the overflow doorbell', () => {
	const { memory, audio } = createAudioHarness();

	for (let index = 0; index < APU_COMMAND_FIFO_CAPACITY; index += 1) {
		memory.writeValue(IO_APU_SLOT, 0);
		memory.writeValue(IO_APU_CMD, APU_CMD_STOP_SLOT);
	}
	assert.equal(memory.readIoU32(IO_APU_CMD_QUEUED), APU_COMMAND_FIFO_CAPACITY);
	assert.equal(memory.readIoU32(IO_APU_CMD_FREE), 0);
	assert.equal(memory.readIoU32(IO_APU_STATUS) & APU_STATUS_CMD_FIFO_FULL, APU_STATUS_CMD_FIFO_FULL);

	memory.writeValue(IO_APU_SLOT, 1);
	memory.writeValue(IO_APU_CMD, APU_CMD_STOP_SLOT);
	assertApuFaultLatch(memory, APU_FAULT_CMD_FIFO_FULL);
	assert.equal(memory.readIoU32(IO_APU_CMD_QUEUED), APU_COMMAND_FIFO_CAPACITY);

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

test('APU output playback-parameter faults clear the replacement slot latch', () => {
	const { memory, audio } = createRealAudioHarness();

	writeValidSourceRegisters(memory);
	memory.writeValue(IO_APU_RATE_STEP_Q16, 0);
	memory.writeValue(IO_APU_SLOT, 1);
	assert.doesNotThrow(() => writeApuCommand(memory, audio, APU_CMD_PLAY));

	assertApuFaultLatch(memory, APU_FAULT_OUTPUT_PLAYBACK_RATE);
	assert.equal(memory.readIoU32(IO_APU_ACTIVE_MASK), 0);
	assertApuIdleReadback(memory);
});

test('AOUT owns reusable host-output queue state', () => {
	const mixer = new ApuOutputMixer();
	const output = new Int16Array(4);

	mixer.pullOutputFrames(output, 2, 48000, 1, 6);
	assert.equal(mixer.outputRing.queuedFrames(), 6);
	mixer.pullOutputFrames(output, 2, 48000, 1);
	assert.equal(mixer.outputRing.queuedFrames(), 4);
	mixer.outputRing.clear();
	assert.equal(mixer.outputRing.queuedFrames(), 0);
	mixer.pullOutputFrames(output, 2, 48000, 1, 20000);
	assert.equal(mixer.outputRing.queuedFrames(), APU_OUTPUT_QUEUE_CAPACITY_FRAMES);
	assert.equal(mixer.outputRing.capacityFrames(), APU_OUTPUT_QUEUE_CAPACITY_FRAMES);
	assert.equal(mixer.outputRing.freeFrames(), 0);
});

test('APU exposes AOUT output-ring status through MMIO', () => {
	const { memory, audio, audioOutput } = createRealAudioHarness();
	const output = new Int16Array(4);

	assert.equal(memory.readIoU32(IO_APU_OUTPUT_QUEUED_FRAMES), 0);
	assert.equal(memory.readIoU32(IO_APU_OUTPUT_FREE_FRAMES), APU_OUTPUT_QUEUE_CAPACITY_FRAMES);
	assert.equal(memory.readIoU32(IO_APU_OUTPUT_CAPACITY_FRAMES), APU_OUTPUT_QUEUE_CAPACITY_FRAMES);
	const resetStatus = memory.readIoU32(IO_APU_STATUS);
	assert.equal(resetStatus & APU_STATUS_OUTPUT_EMPTY, APU_STATUS_OUTPUT_EMPTY);
	assert.equal(resetStatus & APU_STATUS_OUTPUT_FULL, 0);

	audioOutput.pullOutputFrames(output, 2, 48000, 1, 6);
	assert.equal(memory.readIoU32(IO_APU_OUTPUT_QUEUED_FRAMES), 6);
	assert.equal(memory.readIoU32(IO_APU_OUTPUT_FREE_FRAMES), APU_OUTPUT_QUEUE_CAPACITY_FRAMES - 6);
	const partiallyQueuedStatus = memory.readIoU32(IO_APU_STATUS);
	assert.equal(partiallyQueuedStatus & APU_STATUS_OUTPUT_EMPTY, 0);
	assert.equal(partiallyQueuedStatus & APU_STATUS_OUTPUT_FULL, 0);

	audioOutput.pullOutputFrames(output, 2, 48000, 1, 20000);
	assert.equal(memory.readIoU32(IO_APU_OUTPUT_QUEUED_FRAMES), APU_OUTPUT_QUEUE_CAPACITY_FRAMES);
	assert.equal(memory.readIoU32(IO_APU_OUTPUT_FREE_FRAMES), 0);
	const fullStatus = memory.readIoU32(IO_APU_STATUS);
	assert.equal(fullStatus & APU_STATUS_OUTPUT_FULL, APU_STATUS_OUTPUT_FULL);
	memory.writeMappedU32LE(IO_APU_OUTPUT_QUEUED_FRAMES, 0);
	assert.equal(memory.readIoU32(IO_APU_OUTPUT_QUEUED_FRAMES), APU_OUTPUT_QUEUE_CAPACITY_FRAMES);

	const restoreHarness = createRealAudioHarness();
	const savedEmptyState = restoreHarness.audio.captureState();
	restoreHarness.audioOutput.pullOutputFrames(output, 2, 48000, 1, 6);
	assert.equal(restoreHarness.memory.readIoU32(IO_APU_OUTPUT_QUEUED_FRAMES), 6);
	restoreHarness.audio.restoreState(savedEmptyState, 0);
	assert.equal(restoreHarness.memory.readIoU32(IO_APU_OUTPUT_QUEUED_FRAMES), 0);
	assert.equal(restoreHarness.memory.readIoU32(IO_APU_OUTPUT_FREE_FRAMES), APU_OUTPUT_QUEUE_CAPACITY_FRAMES);
	const restoredStatus = restoreHarness.memory.readIoU32(IO_APU_STATUS);
	assert.equal(restoredStatus & APU_STATUS_OUTPUT_EMPTY, APU_STATUS_OUTPUT_EMPTY);
	assert.equal(restoredStatus & APU_STATUS_OUTPUT_FULL, 0);
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

test('APU selected-slot register window writes live channel state through AOUT', () => {
	const { memory, audio, audioOutput } = createRealAudioHarness();
	const selectedGainAddr = IO_APU_SELECTED_SLOT_REG0 + APU_PARAMETER_GAIN_Q12_INDEX * IO_ARG_STRIDE;
	const selectedRateAddr = IO_APU_SELECTED_SLOT_REG0 + APU_PARAMETER_RATE_STEP_Q16_INDEX * IO_ARG_STRIDE;

	beginApuPlay(memory, audio, 1);
	memory.writeValue(IO_APU_SLOT, 1);
	memory.writeMappedU32LE(selectedGainAddr, 0x0800);

	assert.equal(memory.readIoU32(selectedGainAddr), 0x0800);
	assert.equal(audio.captureState().slotRegisterWords[apuSlotRegisterWordIndex(1, APU_PARAMETER_GAIN_Q12_INDEX)], 0x0800);
	const output = new Int16Array(2);
	audioOutput.renderSamples(output, 1, APU_SAMPLE_RATE_HZ, 1);
	assert.equal(output[0], -7680);
	assert.equal(output[1], -7680);

	memory.writeMappedU32LE(selectedRateAddr, 0);
	assertApuFaultLatch(memory, APU_FAULT_OUTPUT_PLAYBACK_RATE);
	assertApuIdleReadback(memory);

	const { memory: sourceReloadMemory, audio: sourceReloadAudio, audioOutput: sourceReloadOutput } = createRealAudioHarness();
	sourceReloadMemory.writeU32(RAM_BASE + 4, 0x80808080);
	beginApuPlay(sourceReloadMemory, sourceReloadAudio, 1);
	sourceReloadMemory.writeValue(IO_APU_SLOT, 1);
	sourceReloadMemory.writeMappedU32LE(IO_APU_SELECTED_SLOT_REG0 + APU_PARAMETER_SOURCE_ADDR_INDEX * IO_ARG_STRIDE, RAM_BASE + 4);
	assert.equal(sourceReloadMemory.readIoU32(IO_APU_SELECTED_SLOT_REG0), RAM_BASE + 4);
	assert.equal(sourceReloadMemory.readIoU32(IO_APU_ACTIVE_MASK), 2);
	assert.deepEqual(Array.from(sourceReloadAudio.captureState().slotSourceBytes[1]!), [0x80, 0x80, 0x80, 0x80]);
	const reloadedOutput = new Int16Array(2);
	sourceReloadOutput.renderSamples(reloadedOutput, 1, APU_SAMPLE_RATE_HZ, 1);
	assert.equal(reloadedOutput[0], 0);
	assert.equal(reloadedOutput[1], 0);

	const { memory: noRecordRateMemory, audio: noRecordRateAudio, audioOutput: noRecordRateOutput } = createRealAudioHarness();
	beginApuPlay(noRecordRateMemory, noRecordRateAudio, 1);
	noRecordRateMemory.writeValue(IO_APU_SLOT, 1);
	renderPastAoutVoiceEnd(noRecordRateOutput);
	assert.equal(noRecordRateMemory.readIoU32(IO_APU_ACTIVE_MASK), 2);
	noRecordRateMemory.writeMappedU32LE(selectedRateAddr, 0);
	assertApuFaultLatch(noRecordRateMemory, APU_FAULT_OUTPUT_PLAYBACK_RATE);
	assertApuIdleReadback(noRecordRateMemory);
});

test('APU selected-slot source-DMA reload preserves STOP fade countdown', () => {
	const { memory, audio, activeVoice } = createActiveVoiceAudioHarness(true);

	memory.writeU32(RAM_BASE + 4, 0x80808080);
	beginApuPlay(memory, audio, 1);
	memory.writeValue(IO_APU_SLOT, 1);
	memory.writeValue(IO_APU_FADE_SAMPLES, APU_SAMPLE_RATE_HZ);
	writeApuCommand(memory, audio, APU_CMD_STOP_SLOT);
	audio.accrueCycles(2, 2);
	audio.onService(2);
	memory.writeValue(IO_APU_SLOT, 1);
	memory.writeMappedU32LE(IO_APU_SELECTED_SLOT_REG0 + APU_PARAMETER_SOURCE_ADDR_INDEX * IO_ARG_STRIDE, RAM_BASE + 4);

	const voice = activeVoice();
	assert.notEqual(voice, null);
	assert.equal((voice as FakeVoiceInfo).sourceAddr, RAM_BASE + 4);
	assert.equal((voice as FakeVoiceInfo).stopFadeSamples, APU_SAMPLE_RATE_HZ - 2);
	const state = audio.captureState();
	assert.equal(state.slotFadeSamplesRemaining[1], APU_SAMPLE_RATE_HZ - 2);
	assert.equal(state.slotFadeSamplesTotal[1], APU_SAMPLE_RATE_HZ);
	assert.deepEqual(Array.from(state.slotSourceBytes[1]!), [0x80, 0x80, 0x80, 0x80]);
});

test('APU restore preserves live AOUT STOP fade envelope state', () => {
	const { memory, audio, audioOutput } = createRealAudioHarness();
	writeValidSourceRegisters(memory);
	memory.writeU32(RAM_BASE, 0x44444444);
	memory.writeValue(IO_APU_SLOT, 1);
	writeApuCommand(memory, audio, APU_CMD_PLAY);
	memory.writeValue(IO_APU_SLOT, 1);
	memory.writeValue(IO_APU_FADE_SAMPLES, 4);
	writeApuCommand(memory, audio, APU_CMD_STOP_SLOT);
	audio.accrueCycles(2, 2);
	audio.onService(2);

	const saved = audio.captureState();
	assert.equal(saved.slotFadeSamplesRemaining[1], 2);
	assert.equal(saved.slotFadeSamplesTotal[1], 4);
	const liveOutput = new Int16Array(2);
	audioOutput.renderSamples(liveOutput, 1, APU_SAMPLE_RATE_HZ, 1);

	const restored = createRealAudioHarness();
	restored.audio.restoreState(saved, 0);
	const output = new Int16Array(2);
	restored.audioOutput.renderSamples(output, 1, APU_SAMPLE_RATE_HZ, 1);
	assert.deepEqual(Array.from(output), Array.from(liveOutput));
});

test('APU sample cursor ends playback through the device scheduler', async () => {
	const { memory, audio } = createActiveVoiceAudioHarness();

	await playApuSlot(memory, audio, 1);
	audio.accrueCycles(4, 4);
	audio.onService(4);
	assertApuSlotEndedEvent(memory, 1);
	assert.equal((memory.readIoU32(IO_IRQ_FLAGS) & IRQ_APU) !== 0, true);

	const saved = audio.captureState();
	const restored = createAudioHarness();
	restored.audio.restoreState(saved, 0);
	assertApuSlotEndedEvent(restored.memory, 1);
	assert.equal(restored.audio.captureState().eventKind, APU_EVENT_SLOT_ENDED);
	assert.equal(restored.audio.captureState().eventSlot, 1);
	assert.equal(restored.audio.captureState().eventSourceAddr, RAM_BASE);
});

test('APU save-state preserves device-owned playback cursor and replays host output from it', async () => {
	const { memory, audio } = createActiveVoiceAudioHarness();

	await playApuSlot(memory, audio, 1);
	audio.accrueCycles(2, 2);
	audio.onService(2);
	const twoSampleCursorQ16 = 2 * APU_RATE_STEP_Q16_ONE;
	const saved = audio.captureState();
	assert.equal(memory.readIoU32(IO_APU_ACTIVE_MASK), 2);
	assert.equal(saved.slotPlaybackCursorQ16[1], twoSampleCursorQ16);

	const restored = createActiveVoiceAudioHarness();
	restored.audio.restoreState(saved, 0);
	const restoredVoice = restored.activeVoice();
	assert.notEqual(restoredVoice, null);
	assert.equal((restoredVoice as FakeVoiceInfo).registerWords[APU_PARAMETER_SLOT_INDEX], 1);
	assert.equal((restoredVoice as FakeVoiceInfo).playbackCursorQ16, twoSampleCursorQ16);
	assert.equal(restored.audio.captureState().slotPlaybackCursorQ16[1], twoSampleCursorQ16);
});

test('APU save-state preserves AOUT voice datapath state after host rendering', () => {
	const { memory, audio, audioOutput } = createRealAudioHarness();

	writeValidSourceRegisters(memory);
	memory.writeValue(IO_APU_FILTER_KIND, APU_FILTER_LOWPASS);
	memory.writeValue(IO_APU_FILTER_FREQ_HZ, 800);
	memory.writeValue(IO_APU_FILTER_Q_MILLI, 700);
	memory.writeValue(IO_APU_SLOT, 1);
	writeApuCommand(memory, audio, APU_CMD_PLAY);
	const primed = new Int16Array(4);
	audioOutput.renderSamples(primed, 2, APU_SAMPLE_RATE_HZ, 1);
	const saved = audio.captureState();
	assert.equal(saved.slotPlaybackCursorQ16[1], 0);
	assert.equal(saved.output.voices.length, 1);

	const liveNext = new Int16Array(2);
	audioOutput.renderSamples(liveNext, 1, APU_SAMPLE_RATE_HZ, 1);
	const restored = createRealAudioHarness();
	restored.audio.restoreState(saved, 0);
	const restoredNext = new Int16Array(2);
	restored.audioOutput.renderSamples(restoredNext, 1, APU_SAMPLE_RATE_HZ, 1);

	assert.deepEqual(Array.from(restoredNext), Array.from(liveNext));
});

test('APU save-state does not recreate an AOUT voice that already drained at the host edge', () => {
	const { memory, audio, audioOutput } = createRealAudioHarness();

	beginApuPlay(memory, audio, 1);
	renderPastAoutVoiceEnd(audioOutput);
	const saved = audio.captureState();
	assert.equal(memory.readIoU32(IO_APU_ACTIVE_MASK), 2);
	assert.equal(saved.output.voices.length, 0);

	const restored = createRealAudioHarness();
	restored.audio.restoreState(saved, 0);
	const output = new Int16Array(2);
	restored.audioOutput.renderSamples(output, 1, APU_SAMPLE_RATE_HZ, 1);

	assert.equal(restored.memory.readIoU32(IO_APU_ACTIVE_MASK), 2);
	assert.deepEqual(Array.from(output), [0, 0]);
});

test('APU device cursor advances at source sample rate', async () => {
	const { memory, audio } = createActiveVoiceAudioHarness();

	writeValidSourceRegisters(memory);
	memory.writeValue(IO_APU_SOURCE_SAMPLE_RATE_HZ, APU_SAMPLE_RATE_HZ / 2);
	memory.writeValue(IO_APU_SLOT, 1);
	writeApuCommand(memory, audio, APU_CMD_PLAY);
	audio.accrueCycles(2, 2);
	audio.onService(2);

	assert.equal(audio.captureState().slotPlaybackCursorQ16[1], APU_RATE_STEP_Q16_ONE);
});

test('APU square generator is device-owned and restores live AOUT state', () => {
	const { memory, audio, audioOutput } = createRealAudioHarness();
	writeSquareGeneratorRegisters(memory);
	memory.writeValue(IO_APU_SLOT, 1);
	writeApuCommand(memory, audio, APU_CMD_PLAY);
	const state = audio.captureState();
	assert.equal(state.slotSourceBytes[1]!.byteLength, 0);
	const output = new Int16Array(8);
	audioOutput.renderSamples(output, 4, APU_SAMPLE_RATE_HZ, 1);
	assert.deepEqual(Array.from(output), [32767, 32767, 32767, 32767, -32767, -32767, -32767, -32767]);

	const phaseHarness = createRealAudioHarness();
	writeSquareGeneratorRegisters(phaseHarness.memory);
	phaseHarness.memory.writeValue(IO_APU_SLOT, 1);
	writeApuCommand(phaseHarness.memory, phaseHarness.audio, APU_CMD_PLAY);
	phaseHarness.audio.accrueCycles(2, 2);
	phaseHarness.audio.onService(2);
	const saved = phaseHarness.audio.captureState();
	assert.equal(saved.slotPlaybackCursorQ16[1], APU_RATE_STEP_Q16_ONE / 2);
	const liveRestoredPhase = new Int16Array(2);
	phaseHarness.audioOutput.renderSamples(liveRestoredPhase, 1, APU_SAMPLE_RATE_HZ, 1);
	const restored = createRealAudioHarness();
	restored.audio.restoreState(saved, 0);
	const restoredOutput = new Int16Array(2);
	restored.audioOutput.renderSamples(restoredOutput, 1, APU_SAMPLE_RATE_HZ, 1);
	assert.deepEqual(Array.from(restoredOutput), Array.from(liveRestoredPhase));
});

test('APU BADP save-state restores decoder-backed AOUT and selected-slot seek writes', () => {
	const { memory, audio, audioOutput } = createRealAudioHarness();
	writeBadpSourceRegisters(memory);
	memory.writeValue(IO_APU_SLOT, 1);
	writeApuCommand(memory, audio, APU_CMD_PLAY);

	const firstFrames = new Int16Array(4);
	audioOutput.renderSamples(firstFrames, 2, APU_SAMPLE_RATE_HZ, 1);
	assert.deepEqual(Array.from(firstFrames), [1, 1, 2, 2]);

	const saved = audio.captureState();
	assert.equal(saved.output.voices.length, 1);
	assert.equal(saved.output.voices[0]!.badp.decodedFrame, 2);
	assert.equal(saved.output.voices[0]!.badp.nextFrame, 3);

	const liveNext = new Int16Array(2);
	audioOutput.renderSamples(liveNext, 1, APU_SAMPLE_RATE_HZ, 1);

	const restored = createRealAudioHarness();
	restored.audio.restoreState(saved, 0);
	const restoredNext = new Int16Array(2);
	restored.audioOutput.renderSamples(restoredNext, 1, APU_SAMPLE_RATE_HZ, 1);
	assert.deepEqual(Array.from(restoredNext), Array.from(liveNext));

	restored.memory.writeValue(IO_APU_SLOT, 1);
	restored.memory.writeMappedU32LE(IO_APU_SELECTED_SLOT_REG0 + APU_PARAMETER_START_SAMPLE_INDEX * IO_ARG_STRIDE, 5);
	const seekState = restored.audio.captureState();
	assert.equal(seekState.slotPlaybackCursorQ16[1], 5 * APU_RATE_STEP_Q16_ONE);
	assert.equal(seekState.output.voices[0]!.badp.decodedFrame, 5);
	assert.equal(seekState.output.voices[0]!.badp.nextFrame, 6);

	const seekFrame = new Int16Array(2);
	restored.audioOutput.renderSamples(seekFrame, 1, APU_SAMPLE_RATE_HZ, 1);
	assert.deepEqual(Array.from(seekFrame), [6, 6]);
});

test('APU STOP_SLOT fade keeps the slot active until the ended event', async () => {
	const { memory, audio, stoppedFadeSamples } = createActiveVoiceAudioHarness(true);

	writeValidSourceRegisters(memory);
	memory.writeValue(IO_APU_SOURCE_LOOP_START_SAMPLE, 0);
	memory.writeValue(IO_APU_SOURCE_LOOP_END_SAMPLE, 4);
	memory.writeValue(IO_APU_SLOT, 1);
	writeApuCommand(memory, audio, APU_CMD_PLAY);
	memory.writeValue(IO_APU_SLOT, 1);
	assertApuSlotOneActiveReadback(memory);

	memory.writeValue(IO_APU_FADE_SAMPLES, APU_SAMPLE_RATE_HZ);
	writeApuCommand(memory, audio, APU_CMD_STOP_SLOT);
	assert.equal(stoppedFadeSamples(), APU_SAMPLE_RATE_HZ);
	memory.writeValue(IO_APU_SLOT, 1);
	assertApuSlotOneActiveReadback(memory);
	assert.equal(memory.readIoU32(IO_APU_EVENT_SEQ), 0);

	audio.accrueCycles(2, 2);
	audio.onService(2);
	const twoSampleCursorQ16 = 2 * APU_RATE_STEP_Q16_ONE;
	assertApuSlotOneActiveReadback(memory);
	assert.equal(memory.readIoU32(IO_APU_EVENT_SEQ), 0);
	assert.equal(audio.captureState().slotPlaybackCursorQ16[1], twoSampleCursorQ16);

	const midFade = audio.captureState();
	assert.equal(midFade.slotPhases[1], APU_SLOT_PHASE_FADING);
	const restoredMidFade = createActiveVoiceAudioHarness();
	restoredMidFade.audio.restoreState(midFade, 0);
	const restoredMidFadeVoice = restoredMidFade.activeVoice();
	assert.notEqual(restoredMidFadeVoice, null);
	assert.equal((restoredMidFadeVoice as FakeVoiceInfo).playbackCursorQ16, twoSampleCursorQ16);
	assert.equal((restoredMidFadeVoice as FakeVoiceInfo).stopFadeSamples, APU_SAMPLE_RATE_HZ - 2);

	audio.accrueCycles(APU_SAMPLE_RATE_HZ - 2, APU_SAMPLE_RATE_HZ);
	audio.onService(APU_SAMPLE_RATE_HZ);
	assertApuIdleReadback(memory);
	assertApuSlotEndedEvent(memory, 1);
	assert.equal((memory.readIoU32(IO_IRQ_FLAGS) & IRQ_APU) !== 0, true);
	assertNoCapturedSlotOneSource(audio);
});
