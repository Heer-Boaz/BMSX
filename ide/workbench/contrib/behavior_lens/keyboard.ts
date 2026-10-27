import type { KeyInputEvent } from '../../../../hosts/common/input/text';
import type { PlayerInput } from '../../../../hosts/common/input/player';
import { consumeIdeKey, isKeyJustPressed, isKeyDown, isShiftDown } from '../../../input/keyboard/key_input';
import type { BehaviorLensController } from './controller';
import type { BehaviorLensInput } from './editor_input';
import type { EditorGroupView } from '../../services/editor/editor_group';
import { inputFocus } from '../../../input/focus';

export function handleBehaviorLensKeyboardInput(
	group: EditorGroupView,
	input: BehaviorLensInput,
	playerInput: KeyInputEvent,
	controller: BehaviorLensController,
): boolean {
	const view = input.view;
	if (isKeyDown('ArrowUp', playerInput)) {
		consumeIdeKey('ArrowUp', playerInput);
		controller.executeNavigation(group, input, view.presentation.kind === 'state-graph' && !isShiftDown(playerInput) ? 'previous' : 'up');
		return true;
	}
	if (isKeyDown('ArrowDown', playerInput)) {
		consumeIdeKey('ArrowDown', playerInput);
		controller.executeNavigation(group, input, view.presentation.kind === 'state-graph' && !isShiftDown(playerInput) ? 'next' : 'down');
		return true;
	}
	if (isKeyDown('ArrowLeft', playerInput)) {
		consumeIdeKey('ArrowLeft', playerInput);
		controller.executeNavigation(group, input, 'left');
		return true;
	}
	if (isKeyDown('ArrowRight', playerInput)) {
		consumeIdeKey('ArrowRight', playerInput);
		controller.executeNavigation(group, input, 'right');
		return true;
	}
	if (isKeyDown('PageUp', playerInput)) {
		consumeIdeKey('PageUp', playerInput);
		controller.executeNavigation(group, input, 'page-up');
		return true;
	}
	if (isKeyDown('PageDown', playerInput)) {
		consumeIdeKey('PageDown', playerInput);
		controller.executeNavigation(group, input, 'page-down');
		return true;
	}
	if (isKeyDown('Home', playerInput)) {
		consumeIdeKey('Home', playerInput);
		controller.executeNavigation(group, input, 'home');
		return true;
	}
	if (isKeyDown('End', playerInput)) {
		consumeIdeKey('End', playerInput);
		controller.executeNavigation(group, input, 'end');
		return true;
	}
	if (isKeyJustPressed('Enter', playerInput)) {
		consumeIdeKey('Enter', playerInput);
		controller.executeNavigation(group, input, 'activate');
		return true;
	}
	if (isKeyJustPressed('NumpadEnter', playerInput)) {
		consumeIdeKey('NumpadEnter', playerInput);
		controller.executeNavigation(group, input, 'activate');
		return true;
	}
	if (isKeyJustPressed('Escape', playerInput)) {
		consumeIdeKey('Escape', playerInput);
		controller.executeNavigation(group, input, 'back');
		return true;
	}
	return false;
}

export function handleBehaviorLensGamepadInput(
	group: EditorGroupView,
	input: BehaviorLensInput,
	playerInput: PlayerInput,
	controller: BehaviorLensController,
): boolean {
	const view = input.view;
	const gamepad = playerInput.inputHandlers.gamepad;
	if (gamepad === null) {
		return false;
	}
	if (playerInput.controlButtonRepeatEdge('up', 'gamepad')) {
		gamepad.consumeButton('up');
		controller.executeNavigation(group, input, view.presentation.kind === 'state-graph' ? 'previous' : 'up');
		return true;
	}
	if (playerInput.controlButtonRepeatEdge('down', 'gamepad')) {
		gamepad.consumeButton('down');
		controller.executeNavigation(group, input, view.presentation.kind === 'state-graph' ? 'next' : 'down');
		return true;
	}
	if (playerInput.controlButtonRepeatEdge('left', 'gamepad')) {
		gamepad.consumeButton('left');
		controller.executeNavigation(group, input, 'left');
		return true;
	}
	if (playerInput.controlButtonRepeatEdge('right', 'gamepad')) {
		gamepad.consumeButton('right');
		controller.executeNavigation(group, input, 'right');
		return true;
	}
	const details = gamepad.getButtonState('x');
	if (details.justpressed && !details.consumed) {
		gamepad.consumeButton('x');
		inputFocus.executeCommand('behaviorLens.details');
		return true;
	}
	const activate = gamepad.getButtonState('a');
	if (activate.justpressed && !activate.consumed) {
		gamepad.consumeButton('a');
		controller.executeNavigation(group, input, 'activate');
		return true;
	}
	const back = gamepad.getButtonState('b');
	if (back.justpressed && !back.consumed) {
		gamepad.consumeButton('b');
		controller.executeNavigation(group, input, 'back');
		return true;
	}
	return false;
}
