import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
	INP_CTRL_ARM,
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
import { InputController } from '../../machine/ts/machine/devices/input/controller';
import {
	INP_OUTPUT_CTRL_APPLY,
	INP_POINTER_BUTTON_PRIMARY,
	INP_POINTER_BUTTON_SECONDARY,
	INPUT_CONTROLLER_OUTPUT_INTENSITY_Q16_ONE,
	type InputControllerInputSource,
	type InputControllerSnapshot,
} from '../../machine/ts/machine/devices/input/contracts';
import { DEFAULT_LUA_BUILTIN_NAMES } from '../../machine/ts/lua/builtin_descriptors';
import { Memory } from '../../machine/ts/machine/memory/memory';

const HID_KEY_X = 27;
const PAD_A_BIT = 0;

type FakeVibration = {
	padIndex: number;
	durationMs: number;
	intensity: number;
};

function writeSample(snapshot: InputControllerSnapshot): void {
	snapshot.keyWords[HID_KEY_X >>> 5] = 1 << (HID_KEY_X & 31);
	snapshot.pointerButtons = (1 << INP_POINTER_BUTTON_PRIMARY) | (1 << INP_POINTER_BUTTON_SECONDARY);
	snapshot.pointerX = 12.5;
	snapshot.pointerY = -3.25;
	snapshot.pointerWheel = 1.5;
	snapshot.rumbleSupportMask = 1 << 2;
	snapshot.pads[0].buttons = 1 << PAD_A_BIT;
	snapshot.pads[0].axes[0] = -0.5;
	snapshot.pads[0].axes[1] = 0.25;
}

function createHarness(): { memory: Memory; controller: InputController; vibrations: FakeVibration[]; samples: () => number } {
	const memory = new Memory({ systemRom: new Uint8Array(0), cartRom: new Uint8Array(0) });
	const vibrations: FakeVibration[] = [];
	let sampleCount = 0;
	const input: InputControllerInputSource = {
		sampleInputControllerSnapshot(_currentTimeMs: number, snapshot: InputControllerSnapshot) {
			sampleCount += 1;
			writeSample(snapshot);
		},
		applyInputControllerVibrationEffect(padIndex, durationMs, intensity) {
			vibrations.push({ padIndex, durationMs, intensity });
		},
		setRuntimeInputFrameDurationMs() { },
	};
	const controller = new InputController(memory, input);
	controller.reset();
	return { memory, controller, vibrations, samples: () => sampleCount };
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

test('ICU raw input words are not host globals or high-level action registers', () => {
	const source = DEFAULT_LUA_BUILTIN_NAMES.join('\n');
	assert.equal(DEFAULT_LUA_BUILTIN_NAMES.includes('string' + '_ref'), false);
	for (const name of [
		'sys_inp_ctrl',
		'sys_inp_status',
		'sys_inp_keys',
		'sys_inp_pads',
		'sys_inp_pointer_buttons',
		'sys_inp_output_port',
	]) {
		assert.equal(source.includes(name), false);
		assert.equal(DEFAULT_LUA_BUILTIN_NAMES.includes(name), false);
	}
	assert.equal(DEFAULT_LUA_BUILTIN_NAMES.includes('sys_inp_player'), false);
	assert.equal(DEFAULT_LUA_BUILTIN_NAMES.includes('sys_inp_source'), false);
	assert.equal(DEFAULT_LUA_BUILTIN_NAMES.includes('sys_inp_button'), false);
	assert.equal(DEFAULT_LUA_BUILTIN_NAMES.includes('sys_inp_action'), false);
	assert.equal(DEFAULT_LUA_BUILTIN_NAMES.includes('sys_inp_bind'), false);
	assert.equal(DEFAULT_LUA_BUILTIN_NAMES.includes('sys_inp_query'), false);
	assert.equal(DEFAULT_LUA_BUILTIN_NAMES.includes('sys_inp_consume'), false);
	assert.equal(DEFAULT_LUA_BUILTIN_NAMES.includes('sys_inp_value_x'), false);
	assert.equal(DEFAULT_LUA_BUILTIN_NAMES.includes('sys_inp_value_y'), false);
});
