import type { EditorNavigationController } from '../../../resources/navigation';
import * as TextEditing from '../../../../../editor/editing/text_editing_and_selection';
import { moveCursorDown, moveCursorEnd, moveCursorHome, moveCursorLeft, moveCursorRight, moveCursorUp, pageDown, pageUp } from '../../../../../editor/ui/view/caret/caret';
import { consumeIdeKey, isAltDown, isCtrlDown, isKeyJustPressed, isShiftDown, shouldRepeatKeyFromPlayer } from '../../../../../input/keyboard/key_input';
import type { PlayerInput } from '../../../../../../hosts/common/input/player';

type NavigationHistoryCommands = {
	goBackward(): Promise<void>;
	goForward(): Promise<void>;
};

export function handleEditorNavigationKeys(playerInput: PlayerInput, navigation: EditorNavigationController): void {
	const ctrlDown = isCtrlDown(playerInput);
	const shiftDown = isShiftDown(playerInput);
	const altDown = isAltDown(playerInput);
	if (altDown) {
		handleEditorAltNavigation(playerInput, navigation, ctrlDown, shiftDown);
		return;
	}
	if (shouldRepeatKeyFromPlayer('ArrowLeft', playerInput)) {
		consumeIdeKey('ArrowLeft', playerInput);
		moveCursorLeft(playerInput);
		return;
	}
	if (shouldRepeatKeyFromPlayer('ArrowRight', playerInput)) {
		consumeIdeKey('ArrowRight', playerInput);
		moveCursorRight(playerInput);
		return;
	}
	if (shouldRepeatKeyFromPlayer('ArrowUp', playerInput)) {
		consumeIdeKey('ArrowUp', playerInput);
		moveCursorUp(playerInput);
		return;
	}
	if (shouldRepeatKeyFromPlayer('ArrowDown', playerInput)) {
		consumeIdeKey('ArrowDown', playerInput);
		moveCursorDown(playerInput);
		return;
	}
	if (shouldRepeatKeyFromPlayer('Home', playerInput)) {
		consumeIdeKey('Home', playerInput);
		moveCursorHome(playerInput);
		return;
	}
	if (shouldRepeatKeyFromPlayer('End', playerInput)) {
		consumeIdeKey('End', playerInput);
		moveCursorEnd(playerInput);
		return;
	}
	if (shouldRepeatKeyFromPlayer('PageDown', playerInput)) {
		consumeIdeKey('PageDown', playerInput);
		pageDown(playerInput);
		return;
	}
	if (shouldRepeatKeyFromPlayer('PageUp', playerInput)) {
		consumeIdeKey('PageUp', playerInput);
		pageUp(playerInput);
	}
}

function handleEditorAltNavigation(playerInput: PlayerInput, navigation: NavigationHistoryCommands, ctrlDown: boolean, shiftDown: boolean): void {
	if (!ctrlDown && !shiftDown) {
		if (isKeyJustPressed('ArrowLeft', playerInput)) {
			consumeIdeKey('ArrowLeft', playerInput);
			void navigation.goBackward();
			return;
		}
		if (isKeyJustPressed('ArrowRight', playerInput)) {
			consumeIdeKey('ArrowRight', playerInput);
			void navigation.goForward();
			return;
		}
	}
	let movedAlt = false;
	if (shouldRepeatKeyFromPlayer('ArrowUp', playerInput)) {
		consumeIdeKey('ArrowUp', playerInput);
		if (shiftDown) {
			TextEditing.copySelectionLines(-1);
		} else {
			TextEditing.moveSelectionLines(-1);
		}
		movedAlt = true;
	}
	if (shouldRepeatKeyFromPlayer('ArrowDown', playerInput)) {
		consumeIdeKey('ArrowDown', playerInput);
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
