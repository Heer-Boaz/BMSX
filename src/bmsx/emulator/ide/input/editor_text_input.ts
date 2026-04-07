import { $ } from '../../../core/engine_core';
import { CHARACTER_CODES, CHARACTER_MAP } from '../character_map';
import { insertText } from '../text_editing_and_selection';
import * as TextEditing from '../text_editing_and_selection';
import { moveCursorDown, moveCursorEnd, moveCursorHome, moveCursorLeft, moveCursorRight, moveCursorUp, pageDown, pageUp } from '../caret';
import { goBackwardInNavigationHistory, goForwardInNavigationHistory } from '../navigation_history';
import { prepareDebuggerStepOverlay, RuntimeDebuggerCommandExecutor, toggleBreakpointForEditorRow } from '../ide_debugger';
import { consumeIdeKey, isAltDown, isCtrlDown, isKeyJustPressed, isMetaDown, isShiftDown, shouldRepeatKeyFromPlayer } from './key_input';

export class InputController {
	public handleEditorInput(): void {
		if (handleDebuggerShortcuts()) {
			return;
		}
		if (isKeyJustPressed('F9')) {
			consumeIdeKey('F9');
			toggleBreakpointForEditorRow();
			return;
		}
		this.handleNavigationKeys();
		this.handleEditingKeys();
		const ctrlDown = isCtrlDown();
		const metaDown = isMetaDown();
		const altDown = isAltDown();
		if (ctrlDown || metaDown || altDown) {
			return;
		}
		this.handleCharacterInput();
		if (isKeyJustPressed('Space')) {
			insertText(' ');
			consumeIdeKey('Space');
		}
	}

	private handleNavigationKeys(): void {
		const ctrlDown = isCtrlDown();
		const shiftDown = isShiftDown();
		const altDown = isAltDown();
		if (altDown) {
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
			return;
		}
	}

	private handleEditingKeys(): void {
		const ctrlDown = isCtrlDown();
		const shiftDown = isShiftDown();
		if (isKeyJustPressed('Tab')) {
			consumeIdeKey('Tab');
			if (shiftDown) {
				TextEditing.unindentSelectionOrLine();
			} else {
				insertText('\t');
			}
			return;
		}
		if (shouldRepeatKeyFromPlayer('Backspace')) {
			consumeIdeKey('Backspace');
			if (ctrlDown) {
				TextEditing.deleteWordBackward();
			} else if (!TextEditing.deleteSelectionIfPresent()) {
				TextEditing.backspace();
			}
			return;
		}
		if (shouldRepeatKeyFromPlayer('Delete')) {
			consumeIdeKey('Delete');
			if (shiftDown && !ctrlDown) {
				TextEditing.deleteActiveLines();
			} else if (ctrlDown) {
				TextEditing.deleteWordForward();
			} else if (!TextEditing.deleteSelectionIfPresent()) {
				TextEditing.deleteForward();
			}
			return;
		}
		if (isKeyJustPressed('Enter') || isKeyJustPressed('NumpadEnter')) {
			consumeIdeKey('Enter');
			TextEditing.insertLineBreak();
			return;
		}
	}

	private handleCharacterInput(): void {
		for (let i = 0; i < CHARACTER_CODES.length; i += 1) {
			const code = CHARACTER_CODES[i];
			if (!isKeyJustPressed(code)) {
				continue;
			}
			const entry = CHARACTER_MAP[code];
			const value = isShiftDown() ? entry.shift : entry.normal;
			if (value.length > 0) {
				insertText(value);
			}
			consumeIdeKey(code);
		}
	}

	public applyOverrides(active: boolean, captureKeys: readonly string[]): void {
		const input = $.input;
		input.debugHotkeysPaused = active;
		for (let i = 0; i < captureKeys.length; i += 1) {
			input.setKeyboardCapture(captureKeys[i], active);
		}
	}
}

function handleDebuggerShortcuts(): boolean {
	const handled = evaluateDebuggerShortcuts();
	if (handled) {
		prepareDebuggerStepOverlay();
	}
	return handled;
}

function evaluateDebuggerShortcuts(): boolean {
	const executor = RuntimeDebuggerCommandExecutor.instance;
	const ctrlDown = isCtrlDown();
	const metaDown = isMetaDown();
	const shiftDown = isShiftDown();
	const altDown = isAltDown();
	if (!executor || !executor.suspended) {
		return false;
	}
	if (ctrlDown || altDown || metaDown) {
		return false;
	}
	if (isKeyJustPressed('F5')) {
		consumeIdeKey('F5');
		if (shiftDown) {
			return executor.issueDebuggerCommand('ignore_exception');
		}
		return executor.issueDebuggerCommand('continue');
	}
	if (isKeyJustPressed('F10')) {
		consumeIdeKey('F10');
		if (shiftDown) {
			return executor.issueDebuggerCommand('step_out_exception');
		}
		return executor.issueDebuggerCommand('step_over');
	}
	if (isKeyJustPressed('F11')) {
		consumeIdeKey('F11');
		if (shiftDown) {
			return executor.issueDebuggerCommand('step_out');
		}
		return executor.issueDebuggerCommand('step_into');
	}
	return false;
}
