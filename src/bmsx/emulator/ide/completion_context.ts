import type { LuaDefinitionInfo } from '../../lua/syntax/lua_ast';
import { clamp } from '../../utils/clamp';
import type { ModuleAliasEntry } from './semantic_model';
import type { TextBuffer } from './text/text_buffer';
import type { CursorScreenInfo } from './types';
import type { EditorFont } from '../editor_font';
import { ide_state } from './ide_state';
import * as TextEditing from './text_editing_and_selection';
import { getActiveCodeTabContext } from './editor_tabs';
import { revealCursor, updateDesiredColumn } from './caret';
import { resetBlink } from './render/render_caret';
import { measureText } from './text_utils';
import { drawEditorText } from './render/text_renderer';
import { getActiveSemanticDefinitions, getLuaModuleAliases } from './diagnostics_controller';
import { prepareUndo } from './undo_controller';

export interface CompletionContextSource {
	isCompletionReady(): boolean;
	shouldAutoTriggerCompletions(): boolean;
	getBuffer(): TextBuffer;
	getCursorPosition(): { row: number; column: number };
	getTextVersion(): number;
	getCursorScreenInfo(): CursorScreenInfo;
	getLineHeight(): number;
	getFont(): EditorFont;
	measureText(value: string): number;
	drawText(font: EditorFont, text: string, x: number, y: number, color: number): void;
	getActivePath(): string;
	getActiveSemanticDefinitions(): readonly LuaDefinitionInfo[];
	getLuaModuleAliases(path: string): Map<string, ModuleAliasEntry>;
	getCharAt(row: number, column: number): string;
	setCursorPosition(row: number, column: number): void;
	setSelectionAnchor(anchor: { row: number; column: number }): void;
	prepareUndo(): void;
	replaceSelectionWithText(text: string): void;
	clampBufferPosition(position: { row: number; column: number }): { row: number; column: number };
	afterCompletionApplied(): void;
	clearSelectionAnchor(): void;
}

export class EditorCompletionContext implements CompletionContextSource {
	public constructor(
		private readonly isCompletionReadyFn: () => boolean,
		private readonly shouldAutoTriggerCompletionsFn: () => boolean,
	) {}

	public isCompletionReady(): boolean {
		return this.isCompletionReadyFn();
	}

	public shouldAutoTriggerCompletions(): boolean {
		return this.shouldAutoTriggerCompletionsFn();
	}

	public getBuffer(): TextBuffer {
		return ide_state.buffer;
	}

	public getCursorPosition(): { row: number; column: number } {
		return { row: ide_state.cursorRow, column: ide_state.cursorColumn };
	}

	public getTextVersion(): number {
		return ide_state.textVersion;
	}

	public getCursorScreenInfo(): CursorScreenInfo {
		return ide_state.cursorScreenInfo;
	}

	public getLineHeight(): number {
		return ide_state.lineHeight;
	}

	public getFont(): EditorFont {
		return ide_state.font;
	}

	public measureText(value: string): number {
		return measureText(value);
	}

	public drawText(font: EditorFont, text: string, x: number, y: number, color: number): void {
		drawEditorText(font, text, x, y, undefined, color);
	}

	public getActivePath(): string {
		return getActiveCodeTabContext().descriptor.path;
	}

	public getActiveSemanticDefinitions(): readonly LuaDefinitionInfo[] {
		return getActiveSemanticDefinitions();
	}

	public getLuaModuleAliases(path: string): Map<string, ModuleAliasEntry> {
		return getLuaModuleAliases(path);
	}

	public getCharAt(row: number, column: number): string {
		return TextEditing.charAt(row, column);
	}

	public setCursorPosition(row: number, column: number): void {
		const rowCount = ide_state.buffer.getLineCount();
		const clampedRow = clamp(row, 0, Math.max(0, rowCount - 1));
		const line = ide_state.buffer.getLineContent(clampedRow);
		ide_state.cursorRow = clampedRow;
		ide_state.cursorColumn = clamp(column, 0, line.length);
	}

	public setSelectionAnchor(anchor: { row: number; column: number }): void {
		const target = ide_state.selectionAnchor;
		if (!target) {
			ide_state.selectionAnchor = {
				row: anchor.row,
				column: anchor.column,
			};
			return;
		}
		target.row = anchor.row;
		target.column = anchor.column;
	}

	public prepareUndo(): void {
		prepareUndo('completion', false);
	}

	public replaceSelectionWithText(text: string): void {
		TextEditing.replaceSelectionWith(text);
	}

	public clampBufferPosition(position: { row: number; column: number }): { row: number; column: number } {
		return ide_state.layout.clampBufferPosition(ide_state.buffer, position);
	}

	public afterCompletionApplied(): void {
		updateDesiredColumn();
		resetBlink();
		revealCursor();
	}

	public clearSelectionAnchor(): void {
		ide_state.selectionAnchor = null;
	}
}
