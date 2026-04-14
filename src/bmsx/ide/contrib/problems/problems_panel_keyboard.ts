import { consumeIdeKey, isKeyJustPressed, shouldRepeatKeyFromPlayer } from '../../input/keyboard/key_input';
import type { ProblemsPanelController } from './problems_panel';

export function handleProblemsPanelKeyboardInput(controller: ProblemsPanelController): void {
	if (shouldRepeatKeyFromPlayer('ArrowUp')) {
		consumeIdeKey('ArrowUp');
		controller.handleKeyboardCommand('up');
	} else if (shouldRepeatKeyFromPlayer('ArrowDown')) {
		consumeIdeKey('ArrowDown');
		controller.handleKeyboardCommand('down');
	} else if (shouldRepeatKeyFromPlayer('PageUp')) {
		consumeIdeKey('PageUp');
		controller.handleKeyboardCommand('page-up');
	} else if (shouldRepeatKeyFromPlayer('PageDown')) {
		consumeIdeKey('PageDown');
		controller.handleKeyboardCommand('page-down');
	} else if (shouldRepeatKeyFromPlayer('Home')) {
		consumeIdeKey('Home');
		controller.handleKeyboardCommand('home');
	} else if (shouldRepeatKeyFromPlayer('End')) {
		consumeIdeKey('End');
		controller.handleKeyboardCommand('end');
	} else if (isKeyJustPressed('Enter')) {
		consumeIdeKey('Enter');
		controller.handleKeyboardCommand('activate');
	} else if (isKeyJustPressed('NumpadEnter')) {
		consumeIdeKey('NumpadEnter');
		controller.handleKeyboardCommand('activate');
	}
	if (shouldRepeatKeyFromPlayer('ArrowLeft')) {
		consumeIdeKey('ArrowLeft');
	}
	if (shouldRepeatKeyFromPlayer('ArrowRight')) {
		consumeIdeKey('ArrowRight');
	}
}
