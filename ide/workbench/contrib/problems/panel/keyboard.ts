import type { KeyInputEvent } from '../../../../../hosts/common/input/text';
import { consumeIdeKey, isKeyJustPressed, isKeyDown } from '../../../../input/keyboard/key_input';
import type { ProblemsPanelController } from './controller';
import { handleProblemsPanelNavigationCommand } from './navigation';
import type { EditorGroupView } from '../../../services/editor/editor_group';

export function handleProblemsPanelKeyboardInput(
	playerInput: KeyInputEvent,
	controller: ProblemsPanelController,
	editorGroup: EditorGroupView,
): void {
	if (isKeyDown('ArrowUp', playerInput)) {
		consumeIdeKey('ArrowUp', playerInput);
		handleProblemsPanelNavigationCommand(controller, editorGroup, 'up');
	} else if (isKeyDown('ArrowDown', playerInput)) {
		consumeIdeKey('ArrowDown', playerInput);
		handleProblemsPanelNavigationCommand(controller, editorGroup, 'down');
	} else if (isKeyDown('PageUp', playerInput)) {
		consumeIdeKey('PageUp', playerInput);
		handleProblemsPanelNavigationCommand(controller, editorGroup, 'page-up');
	} else if (isKeyDown('PageDown', playerInput)) {
		consumeIdeKey('PageDown', playerInput);
		handleProblemsPanelNavigationCommand(controller, editorGroup, 'page-down');
	} else if (isKeyDown('Home', playerInput)) {
		consumeIdeKey('Home', playerInput);
		handleProblemsPanelNavigationCommand(controller, editorGroup, 'home');
	} else if (isKeyDown('End', playerInput)) {
		consumeIdeKey('End', playerInput);
		handleProblemsPanelNavigationCommand(controller, editorGroup, 'end');
	} else if (isKeyJustPressed('Enter', playerInput)) {
		consumeIdeKey('Enter', playerInput);
		handleProblemsPanelNavigationCommand(controller, editorGroup, 'activate');
	} else if (isKeyJustPressed('NumpadEnter', playerInput)) {
		consumeIdeKey('NumpadEnter', playerInput);
		handleProblemsPanelNavigationCommand(controller, editorGroup, 'activate');
	}
	if (isKeyDown('ArrowLeft', playerInput)) {
		consumeIdeKey('ArrowLeft', playerInput);
	}
	if (isKeyDown('ArrowRight', playerInput)) {
		consumeIdeKey('ArrowRight', playerInput);
	}
}
