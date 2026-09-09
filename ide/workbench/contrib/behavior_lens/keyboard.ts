import type { PlayerInput } from '../../../../hosts/common/input/player';
import { inputFocus } from '../../../input/focus';
import { consumeIdeKey, isKeyJustPressed, shouldRepeatKeyFromPlayer, isShiftDown, isCtrlDown, isMetaDown, isAltDown } from '../../../input/keyboard/key_input';
import type { BehaviorLensController } from './controller';
import type { BehaviorLensViewState } from './view_model';

export function handleBehaviorLensKeyboardInput(
	view: BehaviorLensViewState,
	playerInput: PlayerInput,
	controller: BehaviorLensController,
): boolean {
	if ((view.presentation.kind === 'state-graph' || view.presentation.kind === 'properties') && isKeyJustPressed('Tab', playerInput)
		&& !isCtrlDown(playerInput) && !isMetaDown(playerInput) && !isAltDown(playerInput)) {
		consumeIdeKey('Tab', playerInput);
		controller.executeNavigation(view, isShiftDown(playerInput) ? 'previous' : 'next');
		return true;
	}
	if (shouldRepeatKeyFromPlayer('ArrowUp', playerInput)) {
		consumeIdeKey('ArrowUp', playerInput);
		controller.executeNavigation(view, 'up');
		return true;
	}
	if (shouldRepeatKeyFromPlayer('ArrowDown', playerInput)) {
		consumeIdeKey('ArrowDown', playerInput);
		controller.executeNavigation(view, 'down');
		return true;
	}
	if (shouldRepeatKeyFromPlayer('ArrowLeft', playerInput)) {
		consumeIdeKey('ArrowLeft', playerInput);
		controller.executeNavigation(view, 'left');
		return true;
	}
	if (shouldRepeatKeyFromPlayer('ArrowRight', playerInput)) {
		consumeIdeKey('ArrowRight', playerInput);
		controller.executeNavigation(view, 'right');
		return true;
	}
	if (shouldRepeatKeyFromPlayer('PageUp', playerInput)) {
		consumeIdeKey('PageUp', playerInput);
		controller.executeNavigation(view, 'page-up');
		return true;
	}
	if (shouldRepeatKeyFromPlayer('PageDown', playerInput)) {
		consumeIdeKey('PageDown', playerInput);
		controller.executeNavigation(view, 'page-down');
		return true;
	}
	if (shouldRepeatKeyFromPlayer('Home', playerInput)) {
		consumeIdeKey('Home', playerInput);
		controller.executeNavigation(view, 'home');
		return true;
	}
	if (shouldRepeatKeyFromPlayer('End', playerInput)) {
		consumeIdeKey('End', playerInput);
		controller.executeNavigation(view, 'end');
		return true;
	}
	if (isKeyJustPressed('Enter', playerInput)) {
		consumeIdeKey('Enter', playerInput);
		controller.executeNavigation(view, 'activate');
		return true;
	}
	if (isKeyJustPressed('NumpadEnter', playerInput)) {
		consumeIdeKey('NumpadEnter', playerInput);
		controller.executeNavigation(view, 'activate');
		return true;
	}
	if (isKeyJustPressed('Escape', playerInput)) {
		consumeIdeKey('Escape', playerInput);
		controller.executeNavigation(view, 'back');
		return true;
	}
	return false;
}

export function handleBehaviorLensGamepadInput(
	view: BehaviorLensViewState,
	playerInput: PlayerInput,
	controller: BehaviorLensController,
): boolean {
	const gamepad = playerInput.inputHandlers.gamepad;
	if (gamepad === null) {
		return false;
	}
	if (playerInput.controlButtonRepeatEdge('up', 'gamepad')) {
		gamepad.consumeButton('up');
		controller.executeNavigation(view, view.presentation.kind === 'state-graph' ? 'previous' : 'up');
		return true;
	}
	if (playerInput.controlButtonRepeatEdge('down', 'gamepad')) {
		gamepad.consumeButton('down');
		controller.executeNavigation(view, view.presentation.kind === 'state-graph' ? 'next' : 'down');
		return true;
	}
	if (playerInput.controlButtonRepeatEdge('left', 'gamepad')) {
		gamepad.consumeButton('left');
		controller.executeNavigation(view, 'left');
		return true;
	}
	if (playerInput.controlButtonRepeatEdge('right', 'gamepad')) {
		gamepad.consumeButton('right');
		controller.executeNavigation(view, 'right');
		return true;
	}
	const details = gamepad.getButtonState('x');
	if (details.justpressed && !details.consumed) {
		gamepad.consumeButton('x');
		controller.openDetails();
		return true;
	}
	if (view.presentation.kind === 'graph') {
		const collapse = gamepad.getButtonState('y');
		if (collapse.justpressed && !collapse.consumed) {
			gamepad.consumeButton('y');
			inputFocus.executeCommand('behaviorLens.toggleBranch');
			return true;
		}
	}
	const activate = gamepad.getButtonState('a');
	if (activate.justpressed && !activate.consumed) {
		gamepad.consumeButton('a');
		controller.executeNavigation(view, 'activate');
		return true;
	}
	const back = gamepad.getButtonState('b');
	if (back.justpressed && !back.consumed) {
		gamepad.consumeButton('b');
		controller.executeNavigation(view, 'back');
		return true;
	}
	return false;
}
