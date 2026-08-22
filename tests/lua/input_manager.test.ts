import assert from 'node:assert/strict';
import { test } from 'node:test';

import type { HostClock } from '../../hosts/common/clock';
import type { GamepadDevice, InputSource } from '../../hosts/common/input/contracts';
import { inputControllerGamepadButtonBit } from '../../hosts/common/input/gamepad_buttons';
import { Input } from '../../hosts/common/input/manager';
import { createInputControllerSnapshot } from '../../machine/ts/machine/devices/input/contracts';

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
	input.sampleInputControllerSnapshot(snapshot);
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
