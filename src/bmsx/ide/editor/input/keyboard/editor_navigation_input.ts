import * as TextEditing from '../../editing/text_editing_and_selection';
import { moveCursorDown, moveCursorEnd, moveCursorHome, moveCursorLeft, moveCursorRight, moveCursorUp, pageDown, pageUp } from '../../ui/caret';
import { goBackwardInNavigationHistory, goForwardInNavigationHistory } from '../../navigation/navigation_history';
import { consumeIdeKey, isAltDown, isCtrlDown, isKeyJustPressed, isShiftDown, shouldRepeatKeyFromPlayer } from './key_input';

export function handleEditorNavigationKeys(): void {
	const ctrlDown = isCtrlDown();
	const shiftDown = isShiftDown();
	const altDown = isAltDown();
	if (altDown) {
		handleEditorAltNavigation(ctrlDown, shiftDown);
		return;
	}
	if (shouldRepeatKeyFromPlayer('ArrowLeft')) {
		consumeIdeKey('ArrowLeft');
		moveCursorLeft();
		return;
	}
	if (shouldRepeatKeyFromPlayer('ArrowRight')) {
		consumeIdeKey('ArrowRight');
		moveCursorRight();
		return;
	}
	if (shouldRepeatKeyFromPlayer('ArrowUp')) {
		consumeIdeKey('ArrowUp');
		moveCursorUp();
		return;
	}
	if (shouldRepeatKeyFromPlayer('ArrowDown')) {
		consumeIdeKey('ArrowDown');
		moveCursorDown();
		return;
	}
	if (shouldRepeatKeyFromPlayer('Home')) {
		consumeIdeKey('Home');
		moveCursorHome();
		return;
	}
	if (shouldRepeatKeyFromPlayer('End')) {
		consumeIdeKey('End');
		moveCursorEnd();
		return;
	}
	if (shouldRepeatKeyFromPlayer('PageDown')) {
		consumeIdeKey('PageDown');
		pageDown();
		return;
	}
	if (shouldRepeatKeyFromPlayer('PageUp')) {
		consumeIdeKey('PageUp');
		pageUp();
	}
}

function handleEditorAltNavigation(ctrlDown: boolean, shiftDown: boolean): void {
	if (!ctrlDown && !shiftDown) {
		if (isKeyJustPressed('ArrowLeft')) {
			consumeIdeKey('ArrowLeft');
			goBackwardInNavigationHistory();
			return;
		}
		if (isKeyJustPressed('ArrowRight')) {
			consumeIdeKey('ArrowRight');
			goForwardInNavigationHistory();
			return;
		}
	}
	let movedAlt = false;
	if (shouldRepeatKeyFromPlayer('ArrowUp')) {
		consumeIdeKey('ArrowUp');
		if (shiftDown) {
			TextEditing.copySelectionLines(-1);
		} else {
			TextEditing.moveSelectionLines(-1);
		}
		movedAlt = true;
	}
	if (shouldRepeatKeyFromPlayer('ArrowDown')) {
		consumeIdeKey('ArrowDown');
		if (shiftDown) {
			TextEditing.copySelectionLines(1);
		} else {
			TextEditing.moveSelectionLines(1);
		}
		movedAlt = true;
	}
	if (movedAlt) {
		return;
	}
}
