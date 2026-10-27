import type { KeyInputEvent } from '../../../../../hosts/common/input/text';
import { consumeIdeKey, isKeyJustPressed, isKeyDown } from '../../../../input/keyboard/key_input';
import type { ProblemsPanelController } from './controller';
import { handleProblemsPanelNavigationCommand } from './navigation';
import type { EditorParts } from '../../../services/editor/editor_parts';

export function handleProblemsPanelKeyboardInput(
	playerInput: KeyInputEvent,
	controller: ProblemsPanelController,
	parts: EditorParts,
): void {
	if (isKeyDown('ArrowUp', playerInput)) {
		consumeIdeKey('ArrowUp', playerInput);
		handleProblemsPanelNavigationCommand(controller, parts, 'up');
	} else if (isKeyDown('ArrowDown', playerInput)) {
		consumeIdeKey('ArrowDown', playerInput);
		handleProblemsPanelNavigationCommand(controller, parts, 'down');
	} else if (isKeyDown('PageUp', playerInput)) {
		consumeIdeKey('PageUp', playerInput);
		handleProblemsPanelNavigationCommand(controller, parts, 'page-up');
	} else if (isKeyDown('PageDown', playerInput)) {
		consumeIdeKey('PageDown', playerInput);
		handleProblemsPanelNavigationCommand(controller, parts, 'page-down');
	} else if (isKeyDown('Home', playerInput)) {
		consumeIdeKey('Home', playerInput);
		handleProblemsPanelNavigationCommand(controller, parts, 'home');
	} else if (isKeyDown('End', playerInput)) {
		consumeIdeKey('End', playerInput);
		handleProblemsPanelNavigationCommand(controller, parts, 'end');
	} else if (isKeyJustPressed('Enter', playerInput)) {
		consumeIdeKey('Enter', playerInput);
		handleProblemsPanelNavigationCommand(controller, parts, 'activate');
	} else if (isKeyJustPressed('NumpadEnter', playerInput)) {
		consumeIdeKey('NumpadEnter', playerInput);
		handleProblemsPanelNavigationCommand(controller, parts, 'activate');
	}
	if (isKeyDown('ArrowLeft', playerInput)) {
		consumeIdeKey('ArrowLeft', playerInput);
	}
	if (isKeyDown('ArrowRight', playerInput)) {
		consumeIdeKey('ArrowRight', playerInput);
	}
}
