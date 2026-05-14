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
	IO_INP_PLAYER,
	IO_INP_QUERY,
	IO_INP_STATUS,
	IO_INP_VALUE,
} from '../../src/bmsx/machine/bus/io';
import { CPU, asStringId, StringValue } from '../../src/bmsx/machine/cpu/cpu';
import { Memory } from '../../src/bmsx/machine/memory/memory';
import type { Input } from '../../src/bmsx/input/manager';
import type { GamepadInputMapping, KeyboardInputMapping, PointerInputMapping } from '../../src/bmsx/input/models';

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
	checkActionTriggered(action: string): boolean;
	consumeAction(action: string): void;
	pushContext(id: string, keyboard: KeyboardInputMapping, gamepad: GamepadInputMapping, pointer: PointerInputMapping): void;
	clearContext(id: string): void;
};

function createFakePlayer(): FakePlayerInput {
	return {
		pushed: [],
		cleared: [],
		consumed: [],
		checkActionTriggered: action => action === 'jump[p]',
		consumeAction(action) {
			this.consumed.push(action);
		},
		pushContext(id, keyboard, gamepad, pointer) {
			this.pushed.push({ id, keyboard, gamepad, pointer });
		},
		clearContext(id) {
			this.cleared.push(id);
		},
	};
}

function createHarness(): { memory: Memory; cpu: CPU; controller: InputController; players: FakePlayerInput[]; beginFrames: () => number } {
	const memory = new Memory({ systemRom: new Uint8Array(0) });
	const cpu = new CPU(memory);
	const players = [createFakePlayer(), createFakePlayer(), createFakePlayer(), createFakePlayer()];
	let beginFrameCount = 0;
	const input = {
		beginFrame() {
			beginFrameCount += 1;
		},
		getPlayerInput(playerIndex: number) {
			return players[playerIndex - 1]!;
		},
	};
	const controller = new InputController(memory, input as unknown as Input, cpu.stringPool);
	controller.reset();
	return { memory, cpu, controller, players, beginFrames: () => beginFrameCount };
}

test('input controller persists register latches and committed action contexts', () => {
	const live = createHarness();
	const actionValue = StringValue.get(live.cpu.stringPool.intern('jump'));
	const bindValue = StringValue.get(live.cpu.stringPool.intern('a,left'));
	const queryValue = StringValue.get(live.cpu.stringPool.intern('jump[p]'));
	const consumeValue = StringValue.get(live.cpu.stringPool.intern('jump,dash'));

	live.memory.writeValue(IO_INP_PLAYER, 2);
	live.memory.writeValue(IO_INP_ACTION, actionValue);
	live.memory.writeValue(IO_INP_BIND, bindValue);
	live.memory.writeValue(IO_INP_CTRL, INP_CTRL_COMMIT);
	live.memory.writeValue(IO_INP_QUERY, queryValue);
	live.memory.writeValue(IO_INP_CONSUME, consumeValue);
	live.memory.writeValue(IO_INP_CTRL, INP_CTRL_ARM);

	assert.equal(live.memory.readIoU32(IO_INP_STATUS), 1);
	assert.equal(live.memory.readIoU32(IO_INP_VALUE), 0);
	assert.deepEqual(live.players[1]!.consumed, ['jump', 'dash']);
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
	assert.equal(restored.memory.readIoU32(IO_INP_STATUS), 1);
	assert.equal(restored.memory.readIoU32(IO_INP_VALUE), 0);

	assert.equal(restored.players[1]!.pushed.length, 1);
	const pushed = restored.players[1]!.pushed[0]!;
	assert.equal(pushed.id, 'inp_chip');
	assert.deepEqual(pushed.gamepad.jump, [{ id: 'a' }, { id: 'left' }]);
	assert.equal(restored.controller.captureState().players[1]!.actions[0]!.actionStringId, asStringId(actionValue));
	assert.equal(restored.controller.captureState().players[1]!.actions[0]!.bindStringId, asStringId(bindValue));

	restored.controller.onVblankEdge();
	assert.equal(restored.beginFrames(), 1);
	assert.equal(restored.controller.captureState().sampleArmed, false);
});

test('input controller owns arm cancellation instead of exposing the latch', () => {
	const harness = createHarness();
	harness.memory.writeValue(IO_INP_CTRL, INP_CTRL_ARM);
	assert.equal(harness.controller.captureState().sampleArmed, true);
	harness.controller.cancelArmedSample();
	assert.equal(harness.controller.captureState().sampleArmed, false);
});
