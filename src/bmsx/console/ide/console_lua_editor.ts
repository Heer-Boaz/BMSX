import * as constants from './constants';
import { ConsoleCartEditor, type ConsoleEditorShortcutContext } from './console_cart_editor';
import type { ConsoleEditorOptions } from './types';
import type { KeyboardInput } from '../../input/keyboardinput';
import { consumeKey as consumeKeyboardKey, isKeyJustPressed as isKeyJustPressedGlobal } from './input_helpers';
import { formatLuaDocument } from './lua_formatter';

export class ConsoleLuaEditor extends ConsoleCartEditor {
	constructor(options: ConsoleEditorOptions) {
		super(options);
	}

	protected override handleCustomKeybinding(
		keyboard: KeyboardInput,
		_deltaSeconds: number,
		context: ConsoleEditorShortcutContext,
	): boolean {
		if (!context.codeTabActive || context.inlineFieldFocused || context.resourcePanelFocused) {
			return false;
		}
		if (context.altDown || !context.shiftDown || (!context.ctrlDown && !context.metaDown)) {
			return false;
		}
		if (!isKeyJustPressedGlobal(this.playerIndex, 'KeyF')) {
			return false;
		}
		consumeKeyboardKey(keyboard, 'KeyF');
		this.applyDocumentFormatting();
		return true;
	}

	private applyDocumentFormatting(): void {
		const originalLines = [...this.lines];
		const originalSource = originalLines.join('\n');
		try {
			const formatted = formatLuaDocument(originalSource);
			if (formatted === originalSource) {
				this.showMessage('Document already formatted', constants.COLOR_STATUS_TEXT, 1.5);
				return;
			}
			const cursorOffset = this.computeDocumentOffset(originalLines, this.cursorRow, this.cursorColumn);
			this.prepareUndo('format-document', false);
			if (this.lines.length === 0) {
				this.selectionAnchor = { row: 0, column: 0 };
				this.cursorRow = 0;
				this.cursorColumn = 0;
			} else {
				const lastRow = this.lines.length - 1;
				this.selectionAnchor = { row: 0, column: 0 };
				this.cursorRow = lastRow;
				this.cursorColumn = this.lines[lastRow].length;
			}
			this.replaceSelectionWith(formatted);
			const updatedLines = [...this.lines];
			const target = this.resolveOffsetPosition(updatedLines, cursorOffset);
			this.setCursorPosition(target.row, target.column);
			this.clearSelection();
			this.markDiagnosticsDirty();
			this.showMessage('Document formatted', constants.COLOR_STATUS_SUCCESS, 1.6);
		} catch (error) {
			const message = error instanceof Error ? error.message : String(error);
			this.showMessage(`Formatting failed: ${message}`, constants.COLOR_STATUS_ERROR, 3.2);
		}
	}

	private computeDocumentOffset(lines: readonly string[], row: number, column: number): number {
		let offset = 0;
		for (let index = 0; index < row; index += 1) {
			offset += lines[index].length + 1;
		}
		return offset + column;
	}

	private resolveOffsetPosition(lines: readonly string[], offset: number): { row: number; column: number } {
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
}
