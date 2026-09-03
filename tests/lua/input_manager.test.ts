import assert from 'node:assert/strict';
import { test } from 'node:test';

import type { HostClock } from '../../hosts/common/clock';
import type { GamepadDevice, InputSource } from '../../hosts/common/input/contracts';
import { inputControllerGamepadButtonBit } from '../../hosts/common/input/gamepad_buttons';
import { Input } from '../../hosts/common/input/manager';
import { InputControllerPlayback } from '../../hosts/common/input/controller_playback';
import {
	createInputControllerSnapshot,
	InputControllerSampleContext,
	InputControllerGamepadAxis,
	InputControllerGamepadButtonBit,
} from '../../machine/ts/machine/devices/input/contracts';
import { encodeSignedFix16 } from '../../machine/ts/machine/common/numeric';
import { Machine } from '../../machine/ts/machine/machine';
import { Memory } from '../../machine/ts/machine/memory/memory';
import { PSX_MACHINE_SPEC } from '../../machine/ts/spec/bmsx/model';
import { cartridgeSlots } from '../helpers/cartridge';
import {
	INP_CTRL_ARM,
	IO_INP_CTRL,
	IO_INP_KEYS,
	IO_INP_PADS,
	IO_INP_PAD_BUTTONS_OFFSET,
} from '../../machine/ts/spec/bmsx/io';
import { IO_WORD_SIZE } from '../../machine/ts/spec/bmsx/memory_map';
import { hidKeyUsageForCode } from '../../hosts/common/input/hid_keys';

function gamepad(index: number): GamepadDevice {
	return {
		id: `gamepad:${index}`,
		kind: 'gamepad',
		gamepadIndex: index,
		label: `GAMEPAD ${index + 1}`,
		vibrationInitialization: null,
		supportsVibration: false,
		setVibration: () => {},
	};
}

test('host and programmatic supervisor requests drive independent wired-OR sources', () => {
	const clock = { now: () => 0 } as HostClock;
	const source: InputSource = {
		devices: () => [],
		subscribe: () => () => {},
	};
	const input = new Input(clock, source, -1);

	input.setSupervisorRequestLine(true);
	input.setProgrammaticSupervisorRequestLine(true);
	input.setSupervisorRequestLine(false);
	assert.equal(input.supervisorRequestLineHigh(), true);

	input.resetInput();
	assert.equal(input.supervisorRequestLineHigh(), true);
	input.setProgrammaticSupervisorRequestLine(false);
	assert.equal(input.supervisorRequestLineHigh(), false);

	input.inputButton('keyboard:0', 'ControlRight', true, 1, 1, 1);
	input.inputButton('keyboard:0', 'ShiftLeft', true, 1, 1, 2);
	input.pollInput();
	assert.equal(input.supervisorRequestLineHigh(), true);

	input.inputButton('keyboard:0', 'ControlRight', false, 0, 2, 1);
	input.inputButton('keyboard:0', 'ShiftLeft', false, 0, 2, 2);
	input.pollInput();
	assert.equal(input.supervisorRequestLineHigh(), false);

	input.inputButton('keyboard:0', 'ControlRight', true, 1, 3, 3);
	input.inputButton('keyboard:0', 'ShiftLeft', true, 1, 3, 4);
	input.pollInput();
	assert.equal(input.supervisorRequestLineHigh(), true);

	input.resetInput();
	assert.equal(input.supervisorRequestLineHigh(), false);
	input.dispose();
});

test('connected gamepads retain their player port while Start is held', () => {
	let time = 0;
	const clock = { now: () => time } as HostClock;
	const device = gamepad(0);
	const source: InputSource = {
		devices: () => [device],
		subscribe: () => () => {},
	};
	const input = new Input(clock, source, 0);
	const assigned = input.getPlayerInput(1).inputHandlers.gamepad;
	assert.ok(assigned);

	input.inputButton(device.id, 'start', true, 1, 0, 1);
	input.pollInput();
	time = 100;
	input.pollInput();
	assert.equal(input.getPlayerInput(1).inputHandlers.gamepad, assigned);

	const snapshot = createInputControllerSnapshot();
	input.sampleInputControllerSnapshot(snapshot, InputControllerSampleContext.Normal);
	const startMask = 1 << inputControllerGamepadButtonBit('start');
	assert.notEqual(snapshot.pads[0].buttons & startMask, 0);
	input.dispose();
});

test('gamepads occupy stable ports in connection order after the startup controller', () => {
	const pads = [gamepad(0), gamepad(1), gamepad(2), gamepad(3), gamepad(4)];
	const clock = { now: () => 0 } as HostClock;
	const source: InputSource = {
		devices: () => pads,
		subscribe: () => () => {},
	};
	const input = new Input(clock, source, 2);
	const player2 = input.getPlayerInput(2);

	assert.equal(input.getPlayerInput(1).inputHandlers.gamepad?.device, pads[2]);
	assert.equal(player2.inputHandlers.gamepad?.device, pads[0]);
	assert.equal(input.getPlayerInput(3).inputHandlers.gamepad?.device, pads[1]);
	assert.equal(input.getPlayerInput(4).inputHandlers.gamepad?.device, pads[3]);

	input.disconnectInputDevice(pads[0].id);
	assert.equal(player2.inputHandlers.gamepad?.device, pads[4]);
	input.dispose();
});

test('player-port remaps affect only the ICU snapshot view', () => {
	const clock = { now: () => 0 } as HostClock;
	const device = gamepad(0);
	const source: InputSource = {
		devices: () => [device],
		subscribe: () => () => {},
	};
	const input = new Input(clock, source, device.gamepadIndex);
	const remap = input.gamepadPortRemaps[0];
	const leftX = InputControllerGamepadAxis.LeftX;
	const leftY = InputControllerGamepadAxis.LeftY;
	const rightX = InputControllerGamepadAxis.RightX;
	const rightY = InputControllerGamepadAxis.RightY;
	const leftTriggerAxis = InputControllerGamepadAxis.LeftTrigger;
	const rightTriggerAxis = InputControllerGamepadAxis.RightTrigger;
	remap.setButtonSource(
		InputControllerGamepadButtonBit.A,
		InputControllerGamepadButtonBit.B,
	);
	remap.setButtonSource(
		InputControllerGamepadButtonBit.B,
		InputControllerGamepadButtonBit.A,
	);
	remap.setButtonSource(
		InputControllerGamepadButtonBit.LeftTrigger,
		InputControllerGamepadButtonBit.RightTrigger,
	);
	remap.setButtonSource(
		InputControllerGamepadButtonBit.RightTrigger,
		InputControllerGamepadButtonBit.LeftTrigger,
	);
	remap.setAxisSource(leftTriggerAxis, rightTriggerAxis);
	remap.setAxisSource(rightTriggerAxis, leftTriggerAxis);
	remap.setButtonSource(
		InputControllerGamepadButtonBit.LeftStick,
		InputControllerGamepadButtonBit.RightStick,
	);
	remap.setButtonSource(
		InputControllerGamepadButtonBit.RightStick,
		InputControllerGamepadButtonBit.LeftStick,
	);
	remap.setAxisSource(leftX, rightX);
	remap.setAxisSource(leftY, rightY);
	remap.setAxisSource(rightX, leftX);
	remap.setAxisSource(rightY, leftY);

	input.inputButton(device.id, 'b', true, 1, 1, 1);
	input.inputButton(device.id, 'rt', true, 0.75, 1, 2);
	input.inputButton(device.id, 'rs', true, 1, 1, 3);
	input.inputAxis2(device.id, 'rs', 0.25, -0.5, 1);
	input.pollInput();

	const physical = input.getPlayerInput(1).inputHandlers.gamepad!;
	assert.equal(physical.getButtonState('b').pressed, true);
	assert.equal(physical.getButtonState('a').pressed, false);

	const snapshot = createInputControllerSnapshot();
	input.sampleInputControllerSnapshot(snapshot, InputControllerSampleContext.Normal);
	const buttons = snapshot.pads[0].buttons;
	const axes = snapshot.pads[0].axesQ16;
	assert.notEqual(buttons & (1 << InputControllerGamepadButtonBit.A), 0);
	assert.equal(buttons & (1 << InputControllerGamepadButtonBit.B), 0);
	assert.notEqual(buttons & (1 << InputControllerGamepadButtonBit.LeftTrigger), 0);
	assert.equal(buttons & (1 << InputControllerGamepadButtonBit.RightTrigger), 0);
	assert.notEqual(buttons & (1 << InputControllerGamepadButtonBit.LeftStick), 0);
	assert.equal(buttons & (1 << InputControllerGamepadButtonBit.RightStick), 0);
	assert.equal(axes[leftX], encodeSignedFix16(0.25));
	assert.equal(axes[leftY], encodeSignedFix16(-0.5));
	assert.equal(axes[leftTriggerAxis], encodeSignedFix16(0.75));
	assert.equal(axes[rightTriggerAxis], 0);

	remap.reset();
	input.sampleInputControllerSnapshot(snapshot, InputControllerSampleContext.Normal);
	assert.equal(snapshot.pads[0].buttons & (1 << InputControllerGamepadButtonBit.A), 0);
	assert.notEqual(snapshot.pads[0].buttons & (1 << InputControllerGamepadButtonBit.B), 0);
	assert.equal(axes[leftX], 0);
	assert.equal(axes[rightX], encodeSignedFix16(0.25));
	input.dispose();
});

test('control maps stay with the player port when devices are reassigned', () => {
	const devices = [gamepad(0), gamepad(1)];
	const clock = { now: () => 0 } as HostClock;
	const source: InputSource = {
		devices: () => devices,
		subscribe: () => () => {},
	};
	const input = new Input(clock, source, devices[0].gamepadIndex);
	input.gamepadPortRemaps[1].setButtonSource(
		InputControllerGamepadButtonBit.A,
		InputControllerGamepadButtonBit.B,
	);
	input.assignGamepadToPlayer(input.connectedGamepads[0], 2);
	input.inputButton(devices[0].id, 'b', true, 1, 1, 1);
	input.pollInput();

	const snapshot = createInputControllerSnapshot();
	input.sampleInputControllerSnapshot(snapshot, InputControllerSampleContext.Normal);
	const aMask = 1 << InputControllerGamepadButtonBit.A;
	assert.equal(snapshot.pads[0].buttons & aMask, 0);
	assert.notEqual(snapshot.pads[1].buttons & aMask, 0);
	input.dispose();
});

test('input-controller playback replaces normal ICU samples but not supervisor samples', () => {
	const clock = { now: () => 0 } as HostClock;
	const device = gamepad(0);
	const source: InputSource = {
		devices: () => [device],
		subscribe: () => () => {},
	};
	const input = new Input(clock, source, device.gamepadIndex);
	input.inputButton('keyboard:0', 'KeyA', true, 1, 0, 1);
	input.inputButton(device.id, 'a', true, 1, 0, 2);
	input.pollInput();

	const playback = new InputControllerPlayback();
	playback.setKeyboardKey('KeyB', true);
	playback.setGamepadButton(0, 'b', true);
	input.setInputControllerPlayback(playback);
	const normal = createInputControllerSnapshot();
	input.sampleInputControllerSnapshot(normal, InputControllerSampleContext.Normal);
	const keyAUsage = hidKeyUsageForCode('KeyA');
	const keyBUsage = hidKeyUsageForCode('KeyB');
	assert.equal(normal.keyWords[keyAUsage >>> 5] & (1 << (keyAUsage & 31)), 0);
	assert.notEqual(normal.keyWords[keyBUsage >>> 5] & (1 << (keyBUsage & 31)), 0);
	const supervisor = createInputControllerSnapshot();
	input.sampleInputControllerSnapshot(supervisor, InputControllerSampleContext.Supervisor);
	assert.notEqual(supervisor.keyWords[keyAUsage >>> 5] & (1 << (keyAUsage & 31)), 0);
	assert.equal(supervisor.keyWords[keyBUsage >>> 5] & (1 << (keyBUsage & 31)), 0);

	const memory = new Memory(
		{ systemRom: new Uint8Array(0), cartridgeSlots: cartridgeSlots() },
		PSX_MACHINE_SPEC.ramBytes,
	);
	const machine = new Machine(memory, input, PSX_MACHINE_SPEC);
	machine.resetDevices();
	const keyCUsage = hidKeyUsageForCode('KeyC');
	memory.writeMappedWord(IO_INP_CTRL, INP_CTRL_ARM);
	playback.setKeyboardKey('KeyC', true);
	machine.inputController.onVblankEdge(1);

	assert.notEqual(
		memory.readIoU32(IO_INP_KEYS + (keyBUsage >>> 5) * IO_WORD_SIZE)
			& (1 << (keyBUsage & 31)),
		0,
	);
	assert.notEqual(
		memory.readIoU32(IO_INP_KEYS + (keyCUsage >>> 5) * IO_WORD_SIZE)
			& (1 << (keyCUsage & 31)),
		0,
	);
	assert.equal(
		memory.readIoU32(IO_INP_KEYS + (hidKeyUsageForCode('KeyA') >>> 5) * IO_WORD_SIZE)
			& (1 << (hidKeyUsageForCode('KeyA') & 31)),
		0,
	);
	assert.notEqual(
		memory.readIoU32(IO_INP_PADS + IO_INP_PAD_BUTTONS_OFFSET)
			& (1 << InputControllerGamepadButtonBit.B),
		0,
	);
	assert.equal(
		memory.readIoU32(IO_INP_PADS + IO_INP_PAD_BUTTONS_OFFSET)
			& (1 << InputControllerGamepadButtonBit.A),
		0,
	);

	playback.setKeyboardKey('KeyC', false);
	assert.notEqual(
		memory.readIoU32(IO_INP_KEYS + (keyCUsage >>> 5) * IO_WORD_SIZE)
			& (1 << (keyCUsage & 31)),
		0,
	);
	memory.writeMappedWord(IO_INP_CTRL, INP_CTRL_ARM);
	machine.inputController.onVblankEdge(2);
	assert.equal(
		memory.readIoU32(IO_INP_KEYS + (keyCUsage >>> 5) * IO_WORD_SIZE)
			& (1 << (keyCUsage & 31)),
		0,
	);
	machine.systemController.requestSupervisorLineEdge();
	memory.writeMappedWord(IO_INP_CTRL, INP_CTRL_ARM);
	machine.inputController.onVblankEdge(3);
	assert.notEqual(
		memory.readIoU32(IO_INP_KEYS + (keyAUsage >>> 5) * IO_WORD_SIZE)
			& (1 << (keyAUsage & 31)),
		0,
	);
	assert.equal(
		memory.readIoU32(IO_INP_KEYS + (keyBUsage >>> 5) * IO_WORD_SIZE)
			& (1 << (keyBUsage & 31)),
		0,
	);
	assert.notEqual(
		memory.readIoU32(IO_INP_PADS + IO_INP_PAD_BUTTONS_OFFSET)
			& (1 << InputControllerGamepadButtonBit.A),
		0,
	);
	assert.equal(
		memory.readIoU32(IO_INP_PADS + IO_INP_PAD_BUTTONS_OFFSET)
			& (1 << InputControllerGamepadButtonBit.B),
		0,
	);

	input.setInputControllerPlayback(null);
	const physical = createInputControllerSnapshot();
	input.sampleInputControllerSnapshot(physical, InputControllerSampleContext.Normal);
	assert.notEqual(physical.keyWords[keyAUsage >>> 5] & (1 << (keyAUsage & 31)), 0);
	assert.notEqual(
		physical.pads[0].buttons & (1 << InputControllerGamepadButtonBit.A),
		0,
	);
	input.dispose();
});
