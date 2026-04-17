import { consumeIdeKey, isKeyJustPressed, shouldRepeatKeyFromPlayer } from '../../../../editor/input/keyboard/key_input';
import type { ProblemsPanelController } from './controller';
import { handleProblemsPanelNavigationCommand } from './navigation';

export function handleProblemsPanelKeyboardInput(controller: ProblemsPanelController): void {
	if (shouldRepeatKeyFromPlayer('ArrowUp')) {
		consumeIdeKey('ArrowUp');
		handleProblemsPanelNavigationCommand(controller, 'up');
	} else if (shouldRepeatKeyFromPlayer('ArrowDown')) {
		consumeIdeKey('ArrowDown');
		handleProblemsPanelNavigationCommand(controller, 'down');
	} else if (shouldRepeatKeyFromPlayer('PageUp')) {
		consumeIdeKey('PageUp');
		handleProblemsPanelNavigationCommand(controller, 'page-up');
	} else if (shouldRepeatKeyFromPlayer('PageDown')) {
		consumeIdeKey('PageDown');
		handleProblemsPanelNavigationCommand(controller, 'page-down');
	} else if (shouldRepeatKeyFromPlayer('Home')) {
		consumeIdeKey('Home');
		handleProblemsPanelNavigationCommand(controller, 'home');
	} else if (shouldRepeatKeyFromPlayer('End')) {
		consumeIdeKey('End');
		handleProblemsPanelNavigationCommand(controller, 'end');
	} else if (isKeyJustPressed('Enter')) {
		consumeIdeKey('Enter');
		handleProblemsPanelNavigationCommand(controller, 'activate');
	} else if (isKeyJustPressed('NumpadEnter')) {
		consumeIdeKey('NumpadEnter');
		handleProblemsPanelNavigationCommand(controller, 'activate');
	}
	if (shouldRepeatKeyFromPlayer('ArrowLeft')) {
		consumeIdeKey('ArrowLeft');
	}
	if (shouldRepeatKeyFromPlayer('ArrowRight')) {
		consumeIdeKey('ArrowRight');
	}
}
