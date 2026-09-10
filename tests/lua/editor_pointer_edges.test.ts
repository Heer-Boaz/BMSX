import { Input } from '../../hosts/common/input/manager';
import { HeadlessInputHub } from '../../hosts/node/headless/input';
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { PointerInput } from '../../hosts/common/input/pointer';
import { PlayerInput } from '../../hosts/common/input/player';
import { VirtualHeadlessClock } from '../../hosts/node/headless/clock';
import { clearEditorPointerSelectionState, editorPointerState } from '../../ide/input/pointer/state';
import { readEditorPointerButtons, PointerButton, type PointerButtons } from '../../ide/input/pointer/buttons';

test('editor button edges belong to the pointer producer, not view activation or gesture cancellation', () => {
	const pointer = new PointerInput(new VirtualHeadlessClock());
	const player = new PlayerInput(1, 20);
	player.inputHandlers.pointer = pointer;
	const buttons: PointerButtons = { pressedButtons: 0, justPressedButtons: 0, justReleasedButtons: 0 };
	for (const [code, mask] of [
		['pointer_primary', PointerButton.Primary],
		['pointer_secondary', PointerButton.Secondary],
		['pointer_aux', PointerButton.Auxiliary],
	] as const) {
		pointer.ingestButton(code, true, 1, 0, 1);
		pointer.pollInput();
		readEditorPointerButtons(player, buttons);
		assert.deepEqual(buttons, { pressedButtons: mask, justPressedButtons: mask, justReleasedButtons: 0 });
		editorPointerState.pointerSelecting = true;
		clearEditorPointerSelectionState();
		assert.ok(pointer.getButtonState(code).pressed);
		assert.ok(pointer.getButtonState(code).justpressed, 'cancelling selection does not change this frame\'s event');
		pointer.pollInput();
		readEditorPointerButtons(player, buttons);
		assert.equal(buttons.justPressedButtons, 0, 'holding across navigation is not another down event');
		pointer.consumeButton(code);
		readEditorPointerButtons(player, buttons);
		assert.equal(buttons.justPressedButtons, 0);
		pointer.pollInput();
		readEditorPointerButtons(player, buttons);
		assert.equal(buttons.justPressedButtons, 0, 'resetting per-frame consumption is not another down event');
		pointer.ingestButton(code, false, 0, 1, 1);
		pointer.pollInput();
		readEditorPointerButtons(player, buttons);
		assert.deepEqual(buttons, { pressedButtons: 0, justPressedButtons: 0, justReleasedButtons: mask });
	}
});

test('editor preserves a complete short click and release/repress edges within one host poll', () => {
	const pointer = new PointerInput(new VirtualHeadlessClock());
	const player = new PlayerInput(1, 20);
	player.inputHandlers.pointer = pointer;
	const buttons: PointerButtons = { pressedButtons: 0, justPressedButtons: 0, justReleasedButtons: 0 };
	pointer.ingestButton('pointer_primary', true, 1, 0, 1);
	pointer.ingestButton('pointer_primary', false, 0, 1, 1);
	pointer.pollInput();
	readEditorPointerButtons(player, buttons);
	assert.equal(buttons.justPressedButtons, PointerButton.Primary);
	assert.equal(buttons.justReleasedButtons, PointerButton.Primary);
	pointer.pollInput();
	readEditorPointerButtons(player, buttons);
	assert.equal(buttons.justPressedButtons, 0);
	pointer.ingestButton('pointer_primary', true, 1, 2, 2);
	pointer.pollInput();
	pointer.ingestButton('pointer_primary', false, 0, 3, 2);
	pointer.ingestButton('pointer_primary', true, 1, 4, 3);
	pointer.pollInput();
	readEditorPointerButtons(player, buttons);
	assert.equal(buttons.justPressedButtons, PointerButton.Primary);
	assert.equal(buttons.justReleasedButtons, PointerButton.Primary);
	pointer.consumeButton('pointer_primary');
	readEditorPointerButtons(player, buttons);
	assert.equal(buttons.justPressedButtons, 0, 'consumed current-frame edges do not reach a later surface');
	pointer.pollInput();
	readEditorPointerButtons(player, buttons);
	assert.equal(buttons.justPressedButtons, 0);
});

test('device-scoped cancellation resets the logical pointer without a release edge or unrelated keyboard reset', () => {
	const clock = new VirtualHeadlessClock();
	const hub = new HeadlessInputHub();
	const input = new Input(clock, hub, -1);
	const player = input.getPlayerInput(1);
	input.inputButton('keyboard:0', 'KeyQ', true, 1, 1, 1);
	input.inputButton('pointer:0', 'pointer_primary', true, 1, 1, 2);
	input.inputButton('pointer:0', 'pointer_aux', true, 1, 1, 3);
	input.pollInput();
	const buttons: PointerButtons = { pressedButtons: 0, justPressedButtons: 0, justReleasedButtons: 0 };
	readEditorPointerButtons(player, buttons);
	assert.equal(buttons.pressedButtons, PointerButton.Primary | PointerButton.Auxiliary);
	hub.post({ type: 'reset', deviceId: 'pointer:0' });
	input.pollInput();
	readEditorPointerButtons(player, buttons);
	assert.deepEqual(buttons, { pressedButtons: 0, justPressedButtons: 0, justReleasedButtons: 0 });
	assert.equal(player.getRawButtonState('KeyQ', 'keyboard').pressed, true);
	hub.post({ type: 'reset' });
	input.pollInput();
	assert.equal(player.getRawButtonState('KeyQ', 'keyboard').pressed, false);
	input.dispose();
});
