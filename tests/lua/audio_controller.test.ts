import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
	APU_CMD_PLAY,
	APU_CMD_RAMP_SLOT,
	APU_CMD_STOP_SLOT,
	APU_EVENT_SLOT_ENDED,
	APU_FILTER_HIGHSHELF,
	APU_FAULT_BAD_CMD,
	APU_FAULT_BAD_SLOT,
	APU_FAULT_NONE,
	APU_FAULT_RUNTIME_UNAVAILABLE,
	APU_FAULT_SOURCE_RANGE,
	APU_PARAMETER_REGISTER_COUNT,
	APU_PARAMETER_SLOT_INDEX,
	APU_PARAMETER_SOURCE_ADDR_INDEX,
	APU_SAMPLE_RATE_HZ,
	APU_SLOT_REGISTER_WORD_COUNT,
	APU_STATUS_BUSY,
	APU_STATUS_FAULT,
	APU_STATUS_SELECTED_SLOT_ACTIVE,
	apuSlotRegisterWordIndex,
} from '../../src/bmsx/machine/devices/audio/contracts';
import {
	IO_APU_CMD,
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
	IO_APU_TARGET_GAIN_Q12,
	IO_ARG_STRIDE,
	IO_IRQ_FLAGS,
	IRQ_APU,
} from '../../src/bmsx/machine/bus/io';
import { AudioController } from '../../src/bmsx/machine/devices/audio/controller';
import { IrqController } from '../../src/bmsx/machine/devices/irq/controller';
import { DEFAULT_LUA_BUILTIN_NAMES } from '../../src/bmsx/machine/firmware/builtin_descriptors';
import { SYSTEM_ROM_GLOBAL_NAME_SET } from '../../src/bmsx/machine/firmware/system_globals';
import { RAM_BASE } from '../../src/bmsx/machine/memory/map';
import { Memory } from '../../src/bmsx/machine/memory/memory';

type FakeVoiceInfo = { slot: number; voiceId: number; sourceAddr: number; params: {}; startedAt: number; startOffset: number };
type FakeEndedListener = (info: FakeVoiceInfo) => void;

function createAudioHarness(runtimeReady: boolean): { memory: Memory; audio: AudioController } {
	const memory = new Memory({ systemRom: new Uint8Array(0) });
	const irq = new IrqController(memory);
	const soundMaster = {
		addEndedListener: () => () => {},
		isRuntimeAudioReady: () => runtimeReady,
		playResolvedSourceOnSlot: async () => 1,
		stopAllVoices: () => {},
		stopSlot: () => {},
		rampSlotGainLinear: () => {},
		setSlotGainLinear: () => {},
	};
	const audio = new AudioController(memory, soundMaster as never, irq);
	audio.reset();
	return { memory, audio };
}

function createActiveVoiceAudioHarness(options: { endExistingVoiceOnReplay?: boolean; stopSlotWithFade?: boolean } = {}): {
	memory: Memory;
	audio: AudioController;
	activeVoice: () => FakeVoiceInfo | null;
	emitEnded: (info: FakeVoiceInfo) => void;
	stoppedFadeMs: () => number;
} {
	const memory = new Memory({ systemRom: new Uint8Array(0) });
	const irq = new IrqController(memory);
	let endedListener: FakeEndedListener = () => {};
	let activeVoice: FakeVoiceInfo | null = null;
	let nextVoiceId = 1;
	let stoppedFadeMs = 0;
	const soundMaster = {
		addEndedListener: (listener: FakeEndedListener) => {
			endedListener = listener;
			return () => {
				endedListener = () => {};
			};
		},
		isRuntimeAudioReady: () => true,
		playResolvedSourceOnSlot: async (slot: number, source: { sourceAddr: number }) => {
			if (options.endExistingVoiceOnReplay && activeVoice !== null && activeVoice.slot === slot) {
				endedListener(activeVoice);
			}
			const voiceId = nextVoiceId;
			nextVoiceId += 1;
			activeVoice = { slot, voiceId, sourceAddr: source.sourceAddr, params: {}, startedAt: 0, startOffset: 0 };
			return voiceId;
		},
		stopAllVoices: () => {
			activeVoice = null;
		},
		stopSlot: (slot: number, fadeMs?: number) => {
			if (!options.stopSlotWithFade) {
				return false;
			}
			stoppedFadeMs = fadeMs === undefined ? 0 : fadeMs;
			return activeVoice !== null && activeVoice.slot === slot;
		},
		rampSlotGainLinear: () => {},
		setSlotGainLinear: () => {},
	};
	const audio = new AudioController(memory, soundMaster as never, irq);
	audio.reset();
	return {
		memory,
		audio,
		activeVoice: () => activeVoice,
		emitEnded: (info) => {
			endedListener(info);
		},
		stoppedFadeMs: () => stoppedFadeMs,
	};
}

function createPendingPlayAudioHarness(stopSlotResult: boolean): {
	memory: Memory;
	audio: AudioController;
	resolvePendingPlay: (voiceId: number) => void;
} {
	const memory = new Memory({ systemRom: new Uint8Array(0) });
	const irq = new IrqController(memory);
	let resolvePendingPlay: (voiceId: number) => void = () => {};
	const soundMaster = {
		addEndedListener: () => () => {},
		isRuntimeAudioReady: () => true,
		playResolvedSourceOnSlot: () => new Promise<number>((resolve) => {
			resolvePendingPlay = resolve;
		}),
		stopAllVoices: () => {},
		stopSlot: () => stopSlotResult,
		rampSlotGainLinear: () => {},
		setSlotGainLinear: () => {},
	};
	const audio = new AudioController(memory, soundMaster as never, irq);
	audio.reset();
	return {
		memory,
		audio,
		resolvePendingPlay: (voiceId) => {
			resolvePendingPlay(voiceId);
		},
	};
}

test('APU contract constants keep cart ABI values', () => {
	assert.equal(APU_CMD_PLAY, 1);
	assert.equal(APU_CMD_STOP_SLOT, 2);
	assert.equal(APU_CMD_RAMP_SLOT, 3);
	assert.equal(APU_SAMPLE_RATE_HZ, 44100);
	assert.equal(APU_STATUS_FAULT, 1);
	assert.equal(APU_STATUS_SELECTED_SLOT_ACTIVE, 2);
	assert.equal(APU_STATUS_BUSY, 4);
	assert.equal(APU_FAULT_SOURCE_RANGE, 0x0102);
	assert.equal(APU_FILTER_HIGHSHELF, 8);
	assert.equal(APU_EVENT_SLOT_ENDED, 1);
	assert.equal(APU_PARAMETER_REGISTER_COUNT, 20);
	assert.equal(APU_PARAMETER_SOURCE_ADDR_INDEX, 0);
	assert.equal(APU_PARAMETER_SLOT_INDEX, 10);
	assert.equal(APU_SLOT_REGISTER_WORD_COUNT, 320);
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
	assert.equal(DEFAULT_LUA_BUILTIN_NAMES.includes('sys_apu_selected_source_addr'), true);
	assert.equal(DEFAULT_LUA_BUILTIN_NAMES.includes('sys_apu_active_mask'), true);
	assert.equal(DEFAULT_LUA_BUILTIN_NAMES.includes('sys_apu_selected_slot_regs'), true);
	assert.equal(DEFAULT_LUA_BUILTIN_NAMES.includes('sys_apu_selected_slot_reg_count'), true);
	assert.equal(DEFAULT_LUA_BUILTIN_NAMES.includes('apu_fault_source_range'), true);
	assert.equal(DEFAULT_LUA_BUILTIN_NAMES.includes('apu_fault_playback_rejected'), true);
	assert.equal(SYSTEM_ROM_GLOBAL_NAME_SET.has('sys_apu_status'), true);
	assert.equal(SYSTEM_ROM_GLOBAL_NAME_SET.has('sys_apu_selected_source_addr'), true);
	assert.equal(SYSTEM_ROM_GLOBAL_NAME_SET.has('sys_apu_active_mask'), true);
	assert.equal(SYSTEM_ROM_GLOBAL_NAME_SET.has('sys_apu_selected_slot_regs'), true);
	assert.equal(SYSTEM_ROM_GLOBAL_NAME_SET.has('sys_apu_selected_slot_reg_count'), true);
	assert.equal(SYSTEM_ROM_GLOBAL_NAME_SET.has('apu_status_selected_slot_active'), true);
	assert.equal(SYSTEM_ROM_GLOBAL_NAME_SET.has('apu_status_busy'), true);
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

function beginApuPlay(memory: Memory, slot: number): void {
	writeValidSourceRegisters(memory);
	memory.writeValue(IO_APU_SLOT, slot);
	memory.writeValue(IO_APU_CMD, APU_CMD_PLAY);
}

async function playApuSlot(memory: Memory, slot: number): Promise<void> {
	beginApuPlay(memory, slot);
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

function beginPendingApuPlay(memory: Memory): void {
	beginApuPlay(memory, 1);
	const pendingStatus = memory.readIoU32(IO_APU_STATUS);
	assert.equal((pendingStatus & APU_STATUS_BUSY) !== 0, true);
	assert.equal(memory.readIoU32(IO_APU_ACTIVE_MASK), 0);
}

async function resolvePendingPlayAndAssertIdle(memory: Memory, resolvePendingPlay: (voiceId: number) => void): Promise<void> {
	resolvePendingPlay(1);
	await Promise.resolve();
	memory.writeValue(IO_APU_SLOT, 1);
	assertApuIdleReadback(memory);
}

function assertNoCapturedSlotOneSource(audio: AudioController): void {
	const state = audio.captureState();
	assert.equal(state.activeSlotMask, 0);
	assert.equal(state.slotRegisterWords[apuSlotRegisterWordIndex(1, APU_PARAMETER_SOURCE_ADDR_INDEX)], 0);
}

function createAudioControllerStateRegisterWords(slot: number): number[] {
	const words = new Array<number>(APU_PARAMETER_REGISTER_COUNT).fill(0);
	words[APU_PARAMETER_SLOT_INDEX] = slot;
	return words;
}

test('APU command faults latch in MMIO and ACK self-clears', () => {
	const { memory } = createAudioHarness(true);

	assert.doesNotThrow(() => memory.writeValue(IO_APU_CMD, 0xffff));
	assertApuFaultLatch(memory, APU_FAULT_BAD_CMD);

	memory.writeValue(IO_APU_CMD, APU_CMD_STOP_SLOT);
	assert.equal(memory.readIoU32(IO_APU_FAULT_CODE), APU_FAULT_BAD_CMD, 'APU fault latch should be sticky-first until ACK');

	memory.writeValue(IO_APU_FAULT_ACK, 1);
	assert.equal(memory.readIoU32(IO_APU_FAULT_CODE), APU_FAULT_NONE);
	assert.equal(memory.readIoU32(IO_APU_STATUS) & APU_STATUS_FAULT, 0);
	assert.equal(memory.readIoU32(IO_APU_FAULT_ACK), 0);
});

test('APU register validation reports device faults instead of throwing', () => {
	const { memory } = createAudioHarness(true);

	memory.writeValue(IO_APU_SLOT, 99);
	assert.doesNotThrow(() => memory.writeValue(IO_APU_CMD, APU_CMD_STOP_SLOT));
	assertApuFaultLatch(memory, APU_FAULT_BAD_SLOT);

	memory.writeValue(IO_APU_FAULT_ACK, 1);
	memory.writeValue(IO_APU_SOURCE_BYTES, 4);
	assert.doesNotThrow(() => memory.writeValue(IO_APU_CMD, APU_CMD_PLAY));
	assertApuFaultLatch(memory, APU_FAULT_SOURCE_RANGE);
});

test('APU host playback rejection is cart-visible device status', () => {
	const { memory } = createAudioHarness(false);

	writeValidSourceRegisters(memory);
	assert.doesNotThrow(() => memory.writeValue(IO_APU_CMD, APU_CMD_PLAY));
	assertApuFaultLatch(memory, APU_FAULT_RUNTIME_UNAVAILABLE);
});

test('APU selected-slot active status is device-owned and saved', async () => {
	const { memory, audio } = createAudioHarness(true);
	const slotOneSourceRegister = apuSlotRegisterWordIndex(1, APU_PARAMETER_SOURCE_ADDR_INDEX);

	beginApuPlay(memory, 1);
	const pendingStatus = memory.readIoU32(IO_APU_STATUS);
	assert.equal((pendingStatus & APU_STATUS_BUSY) !== 0, true);
	await Promise.resolve();
	assertApuSelectedSlotInactive(memory);
	memory.writeValue(IO_APU_SLOT, 1);
	assertApuSlotOneActiveReadback(memory);
	const activeState = audio.captureState();
	assert.equal(activeState.registerWords[APU_PARAMETER_SLOT_INDEX], 1);
	assert.equal(activeState.activeSlotMask, 2);
	assert.equal(activeState.slotRegisterWords[slotOneSourceRegister], RAM_BASE);

	memory.writeValue(IO_APU_SLOT, 0);
	assertApuSelectedSlotInactive(memory);
	memory.writeValue(IO_APU_SLOT, 1);
	assertApuSlotOneActiveReadback(memory);

	const saved = audio.captureState();
	const restored = createAudioHarness(true);
	restored.audio.restoreState(saved);
	const restoredActiveState = restored.audio.captureState();
	assert.equal(restoredActiveState.registerWords[APU_PARAMETER_SLOT_INDEX], 1);
	assert.equal(restoredActiveState.activeSlotMask, 2);
	assert.equal(restored.memory.readIoU32(IO_APU_SLOT), 1);
	assert.equal(restoredActiveState.slotRegisterWords[slotOneSourceRegister], RAM_BASE);
	assertApuSlotOneActiveReadback(restored.memory);

	restored.memory.writeValue(IO_APU_CMD, APU_CMD_STOP_SLOT);
	assertApuIdleReadback(restored.memory);
	const restoredStoppedState = restored.audio.captureState();
	assert.equal(restoredStoppedState.activeSlotMask, 0);
	assert.equal(restoredStoppedState.slotRegisterWords[slotOneSourceRegister], 0);
});

test('APU parameter registerfile is device-owned and saved', () => {
	const { memory, audio } = createAudioHarness(true);

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
	memory.writeValue(IO_APU_TARGET_GAIN_Q12, 0x0400);

	const saved = audio.captureState();
	const restored = createAudioHarness(true);
	restored.audio.restoreState(saved);

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
	assert.equal(restored.memory.readIoU32(IO_APU_TARGET_GAIN_Q12), 0x0400);
	assert.equal(restored.audio.captureState().registerWords[APU_PARAMETER_SLOT_INDEX], 3);
});

test('APU same-source slot replay keeps the new voice latch active', async () => {
	const { memory, audio, activeVoice, emitEnded } = createActiveVoiceAudioHarness({ endExistingVoiceOnReplay: true });

	await playApuSlot(memory, 1);
	memory.writeValue(IO_APU_SLOT, 1);
	assertApuSlotOneActiveReadback(memory);
	memory.writeMappedU32LE(IO_APU_ACTIVE_MASK, 0xffffffff);
	assert.equal(memory.readIoU32(IO_APU_ACTIVE_MASK), 2);
	memory.writeMappedU32LE(IO_APU_SELECTED_SLOT_REG0, 0xffffffff);
	assert.equal(memory.readIoU32(IO_APU_SELECTED_SLOT_REG0), RAM_BASE);

	await playApuSlot(memory, 1);
	memory.writeValue(IO_APU_SLOT, 1);
	assertApuSlotOneActiveReadback(memory);
	assert.equal(audio.captureState().activeSlotMask, 2);
	assert.equal(audio.captureState().slotRegisterWords[apuSlotRegisterWordIndex(1, APU_PARAMETER_SOURCE_ADDR_INDEX)], RAM_BASE);

	const staleVoice = activeVoice();
	assert.notEqual(staleVoice, null);
	audio.restoreState(audio.captureState());
	emitEnded(staleVoice as FakeVoiceInfo);
	memory.writeValue(IO_APU_SLOT, 1);
	assertApuSlotOneActiveReadback(memory);
});

test('APU event latch is device-owned and saved', async () => {
	const { memory, audio, activeVoice, emitEnded } = createActiveVoiceAudioHarness();

	await playApuSlot(memory, 1);
	const endedVoice = activeVoice();
	assert.notEqual(endedVoice, null);
	emitEnded(endedVoice as FakeVoiceInfo);
	assertApuSlotEndedEvent(memory, 1);
	assert.equal((memory.readIoU32(IO_IRQ_FLAGS) & IRQ_APU) !== 0, true);

	const saved = audio.captureState();
	const restored = createAudioHarness(true);
	restored.audio.restoreState(saved);
	assertApuSlotEndedEvent(restored.memory, 1);
	assert.equal(restored.audio.captureState().eventKind, APU_EVENT_SLOT_ENDED);
	assert.equal(restored.audio.captureState().eventSlot, 1);
	assert.equal(restored.audio.captureState().eventSourceAddr, RAM_BASE);
});

test('APU STOP_SLOT fade keeps the slot active until the ended event', async () => {
	const { memory, audio, activeVoice, emitEnded, stoppedFadeMs } = createActiveVoiceAudioHarness({ stopSlotWithFade: true });

	await playApuSlot(memory, 1);
	memory.writeValue(IO_APU_SLOT, 1);
	assertApuSlotOneActiveReadback(memory);

	memory.writeValue(IO_APU_FADE_SAMPLES, APU_SAMPLE_RATE_HZ);
	memory.writeValue(IO_APU_CMD, APU_CMD_STOP_SLOT);
	assert.equal(stoppedFadeMs(), 1000);
	memory.writeValue(IO_APU_SLOT, 1);
	assertApuSlotOneActiveReadback(memory);
	assert.equal(memory.readIoU32(IO_APU_EVENT_SEQ), 0);

	const endedVoice = activeVoice();
	assert.notEqual(endedVoice, null);
	emitEnded(endedVoice as FakeVoiceInfo);
	assertApuIdleReadback(memory);
	assertApuSlotEndedEvent(memory, 1);
	assert.equal((memory.readIoU32(IO_IRQ_FLAGS) & IRQ_APU) !== 0, true);
	assertNoCapturedSlotOneSource(audio);
});

test('APU STOP_SLOT cancels pending play before the host voice becomes active', async () => {
	const { memory, audio, resolvePendingPlay } = createPendingPlayAudioHarness(false);

	beginPendingApuPlay(memory);

	memory.writeValue(IO_APU_SLOT, 1);
	memory.writeValue(IO_APU_CMD, APU_CMD_STOP_SLOT);
	assertApuIdleReadback(memory);

	await resolvePendingPlayAndAssertIdle(memory, resolvePendingPlay);
	assertNoCapturedSlotOneSource(audio);
});

test('APU restore rejects pre-restore pending play completions', async () => {
	const { memory, audio, resolvePendingPlay } = createPendingPlayAudioHarness(false);

	beginPendingApuPlay(memory);
	audio.restoreState({
		registerWords: createAudioControllerStateRegisterWords(1),
		eventSequence: 0,
		eventKind: 0,
		eventSlot: 0,
		eventSourceAddr: 0,
		activeSlotMask: 0,
		slotRegisterWords: new Array<number>(APU_SLOT_REGISTER_WORD_COUNT).fill(0),
		apuStatus: 0,
		apuFaultCode: APU_FAULT_NONE,
		apuFaultDetail: 0,
	});
	assertApuIdleReadback(memory);
	await resolvePendingPlayAndAssertIdle(memory, resolvePendingPlay);
	assertNoCapturedSlotOneSource(audio);
});

test('APU ended listener is released with the controller lifecycle', () => {
	const memory = new Memory({ systemRom: new Uint8Array(0) });
	const irq = new IrqController(memory);
	let listenerCount = 0;
	let unsubscribeCount = 0;
	const soundMaster = {
		addEndedListener: () => {
			listenerCount += 1;
			return () => {
				unsubscribeCount += 1;
			};
		},
		isRuntimeAudioReady: () => true,
		playResolvedSourceOnSlot: async () => 1,
		stopAllVoices: () => {},
		stopSlot: () => {},
		rampSlotGainLinear: () => {},
		setSlotGainLinear: () => {},
	};
	const audio = new AudioController(memory, soundMaster as never, irq);

	assert.equal(listenerCount, 1);
	for (let index = 0; index < 2; index += 1) {
		audio.dispose();
	}
	assert.equal(unsubscribeCount, 1);
});
