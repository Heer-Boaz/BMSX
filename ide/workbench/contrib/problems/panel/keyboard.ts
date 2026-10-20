import type { KeyInputEvent } from '../../../../../hosts/common/input/text';
import { consumeIdeKey, isKeyJustPressed, isKeyDown } from '../../../../input/keyboard/key_input';
import type { ProblemsPanelController } from './controller';
import { handleProblemsPanelNavigationCommand } from './navigation';
import type { EditorPanes } from '../../../services/editor/editor_panes';

export function handleProblemsPanelKeyboardInput(
	playerInput: KeyInputEvent,
	controller: ProblemsPanelController,
	editorPanes: EditorPanes,
): void {
	if (isKeyDown('ArrowUp', playerInput)) {
		consumeIdeKey('ArrowUp', playerInput);
		handleProblemsPanelNavigationCommand(controller, editorPanes, 'up');
	} else if (isKeyDown('ArrowDown', playerInput)) {
		consumeIdeKey('ArrowDown', playerInput);
		handleProblemsPanelNavigationCommand(controller, editorPanes, 'down');
	} else if (isKeyDown('PageUp', playerInput)) {
		consumeIdeKey('PageUp', playerInput);
		handleProblemsPanelNavigationCommand(controller, editorPanes, 'page-up');
	} else if (isKeyDown('PageDown', playerInput)) {
		consumeIdeKey('PageDown', playerInput);
		handleProblemsPanelNavigationCommand(controller, editorPanes, 'page-down');
	} else if (isKeyDown('Home', playerInput)) {
		consumeIdeKey('Home', playerInput);
		handleProblemsPanelNavigationCommand(controller, editorPanes, 'home');
	} else if (isKeyDown('End', playerInput)) {
		consumeIdeKey('End', playerInput);
		handleProblemsPanelNavigationCommand(controller, editorPanes, 'end');
	} else if (isKeyJustPressed('Enter', playerInput)) {
		consumeIdeKey('Enter', playerInput);
		handleProblemsPanelNavigationCommand(controller, editorPanes, 'activate');
	} else if (isKeyJustPressed('NumpadEnter', playerInput)) {
		consumeIdeKey('NumpadEnter', playerInput);
		handleProblemsPanelNavigationCommand(controller, editorPanes, 'activate');
	}
	if (isKeyDown('ArrowLeft', playerInput)) {
		consumeIdeKey('ArrowLeft', playerInput);
	}
	if (isKeyDown('ArrowRight', playerInput)) {
		consumeIdeKey('ArrowRight', playerInput);
	}
}
