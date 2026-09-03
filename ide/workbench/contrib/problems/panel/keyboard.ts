import { consumeIdeKey, isKeyJustPressed, shouldRepeatKeyFromPlayer } from '../../../../input/keyboard/key_input';
import type { ProblemsPanelController } from './controller';
import { handleProblemsPanelNavigationCommand } from './navigation';
import type { EditorPanes } from '../../../services/editor/editor_panes';
import type { PlayerInput } from '../../../../../hosts/common/input/player';

export function handleProblemsPanelKeyboardInput(
	playerInput: PlayerInput,
	controller: ProblemsPanelController,
	editorPanes: EditorPanes,
): void {
	if (shouldRepeatKeyFromPlayer('ArrowUp', playerInput)) {
		consumeIdeKey('ArrowUp', playerInput);
		handleProblemsPanelNavigationCommand(controller, editorPanes, 'up');
	} else if (shouldRepeatKeyFromPlayer('ArrowDown', playerInput)) {
		consumeIdeKey('ArrowDown', playerInput);
		handleProblemsPanelNavigationCommand(controller, editorPanes, 'down');
	} else if (shouldRepeatKeyFromPlayer('PageUp', playerInput)) {
		consumeIdeKey('PageUp', playerInput);
		handleProblemsPanelNavigationCommand(controller, editorPanes, 'page-up');
	} else if (shouldRepeatKeyFromPlayer('PageDown', playerInput)) {
		consumeIdeKey('PageDown', playerInput);
		handleProblemsPanelNavigationCommand(controller, editorPanes, 'page-down');
	} else if (shouldRepeatKeyFromPlayer('Home', playerInput)) {
		consumeIdeKey('Home', playerInput);
		handleProblemsPanelNavigationCommand(controller, editorPanes, 'home');
	} else if (shouldRepeatKeyFromPlayer('End', playerInput)) {
		consumeIdeKey('End', playerInput);
		handleProblemsPanelNavigationCommand(controller, editorPanes, 'end');
	} else if (isKeyJustPressed('Enter', playerInput)) {
		consumeIdeKey('Enter', playerInput);
		handleProblemsPanelNavigationCommand(controller, editorPanes, 'activate');
	} else if (isKeyJustPressed('NumpadEnter', playerInput)) {
		consumeIdeKey('NumpadEnter', playerInput);
		handleProblemsPanelNavigationCommand(controller, editorPanes, 'activate');
	}
	if (shouldRepeatKeyFromPlayer('ArrowLeft', playerInput)) {
		consumeIdeKey('ArrowLeft', playerInput);
	}
	if (shouldRepeatKeyFromPlayer('ArrowRight', playerInput)) {
		consumeIdeKey('ArrowRight', playerInput);
	}
}
