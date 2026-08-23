import assert from 'node:assert/strict';
import test from 'node:test';

import type { HostClock } from '../../hosts/common/clock';
import { HostMenuInput, HostOverlayMenu } from '../../hosts/common/host_overlay_menu';
import type { GamepadDevice, InputSource } from '../../hosts/common/input/contracts';
import { Input } from '../../hosts/common/input/manager';
import {
	HOST_IDE_BUTTON,
	HOST_ON_SCREEN_KEYBOARD_BUTTON,
} from '../../hosts/common/input/shortcuts';
import {
	createInputControllerSnapshot,
	INP_POINTER_BUTTON_PRIMARY,
} from '../../machine/ts/machine/devices/input/contracts';
import { hidKeyUsageForCode } from '../../hosts/common/input/hid_keys';
import type { Runtime } from '../../machine/ts/machine/runtime/runtime';
import { Host2DKind } from '../../machine/ts/render/host_overlay/commands';
import { HostOverlayQueue } from '../../machine/ts/render/host_overlay/overlay_queue';
import type { GlyphRenderSubmission } from '../../machine/ts/render/shared/submissions';
import type { VideoPresenter } from '../../machine/ts/render/video_presenter';
import {
	DisplayPointMappingResult,
	mapDisplayPointToViewport,
} from '../../machine/ts/render/video_output';

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

function createGamepadInput(clock: HostClock): { input: Input; gamepad: GamepadDevice } {
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
	return {
		input: new Input(clock, source, gamepad.gamepadIndex),
		gamepad,
	};
}

function keyWordContains(words: Uint32Array, code: string): boolean {
	const usage = hidKeyUsageForCode(code);
	return (words[usage >>> 5] & (1 << (usage & 31))) !== 0;
}

function tickMenu(input: Input, menu: HostOverlayMenu): HostMenuInput {
	input.pollInput();
	return menu.tickInput();
}

function openMenuWithGamepad(
	input: Input,
	menu: HostOverlayMenu,
	deviceId: string,
	time: number,
	selectPressId: number,
	startPressId: number,
): void {
	input.inputButton(deviceId, 'select', true, 1, time, selectPressId);
	input.inputButton(deviceId, 'start', true, 1, time, startPressId);
	assert.equal(tickMenu(input, menu), HostMenuInput.Active);
	input.inputButton(deviceId, 'select', false, 0, time + 1, selectPressId);
	input.inputButton(deviceId, 'start', false, 0, time + 1, startPressId);
	tickMenu(input, menu);
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

test('on-screen keyboard shortcut context retains keyboard shortcuts and excludes gamepad peers', () => {
	let currentTime = 0;
	const clock = { now: () => currentTime } as HostClock;
	const { input, gamepad } = createGamepadInput(clock);
	const shortcuts = input.getGlobalShortcutRegistry();
	let ideShortcutCount = 0;
	shortcuts.registerControlShortcut(1, HOST_IDE_BUTTON, () => { ideShortcutCount += 1; });
	shortcuts.registerControlShortcut(1, HOST_ON_SCREEN_KEYBOARD_BUTTON, () => {});
	shortcuts.setExclusiveGamepadControlShortcut(HOST_ON_SCREEN_KEYBOARD_BUTTON);

	input.inputButton(gamepad.id, 'select', true, 1, currentTime, 1);
	input.inputButton(gamepad.id, 'rb', true, 1, currentTime, 2);
	input.pollInput();
	assert.equal(ideShortcutCount, 0);
	assert.equal(input.getPlayerInput(1).inputHandlers.gamepad!.getButtonState('rb').consumed, false);

	currentTime += 1;
	input.inputButton('keyboard:0', 'ControlRight', true, 1, currentTime, 3);
	input.inputButton('keyboard:0', 'ShiftRight', true, 1, currentTime, 4);
	input.pollInput();
	assert.equal(ideShortcutCount, 1);

	shortcuts.setExclusiveGamepadControlShortcut(null);
	currentTime += 1;
	input.pollInput();
	assert.equal(ideShortcutCount, 1);
	currentTime += 1;
	input.inputButton(gamepad.id, 'select', false, 0, currentTime, 1);
	input.inputButton(gamepad.id, 'rb', false, 0, currentTime, 2);
	input.inputButton('keyboard:0', 'ControlRight', false, 0, currentTime, 3);
	input.inputButton('keyboard:0', 'ShiftRight', false, 0, currentTime, 4);
	input.pollInput();
	currentTime += 1;
	input.inputButton(gamepad.id, 'select', true, 1, currentTime, 5);
	input.inputButton(gamepad.id, 'rb', true, 1, currentTime, 6);
	input.pollInput();
	assert.equal(ideShortcutCount, 2);
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
	assert.equal(tickMenu(input, menu), HostMenuInput.Active);

	setTime(20);
	input.inputButton('keyboard:0', 'ControlRight', false, 0, 20, 1);
	input.inputButton('keyboard:0', 'AltRight', false, 0, 20, 2);
	assert.equal(tickMenu(input, menu), HostMenuInput.Active);

	setTime(30);
	input.inputButton('keyboard:0', 'ArrowRight', true, 1, 30, 3);
	assert.equal(tickMenu(input, menu), HostMenuInput.Active);
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

	openMenuWithGamepad(input, menu, gamepad.id, currentTime, 1, 2);
	currentTime += 1;

	for (let step = 0; step < 6; step += 1) {
		currentTime += 1;
		const pressId = step + 3;
		input.inputButton(gamepad.id, 'up', true, 1, currentTime, pressId);
		tickMenu(input, menu);
		currentTime += 1;
		input.inputButton(gamepad.id, 'up', false, 0, currentTime, pressId);
		tickMenu(input, menu);
	}

	currentTime += 1;
	input.inputButton(gamepad.id, 'right', true, 1, currentTime, 9);
	tickMenu(input, menu);
	assert.equal(input.getPlayerInput(1).inputHandlers.gamepad, null);
	assert.equal(input.getPlayerInput(2).inputHandlers.gamepad?.device, gamepad);

	currentTime += 1;
	input.inputButton(gamepad.id, 'right', false, 0, currentTime, 9);
	tickMenu(input, menu);
	currentTime += 1;
	input.inputButton(gamepad.id, 'b', true, 1, currentTime, 10);
	assert.equal(tickMenu(input, menu), HostMenuInput.Inactive);
	input.dispose();
});

test('quick menu routes pointer taps through retained option actions', () => {
	const { input, setTime } = createInput();
	const hostOverlayQueue = new HostOverlayQueue();
	const displayBounds = { width: 512, height: 424, left: 10, top: 20 };
	const presenter = {
		show_resource_usage_gizmo: false,
		deviceQuantizeMode: 0,
		viewportSize: { x: 256, y: 212 },
		default_font: {
			lineHeight: 8,
			measure: (value: string) => value.length * 6,
		},
		hostOverlayQueue,
		mapDisplayPointToViewport: (
			x: number,
			y: number,
			target: { x: number; y: number },
		) => mapDisplayPointToViewport(
			displayBounds,
			256,
			212,
			x,
			y,
			target,
		) === DisplayPointMappingResult.Inside,
	} as VideoPresenter;
	const menu = new HostOverlayMenu(presenter, {} as Runtime, input);
	const snapshot = createInputControllerSnapshot();
	const pointerMask = 1 << INP_POINTER_BUTTON_PRIMARY;
	let pressId = 1;
	let currentTime = 10;

	setTime(currentTime);
	input.inputButton('keyboard:0', 'ControlRight', true, 1, currentTime, pressId++);
	input.inputButton('keyboard:0', 'AltRight', true, 1, currentTime, pressId++);
	assert.equal(tickMenu(input, menu), HostMenuInput.Active);
	currentTime += 1;
	setTime(currentTime);
	input.inputButton('keyboard:0', 'ControlRight', false, 0, currentTime, 1);
	input.inputButton('keyboard:0', 'AltRight', false, 0, currentTime, 2);
	tickMenu(input, menu);

	const tapOption = (label: string): HostMenuInput => {
		menu.queueRenderCommands();
		const frame = hostOverlayQueue.consumeHostMenuFrame();
		let optionGlyph: GlyphRenderSubmission | null = null;
		for (let index = 0; index < frame.commandCount; index += 1) {
			if (frame.commandKinds[index] === Host2DKind.Glyphs) {
				const glyphs = frame.commandRefs[index] as GlyphRenderSubmission;
				if ((glyphs.items as string).startsWith(label)) {
					optionGlyph = glyphs;
					break;
				}
			}
		}
		assert.ok(optionGlyph);
		currentTime += 1;
		setTime(currentTime);
		input.inputAxis2(
			'pointer:0',
			'pointer_position',
			displayBounds.left + optionGlyph.x * 2,
			displayBounds.top + optionGlyph.y * 2,
			currentTime,
		);
		input.inputButton('pointer:0', 'pointer_primary', true, 1, currentTime, pressId);
		assert.equal(tickMenu(input, menu), HostMenuInput.Active);
		input.sampleInputControllerSnapshot(snapshot);
		assert.equal(snapshot.pointerButtons & pointerMask, 0);
		currentTime += 1;
		setTime(currentTime);
		input.inputButton('pointer:0', 'pointer_primary', false, 0, currentTime, pressId);
		pressId += 1;
		return tickMenu(input, menu);
	};

	assert.equal(tapOption('Show Usage Gizmo'), HostMenuInput.Active);
	assert.equal(presenter.show_resource_usage_gizmo, true);
	assert.equal(tapOption('ON-SCREEN KEYBOARD'), HostMenuInput.Inactive);
	menu.queueRenderCommands();
	const keyboardFrame = hostOverlayQueue.consumeHostMenuFrame();
	const titleGlyphs = keyboardFrame.commandRefs[1] as GlyphRenderSubmission;
	assert.equal(titleGlyphs.items, 'ON-SCREEN KEYBOARD');
	input.dispose();
});

test('on-screen keyboard owns controller navigation and emits retained HID commands', () => {
	let currentTime = 0;
	const clock = { now: () => currentTime } as HostClock;
	const { input, gamepad } = createGamepadInput(clock);
	const hostOverlayQueue = new HostOverlayQueue();
	const displayBounds = { width: 512, height: 424, left: 10, top: 20 };
	const presenter = {
		show_resource_usage_gizmo: false,
		viewportSize: { x: 256, y: 212 },
		default_font: {
			lineHeight: 8,
			measure: (value: string) => value.length * 6,
		},
		hostOverlayQueue,
		mapDisplayPointToViewport: (
			x: number,
			y: number,
			target: { x: number; y: number },
		) => mapDisplayPointToViewport(
			displayBounds,
			256,
			212,
			x,
			y,
			target,
		) === DisplayPointMappingResult.Inside,
	} as VideoPresenter;
	const menu = new HostOverlayMenu(presenter, {} as Runtime, input);
	const snapshot = createInputControllerSnapshot();
	let pressId = 1;
	const tickCaptured = (): HostMenuInput => {
		const result = tickMenu(input, menu);
		input.sampleInputControllerSnapshot(snapshot);
		assert.equal(snapshot.pads[0].buttons, 0);
		return result;
	};

	const press = (button: string): HostMenuInput => {
		input.inputButton(gamepad.id, button, true, 1, currentTime, pressId);
		const result = tickCaptured();
		currentTime += 1;
		input.inputButton(gamepad.id, button, false, 0, currentTime, pressId);
		pressId += 1;
		tickMenu(input, menu);
		currentTime += 1;
		return result;
	};
	const chord = (modifier: string, button: string): HostMenuInput => {
		const modifierPressId = pressId++;
		const buttonPressId = pressId++;
		input.inputButton(gamepad.id, modifier, true, 1, currentTime, modifierPressId);
		input.inputButton(gamepad.id, button, true, 1, currentTime, buttonPressId);
		const result = tickCaptured();
		currentTime += 1;
		input.inputButton(gamepad.id, modifier, false, 0, currentTime, modifierPressId);
		input.inputButton(gamepad.id, button, false, 0, currentTime, buttonPressId);
		tickMenu(input, menu);
		currentTime += 1;
		return result;
	};
	const assertPulse = (button: string, code: string): void => {
		press(button);
		input.sampleInputControllerSnapshot(snapshot);
		assert.equal(keyWordContains(snapshot.keyWords, code), true, `${button} emits ${code}`);
		tickMenu(input, menu);
		input.sampleInputControllerSnapshot(snapshot);
		assert.equal(keyWordContains(snapshot.keyWords, code), false, `${button} releases ${code}`);
		currentTime += 1;
	};
	const assertChordPulse = (modifier: string, button: string, code: string): void => {
		chord(modifier, button);
		input.sampleInputControllerSnapshot(snapshot);
		assert.equal(keyWordContains(snapshot.keyWords, code), true, `${modifier}+${button} emits ${code}`);
		tickMenu(input, menu);
		input.sampleInputControllerSnapshot(snapshot);
		assert.equal(keyWordContains(snapshot.keyWords, code), false, `${modifier}+${button} releases ${code}`);
		currentTime += 1;
	};

	assert.equal(chord('select', 'x'), HostMenuInput.Inactive);
	assertPulse('a', 'KeyQ');
	press('right');
	assertPulse('a', 'KeyW');
	press('left');
	assertPulse('b', 'Backspace');
	assertPulse('x', 'Space');
	assertPulse('lb', 'ArrowLeft');
	assertPulse('rb', 'ArrowRight');
	assertPulse('lt', 'Home');
	assertPulse('rt', 'End');
	assertPulse('start', 'Enter');
	assertChordPulse('select', 'b', 'Delete');
	assertChordPulse('select', 'lb', 'Home');
	assert.equal(input.supervisorRequestLineHigh(), false);
	assertChordPulse('select', 'rb', 'End');

	press('y');
	input.sampleInputControllerSnapshot(snapshot);
	assert.equal(keyWordContains(snapshot.keyWords, 'ShiftLeft'), true);
	menu.queueRenderCommands();
	let keyboardFrame = hostOverlayQueue.consumeHostMenuFrame();
	assert.ok(keyboardFrame.commandRefs.some((ref, index) =>
		index < keyboardFrame.commandCount
		&& (ref as GlyphRenderSubmission).items === 'Q'));
	press('a');
	input.sampleInputControllerSnapshot(snapshot);
	assert.equal(keyWordContains(snapshot.keyWords, 'ShiftLeft'), true);
	assert.equal(keyWordContains(snapshot.keyWords, 'KeyQ'), true);
	tickMenu(input, menu);
	input.sampleInputControllerSnapshot(snapshot);
	assert.equal(keyWordContains(snapshot.keyWords, 'ShiftLeft'), false);
	assert.equal(keyWordContains(snapshot.keyWords, 'KeyQ'), false);
	currentTime += 1;

	input.inputAxis2(gamepad.id, 'ls', 1, 0, currentTime);
	tickMenu(input, menu);
	input.sampleInputControllerSnapshot(snapshot);
	assert.equal(snapshot.pads[0].axesQ16[0], 0);
	currentTime += 1;
	input.inputAxis2(gamepad.id, 'ls', 0, 0, currentTime);
	tickMenu(input, menu);
	currentTime += 1;
	assertPulse('a', 'KeyW');

	menu.queueRenderCommands();
	keyboardFrame = hostOverlayQueue.consumeHostMenuFrame();
	let qGlyph: GlyphRenderSubmission | null = null;
	for (let index = 0; index < keyboardFrame.commandCount; index += 1) {
		if (keyboardFrame.commandKinds[index] === Host2DKind.Glyphs) {
			const glyphs = keyboardFrame.commandRefs[index] as GlyphRenderSubmission;
			if (glyphs.items === 'q') {
				qGlyph = glyphs;
				break;
			}
		}
	}
	assert.ok(qGlyph);
	input.inputAxis2(
		'pointer:0',
		'pointer_position',
		displayBounds.left + qGlyph.x * 2,
		displayBounds.top + qGlyph.y * 2,
		currentTime,
	);
	input.inputButton('pointer:0', 'pointer_primary', true, 1, currentTime, pressId);
	tickMenu(input, menu);
	currentTime += 1;
	tickMenu(input, menu);
	input.sampleInputControllerSnapshot(snapshot);
	const primaryPointerMask = 1 << INP_POINTER_BUTTON_PRIMARY;
	assert.equal(keyWordContains(snapshot.keyWords, 'KeyQ'), false);
	assert.equal(snapshot.pointerButtons & primaryPointerMask, 0);

	currentTime += 1;
	input.inputButton('pointer:0', 'pointer_primary', false, 0, currentTime, pressId);
	tickMenu(input, menu);
	currentTime += 1;
	tickMenu(input, menu);
	input.sampleInputControllerSnapshot(snapshot);
	assert.equal(keyWordContains(snapshot.keyWords, 'KeyQ'), true);
	assert.equal(snapshot.pointerButtons & primaryPointerMask, 0);
	currentTime += 1;
	tickMenu(input, menu);
	input.sampleInputControllerSnapshot(snapshot);
	assert.equal(keyWordContains(snapshot.keyWords, 'KeyQ'), false);
	currentTime += 1;
	assert.equal(chord('select', 'x'), HostMenuInput.Inactive);
	menu.queueFrameOverlayCommands(60);
	assert.equal(hostOverlayQueue.hasPendingHostMenuFrame(), false);
	input.dispose();
});
