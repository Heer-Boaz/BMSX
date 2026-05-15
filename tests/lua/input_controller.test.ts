import assert from 'node:assert/strict';
import { test } from 'node:test';

import { InputController } from '../../src/bmsx/machine/devices/input/controller';
import {
	INP_CTRL_ARM,
	INP_CTRL_COMMIT,
	IO_INP_ACTION,
	IO_INP_BIND,
	IO_INP_CONSUME,
	IO_INP_CTRL,
	IO_INP_EVENT_ACTION,
	IO_INP_EVENT_COUNT,
	IO_INP_EVENT_CTRL,
	IO_INP_EVENT_FLAGS,
	IO_INP_EVENT_PLAYER,
	IO_INP_EVENT_REPEAT_COUNT,
	IO_INP_EVENT_STATUS,
	IO_INP_EVENT_VALUE,
	IO_INP_OUTPUT_CTRL,
	IO_INP_OUTPUT_DURATION_MS,
	IO_INP_OUTPUT_INTENSITY_Q16,
	IO_INP_OUTPUT_STATUS,
	IO_INP_PLAYER,
	IO_INP_QUERY,
	IO_INP_STATUS,
	IO_INP_VALUE,
	IO_INP_VALUE_X,
	IO_INP_VALUE_Y,
} from '../../src/bmsx/machine/bus/io';
import { CPU, asStringId, StringValue } from '../../src/bmsx/machine/cpu/cpu';
import { Memory } from '../../src/bmsx/machine/memory/memory';
import { Input, makeButtonState } from '../../src/bmsx/input/manager';
import { PlayerInput } from '../../src/bmsx/input/player';
import type { ButtonState, GamepadInputMapping, KeyboardInputMapping, PointerInputMapping } from '../../src/bmsx/input/models';
import type { VibrationParams } from '../../src/bmsx/platform';
import {
	INP_EVENT_CTRL_POP,
	INP_EVENT_STATUS_EMPTY,
	INP_OUTPUT_CTRL_APPLY,
	INP_OUTPUT_STATUS_SUPPORTED,
	INP_STATUS_CONSUMED,
	INP_STATUS_ALL_WAS_PRESSED,
	INP_STATUS_HAS_VALUE,
	INP_STATUS_JUST_PRESSED,
	INP_STATUS_PRESSED,
	INP_STATUS_WAS_PRESSED,
	INPUT_CONTROLLER_OUTPUT_INTENSITY_Q16_ONE,
} from '../../src/bmsx/machine/devices/input/contracts';
import { DEFAULT_LUA_BUILTIN_NAMES } from '../../src/bmsx/machine/firmware/builtin_descriptors';

type PushedContext = {
	id: string;
	keyboard: KeyboardInputMapping;
	gamepad: GamepadInputMapping;
	pointer: PointerInputMapping;
};

type FakePlayerInput = {
	pushed: PushedContext[];
	cleared: string[];
	consumed: string[];
	vibrations: VibrationParams[];
	supportsVibrationEffect: boolean;
	getButtonState(button: string): ButtonState;
	consumeRawButton(button: string, source: 'keyboard' | 'gamepad' | 'pointer'): void;
	applyVibrationEffect(params: VibrationParams): void;
	pushContext(id: string, keyboard: KeyboardInputMapping, gamepad: GamepadInputMapping, pointer: PointerInputMapping): void;
	clearContext(id: string): void;
};

function createFakePlayer(): FakePlayerInput {
	return {
		pushed: [],
		cleared: [],
		consumed: [],
		vibrations: [],
		supportsVibrationEffect: true,
		getButtonState(button) {
			const pressed = button === 'a' || button === 'left' || button === 'KeyX' || button === 'ArrowLeft';
			return makeButtonState({
				pressed,
				waspressed: pressed,
				value: button === 'a' || button === 'KeyX' ? 0.5 : null,
			});
		},
		consumeRawButton(button, source) {
			this.consumed.push(`${source}:${button}`);
		},
		applyVibrationEffect(params) {
			this.vibrations.push(params);
		},
		pushContext(id, keyboard, gamepad, pointer) {
			this.pushed.push({ id, keyboard, gamepad, pointer });
		},
		clearContext(id) {
			this.cleared.push(id);
		},
	};
}

function createHarness(): { memory: Memory; cpu: CPU; controller: InputController; players: FakePlayerInput[]; samples: () => number } {
	const memory = new Memory({ systemRom: new Uint8Array(0) });
	const cpu = new CPU(memory);
	const players = [createFakePlayer(), createFakePlayer(), createFakePlayer(), createFakePlayer()];
	let sampleCount = 0;
	const input = {
		samplePlayers() {
			sampleCount += 1;
		},
		getPlayerInput(playerIndex: number) {
			return players[playerIndex - 1]!;
		},
	};
	const controller = new InputController(memory, input as unknown as Input, cpu.stringPool);
	controller.reset();
	return { memory, cpu, controller, players, samples: () => sampleCount };
}

function createRealPlayerHarness(): { memory: Memory; cpu: CPU; controller: InputController; players: PlayerInput[] } {
	const memory = new Memory({ systemRom: new Uint8Array(0) });
	const cpu = new CPU(memory);
	const players = [
		new PlayerInput(1, 1000 / 60),
		new PlayerInput(2, 1000 / 60),
		new PlayerInput(3, 1000 / 60),
		new PlayerInput(4, 1000 / 60),
	];
	let frameTime = 0;
	const input = {
		samplePlayers(currentTime: number) {
			frameTime = currentTime;
			for (let index = 0; index < players.length; index += 1) {
				players[index]!.beginFrame(frameTime);
			}
		},
		getPlayerInput(playerIndex: number) {
			return players[playerIndex - 1]!;
		},
	};
	const controller = new InputController(memory, input as unknown as Input, cpu.stringPool);
	controller.reset();
	return { memory, cpu, controller, players };
}

test('input controller persists register latches and committed action contexts', () => {
	const live = createHarness();
	const actionValue = StringValue.get(live.cpu.stringPool.intern('jump'));
	const bindValue = StringValue.get(live.cpu.stringPool.intern('KeyX,g:a,ArrowLeft,g:left'));
	const queryValue = StringValue.get(live.cpu.stringPool.intern('jump[p]'));
	const complexQueryValue = StringValue.get(live.cpu.stringPool.intern('jump[p] || jump[p]'));
	const consumeValue = StringValue.get(live.cpu.stringPool.intern('jump,dash'));

	live.memory.writeValue(IO_INP_PLAYER, 2);
	live.memory.writeValue(IO_INP_ACTION, actionValue);
	live.memory.writeValue(IO_INP_BIND, bindValue);
	live.memory.writeValue(IO_INP_CTRL, INP_CTRL_COMMIT);
	live.memory.writeValue(IO_INP_CTRL, INP_CTRL_ARM);
	live.controller.onVblankEdge(1000 / 60, 77);
	live.memory.writeValue(IO_INP_QUERY, queryValue);

	assert.equal(live.memory.readIoU32(IO_INP_STATUS), INP_STATUS_PRESSED | INP_STATUS_WAS_PRESSED | INP_STATUS_ALL_WAS_PRESSED | INP_STATUS_HAS_VALUE);
	assert.equal(live.memory.readIoU32(IO_INP_VALUE), 0x8000);
	assert.equal(live.memory.readIoU32(IO_INP_VALUE_X), 0);
	assert.equal(live.memory.readIoU32(IO_INP_VALUE_Y), 0);
	live.memory.writeValue(IO_INP_QUERY, complexQueryValue);
	assert.equal(live.memory.readIoU32(IO_INP_STATUS), 1);
	assert.equal(live.memory.readIoU32(IO_INP_VALUE), 0);
	live.memory.writeValue(IO_INP_QUERY, queryValue);
	live.memory.writeValue(IO_INP_CONSUME, consumeValue);
	live.memory.writeValue(IO_INP_CTRL, INP_CTRL_ARM);
	assert.deepEqual(live.players[1]!.consumed, ['keyboard:KeyX', 'gamepad:a', 'keyboard:ArrowLeft', 'gamepad:left']);
	assert.equal(live.controller.captureState().sampleArmed, true);

	const savedStrings = live.cpu.stringPool.captureState();
	const savedInput = live.controller.captureState();
	const restored = createHarness();
	restored.cpu.stringPool.restoreState(savedStrings);
	restored.controller.restoreState(savedInput);

	assert.equal(restored.memory.readIoU32(IO_INP_PLAYER), 2);
	assert.equal(asStringId(restored.memory.readValue(IO_INP_ACTION) as StringValue), asStringId(actionValue));
	assert.equal(asStringId(restored.memory.readValue(IO_INP_BIND) as StringValue), asStringId(bindValue));
	assert.equal(asStringId(restored.memory.readValue(IO_INP_QUERY) as StringValue), asStringId(queryValue));
	assert.equal(asStringId(restored.memory.readValue(IO_INP_CONSUME) as StringValue), asStringId(consumeValue));
	assert.equal(restored.memory.readIoU32(IO_INP_CTRL), INP_CTRL_ARM);
	assert.equal(restored.memory.readIoU32(IO_INP_STATUS), INP_STATUS_PRESSED | INP_STATUS_WAS_PRESSED | INP_STATUS_ALL_WAS_PRESSED | INP_STATUS_HAS_VALUE);
	assert.equal(restored.memory.readIoU32(IO_INP_VALUE), 0x8000);
	assert.equal(restored.memory.readIoU32(IO_INP_VALUE_X), 0);
	assert.equal(restored.memory.readIoU32(IO_INP_VALUE_Y), 0);

	assert.equal(restored.players[1]!.pushed.length, 0);
	assert.equal(restored.controller.captureState().players[1]!.actions[0]!.actionStringId, asStringId(actionValue));
	assert.equal(restored.controller.captureState().players[1]!.actions[0]!.bindStringId, asStringId(bindValue));
	assert.equal(restored.controller.captureState().players[1]!.actions[0]!.statusWord, INP_STATUS_PRESSED | INP_STATUS_WAS_PRESSED | INP_STATUS_CONSUMED | INP_STATUS_ALL_WAS_PRESSED | INP_STATUS_HAS_VALUE);
	assert.equal(restored.controller.captureState().players[1]!.actions[0]!.valueQ16, 0x8000);

	restored.controller.onVblankEdge(1000 / 60, 123);
	assert.equal(restored.samples(), 1);
	assert.equal(restored.controller.captureState().sampleArmed, false);
	assert.equal(restored.controller.captureState().sampleSequence, 2);
	assert.equal(restored.controller.captureState().lastSampleCycle, 123);
});


test('input controller decodes selected-player register as a raw hardware selector', () => {
	const live = createHarness();
	const actionValue = StringValue.get(live.cpu.stringPool.intern('jump'));
	const bindValue = StringValue.get(live.cpu.stringPool.intern('a'));
	const queryValue = StringValue.get(live.cpu.stringPool.intern('jump[p]'));

	live.memory.writeValue(IO_INP_PLAYER, 5);
	live.memory.writeValue(IO_INP_ACTION, actionValue);
	live.memory.writeValue(IO_INP_BIND, bindValue);
	live.memory.writeValue(IO_INP_CTRL, INP_CTRL_COMMIT);
	live.memory.writeValue(IO_INP_CTRL, INP_CTRL_ARM);
	live.controller.onVblankEdge(1000 / 60, 91);
	live.memory.writeValue(IO_INP_QUERY, queryValue);

	assert.equal(live.memory.readIoU32(IO_INP_PLAYER), 5);
	assert.equal(live.players[0]!.pushed.length, 0);
	assert.equal(live.players[1]!.pushed.length, 0);
	assert.equal(live.memory.readIoU32(IO_INP_STATUS), INP_STATUS_PRESSED | INP_STATUS_WAS_PRESSED | INP_STATUS_ALL_WAS_PRESSED | INP_STATUS_HAS_VALUE);
});

test('input controller output registers emit selected player vibration commands', () => {
	const live = createHarness();

	live.memory.writeValue(IO_INP_PLAYER, 2);
	live.memory.writeValue(IO_INP_OUTPUT_INTENSITY_Q16, INPUT_CONTROLLER_OUTPUT_INTENSITY_Q16_ONE >>> 1);
	live.memory.writeValue(IO_INP_OUTPUT_DURATION_MS, 120);

	assert.equal(live.memory.readIoU32(IO_INP_OUTPUT_STATUS), INP_OUTPUT_STATUS_SUPPORTED);
	live.memory.writeValue(IO_INP_OUTPUT_CTRL, INP_OUTPUT_CTRL_APPLY);
	assert.deepEqual(live.players[1]!.vibrations, [{ effect: 'dual-rumble', duration: 120, intensity: 0.5 }]);
	assert.equal(live.memory.readIoU32(IO_INP_OUTPUT_CTRL), 0);

	const savedInput = live.controller.captureState();
	const restored = createHarness();
	restored.controller.restoreState(savedInput);
	assert.equal(restored.memory.readIoU32(IO_INP_OUTPUT_INTENSITY_Q16), INPUT_CONTROLLER_OUTPUT_INTENSITY_Q16_ONE >>> 1);
	assert.equal(restored.memory.readIoU32(IO_INP_OUTPUT_DURATION_MS), 120);
	restored.memory.writeValue(IO_INP_PLAYER, 2);
	restored.memory.writeValue(IO_INP_OUTPUT_CTRL, INP_OUTPUT_CTRL_APPLY);
	assert.deepEqual(restored.players[1]!.vibrations, [{ effect: 'dual-rumble', duration: 120, intensity: 0.5 }]);
});

test('input controller exposes the VBlank sample edge without leaking the sample latch', () => {
	const harness = createHarness();
	harness.memory.writeValue(IO_INP_CTRL, INP_CTRL_ARM);
	assert.equal(harness.controller.captureState().sampleArmed, true);
	harness.controller.cancelSampleArm();
	assert.equal(harness.controller.captureState().sampleArmed, false);
});

test('input controller committed mappings drive ICU-owned raw button samples', () => {
	const harness = createRealPlayerHarness();
	const playerTwo = harness.players[1]!;
	const actionValue = StringValue.get(harness.cpu.stringPool.intern('jump'));
	const bindValue = StringValue.get(harness.cpu.stringPool.intern('a'));
	const queryValue = StringValue.get(harness.cpu.stringPool.intern('jump[jp]'));

	harness.memory.writeValue(IO_INP_PLAYER, 2);
	harness.memory.writeValue(IO_INP_ACTION, actionValue);
	harness.memory.writeValue(IO_INP_BIND, bindValue);
	harness.memory.writeValue(IO_INP_CTRL, INP_CTRL_COMMIT);
	playerTwo.recordButtonEvent('gamepad', 'a', { eventType: 'press', identifier: 'a', timestamp: 0, consumed: false, pressId: 7 });
	harness.memory.writeValue(IO_INP_CTRL, INP_CTRL_ARM);
	harness.controller.onVblankEdge(1000 / 60, 456);
	harness.memory.writeValue(IO_INP_QUERY, queryValue);

	const status = harness.memory.readIoU32(IO_INP_STATUS);
	assert.notEqual(status & INP_STATUS_JUST_PRESSED, 0);
	assert.notEqual(status & INP_STATUS_WAS_PRESSED, 0);
	assert.notEqual(status & INP_STATUS_HAS_VALUE, 0);
	assert.equal(harness.memory.readIoU32(IO_INP_VALUE), 0x10000);
	assert.equal(playerTwo.getActionState('jump').justpressed, false);
});


test('input controller treats comma bindings as alternate physical inputs', () => {
	const harness = createRealPlayerHarness();
	const playerOne = harness.players[0]!;
	const actionValue = StringValue.get(harness.cpu.stringPool.intern('moveforward'));
	const bindValue = StringValue.get(harness.cpu.stringPool.intern('KeyW,g:x'));
	const queryValue = StringValue.get(harness.cpu.stringPool.intern('moveforward[p]'));

	harness.memory.writeValue(IO_INP_PLAYER, 1);
	harness.memory.writeValue(IO_INP_ACTION, actionValue);
	harness.memory.writeValue(IO_INP_BIND, bindValue);
	harness.memory.writeValue(IO_INP_CTRL, INP_CTRL_COMMIT);
	playerOne.recordButtonEvent('gamepad', 'x', { eventType: 'press', identifier: 'x', timestamp: 0, consumed: false, pressId: 13 });
	harness.memory.writeValue(IO_INP_CTRL, INP_CTRL_ARM);
	harness.controller.onVblankEdge(1000 / 60, 112);
	harness.memory.writeValue(IO_INP_QUERY, queryValue);

	const status = harness.memory.readIoU32(IO_INP_STATUS);
	assert.notEqual(status & INP_STATUS_PRESSED, 0);
	assert.notEqual(status & INP_STATUS_WAS_PRESSED, 0);
	assert.notEqual(status & INP_STATUS_HAS_VALUE, 0);
	assert.equal(harness.memory.readIoU32(IO_INP_VALUE), 0x10000);
});


test('input controller supports chord actions with any-just-pressed edges', () => {
	const onlyLeft = createHarness();
	onlyLeft.players[0]!.getButtonState = (button) => makeButtonState({
		pressed: button === 'left',
		waspressed: button === 'left',
		justpressed: button === 'left',
	});
	const actionValue = StringValue.get(onlyLeft.cpu.stringPool.intern('jumpleft'));
	const bindValue = StringValue.get(onlyLeft.cpu.stringPool.intern('up,left'));
	const pressedQuery = StringValue.get(onlyLeft.cpu.stringPool.intern('jumpleft[p]'));

	onlyLeft.memory.writeValue(IO_INP_PLAYER, 1);
	onlyLeft.memory.writeValue(IO_INP_ACTION, actionValue);
	onlyLeft.memory.writeValue(IO_INP_BIND, bindValue);
	onlyLeft.memory.writeValue(IO_INP_CTRL, INP_CTRL_COMMIT);
	onlyLeft.memory.writeValue(IO_INP_CTRL, INP_CTRL_ARM);
	onlyLeft.controller.onVblankEdge(1000 / 60, 114);
	onlyLeft.memory.writeValue(IO_INP_QUERY, pressedQuery);
	assert.equal(onlyLeft.memory.readIoU32(IO_INP_STATUS), 0);

	const chord = createHarness();
	chord.players[0]!.getButtonState = (button) => makeButtonState({
		pressed: button === 'up' || button === 'left',
		waspressed: button === 'up' || button === 'left',
		justpressed: button === 'left',
	});
	const chordActionValue = StringValue.get(chord.cpu.stringPool.intern('jumpleft'));
	const chordBindValue = StringValue.get(chord.cpu.stringPool.intern('up,left'));
	const chordPressedQuery = StringValue.get(chord.cpu.stringPool.intern('jumpleft[p]'));
	const chordJustPressedQuery = StringValue.get(chord.cpu.stringPool.intern('jumpleft[jp]'));

	chord.memory.writeValue(IO_INP_PLAYER, 1);
	chord.memory.writeValue(IO_INP_ACTION, chordActionValue);
	chord.memory.writeValue(IO_INP_BIND, chordBindValue);
	chord.memory.writeValue(IO_INP_CTRL, INP_CTRL_COMMIT);
	chord.memory.writeValue(IO_INP_CTRL, INP_CTRL_ARM);
	chord.controller.onVblankEdge(1000 / 60, 115);
	chord.memory.writeValue(IO_INP_QUERY, chordPressedQuery);
	const status = chord.memory.readIoU32(IO_INP_STATUS);
	assert.notEqual(status & INP_STATUS_PRESSED, 0);
	assert.notEqual(status & INP_STATUS_JUST_PRESSED, 0);
	assert.notEqual(status & INP_STATUS_WAS_PRESSED, 0);
	chord.memory.writeValue(IO_INP_QUERY, chordJustPressedQuery);
	assert.notEqual(chord.memory.readIoU32(IO_INP_STATUS) & INP_STATUS_JUST_PRESSED, 0);
	assert.equal(asStringId(chord.memory.readValue(IO_INP_ACTION) as StringValue), asStringId(chordActionValue));
	assert.equal(asStringId(chord.memory.readValue(IO_INP_BIND) as StringValue), asStringId(chordBindValue));
	assert.equal(asStringId(chord.memory.readValue(IO_INP_QUERY) as StringValue), asStringId(chordJustPressedQuery));
});

test('input controller exposes pointer vector values for simple action queries', () => {
	const harness = createRealPlayerHarness();
	const playerOne = harness.players[0]!;
	const actionValue = StringValue.get(harness.cpu.stringPool.intern('mouselook'));
	const bindValue = StringValue.get(harness.cpu.stringPool.intern('pointer_delta'));
	const queryValue = StringValue.get(harness.cpu.stringPool.intern('mouselook[p]'));

	harness.memory.writeValue(IO_INP_PLAYER, 1);
	harness.memory.writeValue(IO_INP_ACTION, actionValue);
	harness.memory.writeValue(IO_INP_BIND, bindValue);
	harness.memory.writeValue(IO_INP_CTRL, INP_CTRL_COMMIT);
	playerOne.recordAxis2Input('pointer', 'pointer_delta', 3.5, -2.25, 0);
	harness.memory.writeValue(IO_INP_CTRL, INP_CTRL_ARM);
	harness.controller.onVblankEdge(1000 / 60, 113);
	harness.memory.writeValue(IO_INP_QUERY, queryValue);

	assert.notEqual(harness.memory.readIoU32(IO_INP_STATUS) & INP_STATUS_PRESSED, 0);
	assert.equal(harness.memory.readIoU32(IO_INP_VALUE_X), 0x00038000);
	assert.equal(harness.memory.readIoU32(IO_INP_VALUE_Y), 0xfffdc000);
});

test('input controller queries ICU default mappings without committed actions', () => {
	const harness = createRealPlayerHarness();
	const playerOne = harness.players[0]!;
	const titleStartQuery = StringValue.get(harness.cpu.stringPool.intern('start[jp] || a[jp]'));
	const startQuery = StringValue.get(harness.cpu.stringPool.intern('start[jp]'));

	playerOne.recordButtonEvent('keyboard', 'Enter', { eventType: 'press', identifier: 'Enter', timestamp: 0, consumed: false, pressId: 12 });
	harness.memory.writeValue(IO_INP_CTRL, INP_CTRL_ARM);
	harness.controller.onVblankEdge(1000 / 60, 111);

	harness.memory.writeValue(IO_INP_QUERY, titleStartQuery);
	assert.equal(harness.memory.readIoU32(IO_INP_STATUS), 1);
	assert.equal(harness.memory.readIoU32(IO_INP_VALUE), 0);

	harness.memory.writeValue(IO_INP_QUERY, startQuery);
	const status = harness.memory.readIoU32(IO_INP_STATUS);
	assert.notEqual(status & INP_STATUS_JUST_PRESSED, 0);
	assert.notEqual(status & INP_STATUS_WAS_PRESSED, 0);
	assert.notEqual(status & INP_STATUS_HAS_VALUE, 0);
});

test('input controller event FIFO exposes sampled action edges', () => {
	const harness = createRealPlayerHarness();
	const playerTwo = harness.players[1]!;
	const actionValue = StringValue.get(harness.cpu.stringPool.intern('jump'));
	const bindValue = StringValue.get(harness.cpu.stringPool.intern('a'));

	harness.memory.writeValue(IO_INP_PLAYER, 2);
	harness.memory.writeValue(IO_INP_ACTION, actionValue);
	harness.memory.writeValue(IO_INP_BIND, bindValue);
	harness.memory.writeValue(IO_INP_CTRL, INP_CTRL_COMMIT);
	playerTwo.recordButtonEvent('gamepad', 'a', { eventType: 'press', identifier: 'a', timestamp: 0, consumed: false, pressId: 9 });
	harness.memory.writeValue(IO_INP_CTRL, INP_CTRL_ARM);
	harness.controller.onVblankEdge(1000 / 60, 789);

	assert.equal(harness.memory.readIoU32(IO_INP_EVENT_COUNT), 1);
	assert.equal(harness.memory.readIoU32(IO_INP_EVENT_PLAYER), 2);
	assert.equal(asStringId(harness.memory.readValue(IO_INP_EVENT_ACTION) as StringValue), asStringId(actionValue));
	const flags = harness.memory.readIoU32(IO_INP_EVENT_FLAGS);
	assert.notEqual(flags & INP_STATUS_JUST_PRESSED, 0);
	assert.notEqual(flags & INP_STATUS_WAS_PRESSED, 0);
	assert.notEqual(flags & INP_STATUS_HAS_VALUE, 0);
	assert.equal(harness.memory.readIoU32(IO_INP_EVENT_VALUE), 0x10000);
	assert.equal(harness.memory.readIoU32(IO_INP_EVENT_REPEAT_COUNT), 0);

	const savedStrings = harness.cpu.stringPool.captureState();
	const savedInput = harness.controller.captureState();
	const restored = createRealPlayerHarness();
	restored.cpu.stringPool.restoreState(savedStrings);
	restored.controller.restoreState(savedInput);
	assert.equal(restored.memory.readIoU32(IO_INP_EVENT_COUNT), 1);
	assert.equal(asStringId(restored.memory.readValue(IO_INP_EVENT_ACTION) as StringValue), asStringId(actionValue));
	restored.memory.writeValue(IO_INP_EVENT_CTRL, INP_EVENT_CTRL_POP);
	assert.equal(restored.memory.readIoU32(IO_INP_EVENT_COUNT), 0);
	assert.notEqual(restored.memory.readIoU32(IO_INP_EVENT_STATUS) & INP_EVENT_STATUS_EMPTY, 0);
	assert.equal(restored.memory.readIoU32(IO_INP_EVENT_CTRL), 0);
});

test('Input.initialize installs host defaults as the base context', () => {
	const input = Input.initialize();
	try {
		const playerOne = input.getPlayerInput(Input.DEFAULT_KEYBOARD_PLAYER_INDEX);
		playerOne.recordButtonEvent('keyboard', 'KeyX', { eventType: 'press', identifier: 'KeyX', timestamp: 0, consumed: false, pressId: 11 });
		input.samplePlayers(1000 / 60);

		assert.equal(playerOne.checkActionTriggered('a[jp]'), true);
		assert.equal(playerOne.getActionState('a').justpressed, true);
	} finally {
		input.dispose();
	}
});

test('ICU firmware descriptors expose input ingress registers without extra string helpers', () => {
	assert.equal(DEFAULT_LUA_BUILTIN_NAMES.includes('string' + '_ref'), false);
	assert.equal(DEFAULT_LUA_BUILTIN_NAMES.includes('sys_inp_action'), true);
	assert.equal(DEFAULT_LUA_BUILTIN_NAMES.includes('sys_inp_bind'), true);
	assert.equal(DEFAULT_LUA_BUILTIN_NAMES.includes('sys_inp_query'), true);
	assert.equal(DEFAULT_LUA_BUILTIN_NAMES.includes('sys_inp_consume'), true);
	assert.equal(DEFAULT_LUA_BUILTIN_NAMES.includes('sys_inp_value_x'), true);
	assert.equal(DEFAULT_LUA_BUILTIN_NAMES.includes('sys_inp_value_y'), true);
});
