import assert from 'node:assert/strict';
import { test } from 'node:test';
import { PointerInput } from '../../hosts/common/input/pointer';
import { PlayerInput } from '../../hosts/common/input/player';
import { VirtualHeadlessClock } from '../../hosts/node/headless/clock';
import { clearEditorPointerSelectionState, editorPointerState } from '../../ide/input/pointer/state';
import {
	computeEditorPointerButtonMask,
	POINTER_PRIMARY_JUST_PRESSED,
	POINTER_PRIMARY_JUST_RELEASED,
	POINTER_SECONDARY_JUST_PRESSED,
	POINTER_AUX_JUST_PRESSED,
} from '../../ide/input/pointer/buttons';

test('editor button edges belong to the pointer producer, not view activation or gesture cancellation', () => {
	const pointer = new PointerInput(new VirtualHeadlessClock());
	const player = new PlayerInput(1, 20);
	player.inputHandlers.pointer = pointer;
	for (const [code, mask] of [
		['pointer_primary', POINTER_PRIMARY_JUST_PRESSED],
		['pointer_secondary', POINTER_SECONDARY_JUST_PRESSED],
		['pointer_aux', POINTER_AUX_JUST_PRESSED],
	] as const) {
		pointer.ingestButton(code, true, 1, 0, 1);
		pointer.pollInput();
		assert.equal(computeEditorPointerButtonMask(player), mask);
		editorPointerState.pointerSelecting = true;
		clearEditorPointerSelectionState();
		assert.ok(pointer.getButtonState(code).pressed);
		assert.ok(pointer.getButtonState(code).justpressed, 'cancelling selection does not change this frame\'s event');
		pointer.pollInput();
		assert.equal(computeEditorPointerButtonMask(player), 0, 'holding across navigation is not another down event');
		pointer.consumeButton(code);
		assert.equal(computeEditorPointerButtonMask(player), 0);
		pointer.pollInput();
		assert.equal(computeEditorPointerButtonMask(player), 0, 'resetting per-frame consumption is not another down event');
		pointer.ingestButton(code, false, 0, 1, 1);
		pointer.pollInput();
		assert.equal(computeEditorPointerButtonMask(player), code === 'pointer_primary' ? POINTER_PRIMARY_JUST_RELEASED : 0);
	}
});

test('editor preserves a complete short click and release/repress edges within one host poll', () => {
	const pointer = new PointerInput(new VirtualHeadlessClock());
	const player = new PlayerInput(1, 20);
	player.inputHandlers.pointer = pointer;
	pointer.ingestButton('pointer_primary', true, 1, 0, 1);
	pointer.ingestButton('pointer_primary', false, 0, 1, 1);
	pointer.pollInput();
	assert.equal(computeEditorPointerButtonMask(player), POINTER_PRIMARY_JUST_PRESSED | POINTER_PRIMARY_JUST_RELEASED);
	pointer.pollInput();
	assert.equal(computeEditorPointerButtonMask(player), 0);
	pointer.ingestButton('pointer_primary', true, 1, 2, 2);
	pointer.pollInput();
	pointer.ingestButton('pointer_primary', false, 0, 3, 2);
	pointer.ingestButton('pointer_primary', true, 1, 4, 3);
	pointer.pollInput();
	assert.equal(computeEditorPointerButtonMask(player), POINTER_PRIMARY_JUST_PRESSED | POINTER_PRIMARY_JUST_RELEASED);
	pointer.consumeButton('pointer_primary');
	assert.equal(computeEditorPointerButtonMask(player), 0, 'consumed current-frame edges do not reach a later surface');
	pointer.pollInput();
	assert.equal(computeEditorPointerButtonMask(player), 0);
});
