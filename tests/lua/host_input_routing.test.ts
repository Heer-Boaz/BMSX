import assert from 'node:assert/strict';
import test from 'node:test';

import type { HostClock } from '../../hosts/common/clock';
import { HostMenuInput, HostOverlayMenu } from '../../hosts/common/host_overlay_menu';
import type { GamepadDevice, InputSource } from '../../hosts/common/input/contracts';
import { Input } from '../../hosts/common/input/manager';
import {
	HOST_IDE_BUTTON,
} from '../../hosts/common/input/shortcuts';
import { createInputControllerSnapshot } from '../../machine/ts/machine/devices/input/contracts';
import { hidKeyUsageForCode } from '../../hosts/common/input/hid_keys';
import type { Runtime } from '../../machine/ts/machine/runtime/runtime';
import type { VideoPresenter } from '../../machine/ts/render/video_presenter';

function createInput(): { input: Input; setTime(time: number): void } {
	let currentTime = 0;
	const clock = {
		now: () => currentTime,
	} as HostClock;
	const source: InputSource = {
		devices: () => [],
		subscribe: () => () => {},
	};
	return {
		input: new Input(clock, source, -1),
		setTime: time => { currentTime = time; },
	};
}

function keyWordContains(words: Uint32Array, code: string): boolean {
	const usage = hidKeyUsageForCode(code);
	return (words[usage >>> 5] & (1 << (usage & 31))) !== 0;
}

test('host control routing reserves Select without leaking split-frame shortcuts', () => {
	const { input, setTime } = createInput();
	let shortcutCount = 0;
	let releaseCount = 0;
	const dispose = input.getGlobalShortcutRegistry().registerControlShortcut(
		1,
		HOST_IDE_BUTTON,
		() => { shortcutCount += 1; },
		() => { releaseCount += 1; },
	);
	const keyboard = input.getPlayerInput(1).inputHandlers.keyboard!;
	const snapshot = createInputControllerSnapshot();

	setTime(10);
	input.inputButton('keyboard:0', 'ControlRight', true, 1, 10, 1);
	input.pollInput();
	assert.equal(shortcutCount, 0);
	assert.equal(keyboard.getButtonState('select').consumed, true);
	input.sampleInputControllerSnapshot(snapshot);
	assert.equal(keyWordContains(snapshot.keyWords, 'ControlRight'), false);

	setTime(20);
	input.inputButton('keyboard:0', 'ShiftRight', true, 1, 20, 2);
	input.pollInput();
	assert.equal(shortcutCount, 1);
	assert.equal(keyboard.getButtonState('rb').consumed, true);
	assert.equal(keyboard.getKeyState('ControlRight').consumed, true);
	assert.equal(keyboard.getKeyState('ShiftRight').consumed, true);
	input.sampleInputControllerSnapshot(snapshot);
	assert.equal(keyWordContains(snapshot.keyWords, 'ControlRight'), false);
	assert.equal(keyWordContains(snapshot.keyWords, 'ShiftRight'), false);

	setTime(30);
	input.inputButton('keyboard:0', 'ControlRight', false, 0, 30, 1);
	input.pollInput();
	assert.equal(releaseCount, 1);
	input.sampleInputControllerSnapshot(snapshot);
	assert.equal(keyWordContains(snapshot.keyWords, 'ShiftRight'), false);

	setTime(40);
	input.inputButton('keyboard:0', 'ShiftRight', false, 0, 40, 2);
	input.pollInput();

	setTime(50);
	input.inputButton('keyboard:0', 'Backspace', true, 1, 50, 3);
	input.inputButton('keyboard:0', 'Enter', true, 1, 50, 4);
	input.pollInput();
	input.sampleInputControllerSnapshot(snapshot);
	assert.equal(keyWordContains(snapshot.keyWords, 'Backspace'), true);
	assert.equal(keyWordContains(snapshot.keyWords, 'Enter'), true);
	assert.equal(keyboard.getKeyState('Backspace').consumed, false);

	dispose();
	input.dispose();
});

test('host key repeat survives frame-local key consumption', () => {
	const { input, setTime } = createInput();
	const player = input.getPlayerInput(1);
	const keyboard = player.inputHandlers.keyboard!;

	input.inputButton('keyboard:0', 'KeyZ', true, 1, 0, 1);
	input.pollInput();
	assert.equal(player.buttonRepeatEdge('KeyZ', 'keyboard'), true);
	keyboard.consumeKey('KeyZ');

	for (let frame = 1; frame < 15; frame += 1) {
		setTime(frame * (1000 / 60));
		input.pollInput();
		assert.equal(player.buttonRepeatEdge('KeyZ', 'keyboard'), false);
		keyboard.consumeKey('KeyZ');
	}
	setTime(15 * (1000 / 60));
	input.pollInput();
	assert.equal(player.buttonRepeatEdge('KeyZ', 'keyboard'), true);
	input.dispose();
});

test('physical and host overlay keyboards retain independent key ownership', () => {
	const { input, setTime } = createInput();
	const keyboard = input.getPlayerInput(1).inputHandlers.keyboard!;
	const snapshot = createInputControllerSnapshot();

	input.inputButton('keyboard:0', 'KeyA', true, 1, 0, 1);
	input.setVirtualKeyboardKey('KeyA', true);
	input.pollInput();
	input.sampleInputControllerSnapshot(snapshot);
	assert.equal(keyboard.getKeyState('KeyA').pressed, true);
	assert.equal(keyWordContains(snapshot.keyWords, 'KeyA'), true);

	setTime(10);
	input.setVirtualKeyboardKey('KeyA', false);
	input.pollInput();
	input.sampleInputControllerSnapshot(snapshot);
	assert.equal(keyboard.getKeyState('KeyA').pressed, true);
	assert.equal(keyboard.getKeyState('KeyA').justreleased, false);
	assert.equal(keyWordContains(snapshot.keyWords, 'KeyA'), true);

	setTime(20);
	input.inputButton('keyboard:0', 'KeyA', false, 0, 20, 1);
	input.pollInput();
	input.sampleInputControllerSnapshot(snapshot);
	assert.equal(keyboard.getKeyState('KeyA').justreleased, true);
	assert.equal(keyWordContains(snapshot.keyWords, 'KeyA'), false);
	input.dispose();
});

test('quick menu accepts navigation after consuming its opening frame', () => {
	const { input, setTime } = createInput();
	const presenter = {
		show_resource_usage_gizmo: false,
	} as VideoPresenter;
	const menu = new HostOverlayMenu(presenter, {} as Runtime, input);

	setTime(10);
	input.inputButton('keyboard:0', 'ControlRight', true, 1, 10, 1);
	input.inputButton('keyboard:0', 'AltRight', true, 1, 10, 2);
	input.pollInput();
	assert.equal(menu.tickInput(), HostMenuInput.Active);

	setTime(20);
	input.inputButton('keyboard:0', 'ControlRight', false, 0, 20, 1);
	input.inputButton('keyboard:0', 'AltRight', false, 0, 20, 2);
	input.pollInput();
	assert.equal(menu.tickInput(), HostMenuInput.Active);

	setTime(30);
	input.inputButton('keyboard:0', 'ArrowRight', true, 1, 30, 3);
	input.pollInput();
	assert.equal(menu.tickInput(), HostMenuInput.Active);
	assert.equal(presenter.show_resource_usage_gizmo, true);
	input.dispose();
});

test('quick menu reassigns an onscreen-style gamepad and remains controllable on its new port', () => {
	let currentTime = 0;
	const clock = {
		now: () => currentTime,
	} as HostClock;
	const gamepad: GamepadDevice = {
		id: 'gamepad:2147483646',
		kind: 'gamepad',
		gamepadIndex: 2147483646,
		label: 'TOUCH',
		vibrationInitialization: null,
		supportsVibration: false,
		setVibration: () => {},
	};
	const source: InputSource = {
		devices: () => [gamepad],
		subscribe: () => () => {},
	};
	const input = new Input(clock, source, gamepad.gamepadIndex);
	const presenter = {
		show_resource_usage_gizmo: false,
	} as VideoPresenter;
	const menu = new HostOverlayMenu(presenter, {} as Runtime, input);

	input.inputButton(gamepad.id, 'select', true, 1, currentTime, 1);
	input.inputButton(gamepad.id, 'start', true, 1, currentTime, 2);
	input.pollInput();
	assert.equal(menu.tickInput(), HostMenuInput.Active);
	currentTime += 1;
	input.inputButton(gamepad.id, 'select', false, 0, currentTime, 1);
	input.inputButton(gamepad.id, 'start', false, 0, currentTime, 2);
	input.pollInput();
	menu.tickInput();

	for (let step = 0; step < 6; step += 1) {
		currentTime += 1;
		const pressId = step + 3;
		input.inputButton(gamepad.id, 'up', true, 1, currentTime, pressId);
		input.pollInput();
		menu.tickInput();
		currentTime += 1;
		input.inputButton(gamepad.id, 'up', false, 0, currentTime, pressId);
		input.pollInput();
		menu.tickInput();
	}

	currentTime += 1;
	input.inputButton(gamepad.id, 'right', true, 1, currentTime, 9);
	input.pollInput();
	menu.tickInput();
	assert.equal(input.getPlayerInput(1).inputHandlers.gamepad, null);
	assert.equal(input.getPlayerInput(2).inputHandlers.gamepad?.device, gamepad);

	currentTime += 1;
	input.inputButton(gamepad.id, 'right', false, 0, currentTime, 9);
	input.pollInput();
	menu.tickInput();
	currentTime += 1;
	input.inputButton(gamepad.id, 'b', true, 1, currentTime, 10);
	input.pollInput();
	assert.equal(menu.tickInput(), HostMenuInput.Inactive);
	input.dispose();
});

test('on-screen keyboard publishes a gamepad-authored HID key pulse', () => {
	let currentTime = 0;
	const clock = { now: () => currentTime } as HostClock;
	const gamepad: GamepadDevice = {
		id: 'gamepad:0',
		kind: 'gamepad',
		gamepadIndex: 0,
		label: 'GAMEPAD',
		vibrationInitialization: null,
		supportsVibration: false,
		setVibration: () => {},
	};
	const source: InputSource = {
		devices: () => [gamepad],
		subscribe: () => () => {},
	};
	const input = new Input(clock, source, 0);
	const presenter = { show_resource_usage_gizmo: false } as VideoPresenter;
	const menu = new HostOverlayMenu(presenter, {} as Runtime, input);
	const snapshot = createInputControllerSnapshot();
	let pressId = 1;

	const press = (button: string): HostMenuInput => {
		input.inputButton(gamepad.id, button, true, 1, currentTime, pressId);
		input.pollInput();
		const result = menu.tickInput();
		currentTime += 1;
		input.inputButton(gamepad.id, button, false, 0, currentTime, pressId);
		pressId += 1;
		input.pollInput();
		menu.tickInput();
		currentTime += 1;
		return result;
	};

	input.inputButton(gamepad.id, 'select', true, 1, currentTime, pressId++);
	input.inputButton(gamepad.id, 'start', true, 1, currentTime, pressId++);
	input.pollInput();
	assert.equal(menu.tickInput(), HostMenuInput.Active);
	currentTime += 1;
	input.inputButton(gamepad.id, 'select', false, 0, currentTime, 1);
	input.inputButton(gamepad.id, 'start', false, 0, currentTime, 2);
	input.pollInput();
	menu.tickInput();
	currentTime += 1;

	press('up');
	press('up');
	press('up');
	assert.equal(press('a'), HostMenuInput.Inactive);
	press('a');

	input.sampleInputControllerSnapshot(snapshot);
	assert.equal(keyWordContains(snapshot.keyWords, 'KeyQ'), true);
	assert.equal(input.getPlayerInput(1).inputHandlers.keyboard!.getKeyState('KeyQ').justpressed, true);

	input.pollInput();
	menu.tickInput();
	input.sampleInputControllerSnapshot(snapshot);
	assert.equal(keyWordContains(snapshot.keyWords, 'KeyQ'), false);
	input.dispose();
});
