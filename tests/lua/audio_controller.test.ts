import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
	APU_CMD_PLAY,
	APU_CMD_STOP_SLOT,
	APU_FAULT_BAD_CMD,
	APU_FAULT_BAD_SLOT,
	APU_FAULT_NONE,
	APU_FAULT_RUNTIME_UNAVAILABLE,
	APU_FAULT_SOURCE_RANGE,
	APU_STATUS_FAULT,
	IO_APU_CMD,
	IO_APU_FAULT_ACK,
	IO_APU_FAULT_CODE,
	IO_APU_STATUS,
	IO_APU_SOURCE_ADDR,
	IO_APU_SOURCE_BITS_PER_SAMPLE,
	IO_APU_SOURCE_BYTES,
	IO_APU_SOURCE_CHANNELS,
	IO_APU_SOURCE_DATA_BYTES,
	IO_APU_SOURCE_DATA_OFFSET,
	IO_APU_SOURCE_FRAME_COUNT,
	IO_APU_SOURCE_SAMPLE_RATE_HZ,
	IO_APU_SLOT,
} from '../../src/bmsx/machine/bus/io';
import { AudioController } from '../../src/bmsx/machine/devices/audio/controller';
import { IrqController } from '../../src/bmsx/machine/devices/irq/controller';
import { RAM_BASE } from '../../src/bmsx/machine/memory/map';
import { Memory } from '../../src/bmsx/machine/memory/memory';

function createAudioHarness(runtimeReady: boolean): { memory: Memory; audio: AudioController } {
	const memory = new Memory({ systemRom: new Uint8Array(0) });
	const irq = new IrqController(memory);
	const soundMaster = {
		addEndedListener: () => () => {},
		isRuntimeAudioReady: () => runtimeReady,
		playResolvedSourceOnSlot: async () => 1,
		stopSlot: () => {},
		rampSlotGainLinear: () => {},
		setSlotGainLinear: () => {},
	};
	const audio = new AudioController(memory, soundMaster as never, irq);
	audio.reset();
	return { memory, audio };
}

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

function assertApuFault(memory: Memory, code: number): void {
	assert.equal(memory.readIoU32(IO_APU_FAULT_CODE), code);
	assert.equal((memory.readIoU32(IO_APU_STATUS) & APU_STATUS_FAULT) !== 0, true);
}

test('APU command faults latch in MMIO and ACK self-clears', () => {
	const { memory } = createAudioHarness(true);

	assert.doesNotThrow(() => memory.writeValue(IO_APU_CMD, 0xffff));
	assertApuFault(memory, APU_FAULT_BAD_CMD);

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
	assertApuFault(memory, APU_FAULT_BAD_SLOT);

	memory.writeValue(IO_APU_FAULT_ACK, 1);
	memory.writeValue(IO_APU_SOURCE_BYTES, 4);
	assert.doesNotThrow(() => memory.writeValue(IO_APU_CMD, APU_CMD_PLAY));
	assertApuFault(memory, APU_FAULT_SOURCE_RANGE);
});

test('APU host playback rejection is cart-visible device status', () => {
	const { memory } = createAudioHarness(false);

	writeValidSourceRegisters(memory);
	assert.doesNotThrow(() => memory.writeValue(IO_APU_CMD, APU_CMD_PLAY));
	assertApuFault(memory, APU_FAULT_RUNTIME_UNAVAILABLE);
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
