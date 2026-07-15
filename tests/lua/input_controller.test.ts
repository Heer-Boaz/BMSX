import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
	INP_CTRL_ARM,
	INP_CTRL_RESET,
	IO_INP_CTRL,
	IO_INP_KEYS,
	IO_INP_OUTPUT_CTRL,
	IO_INP_OUTPUT_DURATION_MS,
	IO_INP_OUTPUT_INTENSITY_Q16,
	IO_INP_OUTPUT_PORT,
	IO_INP_OUTPUT_STATUS,
	IO_INP_PADS,
	IO_INP_PAD_LX_OFFSET,
	IO_INP_PAD_LY_OFFSET,
	IO_INP_PAD_BUTTONS_OFFSET,
	IO_INP_POINTER_BUTTONS,
	IO_INP_POINTER_WHEEL,
	IO_INP_POINTER_X,
	IO_INP_POINTER_Y,
	IO_INP_STATUS,
} from '../../machine/ts/machine/bus/io';
import { IO_WORD_SIZE } from '../../machine/ts/machine/memory/map';
import { encodeSignedFix16 } from '../../machine/ts/machine/common/numeric';
import { AcceptedInterruptKind, CPU } from '../../machine/ts/machine/cpu/cpu';
import { InputController } from '../../machine/ts/machine/devices/input/controller';
import {
	INP_OUTPUT_CTRL_APPLY,
	INP_POINTER_BUTTON_PRIMARY,
	INP_POINTER_BUTTON_SECONDARY,
	INPUT_CONTROLLER_KEY_WORD_COUNT,
	INPUT_CONTROLLER_OUTPUT_INTENSITY_Q16_ONE,
	INPUT_CONTROLLER_SYSTEM_NMI_HID_USAGE,
	type InputControllerInputSource,
	type InputControllerSnapshot,
} from '../../machine/ts/machine/devices/input/contracts';
import { Memory } from '../../machine/ts/machine/memory/memory';
import { IrqController } from '../../machine/ts/machine/devices/irq/controller';

const HID_KEY_X = 27;
const PAD_A_BIT = 0;

type FakeVibration = {
	padIndex: number;
	durationMs: number;
	intensity: number;
};

function writeSample(snapshot: InputControllerSnapshot, keyWords: Uint32Array): void {
	snapshot.keyWords.set(keyWords);
	snapshot.pointerButtons = (1 << INP_POINTER_BUTTON_PRIMARY) | (1 << INP_POINTER_BUTTON_SECONDARY);
	snapshot.pointerX = 12.5;
	snapshot.pointerY = -3.25;
	snapshot.pointerWheel = 1.5;
	snapshot.rumbleSupportMask = 1 << 2;
	snapshot.pads[0].buttons = 1 << PAD_A_BIT;
	snapshot.pads[0].axes[0] = -0.5;
	snapshot.pads[0].axes[1] = 0.25;
}

function createHarness(): {
	memory: Memory;
	cpu: CPU;
	controller: InputController;
	vibrations: FakeVibration[];
	samples: () => number;
	keySamples: () => number;
	setKey: (usage: number, down: boolean) => void;
} {
	const memory = new Memory({ systemRom: new Uint8Array(0), cartRom: new Uint8Array(0) });
	const irq = new IrqController(memory);
	const cpu = new CPU(memory, irq);
	const vibrations: FakeVibration[] = [];
	const keyWords = new Uint32Array(INPUT_CONTROLLER_KEY_WORD_COUNT);
	keyWords[HID_KEY_X >>> 5] = 1 << (HID_KEY_X & 31);
	let sampleCount = 0;
	let keySampleCount = 0;
	const writeKeyWords = (target: Uint32Array): void => {
		target.set(keyWords);
	};
	const input: InputControllerInputSource = {
		sampleInputControllerKeyWords(target) {
			keySampleCount += 1;
			writeKeyWords(target);
		},
		sampleInputControllerSnapshot(_currentTimeMs: number, snapshot: InputControllerSnapshot) {
			sampleCount += 1;
			writeSample(snapshot, keyWords);
		},
		applyInputControllerVibrationEffect(padIndex, durationMs, intensity) {
			vibrations.push({ padIndex, durationMs, intensity });
		},
		setRuntimeInputFrameDurationMs() { },
	};
	const controller = new InputController(memory, input, cpu);
	controller.reset();
	return {
		memory,
		cpu,
		controller,
		vibrations,
		samples: () => sampleCount,
		keySamples: () => keySampleCount,
		setKey: (usage, down) => {
			const mask = 1 << (usage & 31);
			const word = usage >>> 5;
			keyWords[word] = down ? keyWords[word] | mask : keyWords[word] & ~mask;
		},
	};
}

test('input controller latches one raw MMIO snapshot on armed VBlank', () => {
	const live = createHarness();
	live.memory.writeValue(IO_INP_CTRL, INP_CTRL_ARM);
	live.controller.onVblankEdge(1000 / 60, 77);

	assert.equal(live.samples(), 1);
	assert.equal(live.memory.readIoU32(IO_INP_STATUS), 1);
	assert.equal(live.memory.readIoU32(IO_INP_KEYS + (HID_KEY_X >>> 5) * IO_WORD_SIZE), 1 << (HID_KEY_X & 31));
	assert.equal(live.memory.readIoU32(IO_INP_POINTER_BUTTONS), (1 << INP_POINTER_BUTTON_PRIMARY) | (1 << INP_POINTER_BUTTON_SECONDARY));
	assert.equal(live.memory.readIoU32(IO_INP_POINTER_X), encodeSignedFix16(12.5));
	assert.equal(live.memory.readIoU32(IO_INP_POINTER_Y), encodeSignedFix16(-3.25));
	assert.equal(live.memory.readIoU32(IO_INP_POINTER_WHEEL), encodeSignedFix16(1.5));
	assert.equal(live.memory.readIoU32(IO_INP_PADS + IO_INP_PAD_BUTTONS_OFFSET), 1 << PAD_A_BIT);
	assert.equal(live.memory.readIoU32(IO_INP_PADS + IO_INP_PAD_LX_OFFSET), encodeSignedFix16(-0.5));
	assert.equal(live.memory.readIoU32(IO_INP_PADS + IO_INP_PAD_LY_OFFSET), encodeSignedFix16(0.25));
	assert.equal(live.memory.readIoU32(IO_INP_OUTPUT_STATUS), 1 << 2);
});

test('input controller save-state restores raw latch registers', () => {
	const live = createHarness();
	live.memory.writeValue(IO_INP_CTRL, INP_CTRL_ARM);
	live.controller.onVblankEdge(1000 / 60, 77);
	live.memory.writeValue(IO_INP_OUTPUT_PORT, 2);
	live.memory.writeValue(IO_INP_OUTPUT_INTENSITY_Q16, INPUT_CONTROLLER_OUTPUT_INTENSITY_Q16_ONE >>> 1);
	live.memory.writeValue(IO_INP_OUTPUT_DURATION_MS, 120);

	const savedInput = live.controller.captureState();
	const restored = createHarness();
	restored.controller.restoreState(savedInput);

	assert.equal(restored.memory.readIoU32(IO_INP_STATUS), 1);
	assert.equal(restored.memory.readIoU32(IO_INP_KEYS + (HID_KEY_X >>> 5) * IO_WORD_SIZE), 1 << (HID_KEY_X & 31));
	assert.equal(restored.memory.readIoU32(IO_INP_POINTER_X), encodeSignedFix16(12.5));
	assert.equal(restored.memory.readIoU32(IO_INP_PADS), 1 << PAD_A_BIT);
	assert.equal(restored.memory.readIoU32(IO_INP_OUTPUT_PORT), 2);
	assert.equal(restored.memory.readIoU32(IO_INP_OUTPUT_INTENSITY_Q16), INPUT_CONTROLLER_OUTPUT_INTENSITY_Q16_ONE >>> 1);
	assert.equal(restored.memory.readIoU32(IO_INP_OUTPUT_DURATION_MS), 120);
});

test('input controller output registers emit selected-pad vibration commands', () => {
	const live = createHarness();
	live.memory.writeValue(IO_INP_OUTPUT_PORT, 2);
	live.memory.writeValue(IO_INP_OUTPUT_INTENSITY_Q16, INPUT_CONTROLLER_OUTPUT_INTENSITY_Q16_ONE >>> 1);
	live.memory.writeValue(IO_INP_OUTPUT_DURATION_MS, 120);

	live.memory.writeValue(IO_INP_OUTPUT_CTRL, INP_OUTPUT_CTRL_APPLY);
	assert.deepEqual(live.vibrations, [{ padIndex: 2, durationMs: 120, intensity: 0.5 }]);
	assert.equal(live.memory.readIoU32(IO_INP_OUTPUT_CTRL), 0);
});

test('input controller exposes the VBlank sample edge without leaking the sample latch', () => {
	const harness = createHarness();
	harness.memory.writeValue(IO_INP_CTRL, INP_CTRL_ARM);
	assert.equal(harness.controller.captureState().sampleArmed, true);
	harness.controller.cancelSampleArm();
	assert.equal(harness.controller.captureState().sampleArmed, false);
});

test('input controller drives one system NMI edge from raw F2 without publishing an unarmed snapshot', () => {
	const harness = createHarness();
	const restoredState = harness.controller.captureState();
	restoredState.systemNmiLineHigh = true;
	harness.controller.restoreState(restoredState);
	harness.setKey(INPUT_CONTROLLER_SYSTEM_NMI_HID_USAGE, true);
	harness.controller.onVblankEdge(1, 1);

	assert.equal(harness.samples(), 0);
	assert.equal(harness.keySamples(), 1);
	assert.equal(harness.memory.readIoU32(IO_INP_STATUS), 0);
	assert.equal(harness.memory.readIoU32(IO_INP_KEYS + (INPUT_CONTROLLER_SYSTEM_NMI_HID_USAGE >>> 5) * IO_WORD_SIZE), 0);
	assert.equal(harness.cpu.peekPendingInterrupt(), AcceptedInterruptKind.None);
	harness.memory.writeValue(IO_INP_CTRL, INP_CTRL_RESET);
	harness.controller.onVblankEdge(2, 2);
	assert.equal(harness.cpu.peekPendingInterrupt(), AcceptedInterruptKind.None);

	harness.setKey(INPUT_CONTROLLER_SYSTEM_NMI_HID_USAGE, false);
	harness.controller.onVblankEdge(3, 3);
	harness.setKey(INPUT_CONTROLLER_SYSTEM_NMI_HID_USAGE, true);
	harness.controller.onVblankEdge(4, 4);

	assert.equal(harness.cpu.peekPendingInterrupt(), AcceptedInterruptKind.NonMaskable);
	assert.equal(harness.controller.captureState().systemNmiLineHigh, true);
});
