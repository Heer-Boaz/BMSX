import { consumeIdeKey, isKeyJustPressed, shouldRepeatKeyFromPlayer } from '../../../../input/keyboard/key_input';
import type { ProblemsPanelController } from './controller';
import { handleProblemsPanelNavigationCommand } from './navigation';
import type { ResourcePanelController } from '../../resources/panel/controller';

export function handleProblemsPanelKeyboardInput(
	controller: ProblemsPanelController,
	resourcePanel: ResourcePanelController,
): void {
	if (shouldRepeatKeyFromPlayer('ArrowUp')) {
		consumeIdeKey('ArrowUp');
		handleProblemsPanelNavigationCommand(controller, resourcePanel, 'up');
	} else if (shouldRepeatKeyFromPlayer('ArrowDown')) {
		consumeIdeKey('ArrowDown');
		handleProblemsPanelNavigationCommand(controller, resourcePanel, 'down');
	} else if (shouldRepeatKeyFromPlayer('PageUp')) {
		consumeIdeKey('PageUp');
		handleProblemsPanelNavigationCommand(controller, resourcePanel, 'page-up');
	} else if (shouldRepeatKeyFromPlayer('PageDown')) {
		consumeIdeKey('PageDown');
		handleProblemsPanelNavigationCommand(controller, resourcePanel, 'page-down');
	} else if (shouldRepeatKeyFromPlayer('Home')) {
		consumeIdeKey('Home');
		handleProblemsPanelNavigationCommand(controller, resourcePanel, 'home');
	} else if (shouldRepeatKeyFromPlayer('End')) {
		consumeIdeKey('End');
		handleProblemsPanelNavigationCommand(controller, resourcePanel, 'end');
	} else if (isKeyJustPressed('Enter')) {
		consumeIdeKey('Enter');
		handleProblemsPanelNavigationCommand(controller, resourcePanel, 'activate');
	} else if (isKeyJustPressed('NumpadEnter')) {
		consumeIdeKey('NumpadEnter');
		handleProblemsPanelNavigationCommand(controller, resourcePanel, 'activate');
	}
	if (shouldRepeatKeyFromPlayer('ArrowLeft')) {
		consumeIdeKey('ArrowLeft');
	}
	if (shouldRepeatKeyFromPlayer('ArrowRight')) {
		consumeIdeKey('ArrowRight');
	}
}
