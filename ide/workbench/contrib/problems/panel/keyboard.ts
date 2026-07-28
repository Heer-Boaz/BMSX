import { consumeIdeKey, isKeyJustPressed, shouldRepeatKeyFromPlayer } from '../../../../input/keyboard/key_input';
import type { ProblemsPanelController } from './controller';
import { handleProblemsPanelNavigationCommand } from './navigation';
import type { ResourcePanelController } from '../../resources/panel/controller';
import type { PlayerInput } from '../../../../../machine/ts/input/player';

export function handleProblemsPanelKeyboardInput(
	playerInput: PlayerInput,
	controller: ProblemsPanelController,
	resourcePanel: ResourcePanelController,
): void {
	if (shouldRepeatKeyFromPlayer('ArrowUp', playerInput)) {
		consumeIdeKey('ArrowUp', playerInput);
		handleProblemsPanelNavigationCommand(controller, resourcePanel, 'up');
	} else if (shouldRepeatKeyFromPlayer('ArrowDown', playerInput)) {
		consumeIdeKey('ArrowDown', playerInput);
		handleProblemsPanelNavigationCommand(controller, resourcePanel, 'down');
	} else if (shouldRepeatKeyFromPlayer('PageUp', playerInput)) {
		consumeIdeKey('PageUp', playerInput);
		handleProblemsPanelNavigationCommand(controller, resourcePanel, 'page-up');
	} else if (shouldRepeatKeyFromPlayer('PageDown', playerInput)) {
		consumeIdeKey('PageDown', playerInput);
		handleProblemsPanelNavigationCommand(controller, resourcePanel, 'page-down');
	} else if (shouldRepeatKeyFromPlayer('Home', playerInput)) {
		consumeIdeKey('Home', playerInput);
		handleProblemsPanelNavigationCommand(controller, resourcePanel, 'home');
	} else if (shouldRepeatKeyFromPlayer('End', playerInput)) {
		consumeIdeKey('End', playerInput);
		handleProblemsPanelNavigationCommand(controller, resourcePanel, 'end');
	} else if (isKeyJustPressed('Enter', playerInput)) {
		consumeIdeKey('Enter', playerInput);
		handleProblemsPanelNavigationCommand(controller, resourcePanel, 'activate');
	} else if (isKeyJustPressed('NumpadEnter', playerInput)) {
		consumeIdeKey('NumpadEnter', playerInput);
		handleProblemsPanelNavigationCommand(controller, resourcePanel, 'activate');
	}
	if (shouldRepeatKeyFromPlayer('ArrowLeft', playerInput)) {
		consumeIdeKey('ArrowLeft', playerInput);
	}
	if (shouldRepeatKeyFromPlayer('ArrowRight', playerInput)) {
		consumeIdeKey('ArrowRight', playerInput);
	}
}
