import * as constants from './constants';
import {
	createConsoleCartEditor,
	type ConsoleCartEditor,
	type ConsoleEditorShortcutContext,
	playerIndex,
	lines,
	cursorRow,
	cursorColumn,
	prepareUndo,
	replaceSelectionWith,
	setCursorPosition,
	clearSelection,
	markDiagnosticsDirty,
	showMessage,
	setSelectionAnchorPosition,
} from './console_cart_editor';
import type { ConsoleEditorOptions } from './types';
import type { KeyboardInput } from '../../input/keyboardinput';
import { consumeKey as consumeKeyboardKey, isKeyJustPressed as isKeyJustPressedGlobal } from './input_helpers';
import { formatLuaDocument } from './lua_formatter';

export type ConsoleLuaEditor = ConsoleCartEditor;

export function createConsoleLuaEditor(options: ConsoleEditorOptions): ConsoleCartEditor {
	return createConsoleCartEditor(options, {
		handleCustomKeybinding: (keyboard, deltaSeconds, context) =>
			handleLuaFormattingShortcut(keyboard, deltaSeconds, context),
	});
}

function handleLuaFormattingShortcut(
	keyboard: KeyboardInput,
	_deltaSeconds: number,
	context: ConsoleEditorShortcutContext,
): boolean {
	if (!context.codeTabActive || context.inlineFieldFocused || context.resourcePanelFocused) {
		return false;
	}
	if (!context.altDown || context.shiftDown || (!context.ctrlDown && !context.metaDown)) {
		return false;
	}
	if (!isKeyJustPressedGlobal(playerIndex, 'KeyF')) {
		return false;
	}
	consumeKeyboardKey(keyboard, 'KeyF');
	applyDocumentFormatting();
	return true;
}

function applyDocumentFormatting(): void {
	const originalLines = [...lines];
	const originalSource = originalLines.join('\\n');
	try {
		const formatted = formatLuaDocument(originalSource);
		if (formatted === originalSource) {
			showMessage('Document already formatted', constants.COLOR_STATUS_TEXT, 1.5);
			return;
		}
		const cursorOffset = computeDocumentOffset(originalLines, cursorRow, cursorColumn);
		prepareUndo('format-document', false);
		if (lines.length === 0) {
			setSelectionAnchorPosition({ row: 0, column: 0 });
			setCursorPosition(0, 0);
		} else {
			const lastRow = lines.length - 1;
			setSelectionAnchorPosition({ row: 0, column: 0 });
			setCursorPosition(lastRow, lines[lastRow].length);
		}
		replaceSelectionWith(formatted);
		const updatedLines = [...lines];
		const target = resolveOffsetPosition(updatedLines, cursorOffset);
		setCursorPosition(target.row, target.column);
		clearSelection();
		markDiagnosticsDirty();
		showMessage('Document formatted', constants.COLOR_STATUS_SUCCESS, 1.6);
	} catch (error) {
		const message = error instanceof Error ? error.message : String(error);
		showMessage(`Formatting failed: ${message}`, constants.COLOR_STATUS_ERROR, 3.2);
	}
}

function computeDocumentOffset(lines: readonly string[], row: number, column: number): number {
	let offset = 0;
	for (let index = 0; index < row; index += 1) {
		offset += lines[index].length + 1;
	}
	return offset + column;
}

function resolveOffsetPosition(lines: readonly string[], offset: number): { row: number; column: number } {
	let remaining = offset;
	for (let row = 0; row < lines.length; row += 1) {
		const lineLength = lines[row].length;
		if (remaining <= lineLength) {
			return { row, column: remaining };
		}
		remaining -= lineLength + 1;
	}
	if (lines.length === 0) {
		return { row: 0, column: 0 };
	}
	const lastRow = lines.length - 1;
	return { row: lastRow, column: lines[lastRow].length };
}
