import { $ } from '../../core/game';
import type { KeyboardInput } from '../../input/keyboardinput';
import type { ViewportMetrics } from '../../platform/platform';
import { BmsxConsoleApi } from '../api';
import type {
	ConsoleLuaDefinitionLocation,
	ConsoleLuaHoverRequest,
	ConsoleLuaHoverResult,
	ConsoleLuaSymbolEntry,
	ConsoleResourceDescriptor,
} from '../types.ts';
import { ConsoleEditorFont } from '../editor_font';
import { DEFAULT_CONSOLE_FONT_VARIANT } from '../font';
import { drawEditorColoredText, drawEditorText } from './text_renderer';
import { Msx1Colors } from '../../systems/msx.ts';
import { SpriteComponent } from '../../component/sprite_component';
import { renderCodeArea } from './render_code_area';
import { clamp } from '../../utils/utils';
// Intellisense data is handled by CompletionController
import { CompletionController } from './completion_controller';
import { ProblemsPanelController } from './problems_panel';
import { computeAggregatedEditorDiagnostics, type DiagnosticContextInput, type DiagnosticProviders } from './diagnostics';
import { isIdentifierChar, isIdentifierStartChar, isWhitespace, isWordChar } from './text_utils';
import type { InlineFieldEditingHandlers, InlineFieldMetrics } from './inline_text_field';
import {
	applyInlineFieldEditing,
	applyInlineFieldPointer,
	caretX as inlineFieldCaretX,
	createInlineTextField,
	measureRange as inlineFieldMeasureRange,
	selectionRange as inlineFieldSelectionRange,
	setFieldText,
} from './inline_text_field';
import { buildHoverContentLines as buildHoverContentLinesExternal } from './hover_content';
import { isLuaCommentContext, measureTextGeneric, truncateTextToWidth as truncateTextToWidthExternal } from './text_utils_local';
import { ConsoleScrollbar, ScrollbarController } from './scrollbar';
import { renderTopBar } from './render_top_bar';
import { renderTabBar } from './render_tab_bar';
import { renderStatusBar } from './render_status_bar';
import { renderCreateResourceBar, renderSearchBar, renderResourceSearchBar, renderSymbolSearchBar, renderRenameBar, renderLineJumpBar } from './render_inline_bars';
import { renderErrorOverlayText } from './render_error_overlay';
import {
	cloneRuntimeErrorDetails,
	rebuildRuntimeErrorOverlayView
} from './runtime_error_overlay_model';
import {
	computeRuntimeErrorOverlayLayout,
	drawRuntimeErrorOverlay as drawRuntimeErrorOverlayBubble,
	evaluateRuntimeErrorOverlayClick,
	findRuntimeErrorOverlayLineAtPosition,
	type RuntimeErrorOverlayLayoutHost,
	type RuntimeErrorOverlayDrawOptions
} from './runtime_error_overlay_view';
// Resource panel rendering is handled via ResourcePanelController
import { ResourcePanelController } from './resource_panel_controller';
import { InputController } from './input_controller';
import { ConsoleCodeLayout } from './code_layout';
import { buildRuntimeErrorLines as buildRuntimeErrorLinesUtil, computeRuntimeErrorOverlayMaxWidth, wrapRuntimeErrorLine as wrapRuntimeErrorLineUtil } from './runtime_error_utils';
import type {
	CachedHighlight,
	CodeHoverTooltip,
	CodeTabContext,
	ConsoleEditorOptions,
	ConsoleEditorSerializedState,
	CursorScreenInfo,
	EditorSnapshot,
	EditorTabDescriptor,
	EditorTabId,
	EditorTabKind,
	EditorDiagnostic,
	HighlightLine,
	InlineInputOptions,
	InlineTextField,
	MessageState,
	PendingActionPrompt,
	PointerSnapshot,
	Position,
	ResourceCatalogEntry,
	ResourceSearchResult,
	ResourceViewerState,
	RuntimeErrorOverlay,
	RuntimeErrorDetails,
	RuntimeErrorStackFrame,
	ScrollbarKind,
	GlobalSearchMatch,
	SymbolSearchResult,
	TopBarButtonId,
	VisualLineSegment,
	LuaCompletionItem,
	ConsoleEditorShortcutContext,
	CustomKeybindingHandler,
	GlobalSearchJob,
	// SearchComputationJob migrated to editor_search.ts
	RuntimeErrorOverlayLayout,
} from './types';
import type { RectBounds } from '../../rompack/rompack.ts';
import { resolveReferenceLookup, type ReferenceMatchInfo } from './reference_navigation.ts';
import {
	buildReferenceCatalogForExpression as buildProjectReferenceCatalog,
	computeSourceLabel,
	resolveDefinitionLocationForExpression,
	type ProjectReferenceEnvironment,
	filterReferenceCatalog,
	type ReferenceCatalogEntry,
	type ReferenceSymbolEntry,
} from './reference_sources';
import { clearBackgroundTasks, enqueueBackgroundTask } from './console_cart_editor_background';

import { RenameController, type RenameCommitPayload, type RenameCommitResult } from './rename_controller';
import { planRenameLineEdits } from './rename_apply';
import { CrossFileRenameManager, type CrossFileRenameDependencies } from './rename_cross_file';
import {
	consumeKey as consumeKeyboardKey,
	getKeyboardButtonState,
	isKeyJustPressed as isKeyJustPressedGlobal,
	isKeyTyped as isKeyTypedGlobal,
	isModifierPressed as isModifierPressedGlobal,
	resetKeyPressRecords,
	shouldAcceptKeyPress as shouldAcceptKeyPressGlobal,
} from './input_helpers';
import type { LuaDefinitionInfo, LuaSourceRange } from '../../lua/ast.ts';
import { CaretNavigationState } from './caret_navigation.ts';
import type { BmsxConsoleRuntime } from '../../console.ts';
import { EDITOR_TOGGLE_KEY, ESCAPE_KEY, EDITOR_TOGGLE_GAMEPAD_BUTTONS, GLOBAL_SEARCH_RESULT_LIMIT } from './constants';
// Search logic moved to editor_search
import { activeSearchMatchCount, searchPageSize, openSearch, closeSearch, focusEditorFromSearch, onSearchQueryChanged, ensureSearchJobCompleted, moveSearchSelection, applySearchSelection, ensureSearchSelectionVisible, computeSearchPageStats, getVisibleSearchResultEntries, startSearchJob, forEachMatchInLine } from './editor_search';
import { formatLuaDocument } from './lua_formatter.ts';
import * as constants from './constants';
import { ide_state, type NavigationHistoryEntry, captureKeys, EMPTY_DIAGNOSTICS, NAVIGATION_HISTORY_LIMIT, diagnosticsDebounceMs } from './ide_state';
import {
	setCursorPosition,
	moveCursorLeft,
	moveCursorRight,
	moveCursorUp,
	moveCursorDown,
	moveCursorHome,
	moveCursorEnd,
	pageUp,
	pageDown,
	revealCursor,
	clampCursorRow,
	clampCursorColumn,
} from './cursor_operations';

// Re-export commonly used constants for convenience
export { captureKeys, EMPTY_DIAGNOSTICS, NAVIGATION_HISTORY_LIMIT } from './ide_state';

// Export ide_state for direct access
export { ide_state };

// Re-export cursor operations from their dedicated module
export {
	setCursorPosition,
	moveCursorVertical,
	moveCursorHorizontal,
	moveWordLeft,
	moveWordRight,
	moveCursorLeft,
	moveCursorRight,
	moveCursorUp,
	moveCursorDown,
	moveCursorHome,
	moveCursorEnd,
	pageUp,
	pageDown,
	clampCursorRow,
	clampCursorColumn,
	revealCursor,
} from './cursor_operations';

// Re-export ALL text editing and selection operations for backward compatibility
// This makes them available both internally and to external consumers
export * from './text_editing_and_selection';
// Import them for internal use in this module
import * as TextEditing from './text_editing_and_selection';

// Use shorter aliases for commonly used functions
const {
	hasSelection,
	getSelectionRange,
	getSelectionText,
	selectWordAtPosition,
	deleteSelectionIfPresent,
	replaceSelectionWith,
	setSelectionAnchorPosition,
	clearSelection,
	stepLeft,
	stepRight,
	charAt,
	backspace,
	deleteForward,
	insertText,
	insertLineBreak,
	insertClipboardText,
} = TextEditing;

export function invalidateLineRange(startRow: number, endRow: number): void {
	if (ide_state.lines.length === 0) {
		return;
	}
	let from = Math.min(startRow, endRow);
	let to = Math.max(startRow, endRow);
	const lastRow = ide_state.lines.length - 1;
	from = clamp(from, 0, lastRow);
	to = clamp(to, 0, lastRow);
	for (let row = from; row <= to; row += 1) {
		invalidateLine(row);
	}
}

export function maximumLineLength(): number {
	let maxLength = 0;
	for (let i = 0; i < ide_state.lines.length; i += 1) {
		const length = ide_state.lines[i].length;
		if (length > maxLength) {
			maxLength = length;
		}
	}
	return maxLength;
}

export function computeMaximumScrollColumn(): number {
	const maxLength = maximumLineLength();
	const visible = visibleColumnCount();
	const limit = maxLength - visible;
	if (limit <= 0) {
		return 0;
	}
	return limit;
}

export function resetKeyPressGuards(): void {
	resetKeyPressRecords();
}

// Text insertion, deletion, and editing functions moved to text_editing_and_selection.ts
// backspace(), deleteForward(), etc. are now imported and re-exported from the dedicated module

export function deleteWordBackward(): void {
	if (!hasSelection() && ide_state.cursorColumn === 0 && ide_state.cursorRow === 0) {
		return;
	}
	prepareUndo('delete-word-backward', false);
	if (deleteSelectionIfPresent()) {
		return;
	}
	const target = findWordLeft(ide_state.cursorRow, ide_state.cursorColumn);
	if (target.row === ide_state.cursorRow && target.column === ide_state.cursorColumn) {
		backspace();
		return;
	}
	const startRow = target.row;
	const startColumn = target.column;
	const endRow = ide_state.cursorRow;
	const endColumn = ide_state.cursorColumn;
	if (startRow === endRow) {
		const line = ide_state.lines[startRow];
		const removed = line.slice(startColumn, endColumn);
		ide_state.lines[startRow] = line.slice(0, startColumn) + line.slice(endColumn);
		ide_state.cursorColumn = startColumn;
		invalidateLine(startRow);
		recordEditContext('delete', removed);
		markTextMutated();
		resetBlink();
		updateDesiredColumn();
		revealCursor();
		return;
	}
	const firstLine = ide_state.lines[startRow];
	const lastLine = ide_state.lines[endRow];
	const removedParts: string[] = [];
	removedParts.push(firstLine.slice(startColumn));
	for (let row = startRow + 1; row < endRow; row += 1) {
		removedParts.push(ide_state.lines[row]);
	}
	removedParts.push(lastLine.slice(0, endColumn));
	ide_state.lines[startRow] = firstLine.slice(0, startColumn) + lastLine.slice(endColumn);
	ide_state.lines.splice(startRow + 1, endRow - startRow);
	ide_state.cursorRow = startRow;
	ide_state.cursorColumn = startColumn;
	invalidateLine(startRow);
	invalidateHighlightsFromRow(startRow);
	recordEditContext('delete', removedParts.join('\n'));
	markTextMutated();
	resetBlink();
	updateDesiredColumn();
	revealCursor();
}

export function deleteWordForward(): void {
	if (!hasSelection() && ide_state.cursorRow >= ide_state.lines.length - 1 && ide_state.cursorColumn >= currentLine().length) {
		return;
	}
	prepareUndo('delete-word-forward', false);
	if (deleteSelectionIfPresent()) {
		return;
	}
	const destination = findWordRight(ide_state.cursorRow, ide_state.cursorColumn);
	if (destination.row === ide_state.cursorRow && destination.column === ide_state.cursorColumn) {
		deleteForward();
		return;
	}
	const startRow = ide_state.cursorRow;
	const startColumn = ide_state.cursorColumn;
	const endRow = destination.row;
	const endColumn = destination.column;
	if (startRow === endRow) {
		const line = ide_state.lines[startRow];
		const removed = line.slice(startColumn, endColumn);
		ide_state.lines[startRow] = line.slice(0, startColumn) + line.slice(endColumn);
		invalidateLine(startRow);
		recordEditContext('delete', removed);
	} else {
		const firstLine = ide_state.lines[startRow];
		const lastLine = ide_state.lines[endRow];
		const removedParts: string[] = [];
		removedParts.push(firstLine.slice(startColumn));
		for (let row = startRow + 1; row < endRow; row += 1) {
			removedParts.push(ide_state.lines[row]);
		}
		removedParts.push(lastLine.slice(0, endColumn));
		ide_state.lines[startRow] = firstLine.slice(0, startColumn) + lastLine.slice(endColumn);
		ide_state.lines.splice(startRow + 1, endRow - startRow);
		invalidateLine(startRow);
		invalidateHighlightsFromRow(startRow);
		recordEditContext('delete', removedParts.join('\n'));
	}
	ide_state.cursorRow = startRow;
	ide_state.cursorColumn = startColumn;
	markTextMutated();
	resetBlink();
	updateDesiredColumn();
	revealCursor();
}

export function findWordLeft(row: number, column: number): { row: number; column: number } {
	let currentRow = row;
	let currentColumn = column;
	let step = stepLeft(currentRow, currentColumn);
	if (!step) {
		return { row: 0, column: 0 };
	}
	currentRow = step.row;
	currentColumn = step.column;
	let currentChar = charAt(currentRow, currentColumn);
	while (isWhitespace(currentChar)) {
		const previous = stepLeft(currentRow, currentColumn);
		if (!previous) {
			return { row: 0, column: 0 };
		}
		currentRow = previous.row;
		currentColumn = previous.column;
		currentChar = charAt(currentRow, currentColumn);
	}
	const word = isWordChar(currentChar);
	while (true) {
		const previous = stepLeft(currentRow, currentColumn);
		if (!previous) {
			currentRow = 0;
			currentColumn = 0;
			break;
		}
		const previousChar = charAt(previous.row, previous.column);
		if (isWhitespace(previousChar) || isWordChar(previousChar) !== word) {
			break;
		}
		currentRow = previous.row;
		currentColumn = previous.column;
	}
	return { row: currentRow, column: currentColumn };
}

export function findWordRight(row: number, column: number): { row: number; column: number } {
	let currentRow = row;
	let currentColumn = column;
	let step = stepRight(currentRow, currentColumn);
	if (!step) {
		const lastRow = ide_state.lines.length - 1;
		return { row: lastRow, column: ide_state.lines[lastRow].length };
	}
	currentRow = step.row;
	currentColumn = step.column;
	let currentChar = charAt(currentRow, currentColumn);
	while (isWhitespace(currentChar)) {
		const next = stepRight(currentRow, currentColumn);
		if (!next) {
			const lastRow = ide_state.lines.length - 1;
			return { row: lastRow, column: ide_state.lines[lastRow].length };
		}
		currentRow = next.row;
		currentColumn = next.column;
		currentChar = charAt(currentRow, currentColumn);
	}
	const word = isWordChar(currentChar);
	while (true) {
		const next = stepRight(currentRow, currentColumn);
		if (!next) {
			const lastRow = ide_state.lines.length - 1;
			currentRow = lastRow;
			currentColumn = ide_state.lines[lastRow].length;
			break;
		}
		const nextChar = charAt(next.row, next.column);
		if (isWhitespace(nextChar) || isWordChar(nextChar) !== word) {
			currentRow = next.row;
			currentColumn = next.column;
			break;
		}
		currentRow = next.row;
		currentColumn = next.column;
	}
	while (isWhitespace(charAt(currentRow, currentColumn))) {
		const next = stepRight(currentRow, currentColumn);
		if (!next) {
			const lastRow = ide_state.lines.length - 1;
			currentRow = lastRow;
			currentColumn = ide_state.lines[lastRow].length;
			break;
		}
		currentRow = next.row;
		currentColumn = next.column;
	}
	return { row: currentRow, column: currentColumn };
}

export function deleteActiveLines(): void {
	if (ide_state.lines.length === 0) {
		return;
	}
	prepareUndo('delete-ide_state.active-ide_state.lines', false);
	const range = getSelectionRange();
	if (!range) {
		const removedRow = ide_state.cursorRow;
		ide_state.lines.splice(removedRow, 1);
		if (ide_state.lines.length === 0) {
			ide_state.lines = [''];
			ide_state.cursorRow = 0;
			ide_state.cursorColumn = 0;
		} else if (ide_state.cursorRow >= ide_state.lines.length) {
			ide_state.cursorRow = ide_state.lines.length - 1;
			ide_state.cursorColumn = ide_state.lines[ide_state.cursorRow].length;
		} else {
			const line = ide_state.lines[ide_state.cursorRow];
			ide_state.cursorColumn = Math.min(ide_state.cursorColumn, line.length);
		}
		invalidateLine(ide_state.cursorRow);
		invalidateHighlightsFromRow(Math.min(removedRow, ide_state.lines.length - 1));
		recordEditContext('delete', '\n');
		markTextMutated();
		resetBlink();
		updateDesiredColumn();
		revealCursor();
		return;
	}
	const { start, end } = range;
	const deletionStart = start.row;
	let deletionEnd = end.row;
	if (end.column === 0 && end.row > start.row) {
		deletionEnd -= 1;
	}
	const count = deletionEnd - deletionStart + 1;
	const deletedLines = ide_state.lines.slice(deletionStart, deletionStart + count);
	ide_state.lines.splice(deletionStart, count);
	if (ide_state.lines.length === 0) {
		ide_state.lines = [''];
	}
	ide_state.cursorRow = clamp(deletionStart, 0, ide_state.lines.length - 1);
	ide_state.cursorColumn = 0;
	ide_state.selectionAnchor = null;
	invalidateLine(ide_state.cursorRow);
	invalidateHighlightsFromRow(deletionStart);
	recordEditContext('delete', deletedLines.join('\n'));
	markTextMutated();
	resetBlink();
	updateDesiredColumn();
	revealCursor();
}

export function moveSelectionLines(delta: number): void {
	if (delta === 0) {
		return;
	}
	const range = getLineRangeForMovement();
	if (delta < 0 && range.startRow === 0) {
		return;
	}
	if (delta > 0 && range.endRow >= ide_state.lines.length - 1) {
		return;
	}
	prepareUndo('move-ide_state.lines', false);
	const count = range.endRow - range.startRow + 1;
	const block = ide_state.lines.splice(range.startRow, count);
	const targetIndex = range.startRow + delta;
	ide_state.lines.splice(targetIndex, 0, ...block);
	const affectedStart = Math.max(0, Math.min(range.startRow, targetIndex));
	const affectedEnd = Math.min(ide_state.lines.length - 1, Math.max(range.endRow, targetIndex + count - 1));
	if (affectedStart <= affectedEnd) {
		for (let row = affectedStart; row <= affectedEnd; row += 1) {
			invalidateLine(row);
		}
	}
	invalidateHighlightsFromRow(affectedStart);
	ide_state.cursorRow += delta;
	if (ide_state.selectionAnchor) {
		ide_state.selectionAnchor = { row: ide_state.selectionAnchor.row + delta, column: ide_state.selectionAnchor.column };
	}
	clampCursorColumn();
	markTextMutated();
	resetBlink();
	updateDesiredColumn();
	revealCursor();
}

export function getLineRangeForMovement(): { startRow: number; endRow: number } {
	const range = getSelectionRange();
	if (!range) {
		return { startRow: ide_state.cursorRow, endRow: ide_state.cursorRow };
	}
	let endRow = range.end.row;
	if (range.end.column === 0 && endRow > range.start.row) {
		endRow -= 1;
	}
	return { startRow: range.start.row, endRow };
}

export function indentSelectionOrLine(): void {
	prepareUndo('indent', false);
	const range = getSelectionRange();
	if (!range) {
		const line = currentLine();
		ide_state.lines[ide_state.cursorRow] = '\t' + line;
		ide_state.cursorColumn += 1;
		invalidateLine(ide_state.cursorRow);
		recordEditContext('insert', '\t');
		markTextMutated();
		resetBlink();
		updateDesiredColumn();
		revealCursor();
		return;
	}
	for (let row = range.start.row; row <= range.end.row; row += 1) {
		ide_state.lines[row] = '\t' + ide_state.lines[row];
		invalidateLine(row);
	}
	if (ide_state.selectionAnchor) {
		ide_state.selectionAnchor = { row: ide_state.selectionAnchor.row, column: ide_state.selectionAnchor.column + 1 };
	}
	ide_state.cursorColumn += 1;
	recordEditContext('insert', '\t');
	markTextMutated();
	resetBlink();
	updateDesiredColumn();
	revealCursor();
}

export function unindentSelectionOrLine(): void {
	prepareUndo('unindent', false);
	const range = getSelectionRange();
	if (!range) {
		const line = currentLine();
		const indentation = countLeadingIndent(line);
		if (indentation === 0) {
			return;
		}
		const remove = Math.min(indentation, 1);
		ide_state.lines[ide_state.cursorRow] = line.slice(remove);
		ide_state.cursorColumn = Math.max(0, ide_state.cursorColumn - remove);
		invalidateLine(ide_state.cursorRow);
		recordEditContext('delete', line.slice(0, remove));
		markTextMutated();
		resetBlink();
		updateDesiredColumn();
		revealCursor();
		return;
	}
	for (let row = range.start.row; row <= range.end.row; row += 1) {
		const line = ide_state.lines[row];
		const indentation = countLeadingIndent(line);
		if (indentation > 0) {
			ide_state.lines[row] = line.slice(1);
			invalidateLine(row);
		}
	}
	if (ide_state.selectionAnchor) {
		ide_state.selectionAnchor = { row: ide_state.selectionAnchor.row, column: Math.max(0, ide_state.selectionAnchor.column - 1) };
	}
	ide_state.cursorColumn = Math.max(0, ide_state.cursorColumn - 1);
	recordEditContext('delete', '\t');
	markTextMutated();
	resetBlink();
	updateDesiredColumn();
	revealCursor();
}

export function countLeadingIndent(line: string): number {
	let count = 0;
	while (count < line.length) {
		const ch = line.charAt(count);
		if (ch === '\t' || ch === ' ') {
			count += 1;
		} else {
			break;
		}
	}
	return count;
}

export function deleteSelection(): void {
	if (!hasSelection()) {
		return;
	}
	prepareUndo('delete-selection', false);
	replaceSelectionWith('');
}

// Selection manipulation functions moved to text_editing_and_selection.ts
// They are now available via re-export

// insertClipboardText() moved to text_editing_and_selection.ts
// charAt() moved to text_editing_and_selection.ts

export function currentLine(): string {
	if (ide_state.cursorRow < 0 || ide_state.cursorRow >= ide_state.lines.length) {
		return '';
	}
	return ide_state.lines[ide_state.cursorRow];
}

export function clampSelectionPosition(position: Position | null): Position | null {
	if (!position || ide_state.lines.length === 0) {
		return null;
	}
	let row = position.row;
	if (row < 0) {
		row = 0;
	} else if (row >= ide_state.lines.length) {
		row = ide_state.lines.length - 1;
	}
	const line = ide_state.lines[row] ?? '';
	let column = position.column;
	if (column < 0) {
		column = 0;
	} else if (column > line.length) {
		column = line.length;
	}
	return { row, column };
}

export function prepareUndo(key: string, allowMerge: boolean): void {
	const now = Date.now();
	const shouldMerge = allowMerge
		&& ide_state.lastHistoryKey === key
		&& now - ide_state.lastHistoryTimestamp <= constants.UNDO_COALESCE_INTERVAL_MS;
	if (shouldMerge) {
		ide_state.lastHistoryTimestamp = now;
		return;
	}
	const snapshot = captureSnapshot();
	if (ide_state.undoStack.length >= constants.UNDO_HISTORY_LIMIT) {
		ide_state.undoStack.shift();
	}
	ide_state.undoStack.push(snapshot);
	ide_state.redoStack.length = 0;
	ide_state.lastHistoryTimestamp = now;
	if (allowMerge) {
		ide_state.lastHistoryKey = key;
	} else {
		ide_state.lastHistoryKey = null;
	}
}

export function undo(): void {
	if (ide_state.undoStack.length === 0) {
		return;
	}
	const snapshot = ide_state.undoStack.pop();
	if (!snapshot) {
		return;
	}
	const current = captureSnapshot();
	if (ide_state.redoStack.length >= constants.UNDO_HISTORY_LIMIT) {
		ide_state.redoStack.shift();
	}
	ide_state.redoStack.push(current);
	restoreSnapshot(snapshot, true);
	breakUndoSequence();
}

export function redo(): void {
	if (ide_state.redoStack.length === 0) {
		return;
	}
	const snapshot = ide_state.redoStack.pop();
	if (!snapshot) {
		return;
	}
	const current = captureSnapshot();
	if (ide_state.undoStack.length >= constants.UNDO_HISTORY_LIMIT) {
		ide_state.undoStack.shift();
	}
	ide_state.undoStack.push(current);
	restoreSnapshot(snapshot, true);
	breakUndoSequence();
}

export function breakUndoSequence(): void {
	ide_state.lastHistoryKey = null;
	ide_state.lastHistoryTimestamp = 0;
}

export function extractIdentifierAt(row: number, column: number): string | null {
	if (row < 0 || row >= ide_state.lines.length) {
		return null;
	}
	const line = ide_state.lines[row];
	if (column < 0 || column > line.length) {
		return null;
	}
	let start = column;
	let end = column;
	while (start > 0) {
		const previous = line.charCodeAt(start - 1);
		if (!isIdentifierChar(previous)) {
			break;
		}
		start -= 1;
	}
	while (end < line.length) {
		const next = line.charCodeAt(end);
		if (!isIdentifierChar(next)) {
			break;
		}
		end += 1;
	}
	const identifier = line.slice(start, end);
	if (!identifier || !isIdentifierStartChar(identifier.charCodeAt(0))) {
		return null;
	}
	return identifier;
}

export function clampScrollRow(): void {
	ensureVisualLines();
	const rows = visibleRowCount();
	const totalVisual = getVisualLineCount();
	const cursorVisualIndex = positionToVisualIndex(ide_state.cursorRow, ide_state.cursorColumn);
	if (cursorVisualIndex < ide_state.scrollRow) {
		ide_state.scrollRow = cursorVisualIndex;
	}
	if (cursorVisualIndex >= ide_state.scrollRow + rows) {
		ide_state.scrollRow = cursorVisualIndex - rows + 1;
	}
	const maxScrollRow = Math.max(0, totalVisual - rows);
	ide_state.scrollRow = clamp(ide_state.scrollRow, 0, maxScrollRow);
}

export function clampScrollColumn(): void {
	if (ide_state.wordWrapEnabled) {
		ide_state.scrollColumn = 0;
		return;
	}
	const columns = visibleColumnCount();
	if (ide_state.cursorColumn < ide_state.scrollColumn) {
		ide_state.scrollColumn = ide_state.cursorColumn;
	}
	const maxScrollColumn = ide_state.cursorColumn - columns + 1;
	if (maxScrollColumn > ide_state.scrollColumn) {
		ide_state.scrollColumn = maxScrollColumn;
	}
	if (ide_state.scrollColumn < 0) {
		ide_state.scrollColumn = 0;
	}
	const lineLength = currentLine().length;
	const maxColumn = lineLength - columns;
	if (maxColumn < 0) {
		ide_state.scrollColumn = 0;
	} else if (ide_state.scrollColumn > maxColumn) {
		ide_state.scrollColumn = maxColumn;
	}
}

// migrated to editor_search.ts
export { activeSearchMatchCount } from './editor_search';

// migrated to editor_search.ts
export { searchPageSize } from './editor_search';
// additional search-related re-exports
export { openSearch, closeSearch, focusEditorFromSearch, onSearchQueryChanged, ensureSearchJobCompleted, moveSearchSelection, applySearchSelection } from './editor_search';

function searchVisibleResultCount(): number {
	return computeSearchPageStats().visible;
}

function searchResultEntryHeight(): number {
	return ide_state.lineHeight * 2;
}

function isResourceSearchCompactMode(): boolean {
	return ide_state.viewportWidth <= constants.SYMBOL_SEARCH_COMPACT_WIDTH;
}

function resourceSearchEntryHeight(): number {
	return isResourceSearchCompactMode() ? ide_state.lineHeight * 2 : ide_state.lineHeight;
}

function resourceSearchPageSize(): number {
	return isResourceSearchCompactMode() ? constants.QUICK_OPEN_COMPACT_MAX_RESULTS : constants.QUICK_OPEN_MAX_RESULTS;
}

function resourceSearchWindowCapacity(): number {
	return ide_state.resourceSearchVisible ? resourceSearchPageSize() : 0;
}

function resourceSearchVisibleResultCount(): number {
	if (!ide_state.resourceSearchVisible) {
		return 0;
	}
	const remaining = Math.max(0, ide_state.resourceSearchMatches.length - ide_state.resourceSearchDisplayOffset);
	const capacity = resourceSearchWindowCapacity();
	if (capacity <= 0) {
		return remaining;
	}
	return Math.min(remaining, capacity);
}

function isSymbolSearchCompactMode(): boolean {
	return ide_state.viewportWidth <= constants.SYMBOL_SEARCH_COMPACT_WIDTH;
}

function symbolSearchEntryHeight(): number {
	if (ide_state.symbolSearchMode === 'references') {
		return ide_state.lineHeight * 2;
	}
	return ide_state.symbolSearchGlobal && isSymbolSearchCompactMode() ? ide_state.lineHeight * 2 : ide_state.lineHeight;
}

function symbolSearchPageSize(): number {
	if (ide_state.symbolSearchMode === 'references') {
		return constants.REFERENCE_SEARCH_MAX_RESULTS;
	}
	if (!ide_state.symbolSearchGlobal) {
		return constants.SYMBOL_SEARCH_MAX_RESULTS;
	}
	return isSymbolSearchCompactMode() ? constants.SYMBOL_SEARCH_COMPACT_MAX_RESULTS : constants.SYMBOL_SEARCH_MAX_RESULTS;
}

function symbolSearchVisibleResultCount(): number {
	if (!ide_state.symbolSearchVisible) {
		return 0;
	}
	const remaining = Math.max(0, ide_state.symbolSearchMatches.length - ide_state.symbolSearchDisplayOffset);
	const maxResults = symbolSearchPageSize();
	return Math.min(remaining, maxResults);
}

function symbolCatalogDedupKey(entry: ConsoleLuaSymbolEntry): string {
	const { location, kind, name } = entry;
	const chunkName = location.chunkName ?? '';
	const normalizedPath = location.path ? location.path.replace(/\\/g, '/') : '';
	const assetId = location.assetId ?? '';
	const locationKey = normalizedPath.length > 0
		? normalizedPath
		: (assetId.length > 0 ? assetId : chunkName);
	const startLine = location.range.startLine;
	const startColumn = location.range.startColumn;
	const endLine = location.range.endLine;
	const endColumn = location.range.endColumn;
	return `${kind}|${name}|${locationKey}|${startLine}:${startColumn}|${endLine}:${endColumn}`;
}

export function installPlatformVisibilityListener(): void {
	ide_state.disposeVisibilityListener?.();
	ide_state.disposeVisibilityListener = $.platform.lifecycle.onVisibilityChange((visible) => {
		requestWindowFocusState(!!visible, true);
	});
}

export function installWindowEventListeners(): void {
	ide_state.disposeWindowEventListeners?.();
	const host = $.platform.gameviewHost;
	if (!host) {
		throw new Error('[ConsoleCartEditor] Platform game view host unavailable while installing window listeners.');
	}
	const windowEvents = host.getCapability('window-events');
	if (!windowEvents) {
		throw new Error('[ConsoleCartEditor] Platform window-events capability not exposed.');
	}
	const disposers: (() => void)[] = [];
	disposers.push(windowEvents.subscribe('blur', () => {
		requestWindowFocusState(false, true);
	}));
	disposers.push(windowEvents.subscribe('focus', () => {
		requestWindowFocusState(true, true);
	}));
	ide_state.disposeWindowEventListeners = () => {
		for (let i = 0; i < disposers.length; i++) {
			try {
				disposers[i]();
			} catch {
				// Ignore disposer failures; best-effort cleanup.
			}
		}
	};
}

export function resetInputFocusState(keyboard: KeyboardInput | null): void {
	if (keyboard) {
		keyboard.reset();
	}
	ide_state.input.resetRepeats();
	resetKeyPressGuards();
	ide_state.repeatState.clear();
	ide_state.toggleInputLatch = false;
}

export function requestWindowFocusState(hasFocus: boolean, immediate: boolean): void {
	ide_state.pendingWindowFocused = hasFocus;
	if (immediate) {
		flushWindowFocusState();
	}
}

export function flushWindowFocusState(keyboard?: KeyboardInput): void {
	if (ide_state.pendingWindowFocused === ide_state.windowFocused) {
		return;
	}
	ide_state.windowFocused = ide_state.pendingWindowFocused;
	const effectiveKeyboard = keyboard ?? getKeyboard();
	resetInputFocusState(effectiveKeyboard);
}

export function scheduleNextFrame(task: () => void): void {
	if (typeof queueMicrotask === 'function') {
		queueMicrotask(task);
		return;
	}
	void Promise.resolve().then(task);
}

export function drawHoverTooltip(api: BmsxConsoleApi, codeTop: number, codeBottom: number, textLeft: number): void {
	const tooltip = ide_state.hoverTooltip;
	if (!tooltip) {
		return;
	}
	const content = tooltip.contentLines;
	if (!content || content.length === 0) {
		tooltip.bubbleBounds = null;
		return;
	}
	const visibleRows = visibleRowCount();
	ensureVisualLines();
	const visualIndex = positionToVisualIndex(tooltip.row, tooltip.startColumn);
	const relativeRow = visualIndex - ide_state.scrollRow;
	if (relativeRow < 0 || relativeRow >= visibleRows) {
		tooltip.bubbleBounds = null;
		return;
	}
	const rowTop = codeTop + relativeRow * ide_state.lineHeight;
	const segment = visualIndexToSegment(visualIndex);
	if (!segment) {
		tooltip.bubbleBounds = null;
		return;
	}
	const entry = getCachedHighlight(segment.row);
	const highlight = entry.hi;
	let columnStart = ide_state.wordWrapEnabled ? segment.startColumn : ide_state.scrollColumn;
	if (ide_state.wordWrapEnabled) {
		if (columnStart < segment.startColumn || columnStart > segment.endColumn) {
			columnStart = segment.startColumn;
		}
	}
	const columnCount = ide_state.wordWrapEnabled
		? Math.max(0, segment.endColumn - columnStart)
		: visibleColumnCount() + 8;
	const slice = sliceHighlightedLine(highlight, columnStart, columnCount);
	const sliceStartDisplay = slice.startDisplay;
	const sliceEndLimit = ide_state.wordWrapEnabled ? columnToDisplay(highlight, segment.endColumn) : slice.endDisplay;
	const sliceEndDisplay = ide_state.wordWrapEnabled ? Math.min(slice.endDisplay, sliceEndLimit) : slice.endDisplay;
	const startDisplay = columnToDisplay(highlight, tooltip.startColumn);
	const endDisplay = columnToDisplay(highlight, tooltip.endColumn);
	const clampedStartDisplay = clamp(startDisplay, sliceStartDisplay, sliceEndDisplay);
	const clampedEndDisplay = clamp(endDisplay, clampedStartDisplay, sliceEndDisplay);
	const expressionStartX = textLeft + measureRangeFast(entry, sliceStartDisplay, clampedStartDisplay);
	const expressionEndX = textLeft + measureRangeFast(entry, sliceStartDisplay, clampedEndDisplay);
	const maxVisible = Math.max(1, Math.min(constants.HOVER_TOOLTIP_MAX_VISIBLE_LINES, content.length));
	const maxOffset = Math.max(0, content.length - maxVisible);
	tooltip.scrollOffset = clamp(tooltip.scrollOffset, 0, maxOffset);
	const visibleCount = Math.max(1, Math.min(maxVisible, content.length - tooltip.scrollOffset));
	tooltip.visibleLineCount = visibleCount;
	const visibleLines = content.slice(tooltip.scrollOffset, tooltip.scrollOffset + visibleCount);
	let maxLineWidth = 0;
	for (const line of visibleLines) {
		const width = measureText(line);
		if (width > maxLineWidth) {
			maxLineWidth = width;
		}
	}
	const bubbleWidth = maxLineWidth + constants.HOVER_TOOLTIP_PADDING_X * 2;
	const bubbleHeight = visibleLines.length * ide_state.lineHeight + constants.HOVER_TOOLTIP_PADDING_Y * 2;
	const viewportRight = ide_state.viewportWidth - 1;
	let bubbleLeft = expressionEndX + ide_state.spaceAdvance;
	if (bubbleLeft + bubbleWidth > viewportRight) {
		bubbleLeft = viewportRight - bubbleWidth;
	}
	if (bubbleLeft <= expressionEndX) {
		const leftCandidate = expressionStartX - bubbleWidth - ide_state.spaceAdvance;
		if (leftCandidate >= textLeft) {
			bubbleLeft = leftCandidate;
		} else {
			bubbleLeft = Math.max(textLeft, bubbleLeft);
		}
	}
	if (bubbleLeft < textLeft) {
		bubbleLeft = textLeft;
	}
	let bubbleTop = rowTop;
	if (bubbleTop + bubbleHeight > codeBottom) {
		bubbleTop = Math.max(codeTop, codeBottom - bubbleHeight);
	}
	api.rectfill_color(bubbleLeft, bubbleTop, bubbleLeft + bubbleWidth, bubbleTop + bubbleHeight, constants.HOVER_TOOLTIP_BACKGROUND);
	api.rect(bubbleLeft, bubbleTop, bubbleLeft + bubbleWidth, bubbleTop + bubbleHeight, constants.HOVER_TOOLTIP_BORDER);
	for (let i = 0; i < visibleLines.length; i += 1) {
		const lineY = bubbleTop + constants.HOVER_TOOLTIP_PADDING_Y + i * ide_state.lineHeight;
		drawEditorText(api, ide_state.font, visibleLines[i], bubbleLeft + constants.HOVER_TOOLTIP_PADDING_X, lineY, constants.COLOR_STATUS_TEXT);
	}
	tooltip.bubbleBounds = { left: bubbleLeft, top: bubbleTop, right: bubbleLeft + bubbleWidth, bottom: bubbleTop + bubbleHeight };
}

export function showRuntimeErrorInChunk(
	chunkName: string | null,
	line: number | null,
	column: number | null,
	message: string,
	hint?: { assetId: string | null; path?: string | null },
	details?: RuntimeErrorDetails | null
): void {
	focusChunkSource(chunkName, hint);
	const overlayMessage = chunkName && chunkName.length > 0 ? `${chunkName}: ${message}` : message;
	showRuntimeError(line, column, overlayMessage, details ?? null);
}

export function showRuntimeError(line: number | null, column: number | null, message: string, details?: RuntimeErrorDetails | null): void {
	if (!ide_state.active) {
		activate();
	}
	const hasLocation = typeof line === 'number' && Number.isFinite(line) && line >= 1;
	const processedLine = hasLocation ? Math.max(1, Math.floor(line!)) : null;
	const processedColumn = typeof column === 'number' && Number.isFinite(column) ? Math.floor(column!) - 1 : null;
	let targetRow = ide_state.cursorRow;
	if (processedLine !== null) {
		targetRow = clamp(processedLine - 1, 0, ide_state.lines.length - 1);
		ide_state.cursorRow = targetRow;
	}
	const currentLine = ide_state.lines[targetRow] ?? '';
	let targetColumn = ide_state.cursorColumn;
	if (processedColumn !== null) {
		targetColumn = clamp(processedColumn, 0, currentLine.length);
		ide_state.cursorColumn = targetColumn;
	}
	clampCursorColumn();
	targetColumn = ide_state.cursorColumn;
	ide_state.selectionAnchor = null;
	ide_state.pointerSelecting = false;
	ide_state.pointerPrimaryWasPressed = false;
	ide_state.scrollbarController.cancel();
	ide_state.cursorRevealSuspended = false;
	centerCursorVertically();
	updateDesiredColumn();
	revealCursor();
	resetBlink();
	const normalizedMessage = message && message.length > 0 ? message.trim() : 'Runtime error';
	const overlayMessage = processedLine !== null ? `Line ${processedLine}:${normalizedMessage}` : normalizedMessage;
	const messageLines = buildRuntimeErrorLines(overlayMessage);
	const overlayDetails = cloneRuntimeErrorDetails(details ?? null);
	const overlay: RuntimeErrorOverlay = {
		row: targetRow,
		column: targetColumn,
		lines: [],
		timer: Number.POSITIVE_INFINITY,
		messageLines,
		lineDescriptors: [],
		layout: null,
		details: overlayDetails,
		expanded: false,
		hovered: false,
		hoverLine: -1,
	};
	rebuildRuntimeErrorOverlayView(overlay);
	setActiveRuntimeErrorOverlay(overlay);
	setExecutionStopHighlight(processedLine !== null ? targetRow : null);
	const statusLine = overlay.lines.length > 0 ? overlay.lines[0] : 'Runtime error';
	ide_state.showMessage(statusLine, constants.COLOR_STATUS_ERROR, 8.0);
}

export function focusChunkSource(chunkName: string | null, hint?: { assetId: string | null; path?: string | null }): void {
	if (!ide_state.active) {
		activate();
	}
	closeSymbolSearch(true);
	if (hint && typeof hint.assetId === 'string' && hint.assetId.length > 0) {
		const preferredPath = (typeof hint.path === 'string' && hint.path.length > 0) ? hint.path : null;
		focusResourceByAsset(hint.assetId, preferredPath);
		return;
	}
	if (hint && hint.assetId === null) {
		activateCodeTab();
		return;
	}
	const normalizedChunk = normalizeChunkName(chunkName);
	const descriptor = findResourceDescriptorForChunk(normalizedChunk);
	openResourceDescriptor(descriptor);
}

export function focusResourceByAsset(assetId: string, preferredPath?: string | null): void {
	if (typeof assetId !== 'string' || assetId.length === 0) {
		throw new Error('[ConsoleCartEditor] Invalid asset id for runtime error highlight.');
	}
	const descriptors = listResourcesStrict();
	const match = descriptors.find(entry => entry.assetId === assetId);
	const normalizedPreferred = normalizeResourcePath(preferredPath);
	if (match) {
		const effectivePath = normalizedPreferred ? normalizedPreferred : match.path;
		openResourceDescriptor({ ...match, path: effectivePath });
		return;
	}
	if (!normalizedPreferred) {
		throw new Error(`[ConsoleCartEditor] No resource found for asset '${assetId}'.`);
	}
	openResourceDescriptor({ path: normalizedPreferred, type: 'lua', assetId });
}

export function normalizeChunkName(name: string | null): string {
	if (typeof name !== 'string' || name.trim().length === 0) {
		throw new Error('[ConsoleCartEditor] Chunk name unavailable for runtime error.');
	}
	let normalized = name.trim();
	if (normalized.startsWith('@')) {
		normalized = normalized.slice(1);
	}
	normalized = normalized.replace(/\\/g, '/');
	if (normalized.length === 0) {
		throw new Error('[ConsoleCartEditor] Normalized chunk name is empty.');
	}
	return normalized;
}

export function normalizeResourcePath(path?: string | null): string | undefined {
	if (path === null || path === undefined) {
		return undefined;
	}
	const normalized = path.replace(/\\/g, '/');
	return normalized.length > 0 ? normalized : undefined;
}

export function findCodeTabContext(assetId: string | null, chunkName: string | null): CodeTabContext | null {
	const normalizedChunk = normalizeChunkReference(chunkName);
	for (const context of ide_state.codeTabContexts.values()) {
		const descriptor = context.descriptor;
		if (assetId && descriptor && descriptor.assetId === assetId) {
			return context;
		}
		if (!assetId && normalizedChunk && descriptor) {
			const descriptorPath = normalizeChunkReference(descriptor.path);
			if (descriptorPath && descriptorPath === normalizedChunk) {
				return context;
			}
		}
	}
	if (!ide_state.entryTabId) {
		return null;
	}
	const entryContext = ide_state.codeTabContexts.get(ide_state.entryTabId) ?? null;
	if (!entryContext) {
		return null;
	}
	if (assetId !== null) {
		return null;
	}
	if (!normalizedChunk) {
		return entryContext;
	}
	const entryDescriptor = entryContext.descriptor;
	if (!entryDescriptor) {
		return entryContext;
	}
	const entryPath = normalizeChunkReference(entryDescriptor.path);
	if (entryPath && entryPath === normalizedChunk) {
		return entryContext;
	}
	return null;
}

export function normalizeChunkReference(reference: string | null): string | null {
	if (!reference) {
		return null;
	}
	let normalized = reference;
	if (normalized.startsWith('@')) {
		normalized = normalized.slice(1);
	}
	return normalized.replace(/\\/g, '/');
}

export function resolveResourceDescriptorForSource(assetId: string | null, chunkName: string | null): ConsoleResourceDescriptor | null {
	if (typeof assetId === 'string' && assetId.length > 0) {
		const byAsset = findResourceDescriptorByAssetId(assetId);
		if (byAsset) {
			return byAsset;
		}
	}
	const normalizedChunk = normalizeChunkReference(chunkName);
	if (!normalizedChunk) {
		return null;
	}
	try {
		return findResourceDescriptorForChunk(normalizedChunk);
	} catch {
		return null;
	}
}


export function listResourcesStrict(): ConsoleResourceDescriptor[] {
	const descriptors = ide_state.listResourcesFn();
	if (!Array.isArray(descriptors)) {
		throw new Error('[ConsoleCartEditor] Resource enumeration returned an invalid result.');
	}
	return descriptors;
}

export function findResourceDescriptorByAssetId(assetId: string): ConsoleResourceDescriptor | null {
	const descriptors = listResourcesStrict();
	const match = descriptors.find(entry => entry.assetId === assetId);
	return match ?? null;
}

export function findResourceDescriptorForChunk(chunkPath: string): ConsoleResourceDescriptor {
	const descriptors = listResourcesStrict();
	const normalizedTarget = chunkPath.replace(/\\/g, '/');
	const exact = descriptors.find(entry => entry.path.replace(/\\/g, '/') === normalizedTarget);
	if (exact) {
		return exact;
	}
	const segments = normalizedTarget.split('/');
	const basename = segments.length > 0 ? segments[segments.length - 1] : normalizedTarget;
	const withoutExt = basename.endsWith('.lua') ? basename.slice(0, -4) : basename;
	const byAssetId = descriptors.find(entry => entry.assetId === basename || entry.assetId === withoutExt);
	if (byAssetId) {
		return byAssetId;
	}
	throw new Error(`[ConsoleCartEditor] Unable to resolve chunk '${normalizedTarget}' to a resource.`);
}

// resourceDescriptorMatchesFilter removed; controller owns filtering

export function openResourceDescriptor(descriptor: ConsoleResourceDescriptor): void {
	selectResourceInPanel(descriptor);
	if (descriptor.type === 'atlas') {
		ide_state.showMessage('Atlas resources cannot be previewed in the console editor.', constants.COLOR_STATUS_WARNING, 3.2);
		focusEditorFromResourcePanel();
		return;
	}
	if (descriptor.type === 'lua') {
		openLuaCodeTab(descriptor);
	} else {
		openResourceViewerTab(descriptor);
	}
	focusEditorFromResourcePanel();
}

export function clearRuntimeErrorOverlay(): void {
	setActiveRuntimeErrorOverlay(null);
}

// Clear overlays and stop highlights across all open code ide_state.tabs, not just the
// currently ide_state.active one. Useful when resuming after a runtime error where the
// editor may have switched ide_state.tabs to the faulting chunk.
export function clearAllRuntimeErrorOverlays(): void {
	ide_state.runtimeErrorOverlay = null;
	for (const context of ide_state.codeTabContexts.values()) {
		context.runtimeErrorOverlay = null;
	}
	clearExecutionStopHighlights();
}

export function setActiveRuntimeErrorOverlay(overlay: RuntimeErrorOverlay | null): void {
	ide_state.runtimeErrorOverlay = overlay;
	const context = getActiveCodeTabContext();
	if (context) {
		context.runtimeErrorOverlay = overlay;
	}
}

export function setExecutionStopHighlight(row: number | null): void {
	const context = getActiveCodeTabContext();
	if (!context) {
		ide_state.executionStopRow = null;
		return;
	}
	let nextRow = row;
	if (nextRow !== null) {
		const maxRow = Math.max(0, ide_state.lines.length - 1);
		nextRow = clamp(nextRow, 0, maxRow);
	}
	context.executionStopRow = nextRow;
	ide_state.executionStopRow = nextRow;
}

export function clearExecutionStopHighlights(): void {
	ide_state.executionStopRow = null;
	for (const context of ide_state.codeTabContexts.values()) {
		context.executionStopRow = null;
	}
}

export function syncRuntimeErrorOverlayFromContext(context: CodeTabContext | null): void {
	ide_state.runtimeErrorOverlay = context ? context.runtimeErrorOverlay ?? null : null;
	ide_state.executionStopRow = context ? context.executionStopRow ?? null : null;
}

export function getBuiltinIdentifierSet(): ReadonlySet<string> {
	try {
		const descriptors = ide_state.listBuiltinLuaFunctionsFn();
		const names: string[] = [];
		for (let index = 0; index < descriptors.length; index += 1) {
			const descriptor = descriptors[index];
			if (!descriptor || typeof descriptor.name !== 'string') {
				continue;
			}
			const trimmed = descriptor.name.trim();
			if (trimmed.length === 0) {
				continue;
			}
			names.push(trimmed);
		}
		names.sort((a, b) => a.localeCompare(b));
		const key = names.join('\u0000');
		const cached = ide_state.builtinIdentifierCache;
		if (cached && cached.key === key) {
			return cached.set;
		}
		const set = new Set<string>();
		for (let i = 0; i < names.length; i += 1) {
			const name = names[i];
			set.add(name);
			set.add(name.toLowerCase());
		}
		const entry = { key, set };
		ide_state.builtinIdentifierCache = entry;
		return entry.set;
	} catch (error) {
		if (ide_state.builtinIdentifierCache) {
			return ide_state.builtinIdentifierCache.set;
		}
		const fallback = new Set<string>();
		ide_state.builtinIdentifierCache = { key: '', set: fallback };
		return fallback;
	}
}

export function buildRuntimeErrorLines(message: string): string[] {
	const maxWidth = computeRuntimeErrorOverlayMaxWidth(ide_state.viewportWidth, ide_state.charAdvance, ide_state.gutterWidth);
	return buildRuntimeErrorLinesUtil(message, maxWidth, (text) => measureText(text));
}

export function getTabBarTotalHeight(): number {
	return ide_state.tabBarHeight * Math.max(1, ide_state.tabBarRowCount);
}

export function topMargin(): number {
	return ide_state.headerHeight + getTabBarTotalHeight() + 2;
}

export function statusAreaHeight(): number {
	if (!ide_state.message.visible) {
		return ide_state.baseBottomMargin;
	}
	const segments = getStatusMessageLines();
	const lineCount = Math.max(1, segments.length);
	return ide_state.baseBottomMargin + lineCount * ide_state.lineHeight + 4;
}

export function bottomMargin(): number {
	return statusAreaHeight() + getVisibleProblemsPanelHeight();
}

export function getVisibleProblemsPanelHeight(): number {
	if (!ide_state.problemsPanel.isVisible()) {
		return 0;
	}
	const planned = ide_state.problemsPanel.getVisibleHeight();
	if (planned <= 0) {
		return 0;
	}
	const statusHeight = statusAreaHeight();
	const maxAvailable = Math.max(0, ide_state.viewportHeight - statusHeight - (ide_state.headerHeight + getTabBarTotalHeight()));
	if (maxAvailable <= 0) {
		return 0;
	}
	return Math.min(planned, maxAvailable);
}

export function getStatusMessageLines(): string[] {
	if (!ide_state.message.visible) {
		return [];
	}
	const sanitized = ide_state.message.text.length > 0
		? ide_state.message.text.replace(/\r\n/g, '\n').replace(/\r/g, '\n')
		: '';
	const rawLines = sanitized.length > 0 ? sanitized.split('\n') : [''];
	const maxWidth = Math.max(ide_state.viewportWidth - 8, ide_state.charAdvance);
	const localLines: string[] = [];
	for (let i = 0; i < rawLines.length; i += 1) {
		const wrapped = wrapRuntimeErrorLineUtil(rawLines[i], maxWidth, (text) => measureText(text));
		for (let j = 0; j < wrapped.length; j += 1) {
			localLines.push(wrapped[j]);
		}
	}
	return localLines.length > 0 ? localLines : [''];
}

export function tryShowLuaErrorOverlay(error: unknown): boolean {
	let candidate: { line?: unknown; column?: unknown; chunkName?: unknown; message?: unknown };
	if (typeof error === 'string') {
		candidate = { message: error };
	} else if (error && typeof error === 'object') {
		candidate = error as { line?: unknown; column?: unknown; chunkName?: unknown; message?: unknown };
	} else {
		throw new Error('[ConsoleCartEditor] Lua error payload is neither an object nor a string.');
	}
	const rawLine = typeof candidate.line === 'number' && Number.isFinite(candidate.line) ? candidate.line : null;
	const rawColumn = typeof candidate.column === 'number' && Number.isFinite(candidate.column) ? candidate.column : null;
	const chunkName = typeof candidate.chunkName === 'string' && candidate.chunkName.length > 0 ? candidate.chunkName : null;
	const messageText = typeof candidate.message === 'string' && candidate.message.length > 0 ? candidate.message : null;
	const hasLine = rawLine !== null && rawLine > 0;
	const hasColumn = rawColumn !== null && rawColumn > 0;
	if (!hasLine && !hasColumn) {
		if (messageText) {
			ide_state.showMessage(messageText, constants.COLOR_STATUS_ERROR, 4.0);
			return true;
		}
		return false;
	}
	const safeLine = hasLine ? Math.max(1, Math.floor(rawLine!)) : 0;
	const safeColumn = hasColumn ? Math.max(1, Math.floor(rawColumn!)) : 0;
	const baseMessage = messageText ?? 'Lua error';
	showRuntimeErrorInChunk(chunkName, safeLine, safeColumn, baseMessage);
	return true;
}

export function safeInspectLuaExpression(request: ConsoleLuaHoverRequest): ConsoleLuaHoverResult | null {
	ide_state.inspectorRequestFailed = false;
	try {
		return ide_state.inspectLuaExpressionFn(request);
	} catch (error) {
		ide_state.inspectorRequestFailed = true;
		const handled = tryShowLuaErrorOverlay(error);
		if (!handled) {
			const message = error instanceof Error ? error.message : String(error);
			ide_state.showMessage(message, constants.COLOR_STATUS_ERROR, 3.2);
		}
		return null;
	}
}

export function update(deltaSeconds: number): void {
	refreshViewportDimensions();
	const keyboard = getKeyboard();
	flushWindowFocusState(keyboard);
	ide_state.updateMessage(deltaSeconds);
	updateRuntimeErrorOverlay(deltaSeconds);
	if (handleToggleRequest(keyboard)) {
		return;
	}
	if (!ide_state.active) {
		return;
	}
	updateBlink(deltaSeconds);
	handlePointerWheel();
	handlePointerInput(deltaSeconds);
	if (ide_state.pendingActionPrompt) {
		handleActionPromptInput(keyboard);
		return;
	}
	handleEditorInput(keyboard, deltaSeconds);
	ide_state.completion.processPending(deltaSeconds);
	const semanticError = ide_state.layout.getLastSemanticError();
	if (semanticError && semanticError !== ide_state.lastReportedSemanticError) {
		ide_state.showMessage(semanticError, constants.COLOR_STATUS_ERROR, 4.0);
		ide_state.lastReportedSemanticError = semanticError;
	} else if (!semanticError && ide_state.lastReportedSemanticError !== null) {
		ide_state.lastReportedSemanticError = null;
	}
	if (ide_state.diagnosticsDirty) {
		processDiagnosticsQueue(ide_state.clockNow());
	}
	if (isCodeTabActive() && !ide_state.cursorRevealSuspended) {
		ensureCursorVisible();
	}
}

export function processDiagnosticsQueue(now: number): void {
	if (!ide_state.diagnosticsDirty) {
		return;
	}
	if (ide_state.dirtyDiagnosticContexts.size === 0) {
		ide_state.diagnosticsDirty = false;
		ide_state.diagnosticsDueAtMs = null;
		return;
	}
	if (ide_state.diagnosticsDueAtMs === null) {
		ide_state.diagnosticsDueAtMs = now + diagnosticsDebounceMs;
		return;
	}
	if (now < ide_state.diagnosticsDueAtMs) {
		return;
	}
	scheduleDiagnosticsComputation();
}

export function scheduleDiagnosticsComputation(): void {
	if (ide_state.diagnosticsComputationScheduled) {
		return;
	}
	ide_state.diagnosticsComputationScheduled = true;
	scheduleNextFrame(() => {
		ide_state.diagnosticsComputationScheduled = false;
		executeDiagnosticsComputation();
	});
}

export function executeDiagnosticsComputation(): void {
	if (!ide_state.diagnosticsDirty) {
		ide_state.diagnosticsDueAtMs = null;
		return;
	}
	if (ide_state.dirtyDiagnosticContexts.size === 0) {
		ide_state.diagnosticsDirty = false;
		ide_state.diagnosticsDueAtMs = null;
		return;
	}
	if (ide_state.diagnosticsTaskPending) {
		return;
	}
	const now = ide_state.clockNow();
	if (ide_state.diagnosticsDueAtMs === null) {
		ide_state.diagnosticsDueAtMs = now + diagnosticsDebounceMs;
		scheduleDiagnosticsComputation();
		return;
	}
	if (now < ide_state.diagnosticsDueAtMs) {
		scheduleDiagnosticsComputation();
		return;
	}
	const batch = collectDiagnosticsBatch();
	if (batch.length === 0) {
		ide_state.diagnosticsDirty = false;
		ide_state.diagnosticsDueAtMs = null;
		return;
	}
	enqueueDiagnosticsJob(batch);
}

export function enqueueDiagnosticsJob(contextIds: readonly string[]): void {
	if (contextIds.length === 0) {
		return;
	}
	ide_state.diagnosticsTaskPending = true;
	const batch = [...contextIds];
	enqueueBackgroundTask(() => {
		runDiagnosticsForContexts(batch);
		ide_state.diagnosticsTaskPending = false;
		if (ide_state.dirtyDiagnosticContexts.size === 0) {
			ide_state.diagnosticsDirty = false;
			ide_state.diagnosticsDueAtMs = null;
		} else {
			const now = ide_state.clockNow();
			ide_state.diagnosticsDueAtMs = now + diagnosticsDebounceMs;
			scheduleDiagnosticsComputation();
		}
		return false;
	});
}

export function collectDiagnosticsBatch(): string[] {
	const batch: string[] = [];
	const activeId = ide_state.activeCodeTabContextId;
	if (activeId && ide_state.dirtyDiagnosticContexts.has(activeId)) {
		batch.push(activeId);
	}
	if (batch.length === 0) {
		const iterator = ide_state.dirtyDiagnosticContexts.values().next();
		if (!iterator.done) {
			batch.push(iterator.value);
		}
	}
	return batch;
}

export function runDiagnosticsForContexts(contextIds: readonly string[]): void {
	if (contextIds.length === 0) {
		return;
	}
	const providers = createDiagnosticProviders();
	const activeId = ide_state.activeCodeTabContextId;
	const inputs: DiagnosticContextInput[] = [];
	const metadata: Array<{ id: string; chunkName: string | null }> = [];
	for (let index = 0; index < contextIds.length; index += 1) {
		const contextId = contextIds[index];
		const context = ide_state.codeTabContexts.get(contextId);
		if (!context) {
			ide_state.diagnosticsCache.delete(contextId);
			ide_state.dirtyDiagnosticContexts.delete(contextId);
			continue;
		}
		const assetId = resolveHoverAssetId(context);
		const chunkName = resolveHoverChunkName(context);
		let source = '';
		if (activeId && contextId === activeId) {
			source = ide_state.lines.join('\n');
		} else {
			try {
				source = getSourceForChunk(assetId, chunkName);
			} catch {
				source = '';
			}
		}
		if (source.length === 0) {
			ide_state.diagnosticsCache.delete(contextId);
			ide_state.dirtyDiagnosticContexts.delete(contextId);
			continue;
		}
		inputs.push({
			id: context.id,
			title: context.title,
			descriptor: context.descriptor,
			assetId,
			chunkName,
			source,
		});
		metadata.push({ id: context.id, chunkName });
	}
	if (inputs.length === 0) {
		updateDiagnosticsAggregates();
		return;
	}
	const diagnostics = computeAggregatedEditorDiagnostics(inputs, providers);
	const byContext = new Map<string, EditorDiagnostic[]>();
	for (let index = 0; index < diagnostics.length; index += 1) {
		const diag = diagnostics[index];
		const key = diag.contextId ?? '';
		let bucket = byContext.get(key);
		if (!bucket) {
			bucket = [];
			byContext.set(key, bucket);
		}
		bucket.push(diag);
	}
	for (let index = 0; index < metadata.length; index += 1) {
		const meta = metadata[index];
		const diagList = byContext.get(meta.id) ?? [];
		ide_state.diagnosticsCache.set(meta.id, {
			contextId: meta.id,
			chunkName: meta.chunkName,
			diagnostics: diagList,
		});
		ide_state.dirtyDiagnosticContexts.delete(meta.id);
	}
	updateDiagnosticsAggregates();
}

export function createDiagnosticProviders(): DiagnosticProviders {
	return {
		listLocalSymbols: (assetId, chunk) => {
			try {
				return ide_state.listLuaSymbolsFn(assetId, chunk);
			} catch {
				return [];
			}
		},
		listGlobalSymbols: () => {
			try {
				return ide_state.listGlobalLuaSymbolsFn();
			} catch {
				return [];
			}
		},
		listBuiltins: () => {
			try {
				return ide_state.listBuiltinLuaFunctionsFn();
			} catch {
				return [];
			}
		},
	};
}

export function updateDiagnosticsAggregates(): void {
	const aggregate: EditorDiagnostic[] = [];
	for (const context of ide_state.codeTabContexts.values()) {
		const entry = ide_state.diagnosticsCache.get(context.id);
		if (entry) {
			for (let index = 0; index < entry.diagnostics.length; index += 1) {
				aggregate.push(entry.diagnostics[index]);
			}
		}
	}
	for (const [contextId, entry] of ide_state.diagnosticsCache) {
		if (ide_state.codeTabContexts.has(contextId)) {
			continue;
		}
		for (let index = 0; index < entry.diagnostics.length; index += 1) {
			aggregate.push(entry.diagnostics[index]);
		}
	}
	ide_state.diagnostics = aggregate;
	refreshActiveDiagnostics();
	ide_state.problemsPanel.setDiagnostics(ide_state.diagnostics);
}

export function refreshActiveDiagnostics(): void {
	ide_state.diagnosticsByRow.clear();
	const activeId = ide_state.activeCodeTabContextId;
	if (!activeId) {
		return;
	}
	const entry = ide_state.diagnosticsCache.get(activeId);
	if (!entry) {
		return;
	}
	for (let index = 0; index < entry.diagnostics.length; index += 1) {
		const diag = entry.diagnostics[index];
		let bucket = ide_state.diagnosticsByRow.get(diag.row);
		if (!bucket) {
			bucket = [];
			ide_state.diagnosticsByRow.set(diag.row, bucket);
		}
		bucket.push(diag);
	}
}

export function markDiagnosticsDirtyForChunk(chunkName: string): void {
	const context = findContextByChunk(chunkName);
	if (!context) {
		return;
	}
	markDiagnosticsDirty(context.id);
}

export function getActiveSemanticDefinitions(): readonly LuaDefinitionInfo[] | null {
	const context = getActiveCodeTabContext();
	const chunkName = resolveHoverChunkName(context) ?? '<console>';
	return ide_state.layout.getSemanticDefinitions(ide_state.lines, ide_state.textVersion, chunkName);
}

export function getLuaModuleAliases(chunkName: string | null): Map<string, string> {
	const activeContext = getActiveCodeTabContext();
	const targetChunk = chunkName ?? resolveHoverChunkName(activeContext) ?? '<console>';
	ide_state.layout.getSemanticDefinitions(ide_state.lines, ide_state.textVersion, targetChunk);
	const data = ide_state.semanticWorkspace.getFileData(targetChunk);
	if (!data || data.moduleAliases.length === 0) {
		return new Map();
	}
	const aliases = new Map<string, string>();
	for (let index = 0; index < data.moduleAliases.length; index += 1) {
		const entry = data.moduleAliases[index];
		aliases.set(entry.alias, entry.module);
	}
	return aliases;
}

export function findContextByChunk(chunkName: string): CodeTabContext | null {
	const normalized = normalizeChunkReference(chunkName) ?? chunkName;
	for (const context of ide_state.codeTabContexts.values()) {
		const descriptor = context.descriptor;
		if (descriptor) {
			const descriptorPath = normalizeChunkReference(descriptor.path);
			if ((descriptorPath && descriptorPath === normalized)
				|| descriptor.assetId === chunkName
				|| descriptor.assetId === normalized) {
				return context;
			}
			continue;
		}
		const aliases: string[] = [];
		if (ide_state.primaryAssetId) {
			aliases.push(ide_state.primaryAssetId);
		}
		aliases.push('__entry__', '<console>');
		for (let index = 0; index < aliases.length; index += 1) {
			const alias = aliases[index];
			if (alias === chunkName || alias === normalized) {
				return context;
			}
		}
	}
	return null;
}

export function getDiagnosticsForRow(row: number): readonly EditorDiagnostic[] {
	const bucket = ide_state.diagnosticsByRow.get(row);
	return bucket ?? EMPTY_DIAGNOSTICS;
}

export function isActive(): boolean {
	return ide_state.active;
}

export function draw(api: BmsxConsoleApi): void {
	refreshViewportDimensions();
	if (!ide_state.active) {
		return;
	}
	ide_state.codeVerticalScrollbarVisible = false;
	ide_state.codeHorizontalScrollbarVisible = false;
	const frameColor = Msx1Colors[constants.COLOR_FRAME];
	api.rectfill_color(0, 0, ide_state.viewportWidth, ide_state.viewportHeight, { r: frameColor.r, g: frameColor.g, b: frameColor.b, a: frameColor.a });
	drawTopBar(api);
	ide_state.tabBarRowCount = renderTabBar(api, {
		viewportWidth: ide_state.viewportWidth,
		headerHeight: ide_state.headerHeight,
		rowHeight: ide_state.tabBarHeight,
		lineHeight: ide_state.lineHeight,
		tabs: ide_state.tabs,
		activeTabId: ide_state.activeTabId,
		tabHoverId: ide_state.tabHoverId,
		measureText: (text: string) => measureText(text),
		drawText: (api2, text, x, y, color) => drawEditorText(api2, ide_state.font, text, x, y, color),
		getDirtyMarkerMetrics: () => getTabDirtyMarkerMetrics(),
		tabButtonBounds: ide_state.tabButtonBounds,
		tabCloseButtonBounds: ide_state.tabCloseButtonBounds,
	});
	drawResourcePanel(api);
	if (isResourceViewActive()) {
		drawResourceViewer(api);
	} else {
		hideResourceViewerSprite(api);
		drawCreateResourceBar(api);
		drawSearchBar(api);
		drawResourceSearchBar(api);
		drawSymbolSearchBar(api);
		drawRenameBar(api);
		drawLineJumpBar(api);
		drawCodeArea(api);
	}
	drawProblemsPanel(api);
	drawStatusBar(api);
	if (ide_state.pendingActionPrompt) {
		drawActionPromptOverlay(api);
	}
}

export function getSourceForChunk(assetId: string | null, chunkName: string | null): string {
	const context = findCodeTabContext(assetId, chunkName);
	if (context) {
		if (context.id === ide_state.activeCodeTabContextId) {
			return ide_state.lines.join('\n');
		}
		if (context.snapshot) {
			return context.snapshot.lines.join('\n');
		}
		if (context.lastSavedSource.length > 0) {
			return context.lastSavedSource;
		}
		return context.load();
	}
	const descriptor = resolveResourceDescriptorForSource(assetId, chunkName);
	if (descriptor) {
		return ide_state.loadLuaResourceFn(descriptor.assetId);
	}
	throw new Error(`[ConsoleCartEditor] Unable to locate source for asset '${assetId ?? '<null>'}' and chunk '${chunkName ?? '<null>'}'.`);
}

export function getTabDirtyMarkerMetrics(): { width: number; height: number } {
	return { width: 4, height: 4 };
}

export function refreshViewportDimensions(force = false): void {
	const view = $.view;
	if (!view) {
		throw new Error('[ConsoleCartEditor] Game view unavailable during editor frame.');
	}
	const renderSize = ide_state.resolutionMode === 'offscreen' ? view.offscreenCanvasSize : view.viewportSize;
	if (!Number.isFinite(renderSize.x) || !Number.isFinite(renderSize.y) || renderSize.x <= 0 || renderSize.y <= 0) {
		throw new Error('[ConsoleCartEditor] Invalid render dimensions.');
	}
	const width = renderSize.x;
	const height = renderSize.y;
	if (!force && width === ide_state.viewportWidth && height === ide_state.viewportHeight) {
		return;
	}
	ide_state.viewportWidth = width;
	ide_state.viewportHeight = height;
	invalidateVisualLines();
	if (ide_state.resourcePanelWidthRatio !== null) {
		ide_state.resourcePanelWidthRatio = clampResourcePanelRatio(ide_state.resourcePanelWidthRatio);
		if (ide_state.resourcePanelVisible && computePanelPixelWidth(ide_state.resourcePanelWidthRatio) <= 0) {
			hideResourcePanel();
		}
	}
	if (ide_state.resourcePanelVisible) {
		resourceBrowserEnsureSelectionVisible();
	}
}

export function initializeTabs(entryContext: CodeTabContext | null = null): void {
	ide_state.tabs = [];
	ide_state.tabHoverId = null;
	ide_state.tabDragState = null;
	ide_state.tabButtonBounds.clear();
	ide_state.tabCloseButtonBounds.clear();
	if (entryContext) {
		ide_state.tabs.push({
			id: entryContext.id,
			kind: 'lua_editor',
			title: entryContext.title,
			closable: true,
			dirty: entryContext.dirty,
		});
		ide_state.activeTabId = entryContext.id;
		ide_state.activeCodeTabContextId = entryContext.id;
		return;
	}
	ide_state.activeTabId = null;
	ide_state.activeCodeTabContextId = null;
}

export function setTabDirty(tabId: string, dirty: boolean): void {
	const tab = ide_state.tabs.find(candidate => candidate.id === tabId);
	if (!tab) {
		return;
	}
	tab.dirty = dirty;
}

export function updateActiveContextDirtyFlag(): void {
	const context = getActiveCodeTabContext();
	if (!context) {
		return;
	}
	context.dirty = ide_state.dirty;
	setTabDirty(context.id, context.dirty);
}

export function getActiveTabKind(): EditorTabKind {
	if (!ide_state.activeTabId) {
		return 'lua_editor';
	}
	const active = ide_state.tabs.find(tab => tab.id === ide_state.activeTabId) ?? null;
	if (active) {
		return active.kind;
	}
	if (ide_state.tabs.length > 0) {
		const first = ide_state.tabs[0];
		ide_state.activeTabId = first.id;
		return first.kind;
	}
	ide_state.activeTabId = null;
	return 'lua_editor';
}

export function getActiveResourceViewer(): ResourceViewerState | null {
	const tab = ide_state.tabs.find(candidate => candidate.id === ide_state.activeTabId);
	if (!tab) {
		return null;
	}
	if (tab.kind !== 'resource_view' || !tab.resource) {
		return null;
	}
	return tab.resource;
}

export function serializeState(): ConsoleEditorSerializedState { // NOTE: UNUSED AS WE DON'T SAVE EDITOR STATE ANYMORE
	const snapshot = captureSnapshot();
	const messageSnapshot: MessageState = {
		text: ide_state.message.text,
		color: ide_state.message.color,
		timer: ide_state.message.timer,
		visible: ide_state.message.visible,
	};
	return {
		active: ide_state.active,
		activeTab: getActiveTabKind(),
		snapshot,
		searchQuery: ide_state.searchQuery,
		searchMatches: ide_state.searchMatches.map(match => ({ row: match.row, start: match.start, end: match.end })),
		searchCurrentIndex: ide_state.searchCurrentIndex,
		searchActive: ide_state.searchActive,
		searchVisible: ide_state.searchVisible,
		lineJumpValue: ide_state.lineJumpValue,
		lineJumpActive: ide_state.lineJumpActive,
		lineJumpVisible: ide_state.lineJumpVisible,
		message: messageSnapshot,
		runtimeErrorOverlay: null,
		saveGeneration: ide_state.saveGeneration,
		appliedGeneration: ide_state.appliedGeneration,
	};
}

export function restoreState(state: ConsoleEditorSerializedState): void { // NOTE: UNUSED AS WE DON'T SAVE EDITOR STATE ANYMORE
	if (!state) return;
	ide_state.input.applyOverrides(false, captureKeys);
	$.input.setKeyboardCapture(EDITOR_TOGGLE_KEY, true);
	ide_state.codeTabContexts.clear();
	const entryContext = createEntryTabContext();
	if (entryContext) {
		ide_state.entryTabId = entryContext.id;
		ide_state.codeTabContexts.set(entryContext.id, entryContext);
		ide_state.activeCodeTabContextId = entryContext.id;
	}
	else {
		ide_state.activeCodeTabContextId = null;
	}
	initializeTabs(entryContext);
	resetResourcePanelState();
	hideResourcePanel();
	ide_state.active = state.active;
	const restoredKind = state.activeTab ?? 'lua_editor';
	if (restoredKind === 'resource_view') {
		const activeResourceTab = ide_state.tabs.find(tab => tab.kind === 'resource_view');
		if (activeResourceTab) {
			setActiveTab(activeResourceTab.id);
		}
	} else {
		activateCodeTab();
	}
	if (ide_state.active) {
		ide_state.input.applyOverrides(true, captureKeys);
	}
	restoreSnapshot(state.snapshot);
	applySearchFieldText(state.searchQuery, true);
	ide_state.searchScope = 'local';
	ide_state.searchDisplayOffset = 0;
	ide_state.searchHoverIndex = -1;
	ide_state.globalSearchMatches = [];
	ide_state.searchMatches = state.searchMatches.map(match => ({ row: match.row, start: match.start, end: match.end }));
	ide_state.searchCurrentIndex = state.searchCurrentIndex;
	ide_state.searchActive = state.searchActive;
	ide_state.searchVisible = state.searchVisible;
	applyLineJumpFieldText(state.lineJumpValue, true);
	ide_state.lineJumpActive = state.lineJumpActive;
	ide_state.lineJumpVisible = state.lineJumpVisible;
	ide_state.message.text = state.message.text;
	ide_state.message.color = state.message.color;
	ide_state.message.timer = state.message.timer;
	ide_state.message.visible = state.message.visible;
	setActiveRuntimeErrorOverlay(null);
	ide_state.pointerSelecting = false;
	ide_state.pointerPrimaryWasPressed = false;
	clearGotoHoverHighlight();
	ide_state.cursorRevealSuspended = false;
	ide_state.repeatState.clear();
	resetKeyPressGuards();
	breakUndoSequence();
	ide_state.saveGeneration = Number.isFinite(state.saveGeneration) ? Math.max(0, Math.floor(state.saveGeneration)) : 0;
	ide_state.appliedGeneration = Number.isFinite(state.appliedGeneration) ? Math.max(0, Math.floor(state.appliedGeneration)) : 0;
	resetActionPromptState();
	const activeContext = getActiveCodeTabContext();
	const entryContextRef = ide_state.entryTabId ? ide_state.codeTabContexts.get(ide_state.entryTabId) ?? null : null;
	if (activeContext) {
		activeContext.lastSavedSource = ide_state.lines.join('\n');
		activeContext.dirty = ide_state.dirty;
		setTabDirty(activeContext.id, activeContext.dirty);
	}
	if (entryContextRef) {
		if (activeContext && activeContext.id === entryContextRef.id) {
			entryContextRef.lastSavedSource = ide_state.lines.join('\n');
		}
		ide_state.lastSavedSource = entryContextRef.lastSavedSource;
	} else {
		ide_state.lastSavedSource = '';
	}
}

export function shutdown(): void {
	clearExecutionStopHighlights();
	storeActiveCodeTabContext();
	ide_state.input.applyOverrides(false, captureKeys);
	ide_state.active = false;
	if (ide_state.disposeVisibilityListener) {
		ide_state.disposeVisibilityListener();
		ide_state.disposeVisibilityListener = null;
	}
	if (ide_state.disposeWindowEventListeners) {
		ide_state.disposeWindowEventListeners();
		ide_state.disposeWindowEventListeners = null;
	}
	ide_state.windowFocused = true;
	ide_state.pendingWindowFocused = true;
	ide_state.repeatState.clear();
	resetKeyPressGuards();
	ide_state.pointerSelecting = false;
	ide_state.pointerPrimaryWasPressed = false;
	ide_state.pointerAuxWasPressed = false;
	clearGotoHoverHighlight();
	ide_state.cursorRevealSuspended = false;
	ide_state.searchActive = false;
	ide_state.searchVisible = false;
	cancelSearchJob();
	cancelGlobalSearchJob();
	ide_state.searchMatches = [];
	ide_state.globalSearchMatches = [];
	ide_state.searchDisplayOffset = 0;
	ide_state.searchHoverIndex = -1;
	ide_state.searchScope = 'local';
	ide_state.searchCurrentIndex = -1;
	applySearchFieldText('', true);
	ide_state.lineJumpActive = false;
	ide_state.lineJumpVisible = false;
	applyLineJumpFieldText('', true);
	ide_state.createResourceActive = false;
	ide_state.createResourceVisible = false;
	applyCreateResourceFieldText('', true);
	ide_state.createResourceError = null;
	ide_state.createResourceWorking = false;
	resetActionPromptState();
	hideResourcePanel();
	activateCodeTab();
}

export function getKeyboard(): KeyboardInput {
	const playerInput = $.input.getPlayerInput(ide_state.playerIndex);
	if (!playerInput) {
		throw new Error(`[ConsoleCartEditor] Player ide_state.input ${ide_state.playerIndex} unavailable.`);
	}
	const handler = playerInput.inputHandlers['keyboard'];
	if (!handler) {
		throw new Error(`[ConsoleCartEditor] Keyboard handler missing for player ${ide_state.playerIndex}.`);
	}
	const candidate = handler as KeyboardInput;
	if (typeof candidate.keydown !== 'function') {
		throw new Error(`[ConsoleCartEditor] Keyboard handler for player ${ide_state.playerIndex} is invalid.`);
	}
	return candidate;
}

export function handleToggleRequest(keyboard: KeyboardInput): boolean {
	const escapeState = getKeyboardButtonState(ide_state.playerIndex, ESCAPE_KEY);
	if (escapeState && escapeState.pressed === true) {
		if (shouldAcceptKeyPressGlobal(ESCAPE_KEY, escapeState)) {
			const handled = handleEscapeKey();
			if (handled) {
				consumeKeyboardKey(keyboard, ESCAPE_KEY);
				return true;
			}
		}
	}

	const toggleKeyState = getKeyboardButtonState(ide_state.playerIndex, EDITOR_TOGGLE_KEY);
	const selectButton = EDITOR_TOGGLE_GAMEPAD_BUTTONS[0];
	const startButton = EDITOR_TOGGLE_GAMEPAD_BUTTONS[1];
	const playerInput = $.input.getPlayerInput(ide_state.playerIndex);
	const selectState = playerInput ? playerInput.getButtonState(selectButton, 'gamepad') : null;
	const startState = playerInput ? playerInput.getButtonState(startButton, 'gamepad') : null;
	const keyboardPressed = toggleKeyState ? toggleKeyState.pressed === true : false;
	const selectPressed = selectState ? selectState.pressed === true : false;
	const startPressed = startState ? startState.pressed === true : false;
	const gamepadPressed = selectPressed && startPressed;
	if (!keyboardPressed && !gamepadPressed) {
		ide_state.toggleInputLatch = false;
		return false;
	}
	if (ide_state.toggleInputLatch) {
		return false;
	}
	const keyboardAccepted = toggleKeyState ? shouldAcceptKeyPressGlobal(EDITOR_TOGGLE_KEY, toggleKeyState) : false;
	let gamepadAccepted = false;
	if (gamepadPressed) {
		const selectAccepted = selectState ? shouldAcceptKeyPressGlobal(selectButton, selectState) : false;
		const startAccepted = startState ? shouldAcceptKeyPressGlobal(startButton, startState) : false;
		gamepadAccepted = selectAccepted || startAccepted;
	}
	if (!keyboardAccepted && !gamepadAccepted) {
		return false;
	}
	ide_state.toggleInputLatch = true;
	const intercepted = handleEscapeKey();
	if (keyboardAccepted) {
		consumeKeyboardKey(keyboard, EDITOR_TOGGLE_KEY);
	}
	if (gamepadAccepted && playerInput && playerInput.inputHandlers['gamepad']) {
		const handler = playerInput.inputHandlers['gamepad'];
		handler.consumeButton(selectButton);
		handler.consumeButton(startButton);
	}
	if (intercepted) {
		return true;
	}
	if (ide_state.active) {
		if (ide_state.dirty) {
			openActionPrompt('close');
		} else {
			deactivate();
		}
	} else {
		activate();
	}
	return true;
}

export function handleEscapeKey(): boolean {
	if (ide_state.pendingActionPrompt) {
		resetActionPromptState();
		return true;
	}
	if (ide_state.runtimeErrorOverlay) {
		clearRuntimeErrorOverlay();
		ide_state.message.visible = false;
		return true;
	}
	if (ide_state.createResourceVisible) {
		closeCreateResourcePrompt(true);
		return true;
	}
	if (ide_state.symbolSearchActive || ide_state.symbolSearchVisible) {
		closeSymbolSearch(false);
		return true;
	}
	if (ide_state.resourceSearchActive || ide_state.resourceSearchVisible) {
		closeResourceSearch(false);
		return true;
	}
	if (ide_state.lineJumpActive || ide_state.lineJumpVisible) {
		closeLineJump(false);
		return true;
	}
	if (ide_state.searchActive || ide_state.searchVisible) {
		closeSearch(false, true);
		return true;
	}
	return false;
}

export function activate(): void {
	if (!ide_state.disposeVisibilityListener) {
		installPlatformVisibilityListener();
	}
	if (!ide_state.disposeWindowEventListeners) {
		installWindowEventListeners();
	}
	ide_state.input.applyOverrides(true, captureKeys);
	applyResolutionModeToRuntime();
	if (ide_state.activeCodeTabContextId) {
		const existingTab = ide_state.tabs.find(candidate => candidate.id === ide_state.activeCodeTabContextId);
		if (existingTab) {
			setActiveTab(ide_state.activeCodeTabContextId);
		} else {
			activateCodeTab();
		}
	} else {
		activateCodeTab();
	}
	bumpTextVersion();
	ide_state.cursorVisible = true;
	ide_state.blinkTimer = 0;
	ide_state.active = true;
	ide_state.pointerSelecting = false;
	ide_state.pointerPrimaryWasPressed = false;
	ide_state.cursorRevealSuspended = false;
	ide_state.repeatState.clear();
	resetKeyPressGuards();
	updateDesiredColumn();
	ide_state.selectionAnchor = null;
	ide_state.undoStack = [];
	ide_state.redoStack = [];
	ide_state.lastHistoryKey = null;
	ide_state.lastHistoryTimestamp = 0;
	ide_state.searchActive = false;
	ide_state.searchVisible = false;
	ide_state.lineJumpActive = false;
	ide_state.lineJumpVisible = false;
	ide_state.lineJumpValue = '';
	syncRuntimeErrorOverlayFromContext(getActiveCodeTabContext());
	resetActionPromptState();
	cancelSearchJob();
	cancelGlobalSearchJob();
	ide_state.globalSearchMatches = [];
	ide_state.searchDisplayOffset = 0;
	ide_state.searchHoverIndex = -1;
	ide_state.searchScope = 'local';
	if (ide_state.searchQuery.length === 0) {
		ide_state.searchMatches = [];
		ide_state.searchCurrentIndex = -1;
	} else {
		startSearchJob();
	}
	ensureCursorVisible();
	if (ide_state.message.visible && !Number.isFinite(ide_state.message.timer) && ide_state.deferredMessageDuration !== null) {
		ide_state.message.timer = ide_state.deferredMessageDuration;
	}
	ide_state.deferredMessageDuration = null;
	if (ide_state.dimCrtInEditor) {
		applyEditorCrtDimming();
	}
}

export function applyEditorCrtDimming(): void {
	const view = $.view;
	const [bleedR, bleedG, bleedB] = view.colorBleed;
	const [glowR, glowG, glowB] = view.glowColor;
	ide_state.crtOptionsSnapshot = {
		noiseIntensity: view.noiseIntensity,
		colorBleed: [bleedR, bleedG, bleedB] as [number, number, number],
		blurIntensity: view.blurIntensity,
		glowColor: [glowR, glowG, glowB] as [number, number, number],
	};
	let snapshot = ide_state.crtOptionsSnapshot;
	view.noiseIntensity = snapshot.noiseIntensity * 0.5;
	view.colorBleed = [
		snapshot.colorBleed[0] * 0.5,
		snapshot.colorBleed[1] * 0.5,
		snapshot.colorBleed[2] * 0.5,
	] as [number, number, number];
	view.blurIntensity = snapshot.blurIntensity * 0.5;
	view.glowColor = [
		snapshot.glowColor[0] * 0.5,
		snapshot.glowColor[1] * 0.5,
		snapshot.glowColor[2] * 0.5,
	] as [number, number, number];
}

export function restoreCrtOptions(): void {
	const snapshot = ide_state.crtOptionsSnapshot;
	if (!snapshot) {
		throw new Error('[ConsoleCartEditor] CRT options snapshot unavailable during restore.');
	}
	ide_state.crtOptionsSnapshot = null;
	const view = $.view;
	view.noiseIntensity = snapshot.noiseIntensity;
	view.colorBleed = [snapshot.colorBleed[0], snapshot.colorBleed[1], snapshot.colorBleed[2]] as [number, number, number];
	view.blurIntensity = snapshot.blurIntensity;
	view.glowColor = [snapshot.glowColor[0], snapshot.glowColor[1], snapshot.glowColor[2]] as [number, number, number];
}

export function deactivate(): void {
	storeActiveCodeTabContext();
	ide_state.active = false;
	if (ide_state.dimCrtInEditor) {
		restoreCrtOptions();
	}
	ide_state.completion.closeSession();
	ide_state.repeatState.clear();
	resetKeyPressGuards();
	ide_state.input.applyOverrides(false, captureKeys);
	$.input.setKeyboardCapture(EDITOR_TOGGLE_KEY, true);
	ide_state.selectionAnchor = null;
	ide_state.pointerSelecting = false;
	ide_state.pointerPrimaryWasPressed = false;
	ide_state.pointerAuxWasPressed = false;
	ide_state.tabDragState = null;
	clearGotoHoverHighlight();
	ide_state.scrollbarController.cancel();
	ide_state.cursorRevealSuspended = false;
	ide_state.undoStack = [];
	ide_state.redoStack = [];
	ide_state.lastHistoryKey = null;
	ide_state.lastHistoryTimestamp = 0;
	ide_state.searchActive = false;
	ide_state.searchVisible = false;
	ide_state.lineJumpActive = false;
	ide_state.lineJumpVisible = false;
	ide_state.runtimeErrorOverlay = null;
	resetActionPromptState();
	closeCreateResourcePrompt(false);
	hideResourcePanel();
	cancelSearchJob();
	cancelGlobalSearchJob();
	ide_state.globalSearchMatches = [];
	ide_state.searchDisplayOffset = 0;
	ide_state.searchHoverIndex = -1;
	ide_state.searchScope = 'local';
	clearBackgroundTasks();
	ide_state.diagnosticsTaskPending = false;
	ide_state.lastReportedSemanticError = null;
}

export function splitLines(source: string): string[] {
	return source.split(/\r?\n/);
}

export function handleActionPromptInput(keyboard: KeyboardInput): void {
	if (!ide_state.pendingActionPrompt) {
		return;
	}
	if (isKeyJustPressedGlobal(ide_state.playerIndex, 'Escape')) {
		consumeKeyboardKey(keyboard, 'Escape');
		resetActionPromptState();
		return;
	}
	if (isKeyJustPressedGlobal(ide_state.playerIndex, 'Enter')) {
		consumeKeyboardKey(keyboard, 'Enter');
		void handleActionPromptSelection('save-continue');
	}
}

export function handleEditorInput(keyboard: KeyboardInput, deltaSeconds: number): void {
	if (ide_state.resourcePanelVisible && ide_state.resourcePanelFocused) {
		ide_state.resourcePanel.handleKeyboard(keyboard, deltaSeconds);
		const st = ide_state.resourcePanel.getStateForRender();
		ide_state.resourcePanelFocused = st.focused;
		return;
	}
	if (isResourceViewActive()) {
		handleResourceViewerInput(keyboard, deltaSeconds);
		return;
	}
	const ctrlDown = isModifierPressedGlobal(ide_state.playerIndex, 'ControlLeft') || isModifierPressedGlobal(ide_state.playerIndex, 'ControlRight');
	const shiftDown = isModifierPressedGlobal(ide_state.playerIndex, 'ShiftLeft') || isModifierPressedGlobal(ide_state.playerIndex, 'ShiftRight');
	const metaDown = isModifierPressedGlobal(ide_state.playerIndex, 'MetaLeft') || isModifierPressedGlobal(ide_state.playerIndex, 'MetaRight');
	const altDown = isModifierPressedGlobal(ide_state.playerIndex, 'AltLeft') || isModifierPressedGlobal(ide_state.playerIndex, 'AltRight');

	if ((ctrlDown || metaDown) && shiftDown && isKeyJustPressedGlobal(ide_state.playerIndex, 'KeyO')) {
		consumeKeyboardKey(keyboard, 'KeyO');
		openSymbolSearch();
		return;
	}
	if ((ctrlDown || metaDown) && shiftDown && isKeyJustPressedGlobal(ide_state.playerIndex, 'KeyR')) {
		consumeKeyboardKey(keyboard, 'KeyR');
		toggleResolutionMode();
		return;
	}
	if ((ctrlDown || metaDown) && shiftDown && isKeyJustPressedGlobal(ide_state.playerIndex, 'KeyL')) {
		consumeKeyboardKey(keyboard, 'KeyL');
		toggleResourcePanelFilterMode();
		return;
	}
	if ((ctrlDown || metaDown) && !altDown && isKeyJustPressedGlobal(ide_state.playerIndex, 'Comma')) {
		consumeKeyboardKey(keyboard, 'Comma');
		openResourceSearch();
		return;
	}
	if ((ctrlDown || metaDown) && !altDown && !shiftDown && isKeyJustPressedGlobal(ide_state.playerIndex, 'KeyE')) {
		consumeKeyboardKey(keyboard, 'KeyE');
		openResourceSearch();
		return;
	}
	if ((ctrlDown && altDown) && isKeyJustPressedGlobal(ide_state.playerIndex, 'Comma')) {
		consumeKeyboardKey(keyboard, 'Comma');
		openSymbolSearch();
		return;
	}
	if ((ctrlDown || metaDown) && isKeyJustPressedGlobal(ide_state.playerIndex, 'KeyB')) {
		consumeKeyboardKey(keyboard, 'KeyB');
		toggleResourcePanel();
		return;
	}
	if ((ctrlDown || metaDown) && shiftDown && isKeyJustPressedGlobal(ide_state.playerIndex, 'KeyM')) {
		consumeKeyboardKey(keyboard, 'KeyM');
		toggleProblemsPanel();
		if (ide_state.problemsPanel.isVisible()) {
			markDiagnosticsDirty();
		} else {
			focusEditorFromProblemsPanel();
		}
		return;
	}
	if (!ctrlDown && !metaDown && altDown && isKeyJustPressedGlobal(ide_state.playerIndex, 'Comma')) {
		consumeKeyboardKey(keyboard, 'Comma');
		openGlobalSymbolSearch();
		return;
	}

	if (ide_state.createResourceActive) {
		handleCreateResourceInput(keyboard, deltaSeconds, shiftDown, ctrlDown, metaDown);
		return;
	}

	if ((ctrlDown || metaDown) && isKeyJustPressedGlobal(ide_state.playerIndex, 'KeyN')) {
		consumeKeyboardKey(keyboard, 'KeyN');
		openCreateResourcePrompt();
		return;
	}

	if ((ctrlDown || metaDown) && shiftDown && !altDown && isKeyJustPressedGlobal(ide_state.playerIndex, 'KeyF')) {
		consumeKeyboardKey(keyboard, 'KeyF');
		openSearch(true, 'global');
		return;
	}
	if ((ctrlDown || metaDown) && !shiftDown && !altDown && isKeyJustPressedGlobal(ide_state.playerIndex, 'KeyF')) {
		consumeKeyboardKey(keyboard, 'KeyF');
		openSearch(true, 'local');
		return;
	}
	if ((ctrlDown || metaDown) && isKeyJustPressedGlobal(ide_state.playerIndex, 'Tab')) {
		consumeKeyboardKey(keyboard, 'Tab');
		cycleTab(shiftDown ? -1 : 1);
		return;
	}
	const inlineFieldFocused = ide_state.searchActive
		|| ide_state.symbolSearchActive
		|| ide_state.resourceSearchActive
		|| ide_state.lineJumpActive
		|| ide_state.createResourceActive
		|| ide_state.renameController.isActive();
	if (handleCustomKeybinding(keyboard, deltaSeconds, {
		ctrlDown,
		metaDown,
		shiftDown,
		altDown,
		inlineFieldFocused,
		resourcePanelFocused: ide_state.resourcePanelFocused,
		codeTabActive: isCodeTabActive(),
	})) {
		return;
	}
	if (!inlineFieldFocused && isKeyJustPressedGlobal(ide_state.playerIndex, 'F12')) {
		consumeKeyboardKey(keyboard, 'F12');
		if (shiftDown) {
			return;
		}
		openReferenceSearchPopup();
		return;
	}
	if (!inlineFieldFocused && isCodeTabActive() && isKeyJustPressedGlobal(ide_state.playerIndex, 'F2')) {
		consumeKeyboardKey(keyboard, 'F2');
		openRenamePrompt();
		return;
	}
	if ((ctrlDown || metaDown)
		&& !inlineFieldFocused
		&& !ide_state.resourcePanelFocused
		&& isCodeTabActive()
		&& isKeyJustPressedGlobal(ide_state.playerIndex, 'KeyA')) {
		consumeKeyboardKey(keyboard, 'KeyA');
		ide_state.selectionAnchor = { row: 0, column: 0 };
		const lastRowIndex = ide_state.lines.length > 0 ? ide_state.lines.length - 1 : 0;
		const lastColumn = ide_state.lines.length > 0 ? ide_state.lines[lastRowIndex].length : 0;
		ide_state.cursorRow = lastRowIndex;
		ide_state.cursorColumn = lastColumn;
		updateDesiredColumn();
		resetBlink();
		revealCursor();
		return;
	}
	if ((ctrlDown || metaDown) && isKeyJustPressedGlobal(ide_state.playerIndex, 'KeyL')) {
		consumeKeyboardKey(keyboard, 'KeyL');
		openLineJump();
		return;
	}
	if (ide_state.renameController.isActive()) {
		ide_state.renameController.handleInput(keyboard, deltaSeconds, { ctrlDown, metaDown, shiftDown, altDown });
		return;
	}
	if (ide_state.resourceSearchActive) {
		handleResourceSearchInput(keyboard, deltaSeconds, shiftDown, ctrlDown, metaDown);
		return;
	}
	if (ide_state.symbolSearchActive) {
		handleSymbolSearchInput(keyboard, deltaSeconds, shiftDown, ctrlDown, metaDown);
		return;
	}
	if (ide_state.lineJumpActive) {
		handleLineJumpInput(keyboard, deltaSeconds, shiftDown, ctrlDown, metaDown);
		return;
	}
	if (ide_state.searchActive) {
		handleSearchInput(keyboard, deltaSeconds, shiftDown, ctrlDown, metaDown);
		return;
	}
	if (ide_state.problemsPanel.isVisible() && ide_state.problemsPanel.isFocused()) {
		let handled = false;
		if (shouldFireRepeat(keyboard, 'ArrowUp', deltaSeconds)) {
			consumeKeyboardKey(keyboard, 'ArrowUp');
			handled = ide_state.problemsPanel.handleKeyboardCommand('up');
		} else if (shouldFireRepeat(keyboard, 'ArrowDown', deltaSeconds)) {
			consumeKeyboardKey(keyboard, 'ArrowDown');
			handled = ide_state.problemsPanel.handleKeyboardCommand('down');
		} else if (shouldFireRepeat(keyboard, 'PageUp', deltaSeconds)) {
			consumeKeyboardKey(keyboard, 'PageUp');
			handled = ide_state.problemsPanel.handleKeyboardCommand('page-up');
		} else if (shouldFireRepeat(keyboard, 'PageDown', deltaSeconds)) {
			consumeKeyboardKey(keyboard, 'PageDown');
			handled = ide_state.problemsPanel.handleKeyboardCommand('page-down');
		} else if (shouldFireRepeat(keyboard, 'Home', deltaSeconds)) {
			consumeKeyboardKey(keyboard, 'Home');
			handled = ide_state.problemsPanel.handleKeyboardCommand('home');
		} else if (shouldFireRepeat(keyboard, 'End', deltaSeconds)) {
			consumeKeyboardKey(keyboard, 'End');
			handled = ide_state.problemsPanel.handleKeyboardCommand('end');
		} else if (isKeyJustPressedGlobal(ide_state.playerIndex, 'Enter') || isKeyJustPressedGlobal(ide_state.playerIndex, 'NumpadEnter')) {
			if (isKeyJustPressedGlobal(ide_state.playerIndex, 'Enter')) consumeKeyboardKey(keyboard, 'Enter'); else consumeKeyboardKey(keyboard, 'NumpadEnter');
			handled = ide_state.problemsPanel.handleKeyboardCommand('activate');
		} else if (isKeyJustPressedGlobal(ide_state.playerIndex, 'Escape')) {
			consumeKeyboardKey(keyboard, 'Escape');
			hideProblemsPanel();
			focusEditorFromProblemsPanel();
			return;
		}
		// Always swallow caret movement while problems panel is focused
		if (shouldFireRepeat(keyboard, 'ArrowLeft', deltaSeconds)) consumeKeyboardKey(keyboard, 'ArrowLeft');
		if (shouldFireRepeat(keyboard, 'ArrowRight', deltaSeconds)) consumeKeyboardKey(keyboard, 'ArrowRight');
		if (handled) return; else return;
	}
	if (ide_state.searchQuery.length > 0 && isKeyJustPressedGlobal(ide_state.playerIndex, 'F3')) {
		consumeKeyboardKey(keyboard, 'F3');
		if (shiftDown) {
			jumpToPreviousMatch();
		} else {
			jumpToNextMatch();
		}
		return;
	}
	if ((ctrlDown || metaDown) && shouldFireRepeat(keyboard, 'KeyZ', deltaSeconds)) {
		consumeKeyboardKey(keyboard, 'KeyZ');
		if (shiftDown) {
			redo();
		} else {
			undo();
		}
		return;
	}
	if ((ctrlDown || metaDown) && shouldFireRepeat(keyboard, 'KeyY', deltaSeconds)) {
		consumeKeyboardKey(keyboard, 'KeyY');
		redo();
		return;
	}
	if ((ctrlDown || metaDown) && isKeyJustPressedGlobal(ide_state.playerIndex, 'KeyW')) {
		consumeKeyboardKey(keyboard, 'KeyW');
		closeActiveTab();
		return;
	}
	if (ctrlDown && isKeyJustPressedGlobal(ide_state.playerIndex, 'KeyS')) {
		consumeKeyboardKey(keyboard, 'KeyS');
		void save();
		return;
	}
	if (ctrlDown && isKeyJustPressedGlobal(ide_state.playerIndex, 'KeyC')) {
		consumeKeyboardKey(keyboard, 'KeyC');
		void copySelectionToClipboard();
		return;
	}
	if (ctrlDown && isKeyJustPressedGlobal(ide_state.playerIndex, 'KeyX')) {
		consumeKeyboardKey(keyboard, 'KeyX');
		if (hasSelection()) {
			void cutSelectionToClipboard();
		} else {
			void cutLineToClipboard();
		}
		return;
	}
	if (ctrlDown && isKeyJustPressedGlobal(ide_state.playerIndex, 'KeyV')) {
		consumeKeyboardKey(keyboard, 'KeyV');
		pasteFromClipboard();
		return;
	}
	if ((ctrlDown || metaDown) && !altDown && isKeyJustPressedGlobal(ide_state.playerIndex, 'Slash')) {
		consumeKeyboardKey(keyboard, 'Slash');
		toggleLineComments();
		return;
	}
	if ((ctrlDown || metaDown) && !altDown && isKeyJustPressedGlobal(ide_state.playerIndex, 'NumpadDivide')) {
		consumeKeyboardKey(keyboard, 'NumpadDivide');
		toggleLineComments();
		return;
	}
	if (ctrlDown && isKeyJustPressedGlobal(ide_state.playerIndex, 'BracketRight')) {
		consumeKeyboardKey(keyboard, 'BracketRight');
		indentSelectionOrLine();
		return;
	}
	if (ctrlDown && isKeyJustPressedGlobal(ide_state.playerIndex, 'BracketLeft')) {
		consumeKeyboardKey(keyboard, 'BracketLeft');
		unindentSelectionOrLine();
		return;
	}
	// Manual ide_state.completion open/close handled by CompletionController via handleCompletionKeybindings
	if (handleCompletionKeybindings(keyboard, deltaSeconds, shiftDown, ctrlDown, altDown, metaDown)) {
		return;
	}
	ide_state.input.handleEditorInput(keyboard, deltaSeconds);
	if (ctrlDown || metaDown || altDown) {
		return;
	}
	// Remaining character ide_state.input after controller handled modifiers is no-op here
}

let customKeybindingHandler: CustomKeybindingHandler | null = null;

export function handleCustomKeybinding(
	keyboard: KeyboardInput,
	deltaSeconds: number,
	context: ConsoleEditorShortcutContext,
): boolean {
	if (customKeybindingHandler) {
		return customKeybindingHandler(keyboard, deltaSeconds, context);
	}
	return false;
}

export function handleCreateResourceInput(keyboard: KeyboardInput, deltaSeconds: number, shiftDown: boolean, ctrlDown: boolean, metaDown: boolean): void {
	const altDown = isModifierPressedGlobal(ide_state.playerIndex, 'AltLeft') || isModifierPressedGlobal(ide_state.playerIndex, 'AltRight');
	if (isKeyJustPressedGlobal(ide_state.playerIndex, 'Escape')) {
		consumeKeyboardKey(keyboard, 'Escape');
		cancelCreateResourcePrompt();
		return;
	}
	if (!ide_state.createResourceWorking && isKeyJustPressedGlobal(ide_state.playerIndex, 'Enter')) {
		consumeKeyboardKey(keyboard, 'Enter');
		void confirmCreateResourcePrompt();
		return;
	}
	if (ide_state.createResourceWorking) {
		return;
	}
	const textChanged = processInlineFieldEditing(ide_state.createResourceField, keyboard, {
		ctrlDown,
		metaDown,
		shiftDown,
		altDown,
		deltaSeconds,
		allowSpace: true,
		characterFilter: (value: string): boolean => isValidCreateResourceCharacter(value),
		maxLength: constants.CREATE_RESOURCE_MAX_PATH_LENGTH,
	});
	if (textChanged) {
		ide_state.createResourceError = null;
		resetBlink();
	}
	ide_state.createResourcePath = ide_state.createResourceField.text;
}

export function openCreateResourcePrompt(): void {
	if (ide_state.createResourceWorking) {
		return;
	}
	ide_state.resourcePanelFocused = false;
	ide_state.renameController.cancel();
	let defaultPath = ide_state.createResourcePath.length === 0
		? determineCreateResourceDefaultPath()
		: ide_state.createResourcePath;
	if (defaultPath.length > constants.CREATE_RESOURCE_MAX_PATH_LENGTH) {
		defaultPath = defaultPath.slice(defaultPath.length - constants.CREATE_RESOURCE_MAX_PATH_LENGTH);
	}
	applyCreateResourceFieldText(defaultPath, true);
	ide_state.createResourceVisible = true;
	ide_state.createResourceActive = true;
	ide_state.createResourceError = null;
	ide_state.cursorVisible = true;
	resetBlink();
}

export function closeCreateResourcePrompt(focusEditor: boolean): void {
	ide_state.createResourceActive = false;
	ide_state.createResourceVisible = false;
	ide_state.createResourceWorking = false;
	if (focusEditor) {
		focusEditorFromSearch();
		focusEditorFromLineJump();
	}
	applyCreateResourceFieldText('', true);
	ide_state.createResourceError = null;
	resetBlink();
}

export function cancelCreateResourcePrompt(): void {
	closeCreateResourcePrompt(true);
}

export async function confirmCreateResourcePrompt(): Promise<void> {
	if (ide_state.createResourceWorking) {
		return;
	}
	let normalizedPath: string;
	let assetId: string;
	let directory: string;
	try {
		const result = normalizeCreateResourceRequest(ide_state.createResourcePath);
		normalizedPath = result.path;
		assetId = result.assetId;
		directory = result.directory;
		applyCreateResourceFieldText(normalizedPath, true);
		ide_state.createResourceError = null;
	} catch (error) {
		const message = error instanceof Error ? error.message : String(error);
		ide_state.createResourceError = message;
		ide_state.showMessage(message, constants.COLOR_STATUS_ERROR, 4.0);
		resetBlink();
		return;
	}
	ide_state.createResourceWorking = true;
	resetBlink();
	const contents = buildDefaultResourceContents(normalizedPath, assetId);
	try {
		const descriptor = await ide_state.createLuaResourceFn({ path: normalizedPath, assetId, contents });
		ide_state.lastCreateResourceDirectory = directory;
		ide_state.pendingResourceSelectionAssetId = descriptor.assetId;
		if (ide_state.resourcePanelVisible) {
			refreshResourcePanelContents();
		}
		openLuaCodeTab(descriptor);
		ide_state.showMessage(`Created ${descriptor.path} (asset ${descriptor.assetId})`, constants.COLOR_STATUS_SUCCESS, 2.5);
		closeCreateResourcePrompt(false);
	} catch (error) {
		const message = error instanceof Error ? error.message : String(error);
		const simplified = simplifyRuntimeErrorMessage(message);
		ide_state.createResourceError = simplified;
		ide_state.showMessage(`Failed to create resource: ${simplified}`, constants.COLOR_STATUS_WARNING, 4.0);
	} finally {
		ide_state.createResourceWorking = false;
		resetBlink();
	}
}

export function isValidCreateResourceCharacter(value: string): boolean {
	if (value.length !== 1) {
		return false;
	}
	const code = value.charCodeAt(0);
	if (code >= 48 && code <= 57) {
		return true;
	}
	if (code >= 65 && code <= 90) {
		return true;
	}
	if (code >= 97 && code <= 122) {
		return true;
	}
	return value === '_' || value === '-' || value === '.' || value === '/';
}

export function normalizeCreateResourceRequest(rawPath: string): { path: string; assetId: string; directory: string } {
	let candidate = rawPath.trim();
	if (candidate.length === 0) {
		throw new Error('Path must not be empty.');
	}
	if (candidate.indexOf('\n') !== -1 || candidate.indexOf('\r') !== -1) {
		throw new Error('Path cannot contain newlines.');
	}
	candidate = candidate.replace(/\\/g, '/');
	candidate = candidate.replace(/\/+/g, '/');
	if (candidate.startsWith('./')) {
		candidate = candidate.slice(2);
	}
	while (candidate.startsWith('/')) {
		candidate = candidate.slice(1);
	}
	const segments = candidate.split('/');
	for (let i = 0; i < segments.length; i += 1) {
		if (segments[i] === '..') {
			throw new Error('Path cannot contain ".." segments.');
		}
	}
	if (candidate.endsWith('/')) {
		throw new Error('Path must include a file name.');
	}
	if (!candidate.endsWith('.lua')) {
		candidate += '.lua';
	}
	const slashIndex = candidate.lastIndexOf('/');
	const directory = slashIndex === -1 ? '' : candidate.slice(0, slashIndex + 1);
	const fileName = slashIndex === -1 ? candidate : candidate.slice(slashIndex + 1);
	if (fileName.length === 0) {
		throw new Error('File name cannot be empty.');
	}
	const baseName = fileName.endsWith('.lua') ? fileName.slice(0, -4) : fileName;
	if (baseName.length === 0) {
		throw new Error('Asset id cannot be empty.');
	}
	return { path: candidate, assetId: baseName, directory: ensureDirectorySuffix(directory) };
}

export function determineCreateResourceDefaultPath(): string {
	if (ide_state.lastCreateResourceDirectory && ide_state.lastCreateResourceDirectory.length > 0) {
		return ide_state.lastCreateResourceDirectory;
	}
	const activeContext = getActiveCodeTabContext();
	if (activeContext && activeContext.descriptor && typeof activeContext.descriptor.path === 'string' && activeContext.descriptor.path.length > 0) {
		return ensureDirectorySuffix(activeContext.descriptor.path);
	}
	let descriptors: ConsoleResourceDescriptor[] = [];
	try {
		descriptors = ide_state.listResourcesFn();
	} catch (error) {
		descriptors = [];
	}
	const firstLua = descriptors.find(entry => entry.type === 'lua' && typeof entry.path === 'string' && entry.path.length > 0);
	if (firstLua && typeof firstLua.path === 'string') {
		return ensureDirectorySuffix(firstLua.path);
	}
	return './';
}

export function ensureDirectorySuffix(path: string): string {
	if (!path || path.length === 0) {
		return '';
	}
	const normalized = path.replace(/\\/g, '/');
	const slashIndex = normalized.lastIndexOf('/');
	if (slashIndex === -1) {
		return '';
	}
	return normalized.slice(0, slashIndex + 1);
}

export function buildDefaultResourceContents(_path: string, _assetId: string): string {
	return constants.DEFAULT_NEW_LUA_RESOURCE_CONTENT;
}

export function handleSearchInput(keyboard: KeyboardInput, deltaSeconds: number, shiftDown: boolean, ctrlDown: boolean, metaDown: boolean): void {
	const altDown = isModifierPressedGlobal(ide_state.playerIndex, 'AltLeft') || isModifierPressedGlobal(ide_state.playerIndex, 'AltRight');
	if ((ctrlDown || metaDown) && shiftDown && !altDown && isKeyJustPressedGlobal(ide_state.playerIndex, 'KeyF')) {
		consumeKeyboardKey(keyboard, 'KeyF');
		openSearch(false, 'global');
		return;
	}
	if ((ctrlDown || metaDown) && !altDown && isKeyJustPressedGlobal(ide_state.playerIndex, 'KeyF')) {
		consumeKeyboardKey(keyboard, 'KeyF');
		openSearch(false, 'local');
		return;
	}
	if ((ctrlDown || metaDown) && shouldFireRepeat(keyboard, 'KeyZ', deltaSeconds)) {
		consumeKeyboardKey(keyboard, 'KeyZ');
		if (shiftDown) {
			redo();
		} else {
			undo();
		}
		return;
	}
	if ((ctrlDown || metaDown) && shouldFireRepeat(keyboard, 'KeyY', deltaSeconds)) {
		consumeKeyboardKey(keyboard, 'KeyY');
		redo();
		return;
	}
	if (ctrlDown && isKeyJustPressedGlobal(ide_state.playerIndex, 'KeyS')) {
		consumeKeyboardKey(keyboard, 'KeyS');
		void save();
		return;
	}
	const hasResults = activeSearchMatchCount() > 0;
	const previewLocal = ide_state.searchScope === 'local';
	if (isKeyJustPressedGlobal(ide_state.playerIndex, 'Enter')) {
		consumeKeyboardKey(keyboard, 'Enter');
		if (hasResults) {
			if (shiftDown) {
				moveSearchSelection(-1, { wrap: true, preview: previewLocal });
			} else if (ide_state.searchCurrentIndex === -1) {
				ide_state.searchCurrentIndex = 0;
			} else {
				moveSearchSelection(1, { wrap: true, preview: previewLocal });
			}
			applySearchSelection(ide_state.searchCurrentIndex);
		} else if (shiftDown) {
			jumpToPreviousMatch();
		} else {
			jumpToNextMatch();
		}
		return;
	}
	if (isKeyJustPressedGlobal(ide_state.playerIndex, 'F3')) {
		consumeKeyboardKey(keyboard, 'F3');
		if (shiftDown) {
			jumpToPreviousMatch();
		} else {
			jumpToNextMatch();
		}
		return;
	}
	if (hasResults) {
		if (shouldFireRepeat(keyboard, 'ArrowUp', deltaSeconds)) {
			consumeKeyboardKey(keyboard, 'ArrowUp');
			moveSearchSelection(-1, { preview: previewLocal });
			return;
		}
		if (shouldFireRepeat(keyboard, 'ArrowDown', deltaSeconds)) {
			consumeKeyboardKey(keyboard, 'ArrowDown');
			moveSearchSelection(1, { preview: previewLocal });
			return;
		}
		if (shouldFireRepeat(keyboard, 'PageUp', deltaSeconds)) {
			consumeKeyboardKey(keyboard, 'PageUp');
			moveSearchSelection(-searchPageSize(), { preview: previewLocal });
			return;
		}
		if (shouldFireRepeat(keyboard, 'PageDown', deltaSeconds)) {
			consumeKeyboardKey(keyboard, 'PageDown');
			moveSearchSelection(searchPageSize(), { preview: previewLocal });
			return;
		}
		if (isKeyJustPressedGlobal(ide_state.playerIndex, 'Home')) {
			consumeKeyboardKey(keyboard, 'Home');
			ide_state.searchCurrentIndex = hasResults ? 0 : -1;
			ensureSearchSelectionVisible();
			if (previewLocal) {
				applySearchSelection(ide_state.searchCurrentIndex, { preview: true });
			}
			return;
		}
		if (isKeyJustPressedGlobal(ide_state.playerIndex, 'End')) {
			consumeKeyboardKey(keyboard, 'End');
			const lastIndex = hasResults ? activeSearchMatchCount() - 1 : -1;
			ide_state.searchCurrentIndex = lastIndex;
			ensureSearchSelectionVisible();
			if (previewLocal) {
				applySearchSelection(ide_state.searchCurrentIndex, { preview: true });
			}
			return;
		}
	}

	const textChanged = processInlineFieldEditing(ide_state.searchField, keyboard, {
		ctrlDown,
		metaDown,
		shiftDown,
		altDown,
		deltaSeconds,
		allowSpace: true,
		characterFilter: undefined,
		maxLength: null,
	});

	ide_state.searchQuery = ide_state.searchField.text;
	if (textChanged) {
		onSearchQueryChanged();
	}
}

export function handleLineJumpInput(keyboard: KeyboardInput, deltaSeconds: number, shiftDown: boolean, ctrlDown: boolean, metaDown: boolean): void {
	if ((ctrlDown || metaDown) && isKeyJustPressedGlobal(ide_state.playerIndex, 'KeyL')) {
		consumeKeyboardKey(keyboard, 'KeyL');
		openLineJump();
		return;
	}
	const altDown = isModifierPressedGlobal(ide_state.playerIndex, 'AltLeft') || isModifierPressedGlobal(ide_state.playerIndex, 'AltRight');
	if (isKeyJustPressedGlobal(ide_state.playerIndex, 'Enter')) {
		consumeKeyboardKey(keyboard, 'Enter');
		applyLineJump();
		return;
	}
	if (!shiftDown && isKeyJustPressedGlobal(ide_state.playerIndex, 'NumpadEnter')) {
		consumeKeyboardKey(keyboard, 'NumpadEnter');
		applyLineJump();
		return;
	}
	if (isKeyJustPressedGlobal(ide_state.playerIndex, 'Escape')) {
		consumeKeyboardKey(keyboard, 'Escape');
		closeLineJump(false);
		return;
	}

	const digitFilter = (value: string): boolean => value >= '0' && value <= '9';
	const textChanged = processInlineFieldEditing(ide_state.lineJumpField, keyboard, {
		ctrlDown,
		metaDown,
		shiftDown,
		altDown,
		deltaSeconds,
		allowSpace: false,
		characterFilter: digitFilter,
		maxLength: 6,
	});
	ide_state.lineJumpValue = ide_state.lineJumpField.text;
	if (textChanged) {
		// keep value in sync; no additional processing required
	}
}


export function openResourceSearch(initialQuery: string = ''): void {
	clearReferenceHighlights();
	closeSearch(false, true);
	closeLineJump(false);
	closeSymbolSearch(false);
	ide_state.renameController.cancel();
	ide_state.resourceSearchVisible = true;
	ide_state.resourceSearchActive = true;
	applyResourceSearchFieldText(initialQuery, true);
	refreshResourceCatalog();
	updateResourceSearchMatches();
	ide_state.resourceSearchHoverIndex = -1;
	resetBlink();
}

export function closeResourceSearch(clearQuery: boolean): void {
	if (clearQuery) {
		applyResourceSearchFieldText('', true);
	}
	ide_state.resourceSearchActive = false;
	ide_state.resourceSearchVisible = false;
	ide_state.resourceSearchMatches = [];
	ide_state.resourceSearchSelectionIndex = -1;
	ide_state.resourceSearchDisplayOffset = 0;
	ide_state.resourceSearchHoverIndex = -1;
	ide_state.resourceSearchField.selectionAnchor = null;
	ide_state.resourceSearchField.pointerSelecting = false;
	resetBlink();
}

export function focusEditorFromResourceSearch(): void {
	if (!ide_state.resourceSearchActive && !ide_state.resourceSearchVisible) {
		return;
	}
	ide_state.resourceSearchActive = false;
	if (ide_state.resourceSearchQuery.length === 0) {
		ide_state.resourceSearchVisible = false;
		ide_state.resourceSearchMatches = [];
		ide_state.resourceSearchSelectionIndex = -1;
		ide_state.resourceSearchDisplayOffset = 0;
	}
	ide_state.resourceSearchField.selectionAnchor = null;
	ide_state.resourceSearchField.pointerSelecting = false;
	resetBlink();
}

export function openSymbolSearch(initialQuery: string = ''): void {
	clearReferenceHighlights();
	closeSearch(false, true);
	closeLineJump(false);
	closeResourceSearch(false);
	ide_state.renameController.cancel();
	ide_state.symbolSearchMode = 'symbols';
	ide_state.referenceCatalog = [];
	ide_state.symbolSearchGlobal = false;
	ide_state.symbolSearchVisible = true;
	ide_state.symbolSearchActive = true;
	applySymbolSearchFieldText(initialQuery, true);
	refreshSymbolCatalog(true);
	updateSymbolSearchMatches();
	ide_state.symbolSearchHoverIndex = -1;
	resetBlink();
}

export function openGlobalSymbolSearch(initialQuery: string = ''): void {
	clearReferenceHighlights();
	closeSearch(false, true);
	closeLineJump(false);
	closeResourceSearch(false);
	ide_state.renameController.cancel();
	ide_state.symbolSearchMode = 'symbols';
	ide_state.referenceCatalog = [];
	ide_state.symbolSearchGlobal = true;
	ide_state.symbolSearchVisible = true;
	ide_state.symbolSearchActive = true;
	applySymbolSearchFieldText(initialQuery, true);
	refreshSymbolCatalog(true);
	updateSymbolSearchMatches();
	ide_state.symbolSearchHoverIndex = -1;
	resetBlink();
}

export function openReferenceSearchPopup(): void {
	const context = getActiveCodeTabContext();
	if (ide_state.symbolSearchVisible || ide_state.symbolSearchActive) {
		closeSymbolSearch(false);
	}
	ide_state.renameController.cancel();
	const referenceContext = buildProjectReferenceContext(context);
	const result = resolveReferenceLookup({
		layout: ide_state.layout,
		workspace: ide_state.semanticWorkspace,
		lines: ide_state.lines,
		textVersion: ide_state.textVersion,
		cursorRow: ide_state.cursorRow,
		cursorColumn: ide_state.cursorColumn,
		extractExpression: (row, column) => extractHoverExpression(row, column),
		chunkName: referenceContext.chunkName,
	});
	if (result.kind === 'error') {
		ide_state.showMessage(result.message, constants.COLOR_STATUS_WARNING, result.duration);
		return;
	}
	const { info, initialIndex } = result;
	ide_state.referenceState.apply(info, initialIndex);
	ide_state.referenceCatalog = buildReferenceCatalogForExpression(info, context);
	if (ide_state.referenceCatalog.length === 0) {
		ide_state.showMessage('No references found', constants.COLOR_STATUS_WARNING, 1.6);
		return;
	}
	ide_state.symbolSearchMode = 'references';
	ide_state.symbolSearchGlobal = true;
	ide_state.symbolSearchVisible = true;
	ide_state.symbolSearchActive = true;
	applySymbolSearchFieldText('', true);
	ide_state.symbolSearchQuery = '';
	updateReferenceSearchMatches();
	ide_state.symbolSearchHoverIndex = -1;
	ensureSymbolSearchSelectionVisible();
	resetBlink();
	showReferenceStatusMessage();
}

export function openRenamePrompt(): void {
	if (!isCodeTabActive()) {
		return;
	}
	closeSearch(false, true);
	closeLineJump(false);
	closeResourceSearch(false);
	closeSymbolSearch(false);
	ide_state.createResourceActive = false;
	const context = getActiveCodeTabContext();
	const referenceContext = buildProjectReferenceContext(context);
	const started = ide_state.renameController.begin({
		layout: ide_state.layout,
		workspace: ide_state.semanticWorkspace,
		lines: ide_state.lines,
		textVersion: ide_state.textVersion,
		cursorRow: ide_state.cursorRow,
		cursorColumn: ide_state.cursorColumn,
		extractExpression: (row, column) => extractHoverExpression(row, column),
		chunkName: referenceContext.chunkName,
	});
	if (started) {
		ide_state.cursorVisible = true;
		resetBlink();
	}
}

export function commitRename(payload: RenameCommitPayload): RenameCommitResult {
	const { matches, newName, activeIndex, info } = payload;
	const activeContext = getActiveCodeTabContext();
	const referenceContext = buildProjectReferenceContext(activeContext);
	const activeChunkName = referenceContext.chunkName;
	const normalizedActiveChunk = normalizeChunkReference(activeChunkName) ?? activeChunkName;
	const renameManager = new CrossFileRenameManager(getCrossFileRenameDependencies(), ide_state.semanticWorkspace);
	const sortedMatches = matches.slice();
	sortedMatches.sort((a, b) => {
		if (a.row !== b.row) {
			return a.row - b.row;
		}
		return a.start - b.start;
	});
	let updatedTotal = 0;
	let activeEditsApplied = false;
	if (sortedMatches.length > 0) {
		const edits = planRenameLineEdits(ide_state.lines, sortedMatches, newName);
		if (edits.length > 0) {
			prepareUndo('rename', false);
			recordEditContext('replace', newName);
			for (let index = 0; index < edits.length; index += 1) {
				const edit = edits[index];
				ide_state.lines[edit.row] = edit.text;
				invalidateLine(edit.row);
			}
			markTextMutated();
			activeEditsApplied = true;
		}
		const clampedIndex = clamp(activeIndex, 0, sortedMatches.length - 1);
		const match = sortedMatches[clampedIndex];
		const line = ide_state.lines[match.row] ?? '';
		const startColumn = clamp(match.start, 0, line.length);
		const endColumn = clamp(startColumn + newName.length, startColumn, line.length);
		ide_state.cursorRow = match.row;
		ide_state.cursorColumn = startColumn;
		ide_state.selectionAnchor = { row: match.row, column: endColumn };
		updateDesiredColumn();
		resetBlink();
		ide_state.cursorRevealSuspended = false;
		ensureCursorVisible();
		updatedTotal += sortedMatches.length;
	}
	if (activeEditsApplied) {
		ide_state.semanticWorkspace.updateFile(activeChunkName, ide_state.lines.join('\n'));
	}
	const decl = info.definitionKey ? ide_state.semanticWorkspace.getDecl(info.definitionKey) : null;
	const references = info.definitionKey ? ide_state.semanticWorkspace.getReferences(info.definitionKey) : [];
	type RangeBucket = { chunkName: string; ranges: LuaSourceRange[]; seen: Set<string> };
	const rangeMap = new Map<string, RangeBucket>();
	const addRange = (range: LuaSourceRange | null | undefined): void => {
		if (!range || !range.start || !range.end) {
			return;
		}
		const chunk = range.chunkName ?? activeChunkName;
		const normalized = normalizeChunkReference(chunk) ?? chunk;
		let bucket = rangeMap.get(normalized);
		if (!bucket) {
			bucket = { chunkName: chunk, ranges: [], seen: new Set<string>() };
			rangeMap.set(normalized, bucket);
		}
		const key = `${range.start.line}:${range.start.column}:${range.end.line}:${range.end.column}`;
		if (bucket.seen.has(key)) {
			return;
		}
		bucket.seen.add(key);
		bucket.ranges.push(range);
	};
	if (decl) {
		addRange(decl.range);
	}
	for (let index = 0; index < references.length; index += 1) {
		addRange(references[index].range);
	}
	if (normalizedActiveChunk) {
		rangeMap.delete(normalizedActiveChunk);
	}
	for (const bucket of rangeMap.values()) {
		const replacements = renameManager.applyRenameToChunk(bucket.chunkName, bucket.ranges, newName, normalizedActiveChunk);
		updatedTotal += replacements;
		if (replacements > 0) {
			markDiagnosticsDirtyForChunk(bucket.chunkName);
		}
	}
	return { updatedMatches: updatedTotal };
}

export function getCrossFileRenameDependencies(): CrossFileRenameDependencies {
	return {
		normalizeChunkReference: (reference: string | null) => normalizeChunkReference(reference),
		findResourceDescriptorForChunk: (chunk: string) => findResourceDescriptorForChunk(chunk),
		createLuaCodeTabContext: (descriptor: ConsoleResourceDescriptor) => createLuaCodeTabContext(descriptor),
		createEntryTabContext: () => createEntryTabContext(),
		getEntryTabId: () => ide_state.entryTabId,
		setEntryTabId: (id: string | null) => {
			ide_state.entryTabId = id;
		},
		getPrimaryAssetId: () => ide_state.primaryAssetId,
		getCodeTabContext: (id: string) => ide_state.codeTabContexts.get(id) ?? null,
		setCodeTabContext: (context: CodeTabContext) => {
			ide_state.codeTabContexts.set(context.id, context);
		},
		listCodeTabContexts: () => ide_state.codeTabContexts.values(),
		splitLines: (source: string) => splitLines(source),
		setTabDirty: (tabId: string, dirty: boolean) => setTabDirty(tabId, dirty),
	};
}

export function closeSymbolSearch(clearQuery: boolean): void {
	if (clearQuery) {
		applySymbolSearchFieldText('', true);
	}
	ide_state.symbolSearchActive = false;
	ide_state.symbolSearchVisible = false;
	ide_state.symbolSearchGlobal = false;
	ide_state.symbolSearchMode = 'symbols';
	ide_state.referenceCatalog = [];
	ide_state.symbolSearchMatches = [];
	ide_state.symbolSearchSelectionIndex = -1;
	ide_state.symbolSearchDisplayOffset = 0;
	ide_state.symbolSearchHoverIndex = -1;
	ide_state.symbolSearchField.selectionAnchor = null;
	ide_state.symbolSearchField.pointerSelecting = false;
	resetBlink();
}

export function focusEditorFromSymbolSearch(): void {
	if (!ide_state.symbolSearchActive && !ide_state.symbolSearchVisible) {
		return;
	}
	ide_state.symbolSearchActive = false;
	if (ide_state.symbolSearchQuery.length === 0) {
		ide_state.symbolSearchVisible = false;
		ide_state.symbolSearchMatches = [];
		ide_state.symbolSearchSelectionIndex = -1;
		ide_state.symbolSearchDisplayOffset = 0;
	}
	ide_state.symbolSearchField.selectionAnchor = null;
	ide_state.symbolSearchField.pointerSelecting = false;
	resetBlink();
}

export function focusEditorFromRename(): void {
	ide_state.cursorRevealSuspended = false;
	resetBlink();
	revealCursor();
	ide_state.cursorVisible = true;
}

export function refreshSymbolCatalog(force: boolean): void {
	const scope: 'local' | 'global' = ide_state.symbolSearchGlobal ? 'global' : 'local';
	let assetId: string | null = null;
	let chunkName: string | null = null;
	if (scope === 'local') {
		const context = getActiveCodeTabContext();
		assetId = resolveHoverAssetId(context);
		chunkName = resolveHoverChunkName(context);
	}
	const existing = ide_state.symbolCatalogContext;
	const unchanged = existing !== null
		&& existing.scope === scope
		&& (scope === 'global'
			|| (existing.assetId === assetId && existing.chunkName === chunkName));
	if (!force && unchanged) {
		return;
	}
	let entries: ConsoleLuaSymbolEntry[] = [];
	try {
		if (scope === 'global') {
			entries = ide_state.listGlobalLuaSymbolsFn();
		} else {
			entries = ide_state.listLuaSymbolsFn(assetId, chunkName);
		}
	} catch (error) {
		const message = error instanceof Error ? error.message : String(error);
		ide_state.symbolCatalog = [];
		ide_state.symbolSearchMatches = [];
		ide_state.symbolSearchSelectionIndex = -1;
		ide_state.symbolSearchDisplayOffset = 0;
		ide_state.symbolSearchHoverIndex = -1;
		ide_state.showMessage(`Failed to list symbols: ${message}`, constants.COLOR_STATUS_ERROR, 3.0);
		return;
	}
	ide_state.symbolCatalogContext = { scope, assetId, chunkName };
	const deduped: ConsoleLuaSymbolEntry[] = [];
	const seen = new Set<string>();
	for (let index = 0; index < entries.length; index += 1) {
		const entry = entries[index];
		const key = symbolCatalogDedupKey(entry);
		if (seen.has(key)) {
			continue;
		}
		seen.add(key);
		deduped.push(entry);
	}
	entries = deduped;
	const catalogEntries = entries.map((entry) => {
		const display = entry.path && entry.path.length > 0 ? entry.path : entry.name;
		const sourceLabel = scope === 'global' ? symbolSourceLabel(entry) : null;
		const combinedKey = sourceLabel
			? `${display} ${sourceLabel}`.toLowerCase()
			: display.toLowerCase();
		return {
			symbol: entry,
			displayName: display,
			searchKey: combinedKey,
			line: entry.location.range.startLine,
			kindLabel: symbolKindLabel(entry.kind),
			sourceLabel,
		};
	}).sort((a, b) => {
		if (a.line !== b.line) {
			return a.line - b.line;
		}
		if (a.displayName !== b.displayName) {
			return a.displayName.localeCompare(b.displayName);
		}
		const aSource = a.sourceLabel ?? '';
		const bSource = b.sourceLabel ?? '';
		return aSource.localeCompare(bSource);
	});
	ide_state.symbolCatalog = catalogEntries;
}

export function symbolPriority(kind: ConsoleLuaSymbolEntry['kind']): number {
	switch (kind) {
		case 'table_field':
			return 5;
		case 'function':
			return 4;
		case 'parameter':
			return 3;
		case 'variable':
			return 2;
		case 'assignment':
		default:
			return 1;
	}
}

export function symbolKindLabel(kind: ConsoleLuaSymbolEntry['kind']): string {
	switch (kind) {
		case 'function':
			return 'FUNC';
		case 'table_field':
			return 'FIELD';
		case 'parameter':
			return 'PARAM';
		case 'variable':
			return 'VAR';
		case 'assignment':
		default:
			return 'SET';
	}
}

export function symbolSourceLabel(entry: ConsoleLuaSymbolEntry): string | null {
	const path = entry.location.path ?? entry.location.assetId ?? null;
	if (!path) {
		return null;
	}
	return computeSourceLabel(path, entry.location.chunkName ?? '<console>');
}

export function buildReferenceCatalogForExpression(info: ReferenceMatchInfo, context: CodeTabContext | null): ReferenceCatalogEntry[] {
	const descriptor = context?.descriptor ?? null;
	const normalizedPath = descriptor?.path ? descriptor.path.replace(/\\/g, '/') : null;
	const assetId = descriptor?.assetId ?? ide_state.primaryAssetId ?? null;
	const chunkName = resolveHoverChunkName(context) ?? normalizedPath ?? assetId ?? '<console>';
	const environment: ProjectReferenceEnvironment = {
		activeContext: getActiveCodeTabContext(),
		activeLines: ide_state.lines,
		codeTabContexts: Array.from(ide_state.codeTabContexts.values()),
		listResources: () => listResourcesStrict(),
		loadLuaResource: (resourceId: string) => ide_state.loadLuaResourceFn(resourceId),
	};
	const sourceLabelPath = descriptor?.path ?? descriptor?.assetId ?? null;
	return buildProjectReferenceCatalog({
		workspace: ide_state.semanticWorkspace,
		info,
		lines: ide_state.lines,
		chunkName,
		assetId,
		environment,
		sourceLabelPath,
	});
}

export function updateSymbolSearchMatches(): void {
	if (ide_state.symbolSearchMode === 'references') {
		updateReferenceSearchMatches();
		return;
	}
	refreshSymbolCatalog(false);
	ide_state.symbolSearchMatches = [];
	ide_state.symbolSearchSelectionIndex = -1;
	ide_state.symbolSearchDisplayOffset = 0;
	ide_state.symbolSearchHoverIndex = -1;
	if (ide_state.symbolCatalog.length === 0) {
		return;
	}
	const query = ide_state.symbolSearchQuery.trim().toLowerCase();
	if (query.length === 0) {
		ide_state.symbolSearchMatches = ide_state.symbolCatalog.map(entry => ({ entry, matchIndex: 0 }));
		if (ide_state.symbolSearchMatches.length > 0) {
			ide_state.symbolSearchSelectionIndex = 0;
		}
		return;
	}
	const matches: SymbolSearchResult[] = [];
	for (const entry of ide_state.symbolCatalog) {
		const idx = entry.searchKey.indexOf(query);
		if (idx === -1) {
			continue;
		}
		matches.push({ entry, matchIndex: idx });
	}
	if (matches.length === 0) {
		ide_state.symbolSearchMatches = [];
		return;
	}
	matches.sort((a, b) => {
		if (a.matchIndex !== b.matchIndex) {
			return a.matchIndex - b.matchIndex;
		}
		const aPriority = symbolPriority(a.entry.symbol.kind);
		const bPriority = symbolPriority(b.entry.symbol.kind);
		if (aPriority !== bPriority) {
			return bPriority - aPriority;
		}
		if (a.entry.searchKey.length !== b.entry.searchKey.length) {
			return a.entry.searchKey.length - b.entry.searchKey.length;
		}
		if (a.entry.line !== b.entry.line) {
			return a.entry.line - b.entry.line;
		}
		return a.entry.displayName.localeCompare(b.entry.displayName);
	});
	ide_state.symbolSearchMatches = matches;
	ide_state.symbolSearchSelectionIndex = 0;
	ide_state.symbolSearchDisplayOffset = 0;
}

export function updateReferenceSearchMatches(): void {
	const { matches, selectionIndex, displayOffset } = filterReferenceCatalog({
		catalog: ide_state.referenceCatalog,
		query: ide_state.symbolSearchQuery,
		state: ide_state.referenceState,
		pageSize: symbolSearchPageSize(),
	});
	ide_state.symbolSearchMatches = matches;
	ide_state.symbolSearchSelectionIndex = selectionIndex;
	ide_state.symbolSearchDisplayOffset = displayOffset;
	ide_state.symbolSearchHoverIndex = -1;
}

export function getActiveSymbolSearchMatch(): SymbolSearchResult | null {
	if (!ide_state.symbolSearchVisible || ide_state.symbolSearchMatches.length === 0) {
		return null;
	}
	let index = ide_state.symbolSearchHoverIndex;
	if (index < 0 || index >= ide_state.symbolSearchMatches.length) {
		index = ide_state.symbolSearchSelectionIndex;
	}
	if (index < 0 || index >= ide_state.symbolSearchMatches.length) {
		return null;
	}
	return ide_state.symbolSearchMatches[index];
}

export function ensureSymbolSearchSelectionVisible(): void {
	if (ide_state.symbolSearchSelectionIndex < 0) {
		ide_state.symbolSearchDisplayOffset = 0;
		return;
	}
	const maxVisible = symbolSearchPageSize();
	if (ide_state.symbolSearchSelectionIndex < ide_state.symbolSearchDisplayOffset) {
		ide_state.symbolSearchDisplayOffset = ide_state.symbolSearchSelectionIndex;
	}
	if (ide_state.symbolSearchSelectionIndex >= ide_state.symbolSearchDisplayOffset + maxVisible) {
		ide_state.symbolSearchDisplayOffset = ide_state.symbolSearchSelectionIndex - maxVisible + 1;
	}
	if (ide_state.symbolSearchDisplayOffset < 0) {
		ide_state.symbolSearchDisplayOffset = 0;
	}
	const maxOffset = Math.max(0, ide_state.symbolSearchMatches.length - maxVisible);
	if (ide_state.symbolSearchDisplayOffset > maxOffset) {
		ide_state.symbolSearchDisplayOffset = maxOffset;
	}
}

export function moveSymbolSearchSelection(delta: number): void {
	if (ide_state.symbolSearchMatches.length === 0) {
		return;
	}
	let next = ide_state.symbolSearchSelectionIndex;
	if (next === -1) {
		next = delta > 0 ? 0 : ide_state.symbolSearchMatches.length - 1;
	} else {
		next = clamp(next + delta, 0, ide_state.symbolSearchMatches.length - 1);
	}
	if (next === ide_state.symbolSearchSelectionIndex) {
		return;
	}
	ide_state.symbolSearchSelectionIndex = next;
	ensureSymbolSearchSelectionVisible();
	resetBlink();
}

export function applySymbolSearchSelection(index: number): void {
	if (index < 0 || index >= ide_state.symbolSearchMatches.length) {
		ide_state.showMessage('Symbol not found', constants.COLOR_STATUS_WARNING, 1.5);
		return;
	}
	const match = ide_state.symbolSearchMatches[index];
	if (ide_state.symbolSearchMode === 'references') {
		const referenceEntry = match.entry as ReferenceCatalogEntry;
		const symbol = referenceEntry.symbol as ReferenceSymbolEntry;
		const entryIndex = ide_state.referenceCatalog.indexOf(referenceEntry);
		const expressionLabel = ide_state.referenceState.getExpression() ?? symbol.name;
		closeSymbolSearch(true);
		ide_state.referenceState.clear();
		navigateToLuaDefinition(symbol.location);
		const total = ide_state.referenceCatalog.length;
		if (entryIndex >= 0 && total > 0) {
			ide_state.showMessage(`Reference ${entryIndex + 1}/${total} for ${expressionLabel}`, constants.COLOR_STATUS_SUCCESS, 1.6);
		} else {
			ide_state.showMessage('Jumped to reference', constants.COLOR_STATUS_SUCCESS, 1.6);
		}
		return;
	}
	const location = match.entry.symbol.location;
	closeSymbolSearch(true);
	scheduleNextFrame(() => {
		navigateToLuaDefinition(location);
	});
}

export function handleSymbolSearchInput(keyboard: KeyboardInput, deltaSeconds: number, shiftDown: boolean, ctrlDown: boolean, metaDown: boolean): void {
	const altDown = isModifierPressedGlobal(ide_state.playerIndex, 'AltLeft') || isModifierPressedGlobal(ide_state.playerIndex, 'AltRight');
	if (isKeyJustPressedGlobal(ide_state.playerIndex, 'Enter')) {
		consumeKeyboardKey(keyboard, 'Enter');
		if (shiftDown) {
			moveSymbolSearchSelection(-1);
			return;
		}
		if (ide_state.symbolSearchSelectionIndex >= 0) {
			applySymbolSearchSelection(ide_state.symbolSearchSelectionIndex);
		} else {
			ide_state.showMessage('No symbol selected', constants.COLOR_STATUS_WARNING, 1.5);
		}
		return;
	}
	if (isKeyJustPressedGlobal(ide_state.playerIndex, 'Escape')) {
		consumeKeyboardKey(keyboard, 'Escape');
		closeSymbolSearch(true);
		return;
	}
	if (shouldFireRepeat(keyboard, 'ArrowUp', deltaSeconds)) {
		consumeKeyboardKey(keyboard, 'ArrowUp');
		moveSymbolSearchSelection(-1);
		return;
	}
	if (shouldFireRepeat(keyboard, 'ArrowDown', deltaSeconds)) {
		consumeKeyboardKey(keyboard, 'ArrowDown');
		moveSymbolSearchSelection(1);
		return;
	}
	if (shouldFireRepeat(keyboard, 'PageUp', deltaSeconds)) {
		consumeKeyboardKey(keyboard, 'PageUp');
		moveSymbolSearchSelection(-symbolSearchPageSize());
		return;
	}
	if (shouldFireRepeat(keyboard, 'PageDown', deltaSeconds)) {
		consumeKeyboardKey(keyboard, 'PageDown');
		moveSymbolSearchSelection(symbolSearchPageSize());
		return;
	}
	if (isKeyJustPressedGlobal(ide_state.playerIndex, 'Home')) {
		consumeKeyboardKey(keyboard, 'Home');
		ide_state.symbolSearchSelectionIndex = ide_state.symbolSearchMatches.length > 0 ? 0 : -1;
		ensureSymbolSearchSelectionVisible();
		return;
	}
	if (isKeyJustPressedGlobal(ide_state.playerIndex, 'End')) {
		consumeKeyboardKey(keyboard, 'End');
		ide_state.symbolSearchSelectionIndex = ide_state.symbolSearchMatches.length > 0 ? ide_state.symbolSearchMatches.length - 1 : -1;
		ensureSymbolSearchSelectionVisible();
		return;
	}
	const textChanged = processInlineFieldEditing(ide_state.symbolSearchField, keyboard, {
		ctrlDown,
		metaDown,
		shiftDown,
		altDown,
		deltaSeconds,
		allowSpace: true,
		characterFilter: undefined,
		maxLength: null,
	});
	ide_state.symbolSearchQuery = ide_state.symbolSearchField.text;
	if (textChanged) {
		updateSymbolSearchMatches();
	}
}

export function refreshResourceCatalog(): void {
	let descriptors: ConsoleResourceDescriptor[];
	try {
		descriptors = listResourcesStrict();
	} catch (error) {
		const message = error instanceof Error ? error.message : String(error);
		ide_state.resourceCatalog = [];
		ide_state.resourceSearchMatches = [];
		ide_state.resourceSearchSelectionIndex = -1;
		ide_state.resourceSearchDisplayOffset = 0;
		ide_state.resourceSearchHoverIndex = -1;
		ide_state.showMessage(`Failed to list resources: ${message}`, constants.COLOR_STATUS_ERROR, 3.0);
		return;
	}
	const augmented = descriptors.slice();
	const rompack = $.rompack;
	if (rompack && rompack.img) {
		const atlasKeys = Object.keys(rompack.img).filter(key => key === '_atlas' || key.startsWith('atlas'));
		for (const key of atlasKeys) {
			if (augmented.some(entry => entry.assetId === key)) {
				continue;
			}
			augmented.push({ path: `atlas/${key}`, type: 'atlas', assetId: key });
		}
	}
	descriptors = augmented;
	const entries: ResourceCatalogEntry[] = descriptors.map((descriptor) => {
		const normalizedPath = descriptor.path.replace(/\\/g, '/');
		const displayPathSource = normalizedPath.length > 0 ? normalizedPath : (descriptor.assetId ?? '');
		const displayPath = displayPathSource.length > 0 ? displayPathSource : '<unnamed>';
		const typeLabel = descriptor.type ? descriptor.type.toUpperCase() : '';
		const assetLabel = descriptor.assetId && descriptor.assetId !== displayPath ? descriptor.assetId : null;
		const searchKeyParts = [displayPath, descriptor.assetId ?? '', descriptor.type ?? ''];
		const searchKey = searchKeyParts
			.filter(part => part.length > 0)
			.map(part => part.toLowerCase())
			.join(' ');
		return {
			descriptor,
			displayPath,
			searchKey,
			typeLabel,
			assetLabel,
		};
	});
	entries.sort((a, b) => a.displayPath.localeCompare(b.displayPath));
	ide_state.resourceCatalog = entries;
}

export function updateResourceSearchMatches(): void {
	ide_state.resourceSearchMatches = [];
	ide_state.resourceSearchSelectionIndex = -1;
	ide_state.resourceSearchDisplayOffset = 0;
	ide_state.resourceSearchHoverIndex = -1;
	if (ide_state.resourceCatalog.length === 0) {
		return;
	}
	const query = ide_state.resourceSearchQuery.trim().toLowerCase();
	if (query.length === 0) {
		ide_state.resourceSearchMatches = ide_state.resourceCatalog.map(entry => ({ entry, matchIndex: 0 }));
		ide_state.resourceSearchSelectionIndex = -1;
		return;
	}
	const tokens = query.split(/\s+/).filter(token => token.length > 0);
	const matches: ResourceSearchResult[] = [];
	for (const entry of ide_state.resourceCatalog) {
		let bestIndex = Number.POSITIVE_INFINITY;
		let valid = true;
		for (const token of tokens) {
			const idx = entry.searchKey.indexOf(token);
			if (idx === -1) {
				valid = false;
				break;
			}
			if (idx < bestIndex) {
				bestIndex = idx;
			}
		}
		if (!valid) {
			continue;
		}
		if (!Number.isFinite(bestIndex)) {
			bestIndex = 0;
		}
		matches.push({ entry, matchIndex: bestIndex });
	}
	if (matches.length === 0) {
		ide_state.resourceSearchMatches = [];
		return;
	}
	matches.sort((a, b) => {
		if (a.matchIndex !== b.matchIndex) {
			return a.matchIndex - b.matchIndex;
		}
		if (a.entry.displayPath.length !== b.entry.displayPath.length) {
			return a.entry.displayPath.length - b.entry.displayPath.length;
		}
		return a.entry.displayPath.localeCompare(b.entry.displayPath);
	});
	ide_state.resourceSearchMatches = matches;
	ide_state.resourceSearchSelectionIndex = matches.length > 0 ? 0 : -1;
}

export function ensureResourceSearchSelectionVisible(): void {
	if (ide_state.resourceSearchSelectionIndex < 0) {
		ide_state.resourceSearchDisplayOffset = 0;
		return;
	}
	const windowSize = Math.max(1, resourceSearchWindowCapacity());
	if (ide_state.resourceSearchSelectionIndex < ide_state.resourceSearchDisplayOffset) {
		ide_state.resourceSearchDisplayOffset = ide_state.resourceSearchSelectionIndex;
	}
	if (ide_state.resourceSearchSelectionIndex >= ide_state.resourceSearchDisplayOffset + windowSize) {
		ide_state.resourceSearchDisplayOffset = ide_state.resourceSearchSelectionIndex - windowSize + 1;
	}
	if (ide_state.resourceSearchDisplayOffset < 0) {
		ide_state.resourceSearchDisplayOffset = 0;
	}
	const maxOffset = Math.max(0, ide_state.resourceSearchMatches.length - windowSize);
	if (ide_state.resourceSearchDisplayOffset > maxOffset) {
		ide_state.resourceSearchDisplayOffset = maxOffset;
	}
}

export function moveResourceSearchSelection(delta: number): void {
	if (ide_state.resourceSearchMatches.length === 0) {
		return;
	}
	let next = ide_state.resourceSearchSelectionIndex;
	if (next === -1) {
		next = delta > 0 ? 0 : ide_state.resourceSearchMatches.length - 1;
	} else {
		next = clamp(next + delta, 0, ide_state.resourceSearchMatches.length - 1);
	}
	if (next === ide_state.resourceSearchSelectionIndex) {
		return;
	}
	ide_state.resourceSearchSelectionIndex = next;
	ensureResourceSearchSelectionVisible();
	resetBlink();
}

export function applyResourceSearchSelection(index: number): void {
	if (index < 0 || index >= ide_state.resourceSearchMatches.length) {
		ide_state.showMessage('Resource not found', constants.COLOR_STATUS_WARNING, 1.5);
		return;
	}
	const match = ide_state.resourceSearchMatches[index];
	closeResourceSearch(true);
	scheduleNextFrame(() => {
		openResourceDescriptor(match.entry.descriptor);
	});
}

export function handleResourceSearchInput(keyboard: KeyboardInput, deltaSeconds: number, shiftDown: boolean, ctrlDown: boolean, metaDown: boolean): void {
	const altDown = isModifierPressedGlobal(ide_state.playerIndex, 'AltLeft') || isModifierPressedGlobal(ide_state.playerIndex, 'AltRight');
	if (isKeyJustPressedGlobal(ide_state.playerIndex, 'Enter')) {
		consumeKeyboardKey(keyboard, 'Enter');
		if (shiftDown) {
			moveResourceSearchSelection(-1);
			return;
		}
		if (ide_state.resourceSearchSelectionIndex >= 0) {
			applyResourceSearchSelection(ide_state.resourceSearchSelectionIndex);
			return;
		} else {
			const trimmed = ide_state.resourceSearchQuery.trim();
			if (trimmed.length === 0) {
				closeResourceSearch(true);
				focusEditorFromResourceSearch();
			} else {
				ide_state.showMessage('No resource selected', constants.COLOR_STATUS_WARNING, 1.5);
			}
		}
		return;
	}
	if (isKeyJustPressedGlobal(ide_state.playerIndex, 'Escape')) {
		consumeKeyboardKey(keyboard, 'Escape');
		closeResourceSearch(true);
		focusEditorFromResourceSearch();
		return;
	}
	if (shouldFireRepeat(keyboard, 'ArrowUp', deltaSeconds)) {
		consumeKeyboardKey(keyboard, 'ArrowUp');
		moveResourceSearchSelection(-1);
		return;
	}
	if (shouldFireRepeat(keyboard, 'ArrowDown', deltaSeconds)) {
		consumeKeyboardKey(keyboard, 'ArrowDown');
		moveResourceSearchSelection(1);
		return;
	}
	if (shouldFireRepeat(keyboard, 'PageUp', deltaSeconds)) {
		consumeKeyboardKey(keyboard, 'PageUp');
		moveResourceSearchSelection(-resourceSearchWindowCapacity());
		return;
	}
	if (shouldFireRepeat(keyboard, 'PageDown', deltaSeconds)) {
		consumeKeyboardKey(keyboard, 'PageDown');
		moveResourceSearchSelection(resourceSearchWindowCapacity());
		return;
	}
	if (isKeyJustPressedGlobal(ide_state.playerIndex, 'Home')) {
		consumeKeyboardKey(keyboard, 'Home');
		ide_state.resourceSearchSelectionIndex = ide_state.resourceSearchMatches.length > 0 ? 0 : -1;
		ensureResourceSearchSelectionVisible();
		return;
	}
	if (isKeyJustPressedGlobal(ide_state.playerIndex, 'End')) {
		consumeKeyboardKey(keyboard, 'End');
		ide_state.resourceSearchSelectionIndex = ide_state.resourceSearchMatches.length > 0 ? ide_state.resourceSearchMatches.length - 1 : -1;
		ensureResourceSearchSelectionVisible();
		return;
	}
	const textChanged = processInlineFieldEditing(ide_state.resourceSearchField, keyboard, {
		ctrlDown,
		metaDown,
		shiftDown,
		altDown,
		deltaSeconds,
		allowSpace: true,
		characterFilter: undefined,
		maxLength: null,
	});
	ide_state.resourceSearchQuery = ide_state.resourceSearchField.text;
	if (textChanged) {
		if (ide_state.resourceSearchQuery.startsWith('@')) {
			const query = ide_state.resourceSearchQuery.slice(1).trimStart();
			closeResourceSearch(true);
			openSymbolSearch(query);
			return;
		}
		if (ide_state.resourceSearchQuery.startsWith('#')) {
			const query = ide_state.resourceSearchQuery.slice(1).trimStart();
			closeResourceSearch(true);
			openGlobalSymbolSearch(query);
			return;
		}
		if (ide_state.resourceSearchQuery.startsWith(':')) {
			const query = ide_state.resourceSearchQuery.slice(1).trimStart();
			closeResourceSearch(true);
			openLineJump();
			if (query.length > 0) {
				applyLineJumpFieldText(query, true);
				ide_state.lineJumpValue = query;
			}
			return;
		}
		updateResourceSearchMatches();
	}
}

export function openLineJump(): void {
	clearReferenceHighlights();
	closeSymbolSearch(false);
	closeResourceSearch(false);
	closeSearch(false, true);
	ide_state.renameController.cancel();
	ide_state.lineJumpVisible = true;
	ide_state.lineJumpActive = true;
	applyLineJumpFieldText('', true);
	resetBlink();
}

export function closeLineJump(clearValue: boolean): void {
	ide_state.lineJumpActive = false;
	ide_state.lineJumpVisible = false;
	if (clearValue) {
		applyLineJumpFieldText('', true);
	}
	ide_state.lineJumpField.selectionAnchor = null;
	ide_state.lineJumpField.pointerSelecting = false;
	resetBlink();
}

export function focusEditorFromLineJump(): void {
	if (!ide_state.lineJumpActive && !ide_state.lineJumpVisible) {
		return;
	}
	ide_state.lineJumpActive = false;
	ide_state.lineJumpVisible = false;
	ide_state.lineJumpField.selectionAnchor = null;
	ide_state.lineJumpField.pointerSelecting = false;
	resetBlink();
}

export function focusEditorFromProblemsPanel(): void {
	ide_state.problemsPanel.setFocused(false);
	resetBlink();
}

export function focusEditorFromResourcePanel(): void {
	if (!ide_state.resourcePanelFocused) {
		return;
	}
	ide_state.resourcePanelFocused = false;
	resetBlink();
}

export function applyLineJump(): void {
	if (ide_state.lineJumpValue.length === 0) {
		ide_state.showMessage('Enter a line number', constants.COLOR_STATUS_WARNING, 1.5);
		return;
	}
	const target = Number.parseInt(ide_state.lineJumpValue, 10);
	if (!Number.isFinite(target) || target < 1 || target > ide_state.lines.length) {
		const limit = ide_state.lines.length <= 0 ? 1 : ide_state.lines.length;
		ide_state.showMessage(`Line must be between 1 and ${limit}`, constants.COLOR_STATUS_WARNING, 1.8);
		return;
	}
	setCursorPosition(target - 1, 0);
	clearSelection();
	breakUndoSequence();
	closeLineJump(true);
	ide_state.showMessage(`Jumped to line ${target}`, constants.COLOR_STATUS_SUCCESS, 1.5);
}

// moved to editor_search.ts (duplicate removed)
// onSearchQueryChanged

export function onGlobalSearchQueryChanged(): void {
	ide_state.searchDisplayOffset = 0;
	ide_state.searchHoverIndex = -1;
	ide_state.searchCurrentIndex = -1;
	if (ide_state.searchQuery.length === 0) {
		cancelGlobalSearchJob();
		ide_state.globalSearchMatches = [];
		return;
	}
	startGlobalSearchJob();
}

export function focusSearchResult(index: number): void {
	if (index < 0 || index >= ide_state.searchMatches.length) {
		return;
	}
	const match = ide_state.searchMatches[index];
	ide_state.cursorRow = match.row;
	ide_state.cursorColumn = match.start;
	ide_state.selectionAnchor = { row: match.row, column: match.end };
	updateDesiredColumn();
	resetBlink();
	revealCursor();
}

export function gotoDiagnostic(diagnostic: EditorDiagnostic): void {
	const navigationCheckpoint = beginNavigationCapture();
	// Switch to the originating tab if provided
	if (diagnostic.contextId && diagnostic.contextId.length > 0 && diagnostic.contextId !== ide_state.activeCodeTabContextId) {
		setActiveTab(diagnostic.contextId);
	}
	if (!isCodeTabActive()) {
		activateCodeTab();
	}
	if (!isCodeTabActive()) {
		return;
	}
	const targetRow = clamp(diagnostic.row, 0, Math.max(0, ide_state.lines.length - 1));
	const line = ide_state.lines[targetRow] ?? '';
	const targetColumn = clamp(diagnostic.startColumn, 0, line.length);
	setCursorPosition(targetRow, targetColumn);
	clearSelection();
	ide_state.cursorRevealSuspended = false;
	ensureCursorVisible();
	completeNavigation(navigationCheckpoint);
}

export function jumpToNextMatch(): void {
	if (ide_state.searchScope === 'global') {
		if (activeSearchMatchCount() === 0) {
			ide_state.showMessage('No matches found', constants.COLOR_STATUS_WARNING, 1.5);
			return;
		}
		moveSearchSelection(1, { wrap: true });
		applySearchSelection(ide_state.searchCurrentIndex);
		return;
	}
	ensureSearchJobCompleted();
	if (ide_state.searchMatches.length === 0) {
		ide_state.showMessage('No matches found', constants.COLOR_STATUS_WARNING, 1.5);
		return;
	}
	if (ide_state.searchCurrentIndex < 0) {
		ide_state.searchCurrentIndex = 0;
	} else {
		ide_state.searchCurrentIndex += 1;
		if (ide_state.searchCurrentIndex >= ide_state.searchMatches.length) {
			ide_state.searchCurrentIndex = 0;
		}
	}
	focusSearchResult(ide_state.searchCurrentIndex);
}

export function jumpToPreviousMatch(): void {
	if (ide_state.searchScope === 'global') {
		if (activeSearchMatchCount() === 0) {
			ide_state.showMessage('No matches found', constants.COLOR_STATUS_WARNING, 1.5);
			return;
		}
		moveSearchSelection(-1, { wrap: true });
		applySearchSelection(ide_state.searchCurrentIndex);
		return;
	}
	ensureSearchJobCompleted();
	if (ide_state.searchMatches.length === 0) {
		ide_state.showMessage('No matches found', constants.COLOR_STATUS_WARNING, 1.5);
		return;
	}
	if (ide_state.searchCurrentIndex < 0) {
		ide_state.searchCurrentIndex = ide_state.searchMatches.length - 1;
	} else {
		ide_state.searchCurrentIndex -= 1;
		if (ide_state.searchCurrentIndex < 0) {
			ide_state.searchCurrentIndex = ide_state.searchMatches.length - 1;
		}
	}
	focusSearchResult(ide_state.searchCurrentIndex);
}

// moved to editor_search.ts startSearchJob

// moved to editor_search.ts runSearchJobSlice

// moved to editor_search.ts collectSearchMatchesForRow

// moved to editor_search.ts forEachMatchInLine

// moved to editor_search.ts completeSearchJob

export function cancelSearchJob(): void {
	ide_state.searchJob = null;
}

// moved to editor_search.ts ensureSearchJobCompleted (duplicate removed)

export function startGlobalSearchJob(): void {
	cancelGlobalSearchJob();
	const normalized = ide_state.searchQuery.toLowerCase();
	if (normalized.length === 0) {
		ide_state.globalSearchMatches = [];
		return;
	}
	let descriptors: ConsoleResourceDescriptor[] = [];
	try {
		descriptors = listResourcesStrict().filter(entry => entry.type === 'lua');
	} catch {
		descriptors = [];
	}
	const job: GlobalSearchJob = {
		query: normalized,
		descriptors,
		descriptorIndex: 0,
		currentLines: null,
		nextRow: 0,
		matches: [],
		limitHit: false,
	};
	ide_state.globalSearchJob = job;
	ide_state.globalSearchMatches = [];
	ide_state.searchCurrentIndex = -1;
	ide_state.searchDisplayOffset = 0;
	ide_state.searchHoverIndex = -1;
	enqueueBackgroundTask(() => runGlobalSearchJobSlice(job));
}

export function runGlobalSearchJobSlice(job: GlobalSearchJob): boolean {
	if (ide_state.globalSearchJob !== job) {
		return false;
	}
	if (job.query.length === 0) {
		ide_state.globalSearchJob = null;
		return false;
	}
	const rowsPerSlice = 200;
	let processed = 0;
	while (job.descriptorIndex < job.descriptors.length && processed < rowsPerSlice && !job.limitHit) {
		if (!job.currentLines) {
			const descriptor = job.descriptors[job.descriptorIndex];
			job.currentLines = loadDescriptorLines(descriptor);
			job.nextRow = 0;
			if (!job.currentLines) {
				job.descriptorIndex += 1;
				continue;
			}
		}
		const lines = job.currentLines;
		if (!lines) {
			job.descriptorIndex += 1;
			job.currentLines = null;
			continue;
		}
		while (job.nextRow < lines.length && processed < rowsPerSlice && !job.limitHit) {
			const row = job.nextRow;
			job.nextRow += 1;
			processed += 1;
			const line = lines[row] ?? '';
			forEachMatchInLine(line, job.query, (start, end) => {
				if (job.limitHit) {
					return;
				}
				const descriptor = job.descriptors[job.descriptorIndex];
				const match: GlobalSearchMatch = {
					descriptor,
					pathLabel: describeDescriptor(descriptor),
					row,
					start,
					end,
					snippet: buildSearchSnippet(line, start, end),
					assetId: descriptor.assetId ?? null,
					chunkName: descriptor.path ?? null,
				};
				job.matches.push(match);
				if (job.matches.length >= GLOBAL_SEARCH_RESULT_LIMIT) {
					job.limitHit = true;
				}
			});
		}
		if (job.nextRow >= ide_state.lines.length) {
			job.currentLines = null;
			job.nextRow = 0;
			job.descriptorIndex += 1;
		}
	}
	if (job.limitHit || job.descriptorIndex >= job.descriptors.length) {
		completeGlobalSearchJob(job);
		return false;
	}
	return true;
}

export function completeGlobalSearchJob(job: GlobalSearchJob): void {
	if (ide_state.globalSearchJob !== job) {
		return;
	}
	ide_state.globalSearchJob = null;
	ide_state.globalSearchMatches = job.matches;
	if (ide_state.globalSearchMatches.length === 0) {
		ide_state.searchCurrentIndex = -1;
		ide_state.searchDisplayOffset = 0;
		return;
	}
	if (ide_state.searchCurrentIndex < 0 || ide_state.searchCurrentIndex >= ide_state.globalSearchMatches.length) {
		ide_state.searchCurrentIndex = 0;
	}
	ensureSearchSelectionVisible();
}

export function cancelGlobalSearchJob(): void {
	ide_state.globalSearchJob = null;
}

export function loadDescriptorLines(descriptor: ConsoleResourceDescriptor): string[] | null {
	try {
		const assetId = descriptor.assetId;
		if (!assetId) {
			return null;
		}
		const source = ide_state.loadLuaResourceFn(assetId);
		if (typeof source !== 'string') {
			return null;
		}
		return source.split(/\r?\n/);
	} catch {
		return null;
	}
}

export function describeDescriptor(descriptor: ConsoleResourceDescriptor): string {
	if (descriptor.path && descriptor.path.length > 0) {
		return descriptor.path.replace(/\\/g, '/');
	}
	if (descriptor.assetId && descriptor.assetId.length > 0) {
		return descriptor.assetId;
	}
	return '<resource>';
}

export function buildSearchSnippet(line: string, start: number, end: number): string {
	if (!line || line.length === 0) {
		return '<blank>';
	}
	const padding = 32;
	const sliceStart = Math.max(0, start - padding);
	const sliceEnd = Math.min(line.length, end + padding);
	let snippet = line.slice(sliceStart, sliceEnd).trim();
	if (sliceStart > 0) {
		snippet = `…${snippet}`;
	}
	if (sliceEnd < line.length) {
		snippet = `${snippet}…`;
	}
	return snippet;
}

// moved to editor_search.ts getVisibleSearchResultEntries

// moved to editor_search.ts ensureSearchSelectionVisible

// moved to editor_search.ts computeSearchPageStats

// moved to editor_search.ts buildSearchResultEntry

// moved to editor_search.ts moveSearchSelection

// moved to editor_search.ts applySearchSelection

export function focusGlobalSearchResult(index: number, previewOnly: boolean = false): void {
	const match = ide_state.globalSearchMatches[index];
	if (!match) {
		if (!previewOnly) {
			ide_state.showMessage('Search result unavailable', constants.COLOR_STATUS_WARNING, 1.5);
		}
		return;
	}
	if (previewOnly) {
		return;
	}
	if (match.descriptor) {
		openLuaCodeTab(match.descriptor);
	} else {
		activateCodeTab();
	}
	scheduleNextFrame(() => {
		const row = clamp(match.row, 0, Math.max(0, ide_state.lines.length - 1));
		const line = ide_state.lines[row] ?? '';
		const endColumn = Math.min(match.end, line.length);
		ide_state.cursorRow = row;
		ide_state.cursorColumn = clamp(match.start, 0, line.length);
		ide_state.selectionAnchor = { row, column: endColumn };
		ensureCursorVisible();
		resetBlink();
	});
}

export function showReferenceStatusMessage(): void {
	const matches = ide_state.referenceState.getMatches();
	const activeIndex = ide_state.referenceState.getActiveIndex();
	if (matches.length === 0 || activeIndex < 0) {
		return;
	}
	const label = ide_state.referenceState.getExpression() ?? '';
	ide_state.showMessage(`Reference ${activeIndex + 1}/${matches.length} for ${label}`, constants.COLOR_STATUS_SUCCESS, 1.6);
}

export function handlePointerInput(_deltaSeconds: number): void {
	const ctrlDown = isModifierPressedGlobal(ide_state.playerIndex, 'ControlLeft') || isModifierPressedGlobal(ide_state.playerIndex, 'ControlRight');
	const metaDown = isModifierPressedGlobal(ide_state.playerIndex, 'MetaLeft') || isModifierPressedGlobal(ide_state.playerIndex, 'MetaRight');
	const gotoModifierActive = ctrlDown || metaDown;
	if (!gotoModifierActive) {
		clearGotoHoverHighlight();
	}
	const activeContext = getActiveCodeTabContext();
	const snapshot = readPointerSnapshot();
	updateTabHoverState(snapshot);
	ide_state.lastPointerSnapshot = snapshot && snapshot.valid ? snapshot : null;
	if (!snapshot) {
		ide_state.pointerPrimaryWasPressed = false;
		ide_state.scrollbarController.cancel();
		ide_state.lastPointerRowResolution = null;
		clearHoverTooltip();
		clearGotoHoverHighlight();
		return;
	}
	if (!snapshot.valid) {
		ide_state.scrollbarController.cancel();
		clearGotoHoverHighlight();
		ide_state.lastPointerRowResolution = null;
	} else if (ide_state.scrollbarController.hasActiveDrag() && !snapshot.primaryPressed) {
		ide_state.scrollbarController.cancel();
	} else if (ide_state.scrollbarController.hasActiveDrag() && snapshot.primaryPressed) {
		if (ide_state.scrollbarController.update(snapshot.viewportX, snapshot.viewportY, snapshot.primaryPressed, (k, s) => applyScrollbarScroll(k, s))) {
			ide_state.pointerSelecting = false;
			clearHoverTooltip();
			ide_state.pointerPrimaryWasPressed = snapshot.primaryPressed;
			return;
		}
	}
	if (!snapshot.primaryPressed) {
		ide_state.searchField.pointerSelecting = false;
		ide_state.symbolSearchField.pointerSelecting = false;
		ide_state.resourceSearchField.pointerSelecting = false;
		ide_state.lineJumpField.pointerSelecting = false;
		ide_state.createResourceField.pointerSelecting = false;
		ide_state.symbolSearchHoverIndex = -1;
		ide_state.resourceSearchHoverIndex = -1;
	}
	let pointerAuxJustPressed = false;
	let pointerAuxPressed = false;
	const playerInput = $.input.getPlayerInput(ide_state.playerIndex);
	if (playerInput) {
		const auxAction = playerInput.getActionState('pointer_aux');
		if (auxAction && auxAction.justpressed === true && auxAction.consumed !== true) {
			pointerAuxJustPressed = true;
			pointerAuxPressed = true;
		} else if (auxAction && auxAction.pressed === true && auxAction.consumed !== true) {
			pointerAuxPressed = true;
			pointerAuxJustPressed = !ide_state.pointerAuxWasPressed;
		}
	}
	ide_state.pointerAuxWasPressed = pointerAuxPressed;
	const wasPressed = ide_state.pointerPrimaryWasPressed;
	const justPressed = snapshot.primaryPressed && !wasPressed;
	const justReleased = !snapshot.primaryPressed && wasPressed;
	if (justReleased || (!snapshot.primaryPressed && ide_state.pointerSelecting)) {
		ide_state.pointerSelecting = false;
	}
	if (ide_state.tabDragState) {
		if (!snapshot.primaryPressed) {
			endTabDrag();
			ide_state.pointerSelecting = false;
			ide_state.pointerPrimaryWasPressed = snapshot.primaryPressed;
			clearGotoHoverHighlight();
			clearHoverTooltip();
			return;
		}
		if (snapshot.valid) {
			updateTabDrag(snapshot.viewportX, snapshot.viewportY);
		}
		ide_state.pointerSelecting = false;
		ide_state.pointerPrimaryWasPressed = snapshot.primaryPressed;
		clearGotoHoverHighlight();
		clearHoverTooltip();
		return;
	}
	if (justPressed && ide_state.scrollbarController.begin(snapshot.viewportX, snapshot.viewportY, snapshot.primaryPressed, bottomMargin(), (k, s) => applyScrollbarScroll(k, s))) {
		ide_state.pointerSelecting = false;
		clearHoverTooltip();
		clearGotoHoverHighlight();
		ide_state.pointerPrimaryWasPressed = snapshot.primaryPressed;
		return;
	}
	if (ide_state.resourcePanelResizing && !snapshot.valid) {
		ide_state.resourcePanelResizing = false;
		ide_state.pointerPrimaryWasPressed = snapshot.primaryPressed;
		clearGotoHoverHighlight();
		return;
	}
	if (!snapshot.valid) {
		ide_state.pointerPrimaryWasPressed = snapshot.primaryPressed;
		clearHoverTooltip();
		clearGotoHoverHighlight();
		return;
	}
	if (ide_state.resourcePanelResizing) {
		if (!snapshot.primaryPressed) {
			ide_state.resourcePanelResizing = false;
			ide_state.pointerPrimaryWasPressed = snapshot.primaryPressed;
		} else {
			const ok = ide_state.resourcePanel.setRatioFromViewportX(snapshot.viewportX, ide_state.viewportWidth);
			if (!ok) {
				hideResourcePanel();
			} else {
				invalidateVisualLines();
				/* hscroll handled inside controller */
			}
			ide_state.resourcePanelFocused = true;
			ide_state.pointerSelecting = false;
			resetPointerClickTracking();
			ide_state.pointerPrimaryWasPressed = snapshot.primaryPressed;
		}
		clearGotoHoverHighlight();
		return;
	}
	if (ide_state.problemsPanelResizing) {
		if (!snapshot.primaryPressed) {
			ide_state.problemsPanelResizing = false;
			ide_state.pointerPrimaryWasPressed = snapshot.primaryPressed;
		} else {
			setProblemsPanelHeightFromViewportY(snapshot.viewportY);
			ide_state.pointerSelecting = false;
			resetPointerClickTracking();
			ide_state.pointerPrimaryWasPressed = snapshot.primaryPressed;
		}
		clearGotoHoverHighlight();
		return;
	}
	if (justPressed && snapshot.viewportY >= 0 && snapshot.viewportY < ide_state.headerHeight) {
		if (handleTopBarPointer(snapshot)) {
			ide_state.pointerSelecting = false;
			ide_state.pointerPrimaryWasPressed = snapshot.primaryPressed;
			resetPointerClickTracking();
			clearGotoHoverHighlight();
			return;
		}
	}
	if (ide_state.resourcePanelVisible && justPressed && isPointerOverResourcePanelDivider(snapshot.viewportX, snapshot.viewportY)) {
		if (getResourcePanelWidth() > 0) {
			ide_state.resourcePanelResizing = true;
			ide_state.resourcePanelFocused = true;
			ide_state.pointerSelecting = false;
			resetPointerClickTracking();
			ide_state.pointerPrimaryWasPressed = snapshot.primaryPressed;
		}
		clearGotoHoverHighlight();
		return;
	}
	if (justPressed && ide_state.problemsPanel.isVisible() && isPointerOverProblemsPanelDivider(snapshot.viewportX, snapshot.viewportY)) {
		ide_state.problemsPanelResizing = true;
		ide_state.pointerSelecting = false;
		resetPointerClickTracking();
		ide_state.pointerPrimaryWasPressed = snapshot.primaryPressed;
		clearGotoHoverHighlight();
		return;
	}
	const tabTop = ide_state.headerHeight;
	const tabBottom = tabTop + getTabBarTotalHeight();
	if (pointerAuxJustPressed && handleTabBarMiddleClick(snapshot)) {
		if (playerInput) {
			playerInput.consumeAction('pointer_aux');
		}
		ide_state.pointerSelecting = false;
		ide_state.pointerPrimaryWasPressed = snapshot.primaryPressed;
		resetPointerClickTracking();
		clearGotoHoverHighlight();
		return;
	}
	if (justPressed && snapshot.viewportY >= tabTop && snapshot.viewportY < tabBottom) {
		if (handleTabBarPointer(snapshot)) {
			ide_state.pointerSelecting = false;
			ide_state.pointerPrimaryWasPressed = snapshot.primaryPressed;
			resetPointerClickTracking();
			clearGotoHoverHighlight();
			return;
		}
	}
	const panelBounds = ide_state.resourcePanel.getBounds();
	const pointerInPanel = ide_state.resourcePanelVisible
		&& panelBounds !== null
		&& pointInRect(snapshot.viewportX, snapshot.viewportY, panelBounds);
	if (pointerInPanel) {
		ide_state.resourcePanel.setFocused(true);
		resetPointerClickTracking();
		clearHoverTooltip();
		const margin = Math.max(4, ide_state.lineHeight);
		if (snapshot.viewportY < panelBounds.top + margin) {
			ide_state.resourcePanel.scrollBy(-1);
		} else if (snapshot.viewportY >= panelBounds.bottom - margin) {
			ide_state.resourcePanel.scrollBy(1);
		}
		const hoverIndex = ide_state.resourcePanel.indexAtPosition(snapshot.viewportX, snapshot.viewportY);
		ide_state.resourcePanel.setHoverIndex(hoverIndex);
		if (hoverIndex >= 0) {
			if (hoverIndex !== ide_state.resourceBrowserSelectionIndex) {
				ide_state.resourcePanel.setSelectionIndex(hoverIndex);
			}
			if (justPressed) {
				ide_state.resourcePanel.openSelected();
				ide_state.resourcePanel.setFocused(false);
			}
		}
		if (!snapshot.primaryPressed && hoverIndex === -1) {
			ide_state.resourcePanel.setHoverIndex(-1);
		}
		ide_state.pointerSelecting = false;
		ide_state.pointerPrimaryWasPressed = snapshot.primaryPressed;
		clearGotoHoverHighlight();
		const s = ide_state.resourcePanel.getStateForRender();
		ide_state.resourcePanelFocused = s.focused;
		ide_state.resourceBrowserSelectionIndex = s.selectionIndex;
		return;
	}
	if (justPressed && !pointerInPanel) {
		ide_state.resourcePanel.setFocused(false);
	}
	if (ide_state.resourcePanelVisible && !snapshot.primaryPressed) {
		ide_state.resourcePanel.setHoverIndex(-1);
	}
	const problemsBounds = getProblemsPanelBounds();
	if (ide_state.problemsPanel.isVisible() && problemsBounds) {
		const insideProblems = pointInRect(snapshot.viewportX, snapshot.viewportY, problemsBounds);
		if (insideProblems) {
			if (ide_state.problemsPanel.handlePointer(snapshot, justPressed, justReleased, problemsBounds)) {
				ide_state.pointerSelecting = false;
				ide_state.pointerPrimaryWasPressed = snapshot.primaryPressed;
				resetPointerClickTracking();
				clearHoverTooltip();
				clearGotoHoverHighlight();
				return;
			}
		} else if (justPressed) {
			ide_state.problemsPanel.setFocused(false);
		}
	}
	if (isResourceViewActive()) {
		resetPointerClickTracking();
		ide_state.pointerSelecting = false;
		ide_state.pointerPrimaryWasPressed = snapshot.primaryPressed;
		clearHoverTooltip();
		clearGotoHoverHighlight();
		return;
	}
	if (ide_state.pendingActionPrompt) {
		resetPointerClickTracking();
		if (justPressed) {
			handleActionPromptPointer(snapshot);
		}
		ide_state.pointerSelecting = false;
		ide_state.pointerPrimaryWasPressed = snapshot.primaryPressed;
		clearHoverTooltip();
		clearGotoHoverHighlight();
		return;
	}
	const createResourceBounds = getCreateResourceBarBounds();
	if (ide_state.createResourceVisible && createResourceBounds) {
		const insideCreateBar = pointInRect(snapshot.viewportX, snapshot.viewportY, createResourceBounds);
		if (insideCreateBar) {
			if (justPressed) {
				ide_state.createResourceActive = true;
				ide_state.cursorVisible = true;
				resetBlink();
				ide_state.resourcePanelFocused = false;
			}
			const label = 'NEW FILE:';
			const labelX = 4;
			const textLeft = labelX + measureText(label + ' ');
			processInlineFieldPointer(ide_state.createResourceField, textLeft, snapshot.viewportX, justPressed, snapshot.primaryPressed);
			ide_state.pointerSelecting = false;
			ide_state.pointerPrimaryWasPressed = snapshot.primaryPressed;
			clearHoverTooltip();
			clearGotoHoverHighlight();
			return;
		}
		if (justPressed) {
			ide_state.createResourceActive = false;
		}
	}
	const resourceSearchBounds = getResourceSearchBarBounds();
	if (ide_state.resourceSearchVisible && resourceSearchBounds) {
		const insideResourceSearch = pointInRect(snapshot.viewportX, snapshot.viewportY, resourceSearchBounds);
		if (insideResourceSearch) {
			const baseHeight = ide_state.lineHeight + constants.QUICK_OPEN_BAR_MARGIN_Y * 2;
			const fieldBottom = resourceSearchBounds.top + baseHeight;
			const resultsStart = fieldBottom + constants.QUICK_OPEN_RESULT_SPACING;
			if (snapshot.viewportY < fieldBottom) {
				if (justPressed) {
					closeLineJump(false);
					closeSearch(false, true);
					closeSymbolSearch(false);
					ide_state.resourceSearchVisible = true;
					ide_state.resourceSearchActive = true;
					ide_state.resourcePanelFocused = false;
					ide_state.cursorVisible = true;
					resetBlink();
				}
				const label = 'FILE :';
				const labelX = 4;
				const textLeft = labelX + measureText(label + ' ');
				processInlineFieldPointer(ide_state.resourceSearchField, textLeft, snapshot.viewportX, justPressed, snapshot.primaryPressed);
				ide_state.pointerSelecting = false;
				ide_state.pointerPrimaryWasPressed = snapshot.primaryPressed;
				clearHoverTooltip();
				clearGotoHoverHighlight();
				return;
			}
			const rowHeight = resourceSearchEntryHeight();
			const visibleCount = resourceSearchVisibleResultCount();
			let hoverIndex = -1;
			if (snapshot.viewportY >= resultsStart) {
				const relative = snapshot.viewportY - resultsStart;
				const indexWithin = Math.floor(relative / rowHeight);
				if (indexWithin >= 0 && indexWithin < visibleCount) {
					hoverIndex = ide_state.resourceSearchDisplayOffset + indexWithin;
				}
			}
			ide_state.resourceSearchHoverIndex = hoverIndex;
			if (hoverIndex >= 0 && justPressed) {
				if (hoverIndex !== ide_state.resourceSearchSelectionIndex) {
					ide_state.resourceSearchSelectionIndex = hoverIndex;
					ensureResourceSearchSelectionVisible();
				}
				applyResourceSearchSelection(hoverIndex);
				ide_state.pointerSelecting = false;
				ide_state.pointerPrimaryWasPressed = snapshot.primaryPressed;
				clearHoverTooltip();
				clearGotoHoverHighlight();
				return;
			}
			ide_state.pointerSelecting = false;
			ide_state.pointerPrimaryWasPressed = snapshot.primaryPressed;
			clearHoverTooltip();
			clearGotoHoverHighlight();
			return;
		}
		if (justPressed) {
			ide_state.resourceSearchActive = false;
		}
		ide_state.resourceSearchHoverIndex = -1;
	}
	const symbolBounds = getSymbolSearchBarBounds();
	if (ide_state.symbolSearchVisible && symbolBounds) {
		const insideSymbol = pointInRect(snapshot.viewportX, snapshot.viewportY, symbolBounds);
		if (insideSymbol) {
			const baseHeight = ide_state.lineHeight + constants.SYMBOL_SEARCH_BAR_MARGIN_Y * 2;
			const fieldBottom = symbolBounds.top + baseHeight;
			const resultsStart = fieldBottom + constants.SYMBOL_SEARCH_RESULT_SPACING;
			if (snapshot.viewportY < fieldBottom) {
				if (justPressed) {
					closeLineJump(false);
					closeSearch(false, true);
					ide_state.symbolSearchVisible = true;
					ide_state.symbolSearchActive = true;
					ide_state.resourcePanelFocused = false;
					ide_state.cursorVisible = true;
					resetBlink();
				}
				const label = ide_state.symbolSearchGlobal ? 'SYMBOL #:' : 'SYMBOL @:';
				const labelX = 4;
				const textLeft = labelX + measureText(label + ' ');
				processInlineFieldPointer(ide_state.symbolSearchField, textLeft, snapshot.viewportX, justPressed, snapshot.primaryPressed);
				ide_state.pointerSelecting = false;
				ide_state.pointerPrimaryWasPressed = snapshot.primaryPressed;
				clearHoverTooltip();
				clearGotoHoverHighlight();
				return;
			}
			const visibleCount = symbolSearchVisibleResultCount();
			let hoverIndex = -1;
			if (snapshot.viewportY >= resultsStart) {
				const relative = snapshot.viewportY - resultsStart;
				const entryHeight = symbolSearchEntryHeight();
				const indexWithin = entryHeight > 0 ? Math.floor(relative / entryHeight) : -1;
				if (indexWithin >= 0 && indexWithin < visibleCount) {
					hoverIndex = ide_state.symbolSearchDisplayOffset + indexWithin;
				}
			}
			ide_state.symbolSearchHoverIndex = hoverIndex;
			if (hoverIndex >= 0 && justPressed) {
				if (hoverIndex !== ide_state.symbolSearchSelectionIndex) {
					ide_state.symbolSearchSelectionIndex = hoverIndex;
					ensureSymbolSearchSelectionVisible();
				}
				applySymbolSearchSelection(hoverIndex);
				ide_state.pointerSelecting = false;
				ide_state.pointerPrimaryWasPressed = snapshot.primaryPressed;
				clearHoverTooltip();
				clearGotoHoverHighlight();
				return;
			}
			ide_state.pointerSelecting = false;
			ide_state.pointerPrimaryWasPressed = snapshot.primaryPressed;
			clearHoverTooltip();
			clearGotoHoverHighlight();
			return;
		}
		if (justPressed) {
			ide_state.symbolSearchActive = false;
		}
		ide_state.symbolSearchHoverIndex = -1;
	}

	const renameBounds = getRenameBarBounds();
	if (isRenameVisible() && renameBounds) {
		const insideRename = pointInRect(snapshot.viewportX, snapshot.viewportY, renameBounds);
		if (insideRename) {
			if (justPressed) {
				ide_state.resourcePanelFocused = false;
				ide_state.cursorVisible = true;
				resetBlink();
			}
			const label = 'RENAME:';
			const labelX = 4;
			const textLeft = labelX + measureText(label + ' ');
			processInlineFieldPointer(ide_state.renameController.getField(), textLeft, snapshot.viewportX, justPressed, snapshot.primaryPressed);
			ide_state.pointerSelecting = false;
			ide_state.pointerPrimaryWasPressed = snapshot.primaryPressed;
			clearHoverTooltip();
			clearGotoHoverHighlight();
			return;
		}
		if (justPressed) {
			ide_state.renameController.cancel();
		}
	}

	const lineJumpBounds = getLineJumpBarBounds();
	if (ide_state.lineJumpVisible && lineJumpBounds) {
		const insideLineJump = pointInRect(snapshot.viewportX, snapshot.viewportY, lineJumpBounds);
		if (insideLineJump) {
			if (justPressed) {
				closeSearch(false, true);
				ide_state.lineJumpActive = true;
				resetBlink();
			}
			const label = 'LINE #:';
			const labelX = 4;
			const textLeft = labelX + measureText(label + ' ');
			processInlineFieldPointer(ide_state.lineJumpField, textLeft, snapshot.viewportX, justPressed, snapshot.primaryPressed);
			ide_state.pointerSelecting = false;
			ide_state.pointerPrimaryWasPressed = snapshot.primaryPressed;
			clearHoverTooltip();
			clearGotoHoverHighlight();
			return;
		}
		if (justPressed) {
			ide_state.lineJumpActive = false;
		}
	}
	const searchBounds = getSearchBarBounds();
	if (ide_state.searchVisible && searchBounds) {
		const insideSearch = pointInRect(snapshot.viewportX, snapshot.viewportY, searchBounds);
		const baseHeight = ide_state.lineHeight + constants.SEARCH_BAR_MARGIN_Y * 2;
		const fieldBottom = searchBounds.top + baseHeight;
		const visibleResults = searchVisibleResultCount();
		if (insideSearch) {
			ide_state.searchHoverIndex = -1;
			if (snapshot.viewportY < fieldBottom) {
				if (justPressed) {
					closeLineJump(false);
					ide_state.searchVisible = true;
					ide_state.searchActive = true;
					ide_state.resourcePanelFocused = false;
					ide_state.cursorVisible = true;
					resetBlink();
				}
				const label = ide_state.searchScope === 'global' ? 'SEARCH ALL:' : 'SEARCH:';
				const labelX = 4;
				const textLeft = labelX + measureText(label + ' ');
				processInlineFieldPointer(ide_state.searchField, textLeft, snapshot.viewportX, justPressed, snapshot.primaryPressed);
				ide_state.pointerSelecting = false;
				ide_state.pointerPrimaryWasPressed = snapshot.primaryPressed;
				clearHoverTooltip();
				clearGotoHoverHighlight();
				return;
			}
			if (visibleResults > 0) {
				const resultsStart = fieldBottom + constants.SEARCH_RESULT_SPACING;
				const rowHeight = searchResultEntryHeight();
				let hoverIndex = -1;
				if (snapshot.viewportY >= resultsStart) {
					const relative = snapshot.viewportY - resultsStart;
					const indexWithin = Math.floor(relative / rowHeight);
					if (indexWithin >= 0 && indexWithin < visibleResults) {
						hoverIndex = ide_state.searchDisplayOffset + indexWithin;
					}
				}
				ide_state.searchHoverIndex = hoverIndex;
				if (hoverIndex >= 0 && justPressed) {
					if (hoverIndex !== ide_state.searchCurrentIndex) {
						ide_state.searchCurrentIndex = hoverIndex;
						ensureSearchSelectionVisible();
						if (ide_state.searchScope === 'local') {
							applySearchSelection(hoverIndex, { preview: true });
						}
					}
					applySearchSelection(hoverIndex);
					ide_state.pointerSelecting = false;
					ide_state.pointerPrimaryWasPressed = snapshot.primaryPressed;
					clearHoverTooltip();
					clearGotoHoverHighlight();
					return;
				}
				ide_state.pointerSelecting = false;
				ide_state.pointerPrimaryWasPressed = snapshot.primaryPressed;
				clearHoverTooltip();
				clearGotoHoverHighlight();
				return;
			}
		} else if (justPressed) {
			ide_state.searchActive = false;
			ide_state.searchHoverIndex = -1;
		}
	} else {
		ide_state.searchHoverIndex = -1;
	}

	const bounds = getCodeAreaBounds();
	if (processRuntimeErrorOverlayPointer(snapshot, justPressed, bounds.codeTop, bounds.codeRight, bounds.textLeft)) {
		// Keep primary pressed state in sync when overlay handles the event
		ide_state.pointerPrimaryWasPressed = snapshot.primaryPressed;
		return;
	}
	const insideCodeArea = snapshot.viewportY >= bounds.codeTop
		&& snapshot.viewportY < bounds.codeBottom
		&& snapshot.viewportX >= bounds.codeLeft
		&& snapshot.viewportX < bounds.codeRight;
	if (justPressed && insideCodeArea) {
		clearReferenceHighlights();
		ide_state.resourcePanelFocused = false;
		focusEditorFromLineJump();
		focusEditorFromSearch();
		focusEditorFromResourceSearch();
		focusEditorFromSymbolSearch();
		ide_state.completion.closeSession();
		const targetRow = resolvePointerRow(snapshot.viewportY);
		const targetColumn = resolvePointerColumn(targetRow, snapshot.viewportX);
		if (gotoModifierActive && tryGotoDefinitionAt(targetRow, targetColumn)) {
			ide_state.pointerSelecting = false;
			ide_state.pointerPrimaryWasPressed = snapshot.primaryPressed;
			resetPointerClickTracking();
			return;
		}
		const doubleClick = registerPointerClick(targetRow, targetColumn);
		if (doubleClick) {
			selectWordAtPosition(targetRow, targetColumn);
			ide_state.pointerSelecting = false;
		} else {
			ide_state.selectionAnchor = { row: targetRow, column: targetColumn };
			setCursorPosition(targetRow, targetColumn);
			ide_state.pointerSelecting = true;
		}
	}
	if (ide_state.pointerSelecting && snapshot.primaryPressed) {
		clearGotoHoverHighlight();
		handlePointerAutoScroll(snapshot.viewportX, snapshot.viewportY);
		const targetRow = resolvePointerRow(snapshot.viewportY);
		const targetColumn = resolvePointerColumn(targetRow, snapshot.viewportX);
		if (!ide_state.selectionAnchor) {
			ide_state.selectionAnchor = { row: targetRow, column: targetColumn };
		}
		setCursorPosition(targetRow, targetColumn);
	}
	if (isCodeTabActive() && !snapshot.primaryPressed && !ide_state.pointerSelecting && insideCodeArea && gotoModifierActive) {
		const hoverRow = resolvePointerRow(snapshot.viewportY);
		const hoverColumn = resolvePointerColumn(hoverRow, snapshot.viewportX);
		refreshGotoHoverHighlight(hoverRow, hoverColumn, activeContext);
	} else if (!gotoModifierActive || !insideCodeArea || snapshot.primaryPressed || ide_state.pointerSelecting || !isCodeTabActive()) {
		clearGotoHoverHighlight();
	}
	if (isCodeTabActive()) {
		const altDown = isModifierPressedGlobal(ide_state.playerIndex, 'AltLeft') || isModifierPressedGlobal(ide_state.playerIndex, 'AltRight');
		if (!snapshot.primaryPressed && !ide_state.pointerSelecting && insideCodeArea && altDown) {
			updateHoverTooltip(snapshot);
		} else {
			clearHoverTooltip();
		}
	} else {
		clearHoverTooltip();
	}
	ide_state.pointerPrimaryWasPressed = snapshot.primaryPressed;
}

export function updateTabHoverState(snapshot: PointerSnapshot | null): void {
	if (!snapshot || !snapshot.valid || !snapshot.insideViewport) {
		ide_state.tabHoverId = null;
		return;
	}
	const tabTop = ide_state.headerHeight;
	const tabBottom = tabTop + getTabBarTotalHeight();
	const y = snapshot.viewportY;
	if (y < tabTop || y >= tabBottom) {
		ide_state.tabHoverId = null;
		return;
	}
	const x = snapshot.viewportX;
	let hovered: string | null = null;
	for (const [tabId, bounds] of ide_state.tabButtonBounds) {
		if (pointInRect(x, y, bounds)) {
			hovered = tabId;
			break;
		}
	}
	ide_state.tabHoverId = hovered;
}

export function updateHoverTooltip(snapshot: PointerSnapshot): void {
	const context = getActiveCodeTabContext();
	const assetId = resolveHoverAssetId(context);
	const row = resolvePointerRow(snapshot.viewportY);
	const column = resolvePointerColumn(row, snapshot.viewportX);
	const token = extractHoverExpression(row, column);
	if (!token) {
		clearHoverTooltip();
		return;
	}
	const chunkName = resolveHoverChunkName(context);
	const request: ConsoleLuaHoverRequest = {
		assetId,
		expression: token.expression,
		chunkName,
		row: row + 1,
		column: token.startColumn + 1,
	};
	const inspection = safeInspectLuaExpression(request);
	const previousInspection = ide_state.lastInspectorResult;
	ide_state.lastInspectorResult = inspection;
	if (!inspection) {
		clearHoverTooltip();
		return;
	}
	if (inspection.isFunction && (inspection.isLocalFunction || inspection.isBuiltin)) {
		clearHoverTooltip();
		return;
	}
	const contentLines = buildHoverContentLines(inspection);
	const existing = ide_state.hoverTooltip;
	if (existing && existing.expression === inspection.expression && existing.assetId === assetId) {
		existing.contentLines = contentLines;
		existing.valueType = inspection.valueType;
		existing.scope = inspection.scope;
		existing.state = inspection.state;
		existing.assetId = assetId;
		existing.row = row;
		existing.startColumn = token.startColumn;
		existing.endColumn = token.endColumn;
		existing.bubbleBounds = null;
		if (!previousInspection || previousInspection.expression !== inspection.expression) {
			existing.scrollOffset = 0;
			existing.visibleLineCount = 0;
		}
		const maxOffset = Math.max(0, contentLines.length - Math.max(1, existing.visibleLineCount));
		if (existing.scrollOffset > maxOffset) {
			existing.scrollOffset = maxOffset;
		}
		return;
	}
	ide_state.hoverTooltip = {
		expression: inspection.expression,
		contentLines,
		valueType: inspection.valueType,
		scope: inspection.scope,
		state: inspection.state,
		assetId,
		row,
		startColumn: token.startColumn,
		endColumn: token.endColumn,
		scrollOffset: 0,
		visibleLineCount: 0,
		bubbleBounds: null,
	};
}

export function buildHoverContentLines(result: ConsoleLuaHoverResult): string[] {
	return buildHoverContentLinesExternal(result);
}

export function clearHoverTooltip(): void {
	ide_state.hoverTooltip = null;
	ide_state.lastInspectorResult = null;
}

// Scrollbar drag is handled via ide_state.scrollbarController

export function applyScrollbarScroll(kind: ScrollbarKind, scroll: number): void {
	if (Number.isNaN(scroll)) {
		return;
	}
	switch (kind) {
		case 'codeVertical': {
			ensureVisualLines();
			const rowCount = Math.max(1, ide_state.cachedVisibleRowCount);
			const maxScroll = Math.max(0, getVisualLineCount() - rowCount);
			ide_state.scrollRow = clamp(Math.round(scroll), 0, maxScroll);
			ide_state.cursorRevealSuspended = true;
			break;
		}
		case 'codeHorizontal': {
			if (ide_state.wordWrapEnabled) {
				ide_state.scrollColumn = 0;
				break;
			}
			const maxScroll = computeMaximumScrollColumn();
			ide_state.scrollColumn = clamp(Math.round(scroll), 0, maxScroll);
			ide_state.cursorRevealSuspended = true;
			break;
		}
		case 'resourceVertical': {
			ide_state.resourcePanel.setScroll(scroll);
			ide_state.resourcePanel.setFocused(true);
			const s = ide_state.resourcePanel.getStateForRender();
			ide_state.resourcePanelFocused = s.focused;
			break;
		}
		case 'resourceHorizontal': {
			ide_state.resourcePanel.setHScroll(scroll);
			ide_state.resourcePanel.setFocused(true);
			const s = ide_state.resourcePanel.getStateForRender();
			ide_state.resourcePanelFocused = s.focused;
			break;
		}
		case 'viewerVertical': {
			const viewer = getActiveResourceViewer();
			if (!viewer) {
				break;
			}
			const capacity = resourceViewerTextCapacity(viewer);
			const maxScroll = Math.max(0, viewer.lines.length - capacity);
			viewer.scroll = clamp(Math.round(scroll), 0, maxScroll);
			break;
		}
	}
}

export function adjustHoverTooltipScroll(stepCount: number): boolean {
	if (!ide_state.hoverTooltip) {
		return false;
	}
	if (stepCount === 0) {
		return false;
	}
	const tooltip = ide_state.hoverTooltip;
	const totalLines = tooltip.contentLines.length;
	if (totalLines <= tooltip.visibleLineCount || tooltip.visibleLineCount <= 0) {
		const maxVisible = Math.max(1, Math.min(constants.HOVER_TOOLTIP_MAX_VISIBLE_LINES, totalLines));
		if (totalLines <= maxVisible) {
			return false;
		}
		tooltip.visibleLineCount = maxVisible;
	}
	const maxOffset = Math.max(0, totalLines - tooltip.visibleLineCount);
	if (maxOffset === 0) {
		return false;
	}
	const nextOffset = clamp(tooltip.scrollOffset + stepCount, 0, maxOffset);
	if (nextOffset === tooltip.scrollOffset) {
		return false;
	}
	tooltip.scrollOffset = nextOffset;
	return true;
}

export function isPointInHoverTooltip(x: number, y: number): boolean {
	const tooltip = ide_state.hoverTooltip;
	if (!tooltip || !tooltip.bubbleBounds) {
		return false;
	}
	return pointInRect(x, y, tooltip.bubbleBounds);
}

export function pointerHitsHoverTarget(snapshot: PointerSnapshot, tooltip: CodeHoverTooltip): boolean {
	if (!snapshot.valid || !snapshot.insideViewport) {
		return false;
	}
	const bounds = getCodeAreaBounds();
	if (snapshot.viewportY < bounds.codeTop || snapshot.viewportY >= bounds.codeBottom) {
		return false;
	}
	const row = resolvePointerRow(snapshot.viewportY);
	if (row !== tooltip.row) {
		return false;
	}
	const column = resolvePointerColumn(row, snapshot.viewportX);
	return column >= tooltip.startColumn && column <= tooltip.endColumn;
}

export function resolveHoverAssetId(context: CodeTabContext | null): string | null {
	if (context && context.descriptor) {
		return context.descriptor.assetId;
	}
	return ide_state.primaryAssetId;
}

export function resolveHoverChunkName(context: CodeTabContext | null): string | null {
	if (context && context.descriptor) {
		if (context.descriptor.path && context.descriptor.path.length > 0) {
			return context.descriptor.path;
		}
		if (context.descriptor.assetId && context.descriptor.assetId.length > 0) {
			return context.descriptor.assetId;
		}
	}
	if (ide_state.primaryAssetId) {
		return ide_state.primaryAssetId;
	}
	return null;
}

export function buildProjectReferenceContext(context: CodeTabContext | null): {
	environment: ProjectReferenceEnvironment;
	chunkName: string;
	normalizedPath: string | null;
	assetId: string | null;
} {
	const descriptor = context?.descriptor ?? null;
	const normalizedPath = descriptor?.path ? descriptor.path.replace(/\\/g, '/') : null;
	const descriptorAssetId = descriptor?.assetId ?? null;
	const resolvedAssetId = descriptorAssetId ?? ide_state.primaryAssetId ?? null;
	const resolvedChunk = resolveHoverChunkName(context)
		?? normalizedPath
		?? descriptorAssetId
		?? resolvedAssetId
		?? '<console>';
	const environment: ProjectReferenceEnvironment = {
		activeContext: context,
		activeLines: ide_state.lines,
		codeTabContexts: Array.from(ide_state.codeTabContexts.values()),
		listResources: () => listResourcesStrict(),
		loadLuaResource: (resourceId: string) => ide_state.loadLuaResourceFn(resourceId),
	};
	return {
		environment,
		chunkName: resolvedChunk,
		normalizedPath,
		assetId: resolvedAssetId,
	};
}

export function resolveSemanticDefinitionLocation(
	context: CodeTabContext | null,
	expression: string,
	usageRow: number,
	usageColumn: number,
	assetId: string | null,
	chunkName: string | null,
): ConsoleLuaDefinitionLocation | null {
	if (!expression) {
		return null;
	}
	const namePath = expression.split('.');
	if (namePath.length === 0) {
		return null;
	}
	const activeContext = getActiveCodeTabContext();
	const hoverChunkName = resolveHoverChunkName(activeContext);
	const modelChunkName = chunkName ?? hoverChunkName ?? '<console>';
	const model = ide_state.layout.getSemanticModel(ide_state.lines, ide_state.textVersion, modelChunkName);
	if (!model) {
		return null;
	}
	let definition = model.lookupIdentifier(usageRow, usageColumn, namePath);
	if (!definition) {
		definition = findDefinitionAtPosition(model.definitions, usageRow, usageColumn, namePath);
	}
	if (!definition) {
		return null;
	}
	const descriptor = context?.descriptor ?? null;
	const descriptorPath = descriptor?.path ? descriptor.path.replace(/\\/g, '/') : null;
	const descriptorAssetId = descriptor?.assetId ?? null;
	const resolvedAssetId = descriptorAssetId ?? assetId ?? ide_state.primaryAssetId ?? null;
	const resolvedChunk = chunkName
		?? descriptorPath
		?? descriptorAssetId
		?? assetId
		?? ide_state.primaryAssetId
		?? hoverChunkName
		?? '<console>';
	const location: ConsoleLuaDefinitionLocation = {
		chunkName: resolvedChunk,
		assetId: resolvedAssetId,
		range: {
			startLine: definition.definition.start.line,
			startColumn: definition.definition.start.column,
			endLine: definition.definition.end.line,
			endColumn: definition.definition.end.column,
		},
	};
	if (descriptorPath) {
		location.path = descriptorPath;
	} else if (resolvedChunk && resolvedChunk !== '<console>') {
		location.path = resolvedChunk;
	}
	return location;
}

export function findDefinitionAtPosition(
	definitions: readonly LuaDefinitionInfo[],
	row: number,
	column: number,
	namePath: readonly string[],
): LuaDefinitionInfo | null {
	for (let index = 0; index < definitions.length; index += 1) {
		const candidate = definitions[index];
		if (candidate.namePath.length !== namePath.length) {
			continue;
		}
		let matches = true;
		for (let i = 0; i < namePath.length; i += 1) {
			if (candidate.namePath[i] !== namePath[i]) {
				matches = false;
				break;
			}
		}
		if (!matches) {
			continue;
		}
		const range = candidate.definition;
		if (row !== range.start.line) {
			continue;
		}
		if (column < range.start.column || column > range.end.column) {
			continue;
		}
		return candidate;
	}
	return null;
}

export function extractHoverExpression(row: number, column: number): { expression: string; startColumn: number; endColumn: number } | null {
	if (row < 0 || row >= ide_state.lines.length) {
		return null;
	}
	const line = ide_state.lines[row] ?? '';
	const safeColumn = Math.min(Math.max(column, 0), Math.max(0, line.length));
	if (isLuaCommentContext(ide_state.lines, row, safeColumn)) {
		return null;
	}
	if (line.length === 0) {
		return null;
	}
	const clampedColumn = Math.min(Math.max(column, 0), Math.max(0, line.length - 1));
	let probe = clampedColumn;
	if (!isIdentifierChar(line.charCodeAt(probe))) {
		if (line.charCodeAt(probe) === 46 && probe > 0) {
			probe -= 1;
		}
		else if (probe > 0 && isIdentifierChar(line.charCodeAt(probe - 1))) {
			probe -= 1;
		}
		else {
			return null;
		}
	}
	let expressionStart = probe;
	while (expressionStart > 0 && isIdentifierChar(line.charCodeAt(expressionStart - 1))) {
		expressionStart -= 1;
	}
	if (!isIdentifierStartChar(line.charCodeAt(expressionStart))) {
		return null;
	}
	let expressionEnd = probe + 1;
	while (expressionEnd < line.length && isIdentifierChar(line.charCodeAt(expressionEnd))) {
		expressionEnd += 1;
	}
	// extend to include preceding segments (left of initial segment)
	let left = expressionStart;
	while (left > 0) {
		const dotIndex = left - 1;
		if (line.charCodeAt(dotIndex) !== 46) {
			break;
		}
		let segmentStart = dotIndex - 1;
		while (segmentStart >= 0 && isIdentifierChar(line.charCodeAt(segmentStart))) {
			segmentStart -= 1;
		}
		segmentStart += 1;
		if (segmentStart >= dotIndex) {
			break;
		}
		if (!isIdentifierStartChar(line.charCodeAt(segmentStart))) {
			break;
		}
		left = segmentStart;
	}
	expressionStart = left;
	let right = expressionEnd;
	while (right < line.length) {
		if (line.charCodeAt(right) !== 46) {
			break;
		}
		const identifierStart = right + 1;
		if (identifierStart >= line.length) {
			break;
		}
		if (!isIdentifierStartChar(line.charCodeAt(identifierStart))) {
			break;
		}
		let identifierEnd = identifierStart + 1;
		while (identifierEnd < line.length && isIdentifierChar(line.charCodeAt(identifierEnd))) {
			identifierEnd += 1;
		}
		right = identifierEnd;
	}
	expressionEnd = right;
	if (expressionEnd <= expressionStart) {
		return null;
	}
	const segments: Array<{ text: string; start: number; end: number }> = [];
	let segmentStart = expressionStart;
	while (segmentStart < expressionEnd) {
		let segmentEnd = segmentStart;
		while (segmentEnd < expressionEnd && line.charCodeAt(segmentEnd) !== 46) {
			segmentEnd += 1;
		}
		if (segmentEnd > segmentStart) {
			segments.push({ text: line.slice(segmentStart, segmentEnd), start: segmentStart, end: segmentEnd });
		}
		segmentStart = segmentEnd + 1;
	}
	if (segments.length === 0) {
		return null;
	}
	let pointerColumn = Math.min(column, expressionEnd - 1);
	if (pointerColumn < expressionStart) {
		pointerColumn = expressionStart;
	}
	if (line.charCodeAt(pointerColumn) === 46 && pointerColumn > expressionStart) {
		pointerColumn -= 1;
	}
	let segmentIndex = -1;
	for (let i = 0; i < segments.length; i += 1) {
		const seg = segments[i];
		if (pointerColumn >= seg.start && pointerColumn < seg.end) {
			segmentIndex = i;
			break;
		}
	}
	if (segmentIndex === -1) {
		segmentIndex = segments.length - 1;
	}
	const expression = segments.slice(0, segmentIndex + 1).map(segment => segment.text).join('.');
	if (expression.length === 0) {
		return null;
	}
	const targetSegment = segments[segmentIndex];
	return { expression, startColumn: targetSegment.start, endColumn: targetSegment.end };
}

export function refreshGotoHoverHighlight(row: number, column: number, context: CodeTabContext | null): void {
	const token = extractHoverExpression(row, column);
	if (!token) {
		clearGotoHoverHighlight();
		return;
	}
	const existing = ide_state.gotoHoverHighlight;
	if (existing
		&& existing.row === row
		&& column >= existing.startColumn
		&& column <= existing.endColumn
		&& existing.expression === token.expression) {
		return;
	}
	const assetId = resolveHoverAssetId(context);
	const chunkName = resolveHoverChunkName(context);
	let definition = resolveSemanticDefinitionLocation(context, token.expression, row + 1, token.startColumn + 1, assetId, chunkName);
	if (!definition) {
		const inspection = safeInspectLuaExpression({
			assetId,
			expression: token.expression,
			chunkName,
			row: row + 1,
			column: token.startColumn + 1,
		});
		definition = inspection?.definition ?? null;
	}
	if (!definition) {
		clearGotoHoverHighlight();
		return;
	}
	ide_state.gotoHoverHighlight = {
		row,
		startColumn: token.startColumn,
		endColumn: token.endColumn,
		expression: token.expression,
	};
}

export function clearGotoHoverHighlight(): void {
	ide_state.gotoHoverHighlight = null;
}

export function clearReferenceHighlights(): void {
	ide_state.referenceState.clear();
}

export function tryGotoDefinitionAt(row: number, column: number): boolean {
	const context = getActiveCodeTabContext();
	const descriptor = context?.descriptor ?? null;
	const normalizedPath = descriptor?.path ? descriptor.path.replace(/\\/g, '/') : null;
	const assetId = resolveHoverAssetId(context);
	const token = extractHoverExpression(row, column);
	if (!token) {
		ide_state.showMessage('Definition not found', constants.COLOR_STATUS_WARNING, 1.6);
		return false;
	}
	const chunkName = resolveHoverChunkName(context);
	let definition = resolveSemanticDefinitionLocation(context, token.expression, row + 1, token.startColumn + 1, assetId, chunkName);
	if (!definition) {
		const inspection = safeInspectLuaExpression({
			assetId,
			expression: token.expression,
			chunkName,
			row: row + 1,
			column: token.startColumn + 1,
		});
		definition = inspection?.definition ?? null;
	}
	if (!definition) {
		const resolvedChunkName = chunkName
			?? normalizedPath
			?? descriptor?.assetId
			?? assetId
			?? ide_state.primaryAssetId
			?? '<console>';
		const environment: ProjectReferenceEnvironment = {
			activeContext: context,
			activeLines: ide_state.lines,
			codeTabContexts: Array.from(ide_state.codeTabContexts.values()),
			listResources: () => listResourcesStrict(),
			loadLuaResource: (resourceId: string) => ide_state.loadLuaResourceFn(resourceId),
		};
		const projectDefinition = resolveDefinitionLocationForExpression({
			expression: token.expression,
			environment,
			workspace: ide_state.semanticWorkspace,
			currentChunkName: resolvedChunkName,
			currentLines: ide_state.lines,
			currentAssetId: assetId,
			sourceLabelPath: normalizedPath ?? descriptor?.assetId ?? null,
		});
		if (projectDefinition) {
			navigateToLuaDefinition(projectDefinition);
			return true;
		}
		if (!ide_state.inspectorRequestFailed) {
			ide_state.showMessage(`Definition not found for ${token.expression}`, constants.COLOR_STATUS_WARNING, 1.8);
		}
		return false;
	}
	navigateToLuaDefinition(definition);
	return true;
}

export function navigateToLuaDefinition(definition: ConsoleLuaDefinitionLocation): void {
	const navigationCheckpoint = beginNavigationCapture();
	clearReferenceHighlights();
	const hint: { assetId: string | null; path?: string | null } = { assetId: definition.assetId };
	if (definition.path !== undefined) {
		hint.path = definition.path;
	}
	let targetContextId: string | null = null;
	try {
		focusChunkSource(definition.chunkName, hint);
		const context = findCodeTabContext(definition.assetId ?? null, definition.chunkName ?? null);
		if (context) {
			targetContextId = context.id;
		}
	} catch (error) {
		const message = error instanceof Error ? error.message : String(error);
		ide_state.showMessage(`Failed to open definition: ${message}`, constants.COLOR_STATUS_ERROR, 3.2);
		return;
	}
	if (targetContextId) {
		setActiveTab(targetContextId);
	} else {
		activateCodeTab();
	}
	applyDefinitionSelection(definition.range);
	ide_state.cursorRevealSuspended = false;
	clearHoverTooltip();
	clearGotoHoverHighlight();
	completeNavigation(navigationCheckpoint);
	ide_state.showMessage('Jumped to definition', constants.COLOR_STATUS_SUCCESS, 1.6);
}

export function applyDefinitionSelection(range: ConsoleLuaDefinitionLocation['range']): void {
	const lastRowIndex = Math.max(0, ide_state.lines.length - 1);
	const startRow = clamp(range.startLine - 1, 0, lastRowIndex);
	const startLine = ide_state.lines[startRow] ?? '';
	const startColumn = clamp(range.startColumn - 1, 0, startLine.length);
	ide_state.cursorRow = startRow;
	ide_state.cursorColumn = startColumn;
	ide_state.selectionAnchor = null;
	ide_state.pointerSelecting = false;
	ide_state.pointerPrimaryWasPressed = false;
	ide_state.pointerAuxWasPressed = false;
	updateDesiredColumn();
	resetBlink();
	ide_state.cursorRevealSuspended = false;
	ensureCursorVisible();
}

export function beginNavigationCapture(): NavigationHistoryEntry | null {
	if (ide_state.navigationCaptureSuspended) {
		return null;
	}
	if (!ide_state.navigationHistory.current) {
		ide_state.navigationHistory.current = createNavigationEntry();
	}
	const current = ide_state.navigationHistory.current;
	return current ? cloneNavigationEntry(current) : null;
}

export function completeNavigation(previous: NavigationHistoryEntry | null): void {
	if (ide_state.navigationCaptureSuspended) {
		return;
	}
	const next = createNavigationEntry();
	if (previous && (!next || !areNavigationEntriesEqual(previous, next))) {
		const backStack = ide_state.navigationHistory.back;
		const lastBack = backStack[backStack.length - 1] ?? null;
		if (!lastBack || !areNavigationEntriesEqual(lastBack, previous)) {
			pushNavigationEntry(backStack, previous);
		}
		ide_state.navigationHistory.forward.length = 0;
	} else if (previous && next && areNavigationEntriesEqual(previous, next)) {
		// Same location; do not mutate stacks.
	} else if (previous === null && next) {
		ide_state.navigationHistory.forward.length = 0;
	}
	ide_state.navigationHistory.current = next;
}

export function pushNavigationEntry(stack: NavigationHistoryEntry[], entry: NavigationHistoryEntry): void {
	stack.push(entry);
	const overflow = stack.length - NAVIGATION_HISTORY_LIMIT;
	if (overflow > 0) {
		stack.splice(0, overflow);
	}
}

export function areNavigationEntriesEqual(a: NavigationHistoryEntry, b: NavigationHistoryEntry): boolean {
	return a.contextId === b.contextId
		&& a.assetId === b.assetId
		&& a.chunkName === b.chunkName
		&& a.path === b.path
		&& a.row === b.row
		&& a.column === b.column;
}

export function cloneNavigationEntry(entry: NavigationHistoryEntry): NavigationHistoryEntry {
	return { ...entry };
}

export function createNavigationEntry(): NavigationHistoryEntry | null {
	if (!isCodeTabActive()) {
		return null;
	}
	const context = getActiveCodeTabContext();
	if (!context) {
		return null;
	}
	const assetId = resolveHoverAssetId(context);
	const chunkName = resolveHoverChunkName(context);
	const path = context.descriptor?.path ?? null;
	const maxRowIndex = ide_state.lines.length > 0 ? ide_state.lines.length - 1 : 0;
	const row = clamp(ide_state.cursorRow, 0, maxRowIndex);
	const line = ide_state.lines[row] ?? '';
	const column = clamp(ide_state.cursorColumn, 0, line.length);
	return {
		contextId: context.id,
		assetId,
		chunkName,
		path,
		row,
		column,
	};
}

export function withNavigationCaptureSuspended<T>(operation: () => T): T {
	const previous = ide_state.navigationCaptureSuspended;
	ide_state.navigationCaptureSuspended = true;
	try {
		return operation();
	} finally {
		ide_state.navigationCaptureSuspended = previous;
	}
}

export function applyNavigationEntry(entry: NavigationHistoryEntry): void {
	const existingContext = ide_state.codeTabContexts.get(entry.contextId) ?? null;
	if (existingContext) {
		setActiveTab(entry.contextId);
	} else {
		const hint: { assetId: string | null; path?: string | null } = { assetId: entry.assetId };
		if (entry.path) {
			hint.path = entry.path;
		}
		focusChunkSource(entry.chunkName, hint);
		if (entry.contextId) {
			setActiveTab(entry.contextId);
		}
	}
	if (!isCodeTabActive()) {
		activateCodeTab();
	}
	if (!isCodeTabActive()) {
		return;
	}
	const maxRowIndex = ide_state.lines.length > 0 ? ide_state.lines.length - 1 : 0;
	const targetRow = clamp(entry.row, 0, maxRowIndex);
	const line = ide_state.lines[targetRow] ?? '';
	const targetColumn = clamp(entry.column, 0, line.length);
	setCursorPosition(targetRow, targetColumn);
	clearSelection();
	ide_state.cursorRevealSuspended = false;
	ensureCursorVisible();
}

export function goBackwardInNavigationHistory(): void {
	if (ide_state.navigationHistory.back.length === 0) {
		return;
	}
	const currentEntry = createNavigationEntry();
	if (currentEntry) {
		const forwardStack = ide_state.navigationHistory.forward;
		const lastForward = forwardStack[forwardStack.length - 1] ?? null;
		if (!lastForward || !areNavigationEntriesEqual(lastForward, currentEntry)) {
			pushNavigationEntry(forwardStack, currentEntry);
		}
	} else {
		ide_state.navigationHistory.forward.length = 0;
	}
	const target = ide_state.navigationHistory.back.pop()!;
	withNavigationCaptureSuspended(() => {
		applyNavigationEntry(target);
	});
	ide_state.navigationHistory.current = createNavigationEntry();
}

export function goForwardInNavigationHistory(): void {
	if (ide_state.navigationHistory.forward.length === 0) {
		return;
	}
	const currentEntry = createNavigationEntry();
	if (currentEntry) {
		const backStack = ide_state.navigationHistory.back;
		const lastBack = backStack[backStack.length - 1] ?? null;
		if (!lastBack || !areNavigationEntriesEqual(lastBack, currentEntry)) {
			pushNavigationEntry(backStack, currentEntry);
		}
	}
	const target = ide_state.navigationHistory.forward.pop()!;
	withNavigationCaptureSuspended(() => {
		applyNavigationEntry(target);
	});
	ide_state.navigationHistory.current = createNavigationEntry();
}

export function handleActionPromptPointer(snapshot: PointerSnapshot): void {
	if (!ide_state.pendingActionPrompt) {
		return;
	}
	const x = snapshot.viewportX;
	const y = snapshot.viewportY;
	const saveBounds = ide_state.actionPromptButtons.saveAndContinue;
	if (saveBounds && pointInRect(x, y, saveBounds)) {
		void handleActionPromptSelection('save-continue');
		return;
	}
	if (pointInRect(x, y, ide_state.actionPromptButtons.continue)) {
		void handleActionPromptSelection('continue');
		return;
	}
	if (pointInRect(x, y, ide_state.actionPromptButtons.cancel)) {
		void handleActionPromptSelection('cancel');
	}
}

export function handleTopBarPointer(snapshot: PointerSnapshot): boolean {
	const y = snapshot.viewportY;
	if (y < 0 || y >= ide_state.headerHeight) {
		return false;
	}
	const x = snapshot.viewportX;
	if (pointInRect(x, y, ide_state.topBarButtonBounds.resume)) {
		handleTopBarButtonPress('resume');
		return true;
	}
	if (pointInRect(x, y, ide_state.topBarButtonBounds.reboot)) {
		handleTopBarButtonPress('reboot');
		return true;
	}
	if (ide_state.dirty && pointInRect(x, y, ide_state.topBarButtonBounds.save)) {
		handleTopBarButtonPress('save');
		return true;
	}
	if (pointInRect(x, y, ide_state.topBarButtonBounds.resources)) {
		handleTopBarButtonPress('resources');
		return true;
	}
	if (pointInRect(x, y, ide_state.topBarButtonBounds.problems)) {
		handleTopBarButtonPress('problems');
		return true;
	}
	if (ide_state.resourcePanelVisible && pointInRect(x, y, ide_state.topBarButtonBounds.filter)) {
		handleTopBarButtonPress('filter');
		return true;
	}
	if (pointInRect(x, y, ide_state.topBarButtonBounds.wrap)) {
		handleTopBarButtonPress('wrap');
		return true;
	}
	if (pointInRect(x, y, ide_state.topBarButtonBounds.resolution)) {
		handleTopBarButtonPress('resolution');
		return true;
	}
	return false;
}

export function handleTabBarPointer(snapshot: PointerSnapshot): boolean {
	const tabTop = ide_state.headerHeight;
	const tabBottom = tabTop + getTabBarTotalHeight();
	const y = snapshot.viewportY;
	if (y < tabTop || y >= tabBottom) {
		return false;
	}
	const x = snapshot.viewportX;
	for (let index = 0; index < ide_state.tabs.length; index += 1) {
		const tab = ide_state.tabs[index];
		const closeBounds = ide_state.tabCloseButtonBounds.get(tab.id);
		if (closeBounds && pointInRect(x, y, closeBounds)) {
			endTabDrag();
			closeTab(tab.id);
			ide_state.tabHoverId = null;
			return true;
		}
		const tabBounds = ide_state.tabButtonBounds.get(tab.id);
		if (tabBounds && pointInRect(x, y, tabBounds)) {
			beginTabDrag(tab.id, x);
			setActiveTab(tab.id);
			return true;
		}
	}
	return false;
}

export function handleTabBarMiddleClick(snapshot: PointerSnapshot): boolean {
	const tabTop = ide_state.headerHeight;
	const tabBottom = tabTop + getTabBarTotalHeight();
	const y = snapshot.viewportY;
	if (y < tabTop || y >= tabBottom) {
		return false;
	}
	const x = snapshot.viewportX;
	for (let index = 0; index < ide_state.tabs.length; index += 1) {
		const tab = ide_state.tabs[index];
		if (!tab.closable) {
			continue;
		}
		const bounds = ide_state.tabButtonBounds.get(tab.id);
		if (!bounds) {
			continue;
		}
		if (pointInRect(x, y, bounds)) {
			closeTab(tab.id);
			return true;
		}
	}
	return false;
}

export function handlePointerWheel(): void {
	const playerInput = $.input.getPlayerInput(ide_state.playerIndex);
	if (!playerInput) {
		return;
	}
	const wheelAction = playerInput.getActionState('pointer_wheel');
	if (wheelAction.consumed === true) {
		return;
	}
	const delta = typeof wheelAction.value === 'number' ? wheelAction.value : 0;
	if (!Number.isFinite(delta) || delta === 0) {
		return;
	}
	const magnitude = Math.abs(delta);
	const steps = Math.max(1, Math.round(magnitude / constants.WHEEL_SCROLL_STEP));
	const direction = delta > 0 ? 1 : -1;
	const pointer = ide_state.lastPointerSnapshot;
	const shiftDown = isModifierPressedGlobal(ide_state.playerIndex, 'ShiftLeft') || isModifierPressedGlobal(ide_state.playerIndex, 'ShiftRight');
	if (ide_state.hoverTooltip) {
		let canScrollTooltip = false;
		if (!pointer) {
			canScrollTooltip = true;
		} else if (pointer.valid && pointer.insideViewport) {
			if (isPointInHoverTooltip(pointer.viewportX, pointer.viewportY) || pointerHitsHoverTarget(pointer, ide_state.hoverTooltip)) {
				canScrollTooltip = true;
			}
		}
		if (canScrollTooltip && adjustHoverTooltipScroll(direction * steps)) {
			playerInput.consumeAction('pointer_wheel');
			return;
		}
	}
	if (ide_state.resourceSearchVisible) {
		const bounds = getResourceSearchBarBounds();
		const pointerInQuickOpen = bounds !== null
			&& pointer
			&& pointer.valid
			&& pointer.insideViewport
			&& pointInRect(pointer.viewportX, pointer.viewportY, bounds);
		if (pointerInQuickOpen || ide_state.resourceSearchActive) {
			moveResourceSearchSelection(direction * steps);
			playerInput.consumeAction('pointer_wheel');
			return;
		}
	}
	const panelBounds = ide_state.resourcePanel.getBounds();
	const pointerInPanel = ide_state.resourcePanelVisible
		&& panelBounds !== null
		&& pointer
		&& pointer.valid
		&& pointer.insideViewport
		&& pointInRect(pointer.viewportX, pointer.viewportY, panelBounds);
	if (pointerInPanel) {
		if (shiftDown) {
			const horizontalPixels = direction * steps * ide_state.charAdvance * 4;
			scrollResourceBrowserHorizontal(horizontalPixels);
			resourceBrowserEnsureSelectionVisible();
		} else {
			scrollResourceBrowser(direction * steps);
		}
		playerInput.consumeAction('pointer_wheel');
		return;
	}
	if (ide_state.problemsPanel.isVisible()) {
		const bounds = getProblemsPanelBounds();
		if (bounds) {
			let allowScroll = false;
			if (!pointer) {
				allowScroll = ide_state.problemsPanel.isFocused();
			} else if (pointer.valid && pointer.insideViewport && pointInRect(pointer.viewportX, pointer.viewportY, bounds)) {
				allowScroll = true;
			}
			const stepsAbs = Math.max(1, Math.round(Math.abs(steps)));
			if (ide_state.problemsPanel.isFocused()) {
				// Match quick-open/symbol behavior: focused wheel moves selection
				for (let i = 0; i < stepsAbs; i += 1) {
					void ide_state.problemsPanel.handleKeyboardCommand(direction > 0 ? 'down' : 'up');
				}
				playerInput.consumeAction('pointer_wheel');
				return;
			}
			if (allowScroll && ide_state.problemsPanel.handlePointerWheel(direction, stepsAbs)) {
				playerInput.consumeAction('pointer_wheel');
				return;
			}
		}
	}
	if (ide_state.completion.handlePointerWheel(direction, steps, pointer && pointer.valid && pointer.insideViewport ? { x: pointer.viewportX, y: pointer.viewportY } : null)) {
		playerInput.consumeAction('pointer_wheel');
		return;
	}
	if (isResourceViewActive()) {
		scrollResourceViewer(direction * steps);
		playerInput.consumeAction('pointer_wheel');
		return;
	}
	if (isCodeTabActive() && pointer) {
		const bounds = getCodeAreaBounds();
		if (!pointer.valid || !pointer.insideViewport || pointer.viewportY < bounds.codeTop || pointer.viewportY >= bounds.codeBottom || pointer.viewportX < bounds.codeLeft || pointer.viewportX >= bounds.codeRight) {
			playerInput.consumeAction('pointer_wheel');
			return;
		}
	}
	scrollRows(direction * steps);
	ide_state.cursorRevealSuspended = true;
	playerInput.consumeAction('pointer_wheel');
}

export function handleTopBarButtonPress(button: TopBarButtonId): void {
	switch (button) {
		case 'problems':
			toggleProblemsPanel();
			return;
		case 'filter':
			toggleResourcePanelFilterMode();
			return;
		case 'wrap':
			toggleWordWrap();
			return;
		case 'resolution':
			toggleResolutionMode();
			return;
		case 'resources':
			toggleResourcePanel();
			return;
		case 'save':
			if (ide_state.dirty) {
				void save();
			}
			return;
		case 'resume':
		case 'reboot':
			activateCodeTab();
			if (ide_state.dirty) {
				openActionPrompt(button);
				return;
			}
			performAction(button);
			return;
	}
}

export function openActionPrompt(action: PendingActionPrompt['action']): void {
	activateCodeTab();
	ide_state.pendingActionPrompt = { action };
	ide_state.actionPromptButtons.saveAndContinue = null;
	ide_state.actionPromptButtons.continue = { left: 0, top: 0, right: 0, bottom: 0 };
	ide_state.actionPromptButtons.cancel = { left: 0, top: 0, right: 0, bottom: 0 };
	ide_state.pointerSelecting = false;
	ide_state.pointerPrimaryWasPressed = false;
}

export async function handleActionPromptSelection(choice: 'save-continue' | 'continue' | 'cancel'): Promise<void> {
	if (!ide_state.pendingActionPrompt) {
		return;
	}
	if (choice === 'cancel') {
		resetActionPromptState();
		return;
	}
	if (choice === 'save-continue') {
		const saved = await attemptPromptSave(ide_state.pendingActionPrompt.action);
		if (!saved) {
			return;
		}
	}
	const success = executePendingAction();
	if (success) {
		resetActionPromptState();
	}
}

export async function attemptPromptSave(action: PendingActionPrompt['action']): Promise<boolean> {
	if (action === 'close') {
		await save();
		return ide_state.dirty === false;
	}
	await save();
	return ide_state.dirty === false;
}

export function executePendingAction(): boolean {
	const prompt = ide_state.pendingActionPrompt;
	if (!prompt) {
		return false;
	}
	return performAction(prompt.action);
}

export function performAction(action: PendingActionPrompt['action']): boolean {
	if (action === 'resume') {
		return performResume();
	}
	if (action === 'reboot') {
		return performReboot();
	}
	if (action === 'close') {
		deactivate();
		return true;
	}
	return false;
}

export function performResume(): boolean {
	const runtime = getConsoleRuntime();
	if (!runtime) {
		ide_state.showMessage('Console runtime unavailable.', constants.COLOR_STATUS_ERROR, 4.0);
		return false;
	}
	if (!runtime.isLuaRuntimeFailed() && !hasPendingRuntimeReload()) {
		clearExecutionStopHighlights();
		deactivate();
		$.paused = false;
		return true;
	}
	let snapshot: unknown = null;
	try {
		snapshot = runtime.getState();
	} catch (error) {
		const message = error instanceof Error ? error.message : String(error);
		ide_state.showMessage(`Failed to capture runtime state: ${message}`, constants.COLOR_STATUS_ERROR, 4.0);
		return false;
	}
	const sanitizedSnapshot = prepareRuntimeSnapshotForResume(snapshot);
	if (!sanitizedSnapshot) {
		ide_state.showMessage('Runtime state unavailable.', constants.COLOR_STATUS_ERROR, 4.0);
		return false;
	}
	const targetGeneration = ide_state.saveGeneration;
	const shouldUpdateGeneration = hasPendingRuntimeReload();
	clearExecutionStopHighlights();
	deactivate();
	scheduleRuntimeTask(() => {
		runtime.resumeFromSnapshot(sanitizedSnapshot);
		if (shouldUpdateGeneration) {
			ide_state.appliedGeneration = targetGeneration;
		}
		$.paused = false;
	}, (error) => {
		handleRuntimeTaskError(error, 'Failed to resume game');
	});
	return true;
}

export function performReboot(): boolean {
	const runtime = getConsoleRuntime();
	if (!runtime) {
		ide_state.showMessage('Console runtime unavailable.', constants.COLOR_STATUS_ERROR, 4.0);
		return false;
	}
	const requiresReload = hasPendingRuntimeReload();
	const savedSource = requiresReload ? getMainProgramSourceForReload() : null;
	const targetGeneration = ide_state.saveGeneration;
	clearExecutionStopHighlights();
	deactivate();
	scheduleRuntimeTask(async () => {
		if (requiresReload && savedSource !== null) {
			await runtime.reloadLuaProgram(savedSource);
		}
		runtime.boot('editor:reboot');
		ide_state.appliedGeneration = targetGeneration;
		$.paused = false;
	}, (error) => {
		handleRuntimeTaskError(error, 'Failed to reboot game');
	});
	return true;
}

// Indentation adjustments delegated to base class implementation.


export function toggleLineComments(): void {
	const range = getLineRangeForMovement();
	if (range.startRow < 0 || range.endRow < range.startRow) {
		return;
	}
	let allCommented = true;
	for (let row = range.startRow; row <= range.endRow; row++) {
		const line = ide_state.lines[row];
		const commentIndex = firstNonWhitespaceIndex(line);
		if (commentIndex >= line.length) {
			allCommented = false;
			break;
		}
		if (!line.startsWith('--', commentIndex)) {
			allCommented = false;
			break;
		}
	}
	if (allCommented) {
		removeLineComments(range);
	} else {
		addLineComments(range);
	}
}

export function addLineComments(range?: { startRow: number; endRow: number }): void {
	const target = range ?? getLineRangeForMovement();
	if (target.startRow < 0 || target.endRow < target.startRow) {
		return;
	}
	prepareUndo('comment-ide_state.lines', false);
	let changed = false;
	for (let row = target.startRow; row <= target.endRow; row++) {
		const originalLine = ide_state.lines[row];
		const insertIndex = firstNonWhitespaceIndex(originalLine);
		const hasContent = insertIndex < originalLine.length;
		let insertion = '--';
		if (hasContent) {
			const nextChar = originalLine.charAt(insertIndex);
			if (nextChar !== ' ' && nextChar !== '\t') {
				insertion = '-- ';
			}
		}
		const updatedLine = originalLine.slice(0, insertIndex) + insertion + originalLine.slice(insertIndex);
		ide_state.lines[row] = updatedLine;
		invalidateLine(row);
		shiftPositionsForInsertion(row, insertIndex, insertion.length);
		changed = true;
	}
	if (!changed) {
		return;
	}
	clampCursorColumn();
	ide_state.selectionAnchor = clampSelectionPosition(ide_state.selectionAnchor);
	markTextMutated();
	resetBlink();
	updateDesiredColumn();
	revealCursor();
}

export function removeLineComments(range?: { startRow: number; endRow: number }): void {
	const target = range ?? getLineRangeForMovement();
	if (target.startRow < 0 || target.endRow < target.startRow) {
		return;
	}
	prepareUndo('uncomment-ide_state.lines', false);
	let changed = false;
	for (let row = target.startRow; row <= target.endRow; row++) {
		const originalLine = ide_state.lines[row];
		const commentIndex = firstNonWhitespaceIndex(originalLine);
		if (commentIndex >= originalLine.length) {
			continue;
		}
		if (!originalLine.startsWith('--', commentIndex)) {
			continue;
		}
		let removal = 2;
		if (commentIndex + 2 < originalLine.length) {
			const trailing = originalLine.charAt(commentIndex + 2);
			if (trailing === ' ') {
				removal = 3;
			}
		}
		const updatedLine = originalLine.slice(0, commentIndex) + originalLine.slice(commentIndex + removal);
		ide_state.lines[row] = updatedLine;
		invalidateLine(row);
		shiftPositionsForRemoval(row, commentIndex, removal);
		changed = true;
	}
	if (!changed) {
		return;
	}
	clampCursorColumn();
	ide_state.selectionAnchor = clampSelectionPosition(ide_state.selectionAnchor);
	markTextMutated();
	resetBlink();
	updateDesiredColumn();
	revealCursor();
}

export function firstNonWhitespaceIndex(value: string): number {
	for (let index = 0; index < value.length; index++) {
		const ch = value.charAt(index);
		if (ch !== ' ' && ch !== '\t') {
			return index;
		}
	}
	return value.length;
}

export function shiftPositionsForInsertion(row: number, column: number, length: number): void {
	if (length <= 0) {
		return;
	}
	if (ide_state.cursorRow === row && ide_state.cursorColumn >= column) {
		ide_state.cursorColumn += length;
	}
	if (ide_state.selectionAnchor && ide_state.selectionAnchor.row === row && ide_state.selectionAnchor.column >= column) {
		ide_state.selectionAnchor.column += length;
	}
}

export function shiftPositionsForRemoval(row: number, column: number, length: number): void {
	if (length <= 0) {
		return;
	}
	if (ide_state.cursorRow === row && ide_state.cursorColumn > column) {
		if (ide_state.cursorColumn <= column + length) {
			ide_state.cursorColumn = column;
		} else {
			ide_state.cursorColumn -= length;
		}
	}
	if (ide_state.selectionAnchor && ide_state.selectionAnchor.row === row && ide_state.selectionAnchor.column > column) {
		if (ide_state.selectionAnchor.column <= column + length) {
			ide_state.selectionAnchor.column = column;
		} else {
			ide_state.selectionAnchor.column -= length;
		}
	}
}

export function readPointerSnapshot(): PointerSnapshot | null {
	const playerInput = $.input.getPlayerInput(ide_state.playerIndex);
	if (!playerInput) {
		return null;
	}
	const primaryAction = playerInput.getActionState('pointer_primary');
	const primaryPressed = primaryAction.pressed === true && primaryAction.consumed !== true;

	const positionAction = playerInput.getActionState('pointer_position');
	const coords = positionAction.value2d;
	if (!coords) {
		return {
			viewportX: 0,
			viewportY: 0,
			insideViewport: false,
			valid: false,
			primaryPressed,
		};
	}
	const mapped = mapScreenPointToViewport(coords[0], coords[1]);
	return {
		viewportX: mapped.x,
		viewportY: mapped.y,
		insideViewport: mapped.inside,
		valid: mapped.valid,
		primaryPressed,
	};
}

export function mapScreenPointToViewport(screenX: number, screenY: number): { x: number; y: number; inside: boolean; valid: boolean } {
	const view = $.view;
	if (!view) {
		return { x: 0, y: 0, inside: false, valid: false };
	}
	const rect = view.surface.measureDisplay();
	const width = rect.width;
	const height = rect.height;
	if (width <= 0 || height <= 0) {
		return { x: 0, y: 0, inside: false, valid: false };
	}
	const relativeX = screenX - rect.left;
	const relativeY = screenY - rect.top;
	const inside = relativeX >= 0 && relativeX < width && relativeY >= 0 && relativeY < height;
	const viewportX = (relativeX / width) * ide_state.viewportWidth;
	const viewportY = (relativeY / height) * ide_state.viewportHeight;
	return { x: viewportX, y: viewportY, inside, valid: true };
}

export function getCodeAreaBounds(): { codeTop: number; codeBottom: number; codeLeft: number; codeRight: number; gutterLeft: number; gutterRight: number; textLeft: number; } {
	const codeTop = codeViewportTop();
	const codeBottom = ide_state.viewportHeight - bottomMargin();
	const codeLeft = ide_state.resourcePanelVisible ? getResourcePanelWidth() : 0;
	const codeRight = ide_state.viewportWidth;
	const gutterLeft = codeLeft;
	const gutterRight = gutterLeft + ide_state.gutterWidth;
	const textLeft = gutterRight + 2;
	return { codeTop, codeBottom, codeLeft, codeRight, gutterLeft, gutterRight, textLeft };
}

export function resolvePointerRow(viewportY: number): number {
	ensureVisualLines();
	const bounds = getCodeAreaBounds();
	const relativeY = viewportY - bounds.codeTop;
	const lineOffset = Math.floor(relativeY / ide_state.lineHeight);
	let visualIndex = ide_state.scrollRow + lineOffset;
	const visualCount = getVisualLineCount();
	if (visualIndex < 0) {
		visualIndex = 0;
	}
	if (visualCount > 0 && visualIndex > visualCount - 1) {
		visualIndex = visualCount - 1;
	}
	const segment = visualIndexToSegment(visualIndex);
	if (!segment) {
		ide_state.lastPointerRowResolution = null;
		return clamp(visualIndex, 0, Math.max(0, ide_state.lines.length - 1));
	}
	ide_state.lastPointerRowResolution = { visualIndex, segment };
	return segment.row;
}

export function resolvePointerColumn(row: number, viewportX: number): number {
	const bounds = getCodeAreaBounds();
	const textLeft = bounds.textLeft;
	const line = ide_state.lines[row] ?? '';
	if (line.length === 0) {
		return 0;
	}
	const entry = getCachedHighlight(row);
	const highlight = entry.hi;
	let segmentStartColumn = ide_state.scrollColumn;
	let segmentEndColumn = line.length;
	const resolvedSegment = ide_state.lastPointerRowResolution?.segment;
	if (ide_state.wordWrapEnabled && resolvedSegment && resolvedSegment.row === row) {
		segmentStartColumn = resolvedSegment.startColumn;
		segmentEndColumn = resolvedSegment.endColumn;
	}
	if (ide_state.wordWrapEnabled) {
		if (segmentStartColumn < 0) {
			segmentStartColumn = 0;
		}
		if (segmentEndColumn < segmentStartColumn) {
			segmentEndColumn = segmentStartColumn;
		}
	} else {
		segmentStartColumn = Math.min(segmentStartColumn, line.length);
		segmentEndColumn = line.length;
	}
	const effectiveStartColumn = clamp(segmentStartColumn, 0, line.length);
	const startDisplay = columnToDisplay(highlight, effectiveStartColumn);
	const offset = viewportX - textLeft;
	if (offset <= 0) {
		return effectiveStartColumn;
	}
	const baseAdvance = entry.advancePrefix[startDisplay] ?? 0;
	const target = baseAdvance + offset;
	const lower = lowerBound(entry.advancePrefix, target, startDisplay + 1, entry.advancePrefix.length);
	let displayIndex = lower - 1;
	if (displayIndex < startDisplay) {
		displayIndex = startDisplay;
	}
	if (displayIndex >= highlight.chars.length) {
		return ide_state.wordWrapEnabled ? Math.min(segmentEndColumn, line.length) : line.length;
	}
	const left = entry.advancePrefix[displayIndex];
	const right = entry.advancePrefix[displayIndex + 1];
	const midpoint = left + (right - left) * 0.5;
	let column = entry.displayToColumn[displayIndex];
	if (column === undefined) {
		column = line.length;
	}
	if (target >= midpoint) {
		column += 1;
	}
	if (ide_state.wordWrapEnabled) {
		if (column > segmentEndColumn) {
			column = segmentEndColumn;
		}
		if (column < segmentStartColumn) {
			column = segmentStartColumn;
		}
	} else if (column > line.length) {
		column = line.length;
	}
	if (column < 0) {
		column = 0;
	}
	if (column < effectiveStartColumn) {
		column = effectiveStartColumn;
	}
	return column;
}

export function handlePointerAutoScroll(viewportX: number, viewportY: number): void {
	if (!ide_state.pointerSelecting) {
		return;
	}
	const bounds = getCodeAreaBounds();
	ensureVisualLines();
	if (viewportY < bounds.codeTop) {
		if (ide_state.scrollRow > 0) {
			ide_state.scrollRow -= 1;
		}
	}
	else if (viewportY >= bounds.codeBottom) {
		const lastRow = getVisualLineCount() - 1;
		if (ide_state.scrollRow < lastRow) {
			ide_state.scrollRow += 1;
		}
	}
	const maxScrollColumn = computeMaximumScrollColumn();
	if (viewportX < bounds.gutterLeft) {
		return;
	}
	if (!ide_state.wordWrapEnabled) {
		if (viewportX < bounds.textLeft) {
			if (ide_state.scrollColumn > 0) {
				ide_state.scrollColumn -= 1;
			}
		}
		else if (viewportX >= bounds.codeRight) {
			if (ide_state.scrollColumn < maxScrollColumn) {
				ide_state.scrollColumn += 1;
			}
		}
	}
	if (ide_state.scrollRow < 0) {
		ide_state.scrollRow = 0;
	}
	if (ide_state.scrollColumn < 0) {
		ide_state.scrollColumn = 0;
	}
	if (ide_state.wordWrapEnabled) {
		ide_state.scrollColumn = 0;
	}
	const maxScrollRow = Math.max(0, getVisualLineCount() - visibleRowCount());
	if (ide_state.scrollRow > maxScrollRow) {
		ide_state.scrollRow = maxScrollRow;
	}
	if (!ide_state.wordWrapEnabled && ide_state.scrollColumn > maxScrollColumn) {
		ide_state.scrollColumn = maxScrollColumn;
	}
}

export function registerPointerClick(row: number, column: number): boolean {
	const now = $.platform.clock.now();
	const interval = now - ide_state.lastPointerClickTimeMs;
	const sameRow = row === ide_state.lastPointerClickRow;
	const columnDelta = Math.abs(column - ide_state.lastPointerClickColumn);
	const doubleClick = ide_state.lastPointerClickTimeMs > 0
		&& interval <= constants.DOUBLE_CLICK_MAX_INTERVAL_MS
		&& sameRow
		&& columnDelta <= 2;
	ide_state.lastPointerClickTimeMs = now;
	ide_state.lastPointerClickRow = row;
	ide_state.lastPointerClickColumn = column;
	return doubleClick;
}

export function resetPointerClickTracking(): void {
	ide_state.lastPointerClickTimeMs = 0;
	ide_state.lastPointerClickRow = -1;
	ide_state.lastPointerClickColumn = -1;
}

export function scrollRows(deltaRows: number): void {
	if (deltaRows === 0) {
		return;
	}
	ensureVisualLines();
	const maxScrollRow = Math.max(0, getVisualLineCount() - visibleRowCount());
	const targetRow = clamp(ide_state.scrollRow + deltaRows, 0, maxScrollRow);
	ide_state.scrollRow = targetRow;
}

// Cursor movement handled in ConsoleCartEditorTextOps base class.

// Word navigation implemented in base class.

// === InputController host wrappers ===
// Snapshot helpers used by controllers to bracket mutations
export function recordSnapshotPre(key: string): void {
	// Use non-coalesced snapshot to ensure distinct undo step
	prepareUndo(key, false);
}

export function recordSnapshotPost(_key: string): void {
	// Break coalescing to avoid merging unrelated edits
	breakUndoSequence();
}

export function deleteCharLeft(): void {
	backspace();
}

export function deleteCharRight(): void {
	deleteForward();
}

export function insertNewline(): void {
	insertLineBreak();
}

// cursor/grid manipulation now resides in ConsoleCartEditorTextOps base class.

export function applySearchFieldText(value: string, moveCursorToEnd: boolean): void {
	ide_state.searchQuery = value;
	setFieldText(ide_state.searchField, value, moveCursorToEnd);
}

export function applySymbolSearchFieldText(value: string, moveCursorToEnd: boolean): void {
	ide_state.symbolSearchQuery = value;
	setFieldText(ide_state.symbolSearchField, value, moveCursorToEnd);
}

export function applyResourceSearchFieldText(value: string, moveCursorToEnd: boolean): void {
	ide_state.resourceSearchQuery = value;
	setFieldText(ide_state.resourceSearchField, value, moveCursorToEnd);
}

export function applyLineJumpFieldText(value: string, moveCursorToEnd: boolean): void {
	ide_state.lineJumpValue = value;
	setFieldText(ide_state.lineJumpField, value, moveCursorToEnd);
}

export function applyCreateResourceFieldText(value: string, moveCursorToEnd: boolean): void {
	ide_state.createResourcePath = value;
	setFieldText(ide_state.createResourceField, value, moveCursorToEnd);
}

export function inlineFieldMetrics(): InlineFieldMetrics {
	return ide_state.inlineFieldMetricsRef;
}

export function createInlineFieldEditingHandlers(keyboard: KeyboardInput): InlineFieldEditingHandlers {
	return {
		isKeyJustPressed: (code) => isKeyJustPressedGlobal(ide_state.playerIndex, code),
		isKeyTyped: (code) => isKeyTypedGlobal(ide_state.playerIndex, code),
		shouldFireRepeat: (code, deltaSeconds) => ide_state.input.shouldRepeatPublic(keyboard, code, deltaSeconds),
		consumeKey: (code) => consumeKeyboardKey(keyboard, code),
		readClipboard: () => ide_state.customClipboard,
		writeClipboard: (payload, action) => {
			const message = action === 'copy'
				? 'Copied to editor clipboard'
				: 'Cut to editor clipboard';
			void writeClipboard(payload, message);
		},
		onClipboardEmpty: () => {
			ide_state.showMessage('Editor clipboard is empty', constants.COLOR_STATUS_WARNING, 1.5);
		},
	};
}

export function processInlineFieldEditing(field: InlineTextField, keyboard: KeyboardInput, options: InlineInputOptions): boolean {
	return applyInlineFieldEditing(field, options, createInlineFieldEditingHandlers(keyboard));
}

export function processInlineFieldPointer(field: InlineTextField, textLeft: number, pointerX: number, justPressed: boolean, pointerPressed: boolean): void {
	const result = applyInlineFieldPointer(field, {
		metrics: inlineFieldMetrics(),
		textLeft,
		pointerX,
		justPressed,
		pointerPressed,
		now: () => $.platform.clock.now(),
		doubleClickInterval: constants.DOUBLE_CLICK_MAX_INTERVAL_MS,
	});
	if (result.requestBlinkReset) {
		resetBlink();
	}
}

export function updateDesiredColumn(): void {
	ide_state.desiredColumn = ide_state.cursorColumn;
	ide_state.desiredDisplayOffset = 0;
	if (ide_state.cursorRow < 0 || ide_state.cursorRow >= ide_state.lines.length) {
		return;
	}
	const entry = getCachedHighlight(ide_state.cursorRow);
	const highlight = entry.hi;
	const cursorDisplay = columnToDisplay(highlight, ide_state.cursorColumn);
	let segmentStartColumn = 0;
	if (ide_state.wordWrapEnabled) {
		ensureVisualLines();
		const override = caretNavigation.peek(ide_state.cursorRow, ide_state.cursorColumn);
		if (override) {
			segmentStartColumn = override.segmentStartColumn;
		} else {
			const visualIndex = positionToVisualIndex(ide_state.cursorRow, ide_state.cursorColumn);
			const segment = visualIndexToSegment(visualIndex);
			if (segment) {
				segmentStartColumn = segment.startColumn;
			}
		}
	}
	const segmentDisplayStart = columnToDisplay(highlight, segmentStartColumn);
	ide_state.desiredDisplayOffset = cursorDisplay - segmentDisplayStart;
	if (ide_state.desiredDisplayOffset < 0) {
		ide_state.desiredDisplayOffset = 0;
	}
}

export async function save(): Promise<void> {
	const context = getActiveCodeTabContext();
	if (!context) {
		return;
	}
	const source = ide_state.lines.join('\n');
	try {
		await context.save(source);
		ide_state.dirty = false;
		ide_state.saveGeneration = ide_state.saveGeneration + 1;
		context.lastSavedSource = source;
		context.saveGeneration = ide_state.saveGeneration;
		const isEntryContext = ide_state.entryTabId !== null && context.id === ide_state.entryTabId;
		if (isEntryContext) {
			ide_state.lastSavedSource = source;
		}
		context.snapshot = captureSnapshot();
		updateActiveContextDirtyFlag();
		const message = isEntryContext ? 'Lua cart saved (restart pending)' : `${context.title} saved (restart pending)`;
		ide_state.showMessage(message, constants.COLOR_STATUS_SUCCESS, 2.5);
	} catch (error) {
		if (tryShowLuaErrorOverlay(error)) {
			return;
		}
		const message = error instanceof Error ? error.message : String(error);
		ide_state.showMessage(message, constants.COLOR_STATUS_ERROR, 4.0);
	}
}

export function updateRuntimeErrorOverlay(deltaSeconds: number): void {
	const overlay = ide_state.runtimeErrorOverlay;
	if (!overlay) {
		return;
	}
	if (!Number.isFinite(overlay.timer)) {
		return;
	}
	overlay.timer -= deltaSeconds;
	if (overlay.timer <= 0) {
		setActiveRuntimeErrorOverlay(null);
	}
}

export async function copySelectionToClipboard(): Promise<void> {
	const text = getSelectionText();
	if (text === null) {
		ide_state.showMessage('Nothing selected to copy', constants.COLOR_STATUS_WARNING, 1.5);
		return;
	}
	await writeClipboard(text, 'Copied selection to clipboard');
}

export async function cutSelectionToClipboard(): Promise<void> {
	const text = getSelectionText();
	if (text === null) {
		ide_state.showMessage('Nothing selected to cut', constants.COLOR_STATUS_WARNING, 1.5);
		return;
	}
	prepareUndo('cut', false);
	await writeClipboard(text, 'Cut selection to clipboard');
	replaceSelectionWith('');
}

export async function cutLineToClipboard(): Promise<void> {
	if (ide_state.lines.length === 0) {
		ide_state.showMessage('Nothing selected to cut', constants.COLOR_STATUS_WARNING, 1.5);
		return;
	}
	const currentLineValue = currentLine();
	const isLastLine = ide_state.cursorRow >= ide_state.lines.length - 1;
	const text = isLastLine ? currentLineValue : currentLineValue + '\n';
	prepareUndo('cut-line', false);
	await writeClipboard(text, 'Cut line to clipboard');
	if (ide_state.lines.length === 1) {
		ide_state.lines[0] = '';
		ide_state.cursorColumn = 0;
	} else {
		const removedRow = ide_state.cursorRow;
		ide_state.lines.splice(ide_state.cursorRow, 1);
		if (ide_state.cursorRow >= ide_state.lines.length) {
			ide_state.cursorRow = ide_state.lines.length - 1;
		}
		const newLength = ide_state.lines[ide_state.cursorRow].length;
		if (ide_state.cursorColumn > newLength) {
			ide_state.cursorColumn = newLength;
		}
		invalidateHighlightsFromRow(Math.min(removedRow, ide_state.lines.length - 1));
	}
	invalidateLine(ide_state.cursorRow);
	ide_state.selectionAnchor = null;
	markTextMutated();
	resetBlink();
	updateDesiredColumn();
	revealCursor();
}

export function pasteFromClipboard(): void {
	const text = ide_state.customClipboard;
	if (text === null || text.length === 0) {
		ide_state.showMessage('Editor clipboard is empty', constants.COLOR_STATUS_WARNING, 1.5);
		return;
	}
	prepareUndo('paste', false);
	deleteSelectionIfPresent();
	insertClipboardText(text);
	ide_state.showMessage('Pasted from editor clipboard', constants.COLOR_STATUS_SUCCESS, 1.5);
}

export async function writeClipboard(text: string, successMessage: string): Promise<void> {
	ide_state.customClipboard = text;
	const clipboard = $.platform.clipboard;
	if (!clipboard.isSupported()) {
		const message = successMessage + ' (Editor clipboard only)';
		ide_state.showMessage(message, constants.COLOR_STATUS_SUCCESS, 1.5);
		return;
	}
	try {
		await clipboard.writeText(text);
		ide_state.showMessage(successMessage, constants.COLOR_STATUS_SUCCESS, 1.5);
	}
	catch (error) {
		ide_state.showMessage('System clipboard write failed. Editor clipboard updated.', constants.COLOR_STATUS_WARNING, 3.5);
	}
}

export function captureSnapshot(): EditorSnapshot {
	const linesCopy = ide_state.lines.slice();
	let selectionCopy: Position | null = null;
	if (ide_state.selectionAnchor) {
		selectionCopy = { row: ide_state.selectionAnchor.row, column: ide_state.selectionAnchor.column };
	}
	return {
		lines: linesCopy,
		cursorRow: ide_state.cursorRow,
		cursorColumn: ide_state.cursorColumn,
		scrollRow: ide_state.scrollRow,
		scrollColumn: ide_state.scrollColumn,
		selectionAnchor: selectionCopy,
		dirty: ide_state.dirty,
	};
}

export function restoreSnapshot(snapshot: EditorSnapshot, preserveSelection: boolean = false): void {
	const preservedSelection = preserveSelection && ide_state.selectionAnchor
		? { row: ide_state.selectionAnchor.row, column: ide_state.selectionAnchor.column }
		: null;
	ide_state.lines = snapshot.lines.slice();
	invalidateVisualLines();
	invalidateAllHighlights();
	markDiagnosticsDirty();
	ide_state.cursorRow = snapshot.cursorRow;
	ide_state.cursorColumn = snapshot.cursorColumn;
	ide_state.scrollRow = snapshot.scrollRow;
	ide_state.scrollColumn = snapshot.scrollColumn;
	if (!preserveSelection) {
		if (snapshot.selectionAnchor) {
			ide_state.selectionAnchor = { row: snapshot.selectionAnchor.row, column: snapshot.selectionAnchor.column };
		} else {
			ide_state.selectionAnchor = null;
		}
	} else {
		ide_state.selectionAnchor = clampSelectionPosition(preservedSelection);
	}
	ide_state.dirty = snapshot.dirty;
	bumpTextVersion();
	updateDesiredColumn();
	resetBlink();
	ide_state.cursorRevealSuspended = false;
	updateActiveContextDirtyFlag();
	ensureCursorVisible();
	requestSemanticRefresh();
}

export function drawTopBar(api: BmsxConsoleApi): void {
	const host = {
		viewportWidth: ide_state.viewportWidth,
		headerHeight: ide_state.headerHeight,
		lineHeight: ide_state.lineHeight,
		measureText: (text: string) => measureText(text),
		drawText: (api2: BmsxConsoleApi, text: string, x: number, y: number, color: number) => drawEditorText(api2, ide_state.font, text, x, y, color),
		wordWrapEnabled: ide_state.wordWrapEnabled,
		resolutionMode: ide_state.resolutionMode,
		metadata: ide_state.metadata,
		dirty: ide_state.dirty,
		resourcePanelVisible: ide_state.resourcePanelVisible,
		resourcePanelFilterMode: ide_state.resourcePanel.getFilterMode(),
		problemsPanelVisible: ide_state.problemsPanel.isVisible(),
		topBarButtonBounds: ide_state.topBarButtonBounds,
	};
	renderTopBar(api, host);
}

export function drawCreateResourceBar(api: BmsxConsoleApi): void {
	const host = {
		viewportWidth: ide_state.viewportWidth,
		headerHeight: ide_state.headerHeight,
		tabBarHeight: getTabBarTotalHeight(),
		lineHeight: ide_state.lineHeight,
		spaceAdvance: ide_state.spaceAdvance,
		charAdvance: ide_state.charAdvance,
		measureText: (t: string) => measureText(t),
		drawText: (api2: BmsxConsoleApi, t: string, x: number, y: number, c: number) => drawEditorText(api2, ide_state.font, t, x, y, c),
		inlineFieldMetrics: () => inlineFieldMetrics(),
		createResourceActive: ide_state.createResourceActive,
		createResourceVisible: ide_state.createResourceVisible,
		createResourceField: ide_state.createResourceField,
		createResourceWorking: ide_state.createResourceWorking,
		createResourceError: ide_state.createResourceError,
		drawCreateResourceErrorDialog: (api4: BmsxConsoleApi, err: string) => drawCreateResourceErrorDialog(api4, err),
		getCreateResourceBarHeight: () => getCreateResourceBarHeight(),
		getSearchBarHeight: () => getSearchBarHeight(),
		getResourceSearchBarHeight: () => getResourceSearchBarHeight(),
		getSymbolSearchBarHeight: () => getSymbolSearchBarHeight(),
		getRenameBarHeight: () => getRenameBarHeight(),
		getLineJumpBarHeight: () => getLineJumpBarHeight(),
		drawInlineCaret: (
			api3: BmsxConsoleApi,
			field: InlineTextField,
			l: number,
			t: number,
			r: number,
			b: number,
			baseX: number,
			active: boolean,
			caretColor: { r: number; g: number; b: number; a: number },
			textColor: number,
		) => drawInlineCaret(api3, field, l, t, r, b, baseX, active, caretColor, textColor),
		inlineFieldSelectionRange: (f: InlineTextField) => inlineFieldSelectionRange(f),
		inlineFieldMeasureRange: (f: InlineTextField, m: InlineFieldMetrics, s: number, e: number) => inlineFieldMeasureRange(f, m, s, e),
		inlineFieldCaretX: (f: InlineTextField, ox: number, m: (tx: string) => number) => inlineFieldCaretX(f, ox, m),
		blockActiveCarets: (ide_state.problemsPanel.isVisible() && ide_state.problemsPanel.isFocused()),
	};
	renderCreateResourceBar(api, host);
}

export function drawSearchBar(api: BmsxConsoleApi): void {
	const host: import('./render_inline_bars').InlineBarsHost = {
		viewportWidth: ide_state.viewportWidth,
		headerHeight: ide_state.headerHeight,
		tabBarHeight: getTabBarTotalHeight(),
		lineHeight: ide_state.lineHeight,
		spaceAdvance: ide_state.spaceAdvance,
		charAdvance: ide_state.charAdvance,
		measureText: (t: string) => measureText(t),
		drawText: (a, t, x, y, c) => drawEditorText(a, ide_state.font, t, x, y, c),
		inlineFieldMetrics: () => inlineFieldMetrics(),
		createResourceActive: ide_state.createResourceActive,
		createResourceVisible: ide_state.createResourceVisible,
		createResourceField: ide_state.createResourceField,
		createResourceWorking: ide_state.createResourceWorking,
		createResourceError: ide_state.createResourceError,
		drawCreateResourceErrorDialog: (a, m) => drawCreateResourceErrorDialog(a, m),
		getCreateResourceBarHeight: () => getCreateResourceBarHeight(),
		getSearchBarHeight: () => getSearchBarHeight(),
		getResourceSearchBarHeight: () => getResourceSearchBarHeight(),
		getSymbolSearchBarHeight: () => getSymbolSearchBarHeight(),
		getRenameBarHeight: () => getRenameBarHeight(),
		getLineJumpBarHeight: () => getLineJumpBarHeight(),
		drawInlineCaret: (
			a: BmsxConsoleApi,
			f: InlineTextField,
			l: number,
			t: number,
			r: number,
			b: number,
			bx: number,
			ac: boolean,
			cc: { r: number; g: number; b: number; a: number },
			tc: number,
		) => drawInlineCaret(a, f, l, t, r, b, bx, ac, cc, tc),
		inlineFieldSelectionRange: (f: InlineTextField) => inlineFieldSelectionRange(f),
		inlineFieldMeasureRange: (f: InlineTextField, m: InlineFieldMetrics, s: number, e: number) => inlineFieldMeasureRange(f, m, s, e),
		inlineFieldCaretX: (f: InlineTextField, ox: number, m: (tx: string) => number) => inlineFieldCaretX(f, ox, m),
		blockActiveCarets: (ide_state.problemsPanel.isVisible() && ide_state.problemsPanel.isFocused()),
		searchActive: ide_state.searchActive,
		searchField: ide_state.searchField,
		searchQuery: ide_state.searchQuery,
		searchMatchesCount: activeSearchMatchCount(),
		searchCurrentIndex: ide_state.searchCurrentIndex,
		searchScope: ide_state.searchScope,
		searchWorking: ide_state.searchScope === 'global' ? ide_state.globalSearchJob !== null : ide_state.searchJob !== null,
		searchVisibleResultCount: () => searchVisibleResultCount(),
		searchResultEntryHeight: () => searchResultEntryHeight(),
		searchResultEntries: getVisibleSearchResultEntries(),
		searchResultEntriesBaseOffset: ide_state.searchDisplayOffset,
		searchSelectionIndex: ide_state.searchCurrentIndex,
		searchHoverIndex: ide_state.searchHoverIndex,
		searchDisplayOffset: ide_state.searchDisplayOffset,
	};
	renderSearchBar(api, host);
}

export function drawResourceSearchBar(api: BmsxConsoleApi): void {
	const host: import('./render_inline_bars').InlineBarsHost = {
		viewportWidth: ide_state.viewportWidth,
		headerHeight: ide_state.headerHeight,
		tabBarHeight: getTabBarTotalHeight(),
		lineHeight: ide_state.lineHeight,
		spaceAdvance: ide_state.spaceAdvance,
		charAdvance: ide_state.charAdvance,
		measureText: (t: string) => measureText(t),
		drawText: (a, t, x, y, c) => drawEditorText(a, ide_state.font, t, x, y, c),
		inlineFieldMetrics: () => inlineFieldMetrics(),
		createResourceActive: ide_state.createResourceActive,
		createResourceVisible: ide_state.createResourceVisible,
		createResourceField: ide_state.createResourceField,
		createResourceWorking: ide_state.createResourceWorking,
		createResourceError: ide_state.createResourceError,
		drawCreateResourceErrorDialog: (a, m) => drawCreateResourceErrorDialog(a, m),
		getCreateResourceBarHeight: () => getCreateResourceBarHeight(),
		getSearchBarHeight: () => getSearchBarHeight(),
		getResourceSearchBarHeight: () => getResourceSearchBarHeight(),
		getSymbolSearchBarHeight: () => getSymbolSearchBarHeight(),
		getRenameBarHeight: () => getRenameBarHeight(),
		getLineJumpBarHeight: () => getLineJumpBarHeight(),
		drawInlineCaret: (
			a: BmsxConsoleApi,
			f: InlineTextField,
			l: number,
			t: number,
			r: number,
			b: number,
			bx: number,
			ac: boolean,
			cc: { r: number; g: number; b: number; a: number },
			tc: number,
		) => drawInlineCaret(a, f, l, t, r, b, bx, ac, cc, tc),
		inlineFieldSelectionRange: (f: InlineTextField) => inlineFieldSelectionRange(f),
		inlineFieldMeasureRange: (f: InlineTextField, m: InlineFieldMetrics, s: number, e: number) => inlineFieldMeasureRange(f, m, s, e),
		inlineFieldCaretX: (f: InlineTextField, ox: number, m: (tx: string) => number) => inlineFieldCaretX(f, ox, m),
		blockActiveCarets: (ide_state.problemsPanel.isVisible() && ide_state.problemsPanel.isFocused()),
		resourceSearchActive: ide_state.resourceSearchActive,
		resourceSearchField: ide_state.resourceSearchField,
		resourceSearchVisibleResultCount: () => resourceSearchVisibleResultCount(),
		resourceSearchEntryHeight: () => resourceSearchEntryHeight(),
		isResourceSearchCompactMode: () => isResourceSearchCompactMode(),
		resourceSearchMatches: ide_state.resourceSearchMatches,
		resourceSearchSelectionIndex: ide_state.resourceSearchSelectionIndex,
		resourceSearchHoverIndex: ide_state.resourceSearchHoverIndex,
		resourceSearchDisplayOffset: ide_state.resourceSearchDisplayOffset,
	};
	renderResourceSearchBar(api, host);
}

export function drawSymbolSearchBar(api: BmsxConsoleApi): void {
	const host: import('./render_inline_bars').InlineBarsHost = {
		viewportWidth: ide_state.viewportWidth,
		headerHeight: ide_state.headerHeight,
		tabBarHeight: getTabBarTotalHeight(),
		lineHeight: ide_state.lineHeight,
		spaceAdvance: ide_state.spaceAdvance,
		charAdvance: ide_state.charAdvance,
		measureText: (t: string) => measureText(t),
		drawText: (a, t, x, y, c) => drawEditorText(a, ide_state.font, t, x, y, c),
		inlineFieldMetrics: () => inlineFieldMetrics(),
		createResourceActive: ide_state.createResourceActive,
		createResourceVisible: ide_state.createResourceVisible,
		createResourceField: ide_state.createResourceField,
		createResourceWorking: ide_state.createResourceWorking,
		createResourceError: ide_state.createResourceError,
		drawCreateResourceErrorDialog: (a, m) => drawCreateResourceErrorDialog(a, m),
		getCreateResourceBarHeight: () => getCreateResourceBarHeight(),
		getSearchBarHeight: () => getSearchBarHeight(),
		getResourceSearchBarHeight: () => getResourceSearchBarHeight(),
		getSymbolSearchBarHeight: () => getSymbolSearchBarHeight(),
		getRenameBarHeight: () => getRenameBarHeight(),
		getLineJumpBarHeight: () => getLineJumpBarHeight(),
		drawInlineCaret: (
			a: BmsxConsoleApi,
			f: InlineTextField,
			l: number,
			t: number,
			r: number,
			b: number,
			bx: number,
			ac: boolean,
			cc: { r: number; g: number; b: number; a: number },
			tc: number,
		) => drawInlineCaret(a, f, l, t, r, b, bx, ac, cc, tc),
		inlineFieldSelectionRange: (f: InlineTextField) => inlineFieldSelectionRange(f),
		inlineFieldMeasureRange: (f: InlineTextField, m: InlineFieldMetrics, s: number, e: number) => inlineFieldMeasureRange(f, m, s, e),
		inlineFieldCaretX: (f: InlineTextField, ox: number, m: (tx: string) => number) => inlineFieldCaretX(f, ox, m),
		blockActiveCarets: (ide_state.problemsPanel.isVisible() && ide_state.problemsPanel.isFocused()),
		symbolSearchGlobal: ide_state.symbolSearchGlobal,
		symbolSearchActive: ide_state.symbolSearchActive,
		symbolSearchMode: ide_state.symbolSearchMode,
		symbolSearchField: ide_state.symbolSearchField,
		symbolSearchVisibleResultCount: () => symbolSearchVisibleResultCount(),
		symbolSearchEntryHeight: () => symbolSearchEntryHeight(),
		isSymbolSearchCompactMode: () => isSymbolSearchCompactMode(),
		symbolSearchMatches: ide_state.symbolSearchMatches,
		symbolSearchSelectionIndex: ide_state.symbolSearchSelectionIndex,
		symbolSearchHoverIndex: ide_state.symbolSearchHoverIndex,
		symbolSearchDisplayOffset: ide_state.symbolSearchDisplayOffset,
	};
	renderSymbolSearchBar(api, host);
}

export function drawRenameBar(api: BmsxConsoleApi): void {
	const host: import('./render_inline_bars').InlineBarsHost = {
		viewportWidth: ide_state.viewportWidth,
		headerHeight: ide_state.headerHeight,
		tabBarHeight: getTabBarTotalHeight(),
		lineHeight: ide_state.lineHeight,
		spaceAdvance: ide_state.spaceAdvance,
		charAdvance: ide_state.charAdvance,
		measureText: (t: string) => measureText(t),
		drawText: (a, t, x, y, c) => drawEditorText(a, ide_state.font, t, x, y, c),
		inlineFieldMetrics: () => inlineFieldMetrics(),
		createResourceActive: ide_state.createResourceActive,
		createResourceVisible: ide_state.createResourceVisible,
		createResourceField: ide_state.createResourceField,
		createResourceWorking: ide_state.createResourceWorking,
		createResourceError: ide_state.createResourceError,
		drawCreateResourceErrorDialog: (a, m) => drawCreateResourceErrorDialog(a, m),
		getCreateResourceBarHeight: () => getCreateResourceBarHeight(),
		getSearchBarHeight: () => getSearchBarHeight(),
		getResourceSearchBarHeight: () => getResourceSearchBarHeight(),
		getSymbolSearchBarHeight: () => getSymbolSearchBarHeight(),
		getRenameBarHeight: () => getRenameBarHeight(),
		getLineJumpBarHeight: () => getLineJumpBarHeight(),
		drawInlineCaret: (
			a: BmsxConsoleApi,
			f: InlineTextField,
			l: number,
			t: number,
			r: number,
			b: number,
			bx: number,
			ac: boolean,
			cc: { r: number; g: number; b: number; a: number },
			tc: number,
		) => drawInlineCaret(a, f, l, t, r, b, bx, ac, cc, tc),
		inlineFieldSelectionRange: (f: InlineTextField) => inlineFieldSelectionRange(f),
		inlineFieldMeasureRange: (f: InlineTextField, m: InlineFieldMetrics, s: number, e: number) => inlineFieldMeasureRange(f, m, s, e),
		inlineFieldCaretX: (f: InlineTextField, ox: number, m: (tx: string) => number) => inlineFieldCaretX(f, ox, m),
		blockActiveCarets: (ide_state.problemsPanel.isVisible() && ide_state.problemsPanel.isFocused()),
		renameActive: ide_state.renameController.isActive(),
		renameField: ide_state.renameController.getField(),
		renameMatchCount: ide_state.renameController.getMatchCount(),
		renameExpression: ide_state.renameController.getExpressionLabel(),
		renameOriginalName: ide_state.renameController.getOriginalName(),
	};
	renderRenameBar(api, host);
}

export function drawLineJumpBar(api: BmsxConsoleApi): void {
	const host: import('./render_inline_bars').InlineBarsHost = {
		viewportWidth: ide_state.viewportWidth,
		headerHeight: ide_state.headerHeight,
		tabBarHeight: getTabBarTotalHeight(),
		lineHeight: ide_state.lineHeight,
		spaceAdvance: ide_state.spaceAdvance,
		charAdvance: ide_state.charAdvance,
		measureText: (t: string) => measureText(t),
		drawText: (a, t, x, y, c) => drawEditorText(a, ide_state.font, t, x, y, c),
		inlineFieldMetrics: () => inlineFieldMetrics(),
		createResourceActive: ide_state.createResourceActive,
		createResourceVisible: ide_state.createResourceVisible,
		createResourceField: ide_state.createResourceField,
		createResourceWorking: ide_state.createResourceWorking,
		createResourceError: ide_state.createResourceError,
		drawCreateResourceErrorDialog: (a, m) => drawCreateResourceErrorDialog(a, m),
		getCreateResourceBarHeight: () => getCreateResourceBarHeight(),
		getSearchBarHeight: () => getSearchBarHeight(),
		getResourceSearchBarHeight: () => getResourceSearchBarHeight(),
		getSymbolSearchBarHeight: () => getSymbolSearchBarHeight(),
		getRenameBarHeight: () => getRenameBarHeight(),
		getLineJumpBarHeight: () => getLineJumpBarHeight(),
		drawInlineCaret: (
			a: BmsxConsoleApi,
			f: InlineTextField,
			l: number,
			t: number,
			r: number,
			b: number,
			bx: number,
			ac: boolean,
			cc: { r: number; g: number; b: number; a: number },
			tc: number,
		) => drawInlineCaret(a, f, l, t, r, b, bx, ac, cc, tc),
		inlineFieldSelectionRange: (f: InlineTextField) => inlineFieldSelectionRange(f),
		inlineFieldMeasureRange: (f: InlineTextField, m: InlineFieldMetrics, s: number, e: number) => inlineFieldMeasureRange(f, m, s, e),
		inlineFieldCaretX: (f: InlineTextField, ox: number, m: (tx: string) => number) => inlineFieldCaretX(f, ox, m),
		blockActiveCarets: (ide_state.problemsPanel.isVisible() && ide_state.problemsPanel.isFocused()),
		lineJumpActive: ide_state.lineJumpActive,
		lineJumpField: ide_state.lineJumpField,
	};
	renderLineJumpBar(api, host);
}

export function drawCreateResourceErrorDialog(api: BmsxConsoleApi, message: string): void {
	const maxDialogWidth = Math.min(ide_state.viewportWidth - 16, 360);
	const wrapWidth = Math.max(ide_state.charAdvance, maxDialogWidth - (constants.ERROR_OVERLAY_PADDING_X * 2 + 12));
	const segments = message.split(/\r?\n/);
	const lines: string[] = [];
	for (let i = 0; i < segments.length; i += 1) {
		const segment = segments[i].trim();
		const wrapped = wrapRuntimeErrorLineUtil(segment.length === 0 ? '' : segment, wrapWidth, (text) => measureText(text));
		for (let j = 0; j < wrapped.length; j += 1) {
			lines.push(wrapped[j]);
		}
	}
	if (lines.length === 0) {
		lines.push('');
	}
	let contentWidth = 0;
	for (let i = 0; i < lines.length; i += 1) {
		contentWidth = Math.max(contentWidth, measureText(lines[i]));
	}
	const dialogWidth = Math.min(ide_state.viewportWidth - 16, Math.max(180, contentWidth + constants.ERROR_OVERLAY_PADDING_X * 2 + 12));
	const dialogHeight = Math.min(ide_state.viewportHeight - 16, lines.length * ide_state.lineHeight + constants.ERROR_OVERLAY_PADDING_Y * 2 + 16);
	const left = Math.max(8, Math.floor((ide_state.viewportWidth - dialogWidth) / 2));
	const top = Math.max(8, Math.floor((ide_state.viewportHeight - dialogHeight) / 2));
	const right = left + dialogWidth;
	const bottom = top + dialogHeight;
	api.rectfill(left, top, right, bottom, constants.COLOR_STATUS_BACKGROUND);
	api.rect(left, top, right, bottom, constants.COLOR_CREATE_RESOURCE_ERROR);
	const dialogPaddingX = constants.ERROR_OVERLAY_PADDING_X + 6;
	const dialogPaddingY = constants.ERROR_OVERLAY_PADDING_Y + 6;
	renderErrorOverlayText(
		api,
		ide_state.font,
		ide_state.lines,
		left + dialogPaddingX,
		top + dialogPaddingY,
		ide_state.lineHeight,
		constants.COLOR_STATUS_TEXT
	);
}

export function simplifyRuntimeErrorMessage(message: string): string {
	return message.replace(/^\[BmsxConsoleRuntime\]\s*/, '');
}

export function codeViewportTop(): number {
	return topMargin()
		+ getCreateResourceBarHeight()
		+ getSearchBarHeight()
		+ getResourceSearchBarHeight()
		+ getSymbolSearchBarHeight()
		+ getRenameBarHeight()
		+ getLineJumpBarHeight();
}

export function getCreateResourceBarHeight(): number {
	if (!isCreateResourceVisible()) {
		return 0;
	}
	return ide_state.lineHeight + constants.CREATE_RESOURCE_BAR_MARGIN_Y * 2;
}

export function isCreateResourceVisible(): boolean {
	return ide_state.createResourceVisible;
}

export function getSearchBarHeight(): number {
	if (!isSearchVisible()) {
		return 0;
	}
	const baseHeight = ide_state.lineHeight + constants.SEARCH_BAR_MARGIN_Y * 2;
	const visible = searchVisibleResultCount();
	if (visible <= 0) {
		return baseHeight;
	}
	return baseHeight + constants.SEARCH_RESULT_SPACING + visible * searchResultEntryHeight();
}

export function isSearchVisible(): boolean {
	return ide_state.searchVisible;
}

export function getResourceSearchBarHeight(): number {
	if (!isResourceSearchVisible()) {
		return 0;
	}
	const baseHeight = ide_state.lineHeight + constants.QUICK_OPEN_BAR_MARGIN_Y * 2;
	const visible = resourceSearchVisibleResultCount();
	if (visible <= 0) {
		return baseHeight;
	}
	return baseHeight + constants.QUICK_OPEN_RESULT_SPACING + visible * resourceSearchEntryHeight();
}

export function isResourceSearchVisible(): boolean {
	return ide_state.resourceSearchVisible;
}

export function getSymbolSearchBarHeight(): number {
	if (!isSymbolSearchVisible()) {
		return 0;
	}
	const baseHeight = ide_state.lineHeight + constants.SYMBOL_SEARCH_BAR_MARGIN_Y * 2;
	const visible = symbolSearchVisibleResultCount();
	if (visible <= 0) {
		return baseHeight;
	}
	return baseHeight + constants.SYMBOL_SEARCH_RESULT_SPACING + visible * symbolSearchEntryHeight();
}

export function isSymbolSearchVisible(): boolean {
	return ide_state.symbolSearchVisible;
}

export function getRenameBarHeight(): number {
	if (!isRenameVisible()) {
		return 0;
	}
	return ide_state.lineHeight + constants.SEARCH_BAR_MARGIN_Y * 2;
}

export function isRenameVisible(): boolean {
	return ide_state.renameController.isVisible();
}

export function getLineJumpBarHeight(): number {
	if (!isLineJumpVisible()) {
		return 0;
	}
	return ide_state.lineHeight + constants.LINE_JUMP_BAR_MARGIN_Y * 2;
}

export function isLineJumpVisible(): boolean {
	return ide_state.lineJumpVisible;
}

export function getCreateResourceBarBounds(): { top: number; bottom: number; left: number; right: number } | null {
	const height = getCreateResourceBarHeight();
	if (height <= 0) {
		return null;
	}
	const top = ide_state.headerHeight + getTabBarTotalHeight();
	return {
		top,
		bottom: top + height,
		left: 0,
		right: ide_state.viewportWidth,
	};
}

export function getSearchBarBounds(): { top: number; bottom: number; left: number; right: number } | null {
	const height = getSearchBarHeight();
	if (height <= 0) {
		return null;
	}
	const top = ide_state.headerHeight + getTabBarTotalHeight() + getCreateResourceBarHeight();
	return {
		top,
		bottom: top + height,
		left: 0,
		right: ide_state.viewportWidth,
	};
}

export function getResourceSearchBarBounds(): { top: number; bottom: number; left: number; right: number } | null {
	const height = getResourceSearchBarHeight();
	if (height <= 0) {
		return null;
	}
	const top = ide_state.headerHeight + getTabBarTotalHeight() + getCreateResourceBarHeight() + getSearchBarHeight();
	return {
		top,
		bottom: top + height,
		left: 0,
		right: ide_state.viewportWidth,
	};
}

export function getLineJumpBarBounds(): { top: number; bottom: number; left: number; right: number } | null {
	const height = getLineJumpBarHeight();
	if (height <= 0) {
		return null;
	}
	const top = ide_state.headerHeight + getTabBarTotalHeight()
		+ getCreateResourceBarHeight()
		+ getSearchBarHeight()
		+ getResourceSearchBarHeight()
		+ getSymbolSearchBarHeight()
		+ getRenameBarHeight();
	return {
		top,
		bottom: top + height,
		left: 0,
		right: ide_state.viewportWidth,
	};
}

export function getSymbolSearchBarBounds(): { top: number; bottom: number; left: number; right: number } | null {
	const height = getSymbolSearchBarHeight();
	if (height <= 0) {
		return null;
	}
	const top = ide_state.headerHeight + getTabBarTotalHeight()
		+ getCreateResourceBarHeight()
		+ getSearchBarHeight()
		+ getResourceSearchBarHeight();
	return {
		top,
		bottom: top + height,
		left: 0,
		right: ide_state.viewportWidth,
	};
}

export function getRenameBarBounds(): { top: number; bottom: number; left: number; right: number } | null {
	const height = getRenameBarHeight();
	if (height <= 0) {
		return null;
	}
	const top = ide_state.headerHeight + getTabBarTotalHeight()
		+ getCreateResourceBarHeight()
		+ getSearchBarHeight()
		+ getResourceSearchBarHeight()
		+ getSymbolSearchBarHeight();
	return {
		top,
		bottom: top + height,
		left: 0,
		right: ide_state.viewportWidth,
	};
}

export function drawCodeArea(api: BmsxConsoleApi): void {
	const host: import('./render_code_area').CodeAreaHost = {
		// Geometry and metrics
		lineHeight: ide_state.lineHeight,
		spaceAdvance: ide_state.spaceAdvance,
		charAdvance: ide_state.charAdvance,
		warnNonMonospace: ide_state.warnNonMonospace,
		// Editor state
		wordWrapEnabled: ide_state.wordWrapEnabled,
		codeHorizontalScrollbarVisible: ide_state.codeHorizontalScrollbarVisible,
		codeVerticalScrollbarVisible: ide_state.codeVerticalScrollbarVisible,
		cachedVisibleRowCount: ide_state.cachedVisibleRowCount,
		cachedVisibleColumnCount: ide_state.cachedVisibleColumnCount,
		scrollRow: ide_state.scrollRow,
		scrollColumn: ide_state.scrollColumn,
		cursorRow: ide_state.cursorRow,
		cursorColumn: ide_state.cursorColumn,
		cursorVisible: ide_state.cursorVisible,
		cursorScreenInfo: ide_state.cursorScreenInfo,
		gotoHoverHighlight: ide_state.gotoHoverHighlight,
		executionStopRow: ide_state.executionStopRow,
		lines: ide_state.lines,
		// Helpers
		ensureVisualLines: () => ensureVisualLines(),
		getCodeAreaBounds: () => getCodeAreaBounds(),
		maximumLineLength: () => maximumLineLength(),
		getVisualLineCount: () => getVisualLineCount(),
		positionToVisualIndex: (r: number, c: number) => positionToVisualIndex(r, c),
		visualIndexToSegment: (v: number) => visualIndexToSegment(v),
		getCachedHighlight: (r: number) => getCachedHighlight(r),
		sliceHighlightedLine: (hi, start, count) => sliceHighlightedLine(hi, start, count),
		columnToDisplay: (hi, c) => columnToDisplay(hi, c),
		drawColoredText: (a, t, cols, x, y) => drawEditorColoredText(a, ide_state.font, t, cols, x, y, constants.COLOR_CODE_TEXT),
		drawReferenceHighlightsForRow: (a, ri, e, ox, oy, s, ed) => drawReferenceHighlightsForRow(a, ri, e, ox, oy, s, ed),
		drawSearchHighlightsForRow: (a, ri, e, ox, oy, s, ed) => drawSearchHighlightsForRow(a, ri, e, ox, oy, s, ed),
		computeSelectionSlice: (ri, hi, s, e) => computeSelectionSlice(ri, hi, s, e),
		measureRangeFast: (entry, from, to) => measureRangeFast(entry, from, to),
		getDiagnosticsForRow: (row) => getDiagnosticsForRow(row),
		scrollbars: {
			codeVertical: ide_state.scrollbars.codeVertical,
			codeHorizontal: ide_state.scrollbars.codeHorizontal,
		},
		computeMaximumScrollColumn: () => computeMaximumScrollColumn(),
		// Overlays
		drawRuntimeErrorOverlay: (a, ct, cr, tl) => drawRuntimeErrorOverlay(a, ct, cr, tl),
		drawHoverTooltip: (a, ct, cb, tl) => drawHoverTooltip(a, ct, cb, tl),
		drawCursor: (a, info, tx) => drawCursor(a, info, tx),
		computeCursorScreenInfo: (entry, tl, rt, ssd) => computeCursorScreenInfo(entry, tl, rt, ssd),
		drawCompletionPopup: (a, b) => ide_state.completion.drawCompletionPopup(a, b),
		drawParameterHintOverlay: (a, b) => ide_state.completion.drawParameterHintOverlay(a, b),
	};
	renderCodeArea(api, host);
	// write back mutable state possibly changed by renderer
	ide_state.wordWrapEnabled = host.wordWrapEnabled;
	ide_state.codeHorizontalScrollbarVisible = host.codeHorizontalScrollbarVisible;
	ide_state.codeVerticalScrollbarVisible = host.codeVerticalScrollbarVisible;
	ide_state.cachedVisibleRowCount = host.cachedVisibleRowCount;
	ide_state.cachedVisibleColumnCount = host.cachedVisibleColumnCount;
	ide_state.scrollRow = host.scrollRow;
	ide_state.scrollColumn = host.scrollColumn;
	ide_state.cursorScreenInfo = host.cursorScreenInfo;
}

export function drawRuntimeErrorOverlay(api: BmsxConsoleApi, codeTop: number, codeRight: number, textLeft: number): void {
	const overlay = ide_state.runtimeErrorOverlay;
	if (!overlay) {
		return;
	}
	const layoutHost = createRuntimeErrorOverlayLayoutHost();
	const layout = computeRuntimeErrorOverlayLayout(
		layoutHost,
		overlay,
		codeTop,
		codeRight,
		textLeft,
		constants.ERROR_OVERLAY_PADDING_X,
		constants.ERROR_OVERLAY_PADDING_Y,
		computeRuntimeErrorOverlayMaxWidth(ide_state.viewportWidth, ide_state.charAdvance, ide_state.gutterWidth)
	);
	if (!layout) {
		return;
	}
	const highlightLines: number[] = [];
	if (overlay.hovered && overlay.hoverLine >= 0 && overlay.hoverLine < overlay.lineDescriptors.length) {
		const descriptor = overlay.lineDescriptors[overlay.hoverLine];
		if (descriptor && descriptor.role === 'frame') {
			const mapping = (layout as RuntimeErrorOverlayLayout).displayLineMap as number[] | undefined;
			if (Array.isArray(mapping) && mapping.length > 0) {
				for (let i = 0; i < mapping.length; i += 1) {
					if (mapping[i] === overlay.hoverLine) highlightLines.push(i);
				}
			} else {
				highlightLines.push(overlay.hoverLine);
			}
		}
	}
	const drawOptions: RuntimeErrorOverlayDrawOptions = {
		textColor: constants.ERROR_OVERLAY_TEXT_COLOR,
		paddingX: constants.ERROR_OVERLAY_PADDING_X,
		paddingY: constants.ERROR_OVERLAY_PADDING_Y,
		backgroundColor: overlay.hovered ? constants.ERROR_OVERLAY_BACKGROUND_HOVER : constants.ERROR_OVERLAY_BACKGROUND,
		highlightColor: constants.ERROR_OVERLAY_LINE_HOVER,
		highlightLines: highlightLines.length > 0 ? highlightLines : null,
	};
	drawRuntimeErrorOverlayBubble(api, ide_state.font, overlay, layout, ide_state.lineHeight, drawOptions);
}

export function processRuntimeErrorOverlayPointer(snapshot: PointerSnapshot, justPressed: boolean, codeTop: number, codeRight: number, textLeft: number): boolean {
	const overlay = ide_state.runtimeErrorOverlay;
	if (!overlay) {
		return false;
	}
	const layoutHost = createRuntimeErrorOverlayLayoutHost();
	const layout = computeRuntimeErrorOverlayLayout(
		layoutHost,
		overlay,
		codeTop,
		codeRight,
		textLeft,
		constants.ERROR_OVERLAY_PADDING_X,
		constants.ERROR_OVERLAY_PADDING_Y,
		computeRuntimeErrorOverlayMaxWidth(ide_state.viewportWidth, ide_state.charAdvance, ide_state.gutterWidth)
	);
	if (!layout) {
		overlay.hovered = false;
		overlay.hoverLine = -1;
		return false;
	}
	if (!snapshot.valid || !snapshot.insideViewport) {
		overlay.hovered = false;
		overlay.hoverLine = -1;
		return false;
	}
	const insideBubble = pointInRect(snapshot.viewportX, snapshot.viewportY, layout.bounds);
	if (!insideBubble) {
		overlay.hovered = false;
		overlay.hoverLine = -1;
		if (justPressed && overlay.expanded) {
			overlay.expanded = false;
			rebuildRuntimeErrorOverlayView(overlay);
		}
		return false;
	}
	overlay.hovered = true;
	overlay.hoverLine = findRuntimeErrorOverlayLineAtPosition(overlay, snapshot.viewportX, snapshot.viewportY);
	if (!justPressed) {
		return true;
	}
	ide_state.pointerSelecting = false;
	ide_state.pointerPrimaryWasPressed = snapshot.primaryPressed;
	resetPointerClickTracking();
	const clickResult = evaluateRuntimeErrorOverlayClick(overlay, overlay.hoverLine);
	switch (clickResult.kind) {
		case 'expand': {
			overlay.expanded = true;
			rebuildRuntimeErrorOverlayView(overlay);
			return true;
		}
		case 'collapse': {
			overlay.expanded = false;
			rebuildRuntimeErrorOverlayView(overlay);
			return true;
		}
		case 'navigate': {
			overlay.expanded = false;
			rebuildRuntimeErrorOverlayView(overlay);
			navigateToRuntimeErrorFrameTarget(clickResult.frame);
			return true;
		}
		case 'noop':
		default: {
			return true;
		}
	}
	return true;
}

export function createRuntimeErrorOverlayLayoutHost(): RuntimeErrorOverlayLayoutHost {
	return {
		ensureVisualLines: () => ensureVisualLines(),
		positionToVisualIndex: (row: number, column: number) => positionToVisualIndex(row, column),
		visibleRowCount: () => visibleRowCount(),
		scrollRow: ide_state.scrollRow,
		visualIndexToSegment: (visualIndex: number) => visualIndexToSegment(visualIndex),
		getCachedHighlight: (rowIndex: number) => getCachedHighlight(rowIndex),
		wordWrapEnabled: ide_state.wordWrapEnabled,
		scrollColumn: ide_state.scrollColumn,
		visibleColumnCount: () => visibleColumnCount(),
		sliceHighlightedLine: (highlight, columnStart, columnCount) => sliceHighlightedLine(highlight, columnStart, columnCount),
		columnToDisplay: (highlight, column) => columnToDisplay(highlight, column),
		measureRangeFast: (entry, fromDisplay, toDisplay) => measureRangeFast(entry, fromDisplay, toDisplay),
		lineHeight: ide_state.lineHeight,
		viewportHeight: ide_state.viewportHeight,
		bottomMargin: bottomMargin(),
		measureText: (text: string) => measureText(text),
	};
}

export function navigateToRuntimeErrorFrameTarget(frame: RuntimeErrorStackFrame): void {
	if (frame.origin !== 'lua') {
		return;
	}
	const source = frame.source ?? '';
	if (source.length === 0) {
		ide_state.showMessage('Runtime frame is missing a chunk reference.', constants.COLOR_STATUS_ERROR, 3.0);
		return;
	}
	let normalizedChunk: string;
	try {
		normalizedChunk = normalizeChunkName(source);
	} catch (error) {
		const message = error instanceof Error ? error.message : String(error);
		ide_state.showMessage(`Unable to resolve runtime chunk name: ${message}`, constants.COLOR_STATUS_ERROR, 3.0);
		return;
	}
	const frameAssetId = typeof frame.chunkAssetId === 'string' && frame.chunkAssetId.length > 0 ? frame.chunkAssetId : null;
	const framePath = typeof frame.chunkPath === 'string' && frame.chunkPath.length > 0 ? frame.chunkPath : null;
	let descriptor: ConsoleResourceDescriptor | null = null;
	if (!frameAssetId || !framePath) {
		try {
			descriptor = findResourceDescriptorForChunk(normalizedChunk);
		} catch {
			descriptor = null;
		}
	}
	const chunkHintAssetId = frameAssetId ?? descriptor?.assetId ?? null;
	const chunkHintPath = framePath ?? descriptor?.path ?? undefined;
	try {
		const hint = chunkHintAssetId !== null ? { assetId: chunkHintAssetId, path: chunkHintPath } : (descriptor ? { assetId: descriptor.assetId, path: descriptor.path } : undefined);
		focusChunkSource(normalizedChunk, hint);
	} catch (error) {
		const message = error instanceof Error ? error.message : String(error);
		ide_state.showMessage(`Failed to open runtime chunk: ${message}`, constants.COLOR_STATUS_ERROR, 3.0);
		return;
	}
	const activeContext = getActiveCodeTabContext();
	if (!activeContext) {
		ide_state.showMessage('Unable to activate editor context for runtime frame.', constants.COLOR_STATUS_ERROR, 3.0);
		return;
	}
	const lastRowIndex = Math.max(0, ide_state.lines.length - 1);
	let targetRow: number | null = null;
	if (typeof frame.line === 'number' && frame.line > 0) {
		targetRow = clamp(frame.line - 1, 0, lastRowIndex);
	}
	if (targetRow === null && frame.functionName) {
		targetRow = findFunctionDefinitionRowInActiveFile(frame.functionName);
	}
	if (targetRow === null) {
		targetRow = 0;
	}
	const targetLine = ide_state.lines[targetRow] ?? '';
	let targetColumn = 0;
	if (typeof frame.column === 'number' && frame.column > 0) {
		targetColumn = clamp(frame.column - 1, 0, targetLine.length);
	}
	if (targetColumn === 0 && frame.functionName && frame.functionName.length > 0) {
		const nameIndex = targetLine.indexOf(frame.functionName);
		if (nameIndex >= 0) {
			targetColumn = nameIndex;
		}
	}
	ide_state.selectionAnchor = null;
	ide_state.pointerSelecting = false;
	resetPointerClickTracking();
	setCursorPosition(targetRow, targetColumn);
	ide_state.cursorRevealSuspended = false;
	centerCursorVertically();
	ensureCursorVisible();
	ide_state.showMessage('Navigated to call site', constants.COLOR_STATUS_SUCCESS, 1.6);
}

export function findFunctionDefinitionRowInActiveFile(functionName: string): number | null {
	if (typeof functionName !== 'string' || functionName.length === 0) {
		return null;
	}
	const escaped = functionName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
	const patterns = [
		new RegExp(`^\\s*function\\s+${escaped}\\b`),
		new RegExp(`^\\s*local\\s+function\\s+${escaped}\\b`),
		new RegExp(`\\b${escaped}\\s*=\\s*function\\b`),
	];
	for (let row = 0; row < ide_state.lines.length; row += 1) {
		const line = ide_state.lines[row];
		for (let index = 0; index < patterns.length; index += 1) {
			if (patterns[index].test(line)) {
				return row;
			}
		}
	}
	return null;
}

export function isCodeTabActive(): boolean {
	return getActiveTabKind() === 'lua_editor';
}

export function isResourceViewActive(): boolean {
	return getActiveTabKind() === 'resource_view';
}

export function setActiveTab(tabId: string): void {
	const tab = ide_state.tabs.find(candidate => candidate.id === tabId);
	if (!tab) {
		return;
	}
	const navigationCheckpoint = tab.kind === 'lua_editor' && tabId !== ide_state.activeTabId
		? beginNavigationCapture()
		: null;
	closeSymbolSearch(true);
	const previousKind = getActiveTabKind();
	if (previousKind === 'lua_editor') {
		storeActiveCodeTabContext();
	}
	if (ide_state.activeTabId === tabId) {
		if (tab.kind === 'resource_view') {
			enterResourceViewer(tab);
			ide_state.runtimeErrorOverlay = null;
		} else if (tab.kind === 'lua_editor') {
			activateCodeEditorTab(tab.id);
			if (navigationCheckpoint) {
				completeNavigation(navigationCheckpoint);
			}
		}
		return;
	}
	ide_state.activeTabId = tabId;
	if (tab.kind === 'resource_view') {
		enterResourceViewer(tab);
		ide_state.runtimeErrorOverlay = null;
		return;
	}
	if (tab.kind === 'lua_editor') {
		activateCodeEditorTab(tab.id);
		if (navigationCheckpoint) {
			completeNavigation(navigationCheckpoint);
		}
	}
}

export function toggleResourcePanel(): void {
	// Keep editor/controller visibility in sync by delegating to controller
	ide_state.resourcePanel.togglePanel();
}

export function toggleProblemsPanel(): void {
	if (ide_state.problemsPanel.isVisible()) {
		hideProblemsPanel();
		return;
	}
	showProblemsPanel();
}

export function showProblemsPanel(): void {
	ide_state.problemsPanel.show();
	markDiagnosticsDirty();
}

export function hideProblemsPanel(): void {
	ide_state.problemsPanel.hide();
	focusEditorFromProblemsPanel();
}

export function toggleResourcePanelFilterMode(): void {
	// Controller owns filter state and messaging
	ide_state.resourcePanel.toggleFilterMode();
}

export function toggleResolutionMode(): void {
	ide_state.resolutionMode = ide_state.resolutionMode === 'offscreen' ? 'viewport' : 'offscreen';
	refreshViewportDimensions(true);
	ensureCursorVisible();
	ide_state.cursorRevealSuspended = false;
	applyResolutionModeToRuntime();
	const modeLabel = ide_state.resolutionMode === 'offscreen' ? 'OFFSCREEN' : 'NATIVE';
	ide_state.showMessage(`Editor resolution: ${modeLabel}`, constants.COLOR_STATUS_TEXT, 2.5);
}

export function toggleWordWrap(): void {
	ensureVisualLines();
	const previousWrap = ide_state.wordWrapEnabled;
	const visualLineCount = getVisualLineCount();
	const previousTopIndex = clamp(ide_state.scrollRow, 0, visualLineCount > 0 ? visualLineCount - 1 : 0);
	const previousTopSegment = visualIndexToSegment(previousTopIndex);
	const anchorRow = previousTopSegment ? previousTopSegment.row : ide_state.cursorRow;
	const anchorColumnForWrap = previousTopSegment ? previousTopSegment.startColumn : 0;
	const anchorColumnForUnwrap = previousTopSegment
		? (previousWrap ? previousTopSegment.startColumn : ide_state.scrollColumn)
		: ide_state.scrollColumn;
	const previousCursorRow = ide_state.cursorRow;
	const previousCursorColumn = ide_state.cursorColumn;
	const previousDesiredColumn = ide_state.desiredColumn;

	ide_state.wordWrapEnabled = !previousWrap;
	ide_state.cursorRevealSuspended = false;
	invalidateVisualLines();
	ensureVisualLines();

	ide_state.cursorRow = clamp(previousCursorRow, 0, ide_state.lines.length > 0 ? ide_state.lines.length - 1 : 0);
	const currentLine = ide_state.lines[ide_state.cursorRow] ?? '';
	ide_state.cursorColumn = clamp(previousCursorColumn, 0, currentLine.length);
	ide_state.desiredColumn = previousDesiredColumn;

	if (ide_state.wordWrapEnabled) {
		ide_state.scrollColumn = 0;
		const anchorVisualIndex = positionToVisualIndex(anchorRow, anchorColumnForWrap);
		ide_state.scrollRow = clamp(anchorVisualIndex, 0, Math.max(0, getVisualLineCount() - visibleRowCount()));
	} else {
		ide_state.scrollColumn = clamp(anchorColumnForUnwrap, 0, computeMaximumScrollColumn());
		const anchorVisualIndex = positionToVisualIndex(anchorRow, ide_state.scrollColumn);
		ide_state.scrollRow = clamp(anchorVisualIndex, 0, Math.max(0, getVisualLineCount() - visibleRowCount()));
	}
	ide_state.lastPointerRowResolution = null;
	ensureCursorVisible();
	updateDesiredColumn();
	const message = ide_state.wordWrapEnabled ? 'Word wrap enabled' : 'Word wrap disabled';
	ide_state.showMessage(message, constants.COLOR_STATUS_TEXT, 2.5);
}

export function applyResolutionModeToRuntime(): void {
	const runtime = getConsoleRuntime();
	if (!runtime) {
		return;
	}
	runtime.setEditorOverlayResolution(ide_state.resolutionMode);
}

// showResourcePanel removed; controller handles visibility via toggle/show()

export function hideResourcePanel(): void {
	// Forward to controller; it resets its internal state
	ide_state.resourcePanel.hide();
	ide_state.resourcePanelFocused = false;
	ide_state.resourcePanelResizing = false;
	resetResourcePanelState();
	invalidateVisualLines();
}

export function activateCodeTab(): void {
	const codeTab = ide_state.tabs.find(candidate => candidate.kind === 'lua_editor');
	if (codeTab) {
		setActiveTab(codeTab.id);
		return;
	}
	if (ide_state.entryTabId) {
		let context = ide_state.codeTabContexts.get(ide_state.entryTabId);
		if (!context) {
			context = createEntryTabContext();
			if (!context) {
				return;
			}
			ide_state.entryTabId = context.id;
			ide_state.codeTabContexts.set(context.id, context);
		}
		let entryTab = ide_state.tabs.find(candidate => candidate.id === context.id);
		if (!entryTab) {
			entryTab = {
				id: context.id,
				kind: 'lua_editor',
				title: context.title,
				closable: true,
				dirty: context.dirty,
				resource: undefined,
			};
			ide_state.tabs.unshift(entryTab);
		}
		setActiveTab(context.id);
	}
}

export function openLuaCodeTab(descriptor: ConsoleResourceDescriptor): void {
	const navigationCheckpoint = beginNavigationCapture();
	const tabId: EditorTabId = `lua:${descriptor.assetId}`;
	let tab = ide_state.tabs.find(candidate => candidate.id === tabId);
	if (!ide_state.codeTabContexts.has(tabId)) {
		const context = createLuaCodeTabContext(descriptor);
		ide_state.codeTabContexts.set(tabId, context);
	}
	const context = ide_state.codeTabContexts.get(tabId) ?? null;
	if (!tab) {
		const dirty = context ? context.dirty : false;
		tab = {
			id: tabId,
			kind: 'lua_editor',
			title: computeResourceTabTitle(descriptor),
			closable: true,
			dirty,
			resource: undefined,
		};
		ide_state.tabs.push(tab);
	} else {
		tab.title = computeResourceTabTitle(descriptor);
		if (context) {
			tab.dirty = context.dirty;
		}
	}
	setActiveTab(tabId);
	completeNavigation(navigationCheckpoint);
}

export function openResourceViewerTab(descriptor: ConsoleResourceDescriptor): void {
	const tabId: EditorTabId = `resource:${descriptor.assetId}`;
	let tab = ide_state.tabs.find(candidate => candidate.id === tabId);
	const state = buildResourceViewerState(descriptor);
	resourceViewerClampScroll(state);
	if (tab) {
		tab.title = state.title;
		tab.resource = state;
		tab.dirty = false;
		setActiveTab(tabId);
		return;
	}
	tab = {
		id: tabId,
		kind: 'resource_view',
		title: state.title,
		closable: true,
		dirty: false,
		resource: state,
	};
	ide_state.tabs.push(tab);
	setActiveTab(tabId);
}

export function closeActiveTab(): void {
	if (!ide_state.activeTabId) {
		return;
	}
	closeTab(ide_state.activeTabId);
}

export function closeTab(tabId: string): void {
	const index = ide_state.tabs.findIndex(tab => tab.id === tabId);
	if (index === -1) {
		return;
	}
	if (ide_state.tabDragState && ide_state.tabDragState.tabId === tabId) {
		endTabDrag();
	}
	const tab = ide_state.tabs[index];
	if (!tab.closable) {
		return;
	}
	const wasActiveContext = tab.kind === 'lua_editor' && ide_state.activeCodeTabContextId === tab.id;
	if (wasActiveContext) {
		storeActiveCodeTabContext();
	}
	ide_state.tabs.splice(index, 1);
	if (tab.kind === 'lua_editor') {
		if (ide_state.activeCodeTabContextId === tab.id) {
			ide_state.activeCodeTabContextId = null;
		}
		ide_state.dirtyDiagnosticContexts.delete(tab.id);
		ide_state.diagnosticsCache.delete(tab.id);
	}
	if (ide_state.activeTabId === tabId) {
		const fallback = ide_state.tabs[index - 1] ?? ide_state.tabs[0];
		if (fallback) {
			setActiveTab(fallback.id);
		} else {
			ide_state.activeTabId = null;
			ide_state.activeCodeTabContextId = null;
			resetEditorContent();
		}
	}
}

export function cycleTab(direction: number): void {
	if (ide_state.tabs.length <= 1 || direction === 0) {
		return;
	}
	const count = ide_state.tabs.length;
	let currentIndex = ide_state.tabs.findIndex(tab => tab.id === ide_state.activeTabId);
	if (currentIndex === -1) {
		const fallbackIndex = direction > 0 ? 0 : count - 1;
		const fallback = ide_state.tabs[fallbackIndex];
		if (fallback) {
			setActiveTab(fallback.id);
		}
		return;
	}
	let nextIndex = currentIndex + direction;
	nextIndex = ((nextIndex % count) + count) % count;
	if (nextIndex === currentIndex) {
		return;
	}
	const target = ide_state.tabs[nextIndex];
	setActiveTab(target.id);
}

export function measureTabWidth(tab: EditorTabDescriptor): number {
	const textWidth = measureText(tab.title);
	let indicatorWidth = 0;
	if (tab.closable) {
		indicatorWidth = measureText(constants.TAB_CLOSE_BUTTON_SYMBOL) + constants.TAB_CLOSE_BUTTON_PADDING_X * 2;
	} else if (tab.dirty) {
		const metrics = getTabDirtyMarkerMetrics();
		indicatorWidth = metrics.width + constants.TAB_DIRTY_MARKER_SPACING;
	}
	return textWidth + constants.TAB_BUTTON_PADDING_X * 2 + indicatorWidth;
}

export function computeTabLayout(): Array<{ id: string; left: number; right: number; width: number; center: number; rowIndex: number }> {
	const layout: Array<{ id: string; left: number; right: number; width: number; center: number; rowIndex: number }> = [];
	for (let index = 0; index < ide_state.tabs.length; index += 1) {
		const tab = ide_state.tabs[index];
		const bounds = ide_state.tabButtonBounds.get(tab.id) ?? null;
		if (bounds) {
			const left = bounds.left;
			const right = bounds.right;
			const width = Math.max(0, right - left);
			const rowIndex = Math.max(0, Math.floor((bounds.top - ide_state.headerHeight) / ide_state.tabBarHeight));
			layout.push({
				id: tab.id,
				left,
				right,
				width,
				center: (left + right) * 0.5,
				rowIndex,
			});
			continue;
		}
		const width = measureTabWidth(tab);
		const previous = layout.length > 0 ? layout[layout.length - 1] : null;
		const left = previous ? previous.right + constants.TAB_BUTTON_SPACING : 4;
		const right = left + width;
		layout.push({
			id: tab.id,
			left,
			right,
			width,
			center: (left + right) * 0.5,
			rowIndex: previous ? previous.rowIndex : 0,
		});
	}
	return layout;
}

export function beginTabDrag(tabId: string, pointerX: number): void {
	if (ide_state.tabs.length <= 1) {
		ide_state.tabDragState = null;
		return;
	}
	const bounds = ide_state.tabButtonBounds.get(tabId) ?? null;
	const pointerOffset = bounds ? pointerX - bounds.left : 0;
	ide_state.tabDragState = {
		tabId,
		pointerOffset,
		startX: pointerX,
		hasDragged: false,
	};
}

export function updateTabDrag(pointerX: number, pointerY: number): void {
	const state = ide_state.tabDragState;
	if (!state) {
		return;
	}
	const distance = Math.abs(pointerX - state.startX);
	if (!state.hasDragged && distance < constants.TAB_DRAG_ACTIVATION_THRESHOLD) {
		return;
	}
	if (!state.hasDragged) {
		state.hasDragged = true;
		resetPointerClickTracking();
	}
	const layout = computeTabLayout();
	const currentIndex = layout.findIndex(item => item.id === state.tabId);
	if (currentIndex === -1) {
		return;
	}
	const dragged = layout[currentIndex];
	const pointerLeft = pointerX - state.pointerOffset;
	const pointerCenter = pointerLeft + Math.max(dragged.width, 1) * 0.5;
	const totalTabHeight = getTabBarTotalHeight();
	const withinTabBar = pointerY >= ide_state.headerHeight && pointerY < ide_state.headerHeight + totalTabHeight;
	const maxRowIndex = Math.max(0, ide_state.tabBarRowCount - 1);
	const pointerRow = withinTabBar
		? clamp(Math.floor((pointerY - ide_state.headerHeight) / ide_state.tabBarHeight), 0, maxRowIndex)
		: dragged.rowIndex;
	const rowStride = ide_state.viewportWidth + constants.TAB_BUTTON_SPACING * 4;
	const pointerValue = pointerRow * rowStride + pointerCenter;
	let desiredIndex = currentIndex;
	for (let i = 0; i < layout.length; i += 1) {
		const item = layout[i];
		const itemValue = item.rowIndex * rowStride + item.center;
		if (pointerValue > itemValue) {
			desiredIndex = i + 1;
		}
	}
	if (desiredIndex > currentIndex) {
		desiredIndex -= 1;
	}
	if (desiredIndex === currentIndex) {
		return;
	}
	const tabIndex = ide_state.tabs.findIndex(entry => entry.id === state.tabId);
	if (tabIndex === -1) {
		return;
	}
	const removed = ide_state.tabs.splice(tabIndex, 1);
	const tab = removed[0];
	if (!tab) {
		return;
	}
	const targetIndex = clamp(desiredIndex, 0, ide_state.tabs.length);
	ide_state.tabs.splice(targetIndex, 0, tab);
}

export function endTabDrag(): void {
	if (!ide_state.tabDragState) {
		return;
	}
	ide_state.tabDragState = null;
}

export function resetEditorContent(): void {
	ide_state.lines = [''];
	invalidateVisualLines();
	markDiagnosticsDirty();
	ide_state.cursorRow = 0;
	ide_state.cursorColumn = 0;
	ide_state.scrollRow = 0;
	ide_state.scrollColumn = 0;
	ide_state.selectionAnchor = null;
	ide_state.lastSavedSource = '';
	invalidateAllHighlights();
	bumpTextVersion();
	ide_state.dirty = false;
	updateActiveContextDirtyFlag();
	syncRuntimeErrorOverlayFromContext(null);
	updateDesiredColumn();
	resetBlink();
	ensureCursorVisible();
	requestSemanticRefresh();
}

export function resetResourcePanelState(): void {
	ide_state.resourceBrowserItems = [];
	ide_state.resourceBrowserSelectionIndex = -1;
	// max line width handled by controller
	ide_state.pendingResourceSelectionAssetId = null;
	ide_state.resourcePanelResizing = false;
}

export function refreshResourcePanelContents(): void {
	// New path owned by ResourcePanelController
	ide_state.resourcePanel.refresh();
	const s = ide_state.resourcePanel.getStateForRender();
	ide_state.resourcePanelResourceCount = s.items.length;
	ide_state.resourceBrowserItems = s.items;
	ide_state.resourceBrowserSelectionIndex = s.selectionIndex;
}

export function enterResourceViewer(tab: EditorTabDescriptor): void {
	closeSearch(false, true);
	closeLineJump(false);
	ide_state.cursorRevealSuspended = false;
	tab.dirty = false;
	// hover state handled by controller; no-op here
	if (!tab.resource) {
		return;
	}
	resourceViewerClampScroll(tab.resource);
}

// buildResourceBrowserItems removed; ResourcePanelController owns item tree construction

// updateResourceBrowserMetrics removed; controller computes metrics

export function selectResourceInPanel(descriptor: ConsoleResourceDescriptor): void {
	if (!descriptor.assetId || descriptor.assetId.length === 0) {
		return;
	}
	ide_state.pendingResourceSelectionAssetId = descriptor.assetId;
	if (!ide_state.resourcePanelVisible) {
		return;
	}
	applyPendingResourceSelection();
}

export function applyPendingResourceSelection(): void {
	if (!ide_state.resourcePanelVisible) {
		return;
	}
	const assetId = ide_state.pendingResourceSelectionAssetId;
	if (!assetId) {
		return;
	}
	const index = findResourcePanelIndexByAssetId(assetId);
	if (index === -1) {
		return;
	}
	ide_state.resourceBrowserSelectionIndex = index;
	resourceBrowserEnsureSelectionVisible();
	ide_state.pendingResourceSelectionAssetId = null;
}

export function findResourcePanelIndexByAssetId(assetId: string): number {
	for (let i = 0; i < ide_state.resourceBrowserItems.length; i++) {
		const descriptor = ide_state.resourceBrowserItems[i].descriptor;
		if (descriptor && descriptor.assetId === assetId) {
			return i;
		}
	}
	return -1;
}

// getSelectedResourceDescriptor removed; controller + local state provide selection

// computeResourceBrowserMaxHorizontalScroll removed; use controller.computeMaxHScroll()

// clampResourceBrowserHorizontalScroll removed; use controller.clampHScroll()

export function createEntryTabContext(): CodeTabContext | null {
	const assetId = (typeof ide_state.primaryAssetId === 'string' && ide_state.primaryAssetId.length > 0)
		? ide_state.primaryAssetId
		: null;
	const descriptor = assetId ? findResourceDescriptorByAssetId(assetId) : null;
	const resolvedAssetId = descriptor ? descriptor.assetId : (assetId ?? '__entry__');
	const tabId: string = `lua:${resolvedAssetId}`;
	const title = descriptor
		? computeResourceTabTitle(descriptor)
		: (assetId ?? ide_state.metadata.title ?? 'ENTRY').toUpperCase();
	const load = descriptor
		? () => ide_state.loadLuaResourceFn(descriptor.assetId)
		: () => ide_state.loadSourceFn();
	const save = descriptor
		? (source: string) => ide_state.saveLuaResourceFn(descriptor.assetId, source)
		: (source: string) => ide_state.saveSourceFn(source);
	return {
		id: tabId,
		title,
		descriptor: descriptor ?? null,
		load,
		save,
		snapshot: null,
		lastSavedSource: '',
		saveGeneration: 0,
		appliedGeneration: 0,
		dirty: false,
		runtimeErrorOverlay: null,
		executionStopRow: null,
	};
}

export function createLuaCodeTabContext(descriptor: ConsoleResourceDescriptor): CodeTabContext {
	const title = computeResourceTabTitle(descriptor);
	return {
		id: `lua:${descriptor.assetId}`,
		title,
		descriptor,
		load: () => ide_state.loadLuaResourceFn(descriptor.assetId),
		save: (source: string) => ide_state.saveLuaResourceFn(descriptor.assetId, source),
		snapshot: null,
		lastSavedSource: '',
		saveGeneration: 0,
		appliedGeneration: 0,
		dirty: false,
		runtimeErrorOverlay: null,
		executionStopRow: null,
	};
}

export function getActiveCodeTabContext(): CodeTabContext | null {
	if (!ide_state.activeCodeTabContextId) {
		return null;
	}
	return ide_state.codeTabContexts.get(ide_state.activeCodeTabContextId) ?? null;
}

export function storeActiveCodeTabContext(): void {
	const context = getActiveCodeTabContext();
	if (!context) {
		return;
	}
	context.snapshot = captureSnapshot();
	if (ide_state.entryTabId && context.id === ide_state.entryTabId) {
		context.lastSavedSource = ide_state.lastSavedSource;
	}
	context.saveGeneration = ide_state.saveGeneration;
	context.appliedGeneration = ide_state.appliedGeneration;
	context.dirty = ide_state.dirty;
	context.runtimeErrorOverlay = ide_state.runtimeErrorOverlay;
	context.executionStopRow = ide_state.executionStopRow;
	setTabDirty(context.id, context.dirty);
}

export function activateCodeEditorTab(tabId: string | null): void {
	if (!tabId) {
		return;
	}
	let context = ide_state.codeTabContexts.get(tabId);
	if (!context) {
		if (ide_state.entryTabId && tabId === ide_state.entryTabId) {
			const recreated = createEntryTabContext();
			if (!recreated || recreated.id !== tabId) {
				return;
			}
			context = recreated;
			ide_state.entryTabId = context.id;
			ide_state.codeTabContexts.set(tabId, context);
		} else {
			return;
		}
	}
	ide_state.activeCodeTabContextId = tabId;
	const isEntry = ide_state.entryTabId !== null && context.id === ide_state.entryTabId;
	if (context.snapshot) {
		restoreSnapshot(context.snapshot);
		ide_state.saveGeneration = context.saveGeneration;
		ide_state.appliedGeneration = context.appliedGeneration;
		if (isEntry) {
			ide_state.lastSavedSource = context.lastSavedSource;
		}
		context.dirty = ide_state.dirty;
		setTabDirty(context.id, context.dirty);
		syncRuntimeErrorOverlayFromContext(context);
		invalidateAllHighlights();
		updateDesiredColumn();
		ensureCursorVisible();
		refreshActiveDiagnostics();
		const chunkNameSnapshot = resolveHoverChunkName(context) ?? '<console>';
		ide_state.layout.forceSemanticUpdate(ide_state.lines, ide_state.textVersion, chunkNameSnapshot);
		return;
	}
	const source = context.load();
	context.lastSavedSource = source;
	ide_state.lines = splitLines(source);
	invalidateVisualLines();
	markDiagnosticsDirty();
	if (ide_state.lines.length === 0) {
		ide_state.lines.push('');
	}
	invalidateAllHighlights();
	ide_state.cursorRow = 0;
	ide_state.cursorColumn = 0;
	ide_state.scrollRow = 0;
	ide_state.scrollColumn = 0;
	ide_state.selectionAnchor = null;
	ide_state.dirty = false;
	context.dirty = false;
	context.runtimeErrorOverlay = null;
	context.executionStopRow = null;
	ide_state.executionStopRow = null;
	ide_state.saveGeneration = context.saveGeneration;
	ide_state.appliedGeneration = context.appliedGeneration;
	if (isEntry) {
		ide_state.lastSavedSource = context.lastSavedSource;
	}
	setTabDirty(context.id, context.dirty);
	syncRuntimeErrorOverlayFromContext(context);
	bumpTextVersion();
	const chunkName = resolveHoverChunkName(context) ?? '<console>';
	ide_state.layout.forceSemanticUpdate(ide_state.lines, ide_state.textVersion, chunkName);
	updateDesiredColumn();
	resetBlink();
	ide_state.pointerSelecting = false;
	ide_state.pointerPrimaryWasPressed = false;
	refreshActiveDiagnostics();
}

export function getMainProgramSourceForReload(): string {
	const entryId = ide_state.entryTabId;
	if (!entryId) {
		return ide_state.loadSourceFn();
	}
	const context = ide_state.codeTabContexts.get(entryId);
	if (!context) {
		return ide_state.loadSourceFn();
	}
	if (context.id === ide_state.activeCodeTabContextId) {
		return ide_state.lines.join('\n');
	}
	if (context.snapshot) {
		return context.snapshot.lines.join('\n');
	}
	if (context.lastSavedSource.length > 0) {
		return context.lastSavedSource;
	}
	return context.load();
}

export function buildResourceViewerState(descriptor: ConsoleResourceDescriptor): ResourceViewerState {
	const title = computeResourceTabTitle(descriptor);
	const lines: string[] = [
		`Path: ${descriptor.path || '<unknown>'}`,
		`Type: ${descriptor.type}`,
		`Asset ID: ${descriptor.assetId}`,
	];
	const state: ResourceViewerState = {
		descriptor,
		lines: ide_state.lines,
		error: null,
		title,
		scroll: 0,
	};
	let error: string | null = null;
	const rompack = $.rompack;
	if (!rompack) {
		error = 'Rompack unavailable.';
	} else {
		lines.push('');
		switch (descriptor.type) {
			case 'lua': {
				const source = rompack.lua?.[descriptor.assetId];
				if (typeof source === 'string') {
					appendResourceViewerLines(lines, ['-- Lua Source --', '']);
					appendResourceViewerLines(lines, source.split(/\r?\n/));
				} else {
					error = `Lua source '${descriptor.assetId}' unavailable.`;
				}
				break;
			}
			case 'code': {
				const dataEntry = rompack.data?.[descriptor.assetId];
				if (typeof dataEntry === 'string') {
					appendResourceViewerLines(lines, ['-- Code --', '']);
					appendResourceViewerLines(lines, dataEntry.split(/\r?\n/));
				} else if (dataEntry !== undefined) {
					const json = safeJsonStringify(dataEntry);
					appendResourceViewerLines(lines, ['-- Code --', '']);
					appendResourceViewerLines(lines, json.split(/\r?\n/));
				} else if (typeof rompack.code === 'string') {
					appendResourceViewerLines(lines, ['-- Game Code --', '']);
					appendResourceViewerLines(lines, rompack.code.split(/\r?\n/));
				} else {
					error = `Code asset '${descriptor.assetId}' unavailable.`;
				}
				break;
			}
			case 'data':
			case 'rommanifest': {
				const data = rompack.data?.[descriptor.assetId];
				if (data !== undefined) {
					const json = safeJsonStringify(data);
					appendResourceViewerLines(lines, ['-- Data --', '']);
					appendResourceViewerLines(lines, json.split(/\r?\n/));
				} else {
					error = `Data asset '${descriptor.assetId}' not found.`;
				}
				break;
			}
			case 'image':
			case 'atlas':
			case 'romlabel': {
				const image = rompack.img?.[descriptor.assetId];
				if (!image) {
					error = `Image asset '${descriptor.assetId}' not found.`;
					break;
				}
				const meta = image.imgmeta ?? {};
				const width = (meta as { width?: number }).width;
				const height = (meta as { height?: number }).height;
				const atlasId = (meta as { atlasid?: number }).atlasid;
				const atlassed = (meta as { atlassed?: boolean }).atlassed;
				if (Number.isFinite(width) && Number.isFinite(height)) {
					state.image = {
						assetId: descriptor.assetId,
						width: Math.max(1, Math.floor(width as number)),
						height: Math.max(1, Math.floor(height as number)),
						atlassed: Boolean(atlassed),
						atlasId: atlasId,
					};
				}
				appendResourceViewerLines(lines, ['-- Image Metadata --']);
				if (Number.isFinite(width) && Number.isFinite(height)) {
					appendResourceViewerLines(lines, [`Dimensions: ${width}x${height}`]);
				}
				if (typeof atlassed === 'boolean') {
					appendResourceViewerLines(lines, [`Atlassed: ${atlassed ? 'yes' : 'no'}`]);
				}
				if (atlasId !== undefined) {
					appendResourceViewerLines(lines, [`Atlas ID: ${atlasId}`]);
				}
				for (const [key, value] of Object.entries(meta)) {
					if (['width', 'height', 'atlassed', 'atlasid'].includes(key)) {
						continue;
					}
					appendResourceViewerLines(lines, [`${key}: ${describeMetadataValue(value)}`]);
				}
				break;
			}
			case 'audio': {
				const audio = rompack.audio?.[descriptor.assetId];
				if (!audio) {
					error = `Audio asset '${descriptor.assetId}' not found.`;
					break;
				}
				const meta = audio.audiometa ?? {};
				appendResourceViewerLines(lines, ['-- Audio Metadata --']);
				const bufferSize = (audio.buffer as { byteLength?: number } | undefined)?.byteLength;
				if (typeof bufferSize === 'number') {
					appendResourceViewerLines(lines, [`Buffer Size: ${bufferSize} bytes`]);
				}
				for (const [key, value] of Object.entries(meta)) {
					appendResourceViewerLines(lines, [`${key}: ${describeMetadataValue(value)}`]);
				}
				break;
			}
			case 'model': {
				const model = rompack.model?.[descriptor.assetId];
				if (!model) {
					error = `Model asset '${descriptor.assetId}' not found.`;
					break;
				}
				const keys = Object.keys(model);
				appendResourceViewerLines(lines, ['-- Model Metadata --', `Keys: ${keys.join(', ')}`]);
				break;
			}
			case 'aem': {
				const events = rompack.audioevents?.[descriptor.assetId];
				if (!events) {
					error = `Audio event map '${descriptor.assetId}' not found.`;
					break;
				}
				const json = safeJsonStringify(events);
				appendResourceViewerLines(lines, ['-- Audio Events --', '']);
				appendResourceViewerLines(lines, json.split(/\r?\n/));
				break;
			}
			default: {
				appendResourceViewerLines(lines, ['<no preview available for this asset type>']);
				break;
			}
		}
	}
	if (error) {
		lines.push('');
		lines.push(`Error: ${error}`);
	}
	if (lines.length === 0) {
		lines.push('<empty>');
	}
	trimResourceViewerLines(lines);
	state.error = error;
	return state;
}

export function computeResourceTabTitle(descriptor: ConsoleResourceDescriptor): string {
	const normalized = descriptor.path.replace(/\\/g, '/');
	const parts = normalized.split('/').filter(part => part.length > 0);
	if (parts.length > 0) {
		return parts[parts.length - 1];
	}
	if (descriptor.assetId && descriptor.assetId.length > 0) {
		return descriptor.assetId;
	}
	return descriptor.type.toUpperCase();
}

export function appendResourceViewerLines(target: string[], additions: Iterable<string>): void {
	for (const entry of additions) {
		if (target.length >= constants.RESOURCE_VIEWER_MAX_LINES - 1) {
			if (target.length === constants.RESOURCE_VIEWER_MAX_LINES - 1) {
				target.push('<content truncated>');
			}
			return;
		}
		target.push(entry);
	}
}

export function trimResourceViewerLines(lines: string[]): void {
	if (lines.length > constants.RESOURCE_VIEWER_MAX_LINES) {
		lines.length = constants.RESOURCE_VIEWER_MAX_LINES - 1;
		lines.push('<content truncated>');
	}
}

export function safeJsonStringify(value: unknown, space = 2): string {
	return JSON.stringify(value, (_key, val) => {
		if (typeof val === 'bigint') {
			return Number(val);
		}
		return val;
	}, space);
}

export function describeMetadataValue(value: unknown): string {
	if (value === null || value === undefined) {
		return '<none>';
	}
	if (typeof value === 'string') {
		return value;
	}
	if (typeof value === 'number' || typeof value === 'boolean') {
		return String(value);
	}
	if (Array.isArray(value)) {
		const preview = value.slice(0, 4).map(entry => describeMetadataValue(entry)).join(', ');
		return `[${preview}${value.length > 4 ? ', …' : ''}]`;
	}
	if (typeof value === 'object') {
		const keys = Object.keys(value as Record<string, unknown>);
		return `{${keys.join(', ')}}`;
	}
	return String(value);
}

export function getViewportMetrics(): ViewportMetrics {
	const platform = $.platform;
	if (!platform) {
		throw new Error('[ConsoleCartEditor] Platform services unavailable while resolving viewport metrics.');
	}
	const host = platform.gameviewHost;
	if (!host || typeof host.getCapability !== 'function') {
		throw new Error('[ConsoleCartEditor] Game view host unavailable while resolving viewport metrics.');
	}
	const provider = host.getCapability('viewport-metrics');
	if (!provider) {
		throw new Error('[ConsoleCartEditor] Viewport metrics capability unavailable on the current platform.');
	}
	const metrics = provider.getViewportMetrics();
	if (!metrics) {
		throw new Error('[ConsoleCartEditor] Viewport metrics provider returned no data.');
	}
	const { windowInner, screen } = metrics;
	if (!windowInner || !Number.isFinite(windowInner.width) || windowInner.width <= 0) {
		throw new Error('[ConsoleCartEditor] Viewport metrics reported an invalid inner window width.');
	}
	if (!screen || !Number.isFinite(screen.width) || screen.width <= 0) {
		throw new Error('[ConsoleCartEditor] Viewport metrics reported an invalid screen width.');
	}
	return metrics;
}

export function computePanelRatioBounds(): { min: number; max: number } {
	const minRatio = constants.RESOURCE_PANEL_MIN_RATIO;
	const minEditorRatio = constants.RESOURCE_PANEL_MIN_EDITOR_RATIO;
	const availableForPanel = Math.max(0, 1 - minEditorRatio);
	const maxRatio = Math.max(minRatio, Math.min(constants.RESOURCE_PANEL_MAX_RATIO, availableForPanel));
	return { min: minRatio, max: maxRatio };
}

export function clampResourcePanelRatio(ratio: number | null): number {
	const bounds = computePanelRatioBounds();
	let resolved = ratio ?? defaultResourcePanelRatio();
	if (!Number.isFinite(resolved)) {
		resolved = constants.RESOURCE_PANEL_DEFAULT_RATIO;
	}
	if (resolved < bounds.min) {
		resolved = bounds.min;
	}
	if (resolved > bounds.max) {
		resolved = bounds.max;
	}
	return resolved;
}

export function defaultResourcePanelRatio(): number {
	const metrics = getViewportMetrics();
	const viewportWidth = metrics.windowInner.width;
	const screenWidth = metrics.screen.width;
	const relative = Math.min(1, viewportWidth / screenWidth);
	const responsiveness = 1 - relative;
	const ratio = constants.RESOURCE_PANEL_DEFAULT_RATIO + responsiveness * (constants.RESOURCE_PANEL_MAX_RATIO - constants.RESOURCE_PANEL_DEFAULT_RATIO) * 0.6;
	const bounds = computePanelRatioBounds();
	return Math.max(bounds.min, Math.min(bounds.max, ratio));
}

export function computePanelPixelWidth(ratio: number): number {
	if (!Number.isFinite(ratio) || ratio <= 0 || ide_state.viewportWidth <= 0) {
		return 0;
	}
	return Math.floor(ide_state.viewportWidth * ratio);
}

export function getResourcePanelWidth(): number {
	if (!ide_state.resourcePanelVisible) return 0;
	const bounds = ide_state.resourcePanel.getBounds();
	return bounds ? Math.max(0, bounds.right - bounds.left) : 0;
}

// getResourcePanelBounds removed; use ide_state.resourcePanel.getBounds()

export function isPointerOverResourcePanelDivider(x: number, y: number): boolean {
	if (!ide_state.resourcePanelVisible) {
		return false;
	}
	const bounds = ide_state.resourcePanel.getBounds();
	if (!bounds) {
		return false;
	}
	const margin = constants.RESOURCE_PANEL_DIVIDER_DRAG_MARGIN;
	const left = bounds.right - margin;
	const right = bounds.right + margin;
	return y >= bounds.top && y <= bounds.bottom && x >= left && x <= right;
}

// resourcePanelLineCapacity removed; use ide_state.resourcePanel.lineCapacity()

export function scrollResourceBrowser(amount: number): void {
	if (!ide_state.resourcePanelVisible) return;
	ide_state.resourcePanel.scrollBy(amount);
	// controller owns scroll; no local mirror required
}

export function resourceViewerImageLayout(viewer: ResourceViewerState): { left: number; top: number; width: number; height: number; bottom: number; scale: number } | null {
	const info = viewer.image;
	if (!info) {
		return null;
	}
	const width = Math.max(1, info.width);
	const height = Math.max(1, info.height);
	const bounds = getCodeAreaBounds();
	const totalHeight = Math.max(0, bounds.codeBottom - bounds.codeTop);
	if (totalHeight <= 0) {
		return null;
	}
	const paddingX = constants.RESOURCE_PANEL_PADDING_X;
	const contentTop = bounds.codeTop + 2;
	const availableWidth = Math.max(1, bounds.codeRight - bounds.codeLeft - paddingX * 2);
	const estimatedTextLines = Math.max(3, Math.min(8, viewer.lines.length + (viewer.error ? 1 : 0)));
	const reservedTextHeight = Math.min(totalHeight * 0.45, ide_state.lineHeight * estimatedTextLines);
	const maxImageHeight = Math.max(ide_state.lineHeight * 2, totalHeight - reservedTextHeight);
	let scale = Math.min(availableWidth / width, maxImageHeight / height);
	if (!Number.isFinite(scale) || scale <= 0) {
		scale = Math.min(availableWidth / width, totalHeight / height);
		if (!Number.isFinite(scale) || scale <= 0) {
			return null;
		}
	}
	const drawWidth = width * scale;
	const drawHeight = height * scale;
	const leftMargin = bounds.codeLeft + paddingX;
	const centeredOffset = Math.max(0, Math.floor((availableWidth - drawWidth) * 0.5));
	const left = leftMargin + centeredOffset;
	const top = contentTop;
	const bottom = top + drawHeight;
	return { left, top, width: drawWidth, height: drawHeight, bottom, scale };
}

export function resourceViewerTextCapacity(viewer: ResourceViewerState): number {
	const bounds = getCodeAreaBounds();
	const contentTop = bounds.codeTop + 2;
	const layout = resourceViewerImageLayout(viewer);
	let textTop = contentTop;
	if (layout) {
		textTop = Math.floor(layout.bottom + ide_state.lineHeight);
	}
	if (textTop >= bounds.codeBottom) {
		return 0;
	}
	const availableHeight = Math.max(0, bounds.codeBottom - textTop);
	return Math.max(0, Math.floor(availableHeight / ide_state.lineHeight));
}

export function ensureResourceViewerSprite(api: BmsxConsoleApi, assetId: string, layout: { left: number; top: number; scale: number }): void {
	if (!ide_state.resourceViewerSpriteId) {
		ide_state.resourceViewerSpriteId = 'console_resource_viewer_sprite';
	}
	const spriteId = ide_state.resourceViewerSpriteId;
	let object = api.world_object(spriteId);
	if (!object) {
		api.spawn_world_object('WorldObject', {
			id: spriteId,
			position: { x: layout.left, y: layout.top, z: 0 },
			components: [
				{
					class: 'SpriteComponent',
					options: {
						id_local: 'viewer_sprite',
						imgid: assetId,
						layer: 'ui',
					},
				},
			],
		});
		object = api.world_object(spriteId);
	}
	if (!object) {
		return;
	}
	const sprite = object.getComponentByLocalId(SpriteComponent, 'viewer_sprite');
	if (!sprite) {
		return;
	}
	if (ide_state.resourceViewerSpriteAsset !== assetId) {
		sprite.imgid = assetId;
		ide_state.resourceViewerSpriteAsset = assetId;
	}
	if (ide_state.resourceViewerSpriteScale !== layout.scale) {
		sprite.scale.x = layout.scale;
		sprite.scale.y = layout.scale;
		ide_state.resourceViewerSpriteScale = layout.scale;
	}
	object.x = layout.left;
	object.y = layout.top;
	object.visible = true;
}

export function hideResourceViewerSprite(api: BmsxConsoleApi): void {
	if (!ide_state.resourceViewerSpriteId) {
		return;
	}
	const object = api.world_object(ide_state.resourceViewerSpriteId);
	if (object) {
		object.visible = false;
	}
}

export function resourceViewerClampScroll(viewer: ResourceViewerState): void {
	const capacity = resourceViewerTextCapacity(viewer);
	if (capacity <= 0) {
		viewer.scroll = 0;
		return;
	}
	const maxScroll = Math.max(0, viewer.lines.length - capacity);
	if (!Number.isFinite(viewer.scroll) || viewer.scroll < 0) {
		viewer.scroll = 0;
		return;
	}
	if (viewer.scroll > maxScroll) {
		viewer.scroll = maxScroll;
	}
}

// Bridge wrappers to the ResourcePanelController (temporary during migration)
export function resourceBrowserEnsureSelectionVisible(): void {
	if (!ide_state.resourcePanelVisible) return;
	ide_state.resourcePanel.ensureSelectionVisiblePublic();
	// controller owns scroll; no local mirror required
}

export function scrollResourceBrowserHorizontal(delta: number): void {
	if (!ide_state.resourcePanelVisible) return;
	const s = ide_state.resourcePanel.getStateForRender();
	ide_state.resourcePanel.setHScroll(s.hscroll + delta);
}

// moved to ResourcePanelController

export function scrollResourceViewer(amount: number): void {
	const viewer = getActiveResourceViewer();
	if (!viewer) {
		return;
	}
	const capacity = resourceViewerTextCapacity(viewer);
	if (capacity <= 0) {
		viewer.scroll = 0;
		return;
	}
	const maxScroll = Math.max(0, viewer.lines.length - capacity);
	viewer.scroll = clamp(viewer.scroll + amount, 0, maxScroll);
	resourceViewerClampScroll(viewer);
}

// moved to ResourcePanelController


export function handleResourceViewerInput(keyboard: KeyboardInput, deltaSeconds: number): void {
	// Resource viewer specific keys
	const viewer = getActiveResourceViewer();
	if (!viewer) return;
	if (shouldFireRepeat(keyboard, 'ArrowUp', deltaSeconds)) {
		consumeKeyboardKey(keyboard, 'ArrowUp');
		scrollResourceViewer(-1);
		return;
	}
	if (shouldFireRepeat(keyboard, 'ArrowDown', deltaSeconds)) {
		consumeKeyboardKey(keyboard, 'ArrowDown');
		scrollResourceViewer(1);
		return;
	}
	if (shouldFireRepeat(keyboard, 'PageUp', deltaSeconds)) {
		consumeKeyboardKey(keyboard, 'PageUp');
		const capacity = resourceViewerTextCapacity(viewer);
		scrollResourceViewer(-Math.max(1, capacity));
		return;
	}
	if (shouldFireRepeat(keyboard, 'PageDown', deltaSeconds)) {
		consumeKeyboardKey(keyboard, 'PageDown');
		const capacity = resourceViewerTextCapacity(viewer);
		scrollResourceViewer(Math.max(1, capacity));
		return;
	}
}

export function drawResourcePanel(api: BmsxConsoleApi): void {
	// Delegate full drawing to controller and then mirror back minimal state used elsewhere
	ide_state.resourcePanel.draw(api);
	const s = ide_state.resourcePanel.getStateForRender();
	ide_state.resourcePanelVisible = s.visible;
	ide_state.resourceBrowserItems = s.items;
	ide_state.resourcePanelFocused = s.focused;
	ide_state.resourceBrowserSelectionIndex = s.selectionIndex;
	ide_state.resourcePanelResourceCount = s.items.length;
	// max line width handled by controller
}

export function drawResourceViewer(api: BmsxConsoleApi): void {
	const viewer = getActiveResourceViewer();
	if (!viewer) {
		return;
	}
	resourceViewerClampScroll(viewer);
	const bounds = getCodeAreaBounds();
	const contentLeft = bounds.codeLeft + constants.RESOURCE_PANEL_PADDING_X;
	const capacity = resourceViewerTextCapacity(viewer);
	const totalLines = viewer.lines.length;
	const verticalScrollbar = ide_state.scrollbars.viewerVertical;
	const verticalTrack: RectBounds = {
		left: bounds.codeRight - constants.SCROLLBAR_WIDTH,
		top: bounds.codeTop,
		right: bounds.codeRight,
		bottom: bounds.codeBottom,
	};
	verticalScrollbar.layout(verticalTrack, totalLines, Math.max(1, capacity), viewer.scroll);
	const verticalVisible = verticalScrollbar.isVisible();
	viewer.scroll = clamp(verticalScrollbar.getScroll(), 0, Math.max(0, totalLines - capacity));

	api.rectfill(bounds.codeLeft, bounds.codeTop, bounds.codeRight, bounds.codeBottom, constants.COLOR_RESOURCE_VIEWER_BACKGROUND);

	const contentTop = bounds.codeTop + 2;
	const layout = resourceViewerImageLayout(viewer);
	let textTop = contentTop;
	if (layout && viewer.image) {
		ensureResourceViewerSprite(api, viewer.image.assetId, { left: layout.left, top: layout.top, scale: layout.scale });
		textTop = Math.floor(layout.bottom + ide_state.lineHeight);
	} else {
		hideResourceViewerSprite(api);
	}
	if (capacity <= 0) {
		if (viewer.lines.length > 0) {
			const line = viewer.lines[Math.min(viewer.lines.length - 1, Math.max(0, Math.floor(viewer.scroll)))] ?? '';
			const fallbackY = Math.min(textTop, bounds.codeBottom - ide_state.lineHeight);
			drawEditorText(api, ide_state.font, line, contentLeft, fallbackY, constants.COLOR_RESOURCE_VIEWER_TEXT);
		} else {
			drawEditorText(api, ide_state.font, '<empty>', contentLeft, textTop, constants.COLOR_RESOURCE_VIEWER_TEXT);
		}
		if (verticalVisible) {
			verticalScrollbar.draw(api, constants.SCROLLBAR_TRACK_COLOR, constants.SCROLLBAR_THUMB_COLOR);
		}
		return;
	}
	const maxScroll = Math.max(0, totalLines - capacity);
	viewer.scroll = clamp(viewer.scroll, 0, maxScroll);
	const end = Math.min(totalLines, Math.floor(viewer.scroll) + capacity);
	if (viewer.lines.length === 0) {
		drawEditorText(api, ide_state.font, '<empty>', contentLeft, textTop, constants.COLOR_RESOURCE_VIEWER_TEXT);
	} else {
		for (let lineIndex = Math.floor(viewer.scroll), drawIndex = 0; lineIndex < end; lineIndex += 1, drawIndex += 1) {
			const line = viewer.lines[lineIndex] ?? '';
			const y = textTop + drawIndex * ide_state.lineHeight;
			if (y >= bounds.codeBottom) {
				break;
			}
			drawEditorText(api, ide_state.font, line, contentLeft, y, constants.COLOR_RESOURCE_VIEWER_TEXT);
		}
	}
	if (verticalVisible) {
		verticalScrollbar.draw(api, constants.SCROLLBAR_TRACK_COLOR, constants.SCROLLBAR_THUMB_COLOR);
	}
}

export function drawReferenceHighlightsForRow(api: BmsxConsoleApi, rowIndex: number, entry: CachedHighlight, originX: number, originY: number, sliceStartDisplay: number, sliceEndDisplay: number): void {
	const matches = ide_state.referenceState.getMatches();
	if (matches.length === 0) {
		return;
	}
	const activeIndex = ide_state.referenceState.getActiveIndex();
	const highlight = entry.hi;
	for (let i = 0; i < matches.length; i += 1) {
		const match = matches[i];
		if (match.row !== rowIndex) {
			continue;
		}
		const startDisplay = columnToDisplay(highlight, match.start);
		const endDisplay = columnToDisplay(highlight, match.end);
		const visibleStart = Math.max(sliceStartDisplay, startDisplay);
		const visibleEnd = Math.min(sliceEndDisplay, endDisplay);
		if (visibleEnd <= visibleStart) {
			continue;
		}
		const startX = originX + measureRangeFast(entry, sliceStartDisplay, visibleStart);
		const endX = originX + measureRangeFast(entry, sliceStartDisplay, visibleEnd);
		const overlay = i === activeIndex ? constants.REFERENCES_MATCH_ACTIVE_OVERLAY : constants.REFERENCES_MATCH_OVERLAY;
		api.rectfill_color(startX, originY, endX, originY + ide_state.lineHeight, overlay);
	}
}

export function drawSearchHighlightsForRow(api: BmsxConsoleApi, rowIndex: number, entry: CachedHighlight, originX: number, originY: number, sliceStartDisplay: number, sliceEndDisplay: number): void {
	if (ide_state.searchScope !== 'local' || ide_state.searchMatches.length === 0 || ide_state.searchQuery.length === 0) {
		return;
	}
	const highlight = entry.hi;
	for (let i = 0; i < ide_state.searchMatches.length; i++) {
		const match = ide_state.searchMatches[i];
		if (match.row !== rowIndex) {
			continue;
		}
		const startDisplay = columnToDisplay(highlight, match.start);
		const endDisplay = columnToDisplay(highlight, match.end);
		const visibleStart = Math.max(sliceStartDisplay, startDisplay);
		const visibleEnd = Math.min(sliceEndDisplay, endDisplay);
		if (visibleEnd <= visibleStart) {
			continue;
		}
		const startX = originX + measureRangeFast(entry, sliceStartDisplay, visibleStart);
		const endX = originX + measureRangeFast(entry, sliceStartDisplay, visibleEnd);
		const overlay = i === ide_state.searchCurrentIndex ? constants.SEARCH_MATCH_ACTIVE_OVERLAY : constants.SEARCH_MATCH_OVERLAY;
		api.rectfill_color(startX, originY, endX, originY + ide_state.lineHeight, overlay);
	}
}

export function computeCursorScreenInfo(entry: CachedHighlight, textLeft: number, rowTop: number, sliceStartDisplay: number): CursorScreenInfo {
	const highlight = entry.hi;
	const columnToDisplay = highlight.columnToDisplay;
	const clampedColumn = columnToDisplay.length > 0
		? clamp(ide_state.cursorColumn, 0, columnToDisplay.length - 1)
		: 0;
	const cursorDisplayIndex = columnToDisplay.length > 0 ? columnToDisplay[clampedColumn] : 0;
	const limitedDisplayIndex = Math.max(sliceStartDisplay, cursorDisplayIndex);
	const cursorX = textLeft + measureRangeFast(entry, sliceStartDisplay, limitedDisplayIndex);
	let cursorWidth = ide_state.charAdvance;
	let baseChar = ' ';
	let baseColor = constants.COLOR_CODE_TEXT;
	if (cursorDisplayIndex < highlight.chars.length) {
		baseChar = highlight.chars[cursorDisplayIndex];
		baseColor = highlight.colors[cursorDisplayIndex];
		const widthIndex = cursorDisplayIndex + 1;
		if (widthIndex < entry.advancePrefix.length) {
			const widthValue = entry.advancePrefix[widthIndex] - entry.advancePrefix[cursorDisplayIndex];
			if (widthValue > 0) {
				cursorWidth = widthValue;
			} else {
				cursorWidth = ide_state.font.advance(baseChar);
			}
		}
	}
	const currentChar = currentLine().charAt(ide_state.cursorColumn);
	if (currentChar === '\t') {
		cursorWidth = ide_state.spaceAdvance * constants.TAB_SPACES;
	}
	return {
		row: ide_state.cursorRow,
		column: ide_state.cursorColumn,
		x: cursorX,
		y: rowTop,
		width: cursorWidth,
		height: ide_state.lineHeight,
		baseChar,
		baseColor,
	};
}

export function sliceHighlightedLine(highlight: HighlightLine, columnStart: number, columnCount: number): { text: string; colors: number[]; startDisplay: number; endDisplay: number } {
	return ide_state.layout.sliceHighlightedLine(highlight, columnStart, columnCount);
}

export function getCachedHighlight(row: number): CachedHighlight {
	const activeContext = getActiveCodeTabContext();
	const chunkName = resolveHoverChunkName(activeContext) ?? '<console>';
	return ide_state.layout.getCachedHighlight(ide_state.lines, row, ide_state.textVersion, chunkName);
}

export function invalidateLine(row: number): void {
	ide_state.layout.invalidateHighlight(row);
}

export function invalidateAllHighlights(): void {
	ide_state.layout.invalidateAllHighlights();
}

export function invalidateHighlightsFromRow(startRow: number): void {
	ide_state.layout.invalidateHighlightsFrom(Math.max(0, startRow));
}

export function measureRangeFast(entry: CachedHighlight, startDisplay: number, endDisplay: number): number {
	return ide_state.layout.measureRangeFast(entry, startDisplay, endDisplay);
}

export function requestSemanticRefresh(context?: CodeTabContext | null): void {
	const activeContext = context ?? getActiveCodeTabContext();
	const chunkName = resolveHoverChunkName(activeContext) ?? '<console>';
	ide_state.layout.requestSemanticUpdate(ide_state.lines, ide_state.textVersion, chunkName);
}

export function lowerBound(values: number[], target: number, lo = 0, hi = values.length): number {
	let left = lo;
	let right = hi;
	while (left < right) {
		const mid = (left + right) >>> 1;
		if (values[mid] < target) {
			left = mid + 1;
		} else {
			right = mid;
		}
	}
	return left;
}

export function bumpTextVersion(): void {
	ide_state.textVersion += 1;
}

export function markDiagnosticsDirty(contextId?: string): void {
	const targetId = contextId ?? ide_state.activeCodeTabContextId;
	if (!targetId) {
		return;
	}
	ide_state.diagnosticsDirty = true;
	ide_state.dirtyDiagnosticContexts.add(targetId);
	ide_state.diagnosticsDueAtMs = ide_state.clockNow() + diagnosticsDebounceMs;
}

export function markTextMutated(): void {
	ide_state.dirty = true;
	markDiagnosticsDirty();
	bumpTextVersion();
	clearReferenceHighlights();
	updateActiveContextDirtyFlag();
	invalidateVisualLines();
	requestSemanticRefresh();
	ide_state.navigationHistory.forward.length = 0;
	handlePostEditMutation();
	if (ide_state.searchQuery.length > 0) startSearchJob();
}

export function recordEditContext(kind: 'insert' | 'delete' | 'replace', text: string): void {
	ide_state.pendingEditContext = { kind, text };
}

export function handlePostEditMutation(): void {
	const editContext = ide_state.pendingEditContext;
	ide_state.pendingEditContext = null;
	ide_state.completion.updateAfterEdit(editContext);
}

export function handleCompletionKeybindings(
	keyboard: KeyboardInput,
	deltaSeconds: number,
	shiftDown: boolean,
	ctrlDown: boolean,
	altDown: boolean,
	metaDown: boolean,
): boolean {
	return ide_state.completion.handleKeybindings(keyboard, deltaSeconds, shiftDown, ctrlDown, altDown, metaDown);
}

export function onCursorMoved(): void {
	ide_state.completion.onCursorMoved();
}

export function invalidateVisualLines(): void {
	ide_state.layout.markVisualLinesDirty();
}

export function ensureVisualLines(): void {
	const activeContext = getActiveCodeTabContext();
	const chunkName = resolveHoverChunkName(activeContext) ?? '<console>';
	ide_state.scrollRow = ide_state.layout.ensureVisualLines({
		lines: ide_state.lines,
		wordWrapEnabled: ide_state.wordWrapEnabled,
		scrollRow: ide_state.scrollRow,
		documentVersion: ide_state.textVersion,
		chunkName,
		computeWrapWidth: () => computeWrapWidth(),
		estimatedVisibleRowCount: Math.max(1, ide_state.cachedVisibleRowCount),
	});
	if (ide_state.scrollRow < 0) {
		ide_state.scrollRow = 0;
	}
}

export function computeWrapWidth(): number {
	const resourceWidth = ide_state.resourcePanelVisible ? getResourcePanelWidth() : 0;
	const gutterSpace = ide_state.gutterWidth + 2;
	const verticalScrollbarSpace = 0;
	const available = ide_state.viewportWidth - resourceWidth - gutterSpace - verticalScrollbarSpace;
	return Math.max(ide_state.charAdvance, available - 2);
}

export function getVisualLineCount(): number {
	ensureVisualLines();
	return ide_state.layout.getVisualLineCount();
}

export function visualIndexToSegment(index: number): VisualLineSegment | null {
	ensureVisualLines();
	return ide_state.layout.visualIndexToSegment(index);
}

export function positionToVisualIndex(row: number, column: number): number {
	ensureVisualLines();
	const override = caretNavigation.peek(row, column);
	if (override) {
		return override.visualIndex;
	}
	return ide_state.layout.positionToVisualIndex(ide_state.lines, row, column);
}

export function setCursorFromVisualIndex(visualIndex: number, desiredColumnHint?: number, desiredOffsetHint?: number): void {
	ensureVisualLines();
	caretNavigation.clear();
	const visualLines = ide_state.layout.getVisualLines();
	if (visualLines.length === 0) {
		ide_state.cursorRow = 0;
		ide_state.cursorColumn = 0;
		updateDesiredColumn();
		return;
	}
	const clampedIndex = clamp(visualIndex, 0, visualLines.length - 1);
	const segment = visualLines[clampedIndex];
	if (!segment) {
		return;
	}
	const entry = getCachedHighlight(segment.row);
	const highlight = entry.hi;
	const line = ide_state.lines[segment.row] ?? '';
	const hasDesiredHint = desiredColumnHint !== undefined;
	const hasOffsetHint = desiredOffsetHint !== undefined;
	let targetColumn = hasDesiredHint ? desiredColumnHint! : ide_state.cursorColumn;
	if (ide_state.wordWrapEnabled) {
		const segmentEndColumn = Math.max(segment.endColumn, segment.startColumn);
		const segmentDisplayStart = columnToDisplay(highlight, segment.startColumn);
		const segmentDisplayEnd = columnToDisplay(highlight, segmentEndColumn);
		const segmentWidth = Math.max(0, segmentDisplayEnd - segmentDisplayStart);
		if (hasOffsetHint) {
			const clampedOffset = clamp(Math.round(desiredOffsetHint!), 0, segmentWidth);
			const targetDisplay = clamp(segmentDisplayStart + clampedOffset, segmentDisplayStart, segmentDisplayEnd);
			let columnFromOffset = entry.displayToColumn[targetDisplay];
			if (columnFromOffset === undefined) {
				columnFromOffset = ide_state.lines[segment.row].length;
			}
			targetColumn = clamp(columnFromOffset, segment.startColumn, segmentEndColumn);
		} else {
			targetColumn = clamp(Math.round(targetColumn), segment.startColumn, segmentEndColumn);
			if (targetColumn > line.length) {
				targetColumn = line.length;
			}
		}
	} else {
		targetColumn = clamp(Math.round(targetColumn), 0, line.length);
	}
	ide_state.cursorRow = segment.row;
	ide_state.cursorColumn = clamp(targetColumn, 0, line.length);
	const cursorDisplay = columnToDisplay(highlight, ide_state.cursorColumn);
	if (ide_state.wordWrapEnabled) {
		const hasNextSegmentSameRow = (clampedIndex + 1 < visualLines.length)
			&& visualLines[clampedIndex + 1].row === segment.row;
		const segmentEnd = Math.max(segment.endColumn, segment.startColumn);
		if (ide_state.cursorColumn < segment.startColumn) {
			ide_state.cursorColumn = segment.startColumn;
		}
		if (segmentEnd >= segment.startColumn && ide_state.cursorColumn > segmentEnd) {
			ide_state.cursorColumn = Math.min(segmentEnd, line.length);
		}
		if (hasNextSegmentSameRow && ide_state.cursorColumn >= segmentEnd) {
			ide_state.cursorColumn = Math.max(segment.startColumn, segmentEnd - 1);
		}
		const segmentDisplayStart = columnToDisplay(highlight, segment.startColumn);
		ide_state.desiredDisplayOffset = cursorDisplay - segmentDisplayStart;
	} else {
		ide_state.desiredDisplayOffset = cursorDisplay;
	}
	if (hasDesiredHint) {
		ide_state.desiredColumn = Math.max(0, desiredColumnHint!);
	} else {
		ide_state.desiredColumn = ide_state.cursorColumn;
	}
	if (ide_state.desiredDisplayOffset < 0) {
		ide_state.desiredDisplayOffset = 0;
	}
}


export function drawRectOutlineColor(api: BmsxConsoleApi, left: number, top: number, right: number, bottom: number, color: { r: number; g: number; b: number; a: number }): void {
	if (right <= left || bottom <= top) {
		return;
	}
	api.rectfill_color(left, top, right, top + 1, color);
	api.rectfill_color(left, bottom - 1, right, bottom, color);
	api.rectfill_color(left, top, left + 1, bottom, color);
	api.rectfill_color(right - 1, top, right, bottom, color);
}

export function computeSelectionSlice(lineIndex: number, highlight: HighlightLine, sliceStart: number, sliceEnd: number): { startDisplay: number; endDisplay: number } | null {
	const range = getSelectionRange();
	if (!range) {
		return null;
	}
	const { start, end } = range;
	if (lineIndex < start.row || lineIndex > end.row) {
		return null;
	}
	let selectionStartColumn = lineIndex === start.row ? start.column : 0;
	let selectionEndColumn = lineIndex === end.row ? end.column : ide_state.lines[lineIndex].length;
	if (lineIndex === end.row && end.column === 0 && end.row > start.row) {
		selectionEndColumn = 0;
	}
	if (selectionStartColumn === selectionEndColumn) {
		return null;
	}
	const startDisplay = columnToDisplay(highlight, selectionStartColumn);
	const endDisplay = columnToDisplay(highlight, selectionEndColumn);
	const visibleStart = Math.max(sliceStart, startDisplay);
	const visibleEnd = Math.min(sliceEnd, endDisplay);
	if (visibleEnd <= visibleStart) {
		return null;
	}
	return { startDisplay: visibleStart, endDisplay: visibleEnd };
}

export function drawStatusBar(api: BmsxConsoleApi): void {
	const host = {
		viewportWidth: ide_state.viewportWidth,
		viewportHeight: ide_state.viewportHeight,
		bottomMargin: statusAreaHeight(),
		lineHeight: ide_state.lineHeight,
		measureText: (text: string) => measureText(text),
		drawText: (api2: BmsxConsoleApi, text: string, x: number, y: number, color: number) => drawEditorText(api2, ide_state.font, text, x, y, color),
		truncateTextToWidth: (text: string, maxWidth: number) => truncateTextToWidth(text, maxWidth),
		message: ide_state.message,
		getStatusMessageLines: () => getStatusMessageLines(),
		symbolSearchVisible: ide_state.symbolSearchVisible,
		getActiveSymbolSearchMatch: () => getActiveSymbolSearchMatch(),
		resourcePanelVisible: ide_state.resourcePanelVisible,
		resourcePanelFilterMode: ide_state.resourcePanel.getFilterMode(),
		resourcePanelResourceCount: ide_state.resourcePanelResourceCount,
		isResourceViewActive: () => isResourceViewActive(),
		getActiveResourceViewer: () => getActiveResourceViewer(),
		metadata: ide_state.metadata,
		statusLeftInfo: buildStatusLeftInfo(),
		problemsPanelFocused: ide_state.problemsPanel.isVisible() && ide_state.problemsPanel.isFocused(),
	};
	renderStatusBar(api, host);
}

export function buildStatusLeftInfo(): string {
	if (ide_state.problemsPanel.isVisible()) {
		if (ide_state.problemsPanel.isFocused()) {
			const sel = ide_state.problemsPanel.getSelectedDiagnostic();
			if (sel) {
				const file = sel.sourceLabel ?? (sel.chunkName ?? '');
				const parts: string[] = [];
				parts.push(`Ln ${sel.row + 1}, Col ${sel.startColumn + 1}`);
				if (file.length > 0) parts.push(file);
				return parts.join(' • ');
			}
		}
		// When Problems panel is visible but not focused or no selection, don't render default editor position
		return '';
	}
	return `LINE ${ide_state.cursorRow + 1}/${ide_state.lines.length} COL ${ide_state.cursorColumn + 1}`;
}

export function drawProblemsPanel(api: BmsxConsoleApi): void {
	const bounds = getProblemsPanelBounds();
	if (!bounds) {
		return;
	}
	ide_state.problemsPanel.draw(api, bounds);
}

export function getProblemsPanelBounds(): RectBounds | null {
	const panelHeight = getVisibleProblemsPanelHeight();
	if (panelHeight <= 0) {
		return null;
	}
	const statusHeight = statusAreaHeight();
	const bottom = ide_state.viewportHeight - statusHeight;
	const top = bottom - panelHeight;
	if (bottom <= top) {
		return null;
	}
	return { left: 0, top, right: ide_state.viewportWidth, bottom };
}

export function isPointerOverProblemsPanelDivider(x: number, y: number): boolean {
	const bounds = getProblemsPanelBounds();
	if (!bounds) {
		return false;
	}
	const margin = constants.PROBLEMS_PANEL_DIVIDER_DRAG_MARGIN;
	const dividerTop = bounds.top;
	return y >= dividerTop - margin && y <= dividerTop + margin && x >= bounds.left && x <= bounds.right;
}

export function setProblemsPanelHeightFromViewportY(viewportY: number): void {
	const statusHeight = statusAreaHeight();
	const bottom = ide_state.viewportHeight - statusHeight;
	const minTop = ide_state.headerHeight + getTabBarTotalHeight() + 1;
	const headerH = ide_state.lineHeight + constants.PROBLEMS_PANEL_HEADER_PADDING_Y * 2;
	const minContent = Math.max(1, constants.PROBLEMS_PANEL_MIN_VISIBLE_ROWS) * ide_state.lineHeight;
	const minHeight = headerH + constants.PROBLEMS_PANEL_CONTENT_PADDING_Y * 2 + minContent;
	const maxTop = Math.max(minTop, bottom - minHeight);
	const top = clamp(viewportY, minTop, maxTop);
	const height = clamp(bottom - top, minHeight, Math.max(minHeight, bottom - minTop));
	ide_state.problemsPanel.setFixedHeightPx(height);
}

export function drawActionPromptOverlay(api: BmsxConsoleApi): void {
	const prompt = ide_state.pendingActionPrompt;
	if (!prompt) {
		return;
	}
	api.rectfill_color(0, 0, ide_state.viewportWidth, ide_state.viewportHeight, constants.ACTION_OVERLAY_COLOR);

	let messageLines: string[];
	let primaryLabel: string;
	let secondaryLabel: string;
	switch (prompt.action) {
		case 'resume':
			messageLines = [
				'UNSAVED CHANGES DETECTED.',
				'SAVE BEFORE RESUME TO APPLY CODE UPDATES?',
			];
			primaryLabel = 'SAVE & RESUME';
			secondaryLabel = 'RESUME WITHOUT SAVING';
			break;
		case 'reboot':
			messageLines = [
				'UNSAVED CHANGES DETECTED.',
				'SAVE BEFORE REBOOT TO APPLY CODE UPDATES?',
			];
			primaryLabel = 'SAVE & REBOOT';
			secondaryLabel = 'REBOOT WITHOUT SAVING';
			break;
		case 'close':
		default:
			messageLines = [
				'UNSAVED CHANGES DETECTED.',
				'SAVE BEFORE HIDING THE EDITOR?',
			];
			primaryLabel = 'SAVE & HIDE';
			secondaryLabel = 'HIDE WITHOUT SAVING';
			break;
	}
	let maxMessageWidth = 0;
	for (let i = 0; i < messageLines.length; i++) {
		const width = measureText(messageLines[i]);
		if (width > maxMessageWidth) {
			maxMessageWidth = width;
		}
	}
	const cancelLabel = 'CANCEL';
	const primaryWidth = measureText(primaryLabel) + constants.HEADER_BUTTON_PADDING_X * 2;
	const secondaryWidth = measureText(secondaryLabel) + constants.HEADER_BUTTON_PADDING_X * 2;
	const cancelWidth = measureText(cancelLabel) + constants.HEADER_BUTTON_PADDING_X * 2;
	const buttonSpacing = constants.HEADER_BUTTON_SPACING;
	const buttonRowWidth = primaryWidth + secondaryWidth + cancelWidth + buttonSpacing * 2;
	const paddingX = 12;
	const paddingY = 12;
	const buttonHeight = ide_state.lineHeight + constants.HEADER_BUTTON_PADDING_Y * 2;
	const messageSpacing = ide_state.lineHeight + 2;
	const dialogWidth = Math.max(maxMessageWidth + paddingX * 2, buttonRowWidth + paddingX * 2);
	const dialogHeight = paddingY * 2 + messageLines.length * messageSpacing + 6 + buttonHeight;
	const left = Math.max(4, Math.floor((ide_state.viewportWidth - dialogWidth) / 2));
	const top = Math.max(4, Math.floor((ide_state.viewportHeight - dialogHeight) / 2));
	const right = left + dialogWidth;
	const bottom = top + dialogHeight;

	api.rectfill(left, top, right, bottom, constants.ACTION_DIALOG_BACKGROUND_COLOR);
	api.rect(left, top, right, bottom, constants.ACTION_DIALOG_BORDER_COLOR);

	let textY = top + paddingY;
	const textX = left + paddingX;
	for (let i = 0; i < messageLines.length; i++) {
		drawEditorText(api, ide_state.font, messageLines[i], textX, textY, constants.ACTION_DIALOG_TEXT_COLOR);
		textY += messageSpacing;
	}

	const buttonY = bottom - paddingY - buttonHeight;
	let buttonX = left + paddingX;
	const saveBounds: RectBounds = { left: buttonX, top: buttonY, right: buttonX + primaryWidth, bottom: buttonY + buttonHeight };
	api.rectfill(saveBounds.left, saveBounds.top, saveBounds.right, saveBounds.bottom, constants.ACTION_BUTTON_BACKGROUND);
	api.rect(saveBounds.left, saveBounds.top, saveBounds.right, saveBounds.bottom, constants.ACTION_DIALOG_BORDER_COLOR);
	drawEditorText(api, ide_state.font, primaryLabel, saveBounds.left + constants.HEADER_BUTTON_PADDING_X, saveBounds.top + constants.HEADER_BUTTON_PADDING_Y, constants.ACTION_BUTTON_TEXT);
	ide_state.actionPromptButtons.saveAndContinue = saveBounds;
	buttonX = saveBounds.right + buttonSpacing;

	const continueBounds: RectBounds = { left: buttonX, top: buttonY, right: buttonX + secondaryWidth, bottom: buttonY + buttonHeight };
	api.rectfill(continueBounds.left, continueBounds.top, continueBounds.right, continueBounds.bottom, constants.ACTION_BUTTON_BACKGROUND);
	api.rect(continueBounds.left, continueBounds.top, continueBounds.right, continueBounds.bottom, constants.ACTION_DIALOG_BORDER_COLOR);
	drawEditorText(api, ide_state.font, secondaryLabel, continueBounds.left + constants.HEADER_BUTTON_PADDING_X, continueBounds.top + constants.HEADER_BUTTON_PADDING_Y, constants.ACTION_BUTTON_TEXT);
	ide_state.actionPromptButtons.continue = continueBounds;
	buttonX = continueBounds.right + buttonSpacing;

	const cancelBounds: RectBounds = { left: buttonX, top: buttonY, right: buttonX + cancelWidth, bottom: buttonY + buttonHeight };
	api.rectfill(cancelBounds.left, cancelBounds.top, cancelBounds.right, cancelBounds.bottom, constants.COLOR_HEADER_BUTTON_DISABLED_BACKGROUND);
	api.rect(cancelBounds.left, cancelBounds.top, cancelBounds.right, cancelBounds.bottom, constants.ACTION_DIALOG_BORDER_COLOR);
	drawEditorText(api, ide_state.font, cancelLabel, cancelBounds.left + constants.HEADER_BUTTON_PADDING_X, cancelBounds.top + constants.HEADER_BUTTON_PADDING_Y, constants.COLOR_HEADER_BUTTON_TEXT);
	ide_state.actionPromptButtons.cancel = cancelBounds;
}

export function columnToDisplay(highlight: HighlightLine, column: number): number {
	return ide_state.layout.columnToDisplay(highlight, column);
}

export function resolvePaletteIndex(color: { r: number; g: number; b: number; a: number }): number | null {
	const index = Msx1Colors.indexOf(color);
	return index === -1 ? null : index;
}

export function invertColorIndex(colorIndex: number): number {
	const color = Msx1Colors[colorIndex];
	if (!color) {
		return constants.COLOR_CODE_TEXT;
	}
	const luminance = 0.2126 * color.r + 0.7152 * color.g + 0.0722 * color.b;
	return luminance > 0.5 ? 0 : 15;
}

export function resetActionPromptState(): void {
	ide_state.pendingActionPrompt = null;
	ide_state.actionPromptButtons.saveAndContinue = null;
	ide_state.actionPromptButtons.continue = { left: 0, top: 0, right: 0, bottom: 0 };
	ide_state.actionPromptButtons.cancel = { left: 0, top: 0, right: 0, bottom: 0 };
}

export function pointInRect(x: number, y: number, rect: RectBounds | null): boolean {
	if (!rect) {
		return false;
	}
	return x >= rect.left && x < rect.right && y >= rect.top && y < rect.bottom;
}

export function hasPendingRuntimeReload(): boolean {
	return ide_state.saveGeneration > ide_state.appliedGeneration;
}

export function getConsoleRuntime(): BmsxConsoleRuntime | null {
	return $.get('bmsx_console_runtime');
}

export function prepareRuntimeSnapshotForResume(snapshot: unknown): Record<string, unknown> | null {
	if (!snapshot || typeof snapshot !== 'object') {
		return null;
	}
	const base = snapshot as Record<string, unknown>;
	const sanitized: Record<string, unknown> = { ...base };
	if (sanitized.luaRuntimeFailed === true) {
		sanitized.luaRuntimeFailed = false;
	} else {
		sanitized.luaRuntimeFailed = sanitized.luaRuntimeFailed ?? false;
	}
	return sanitized;
}

export function scheduleRuntimeTask(task: () => void | Promise<void>, onError: (error: unknown) => void): void {
	const invoke = (fn: () => void): void => {
		if (typeof queueMicrotask === 'function') {
			queueMicrotask(fn);
			return;
		}
		void Promise.resolve().then(fn);
	};
	invoke(() => {
		try {
			const result = task();
			if (result && typeof (result as Promise<void>).then === 'function') {
				(result as Promise<void>).catch(onError);
			}
		} catch (error) {
			onError(error);
		}
	});
}

export function handleRuntimeTaskError(error: unknown, fallbackMessage: string): void {
	const message = error instanceof Error ? error.message : String(error);
	$.paused = true;
	activate();
	ide_state.showMessage(`${fallbackMessage}: ${message}`, constants.COLOR_STATUS_ERROR, 4.0);
}

export function truncateTextToWidth(text: string, maxWidth: number): string {
	return truncateTextToWidthExternal(text, maxWidth, (ch) => ide_state.font.advance(ch), ide_state.spaceAdvance);
}

export function measureText(text: string): number {
	return measureTextGeneric(text, (ch) => ide_state.font.advance(ch), ide_state.spaceAdvance);
}

export function assertMonospace(): void {
	const sample = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+-*/%<>=#(){}[]:,.;\'"`~!@^&|\\?_ ';
	const reference = ide_state.font.advance('M');
	for (let i = 0; i < sample.length; i++) {
		const candidate = ide_state.font.advance(sample.charAt(i));
		if (candidate !== reference) {
			ide_state.warnNonMonospace = true;
			break;
		}
	}
}

export function centerCursorVertically(): void {
	ensureVisualLines();
	const rows = visibleRowCount();
	const totalVisual = getVisualLineCount();
	const cursorVisualIndex = positionToVisualIndex(ide_state.cursorRow, ide_state.cursorColumn);
	const maxScroll = Math.max(0, totalVisual - rows);
	if (rows <= 1) {
		ide_state.scrollRow = clamp(cursorVisualIndex, 0, maxScroll);
		return;
	}
	let target = cursorVisualIndex - Math.floor(rows / 2);
	if (target < 0) {
		target = 0;
	}
	if (target > maxScroll) {
		target = maxScroll;
	}
	ide_state.scrollRow = target;
}

export function ensureCursorVisible(): void {
	clampCursorRow();
	clampCursorColumn();

	ensureVisualLines();
	const rows = visibleRowCount();
	const totalVisual = getVisualLineCount();
	const cursorVisualIndex = positionToVisualIndex(ide_state.cursorRow, ide_state.cursorColumn);

	if (cursorVisualIndex < ide_state.scrollRow) {
		ide_state.scrollRow = cursorVisualIndex;
	}
	if (cursorVisualIndex >= ide_state.scrollRow + rows) {
		ide_state.scrollRow = cursorVisualIndex - rows + 1;
	}
	const maxScrollRow = Math.max(0, totalVisual - rows);
	ide_state.scrollRow = clamp(ide_state.scrollRow, 0, maxScrollRow);

	if (ide_state.wordWrapEnabled) {
		ide_state.scrollColumn = 0;
		return;
	}

	const columns = visibleColumnCount();
	if (ide_state.cursorColumn < ide_state.scrollColumn) {
		ide_state.scrollColumn = ide_state.cursorColumn;
	}
	const maxScrollColumn = ide_state.cursorColumn - columns + 1;
	if (maxScrollColumn > ide_state.scrollColumn) {
		ide_state.scrollColumn = maxScrollColumn;
	}
	if (ide_state.scrollColumn < 0) {
		ide_state.scrollColumn = 0;
	}
	const lineLength = currentLine().length;
	const maxColumn = lineLength - columns;
	if (maxColumn < 0) {
		ide_state.scrollColumn = 0;
	} else if (ide_state.scrollColumn > maxColumn) {
		ide_state.scrollColumn = maxColumn;
	}
}

export function buildMemberCompletionItems(request: {
	objectName: string;
	operator: '.' | ':';
	prefix: string;
	assetId: string | null;
	chunkName: string | null;
}): LuaCompletionItem[] {
	if (request.objectName.length === 0) {
		return [];
	}
	const response = ide_state.listLuaObjectMembersFn({
		assetId: request.assetId ?? null,
		chunkName: request.chunkName ?? null,
		expression: request.objectName,
		operator: request.operator,
	});
	if (response.length === 0) {
		return [];
	}
	const items: LuaCompletionItem[] = [];
	for (let index = 0; index < response.length; index += 1) {
		const entry = response[index];
		if (!entry || !entry.name || entry.name.length === 0) {
			continue;
		}
		const kind = entry.kind === 'method' ? 'native_method' : 'native_property';
		const parameters = entry.parameters && entry.parameters.length > 0 ? entry.parameters.slice() : undefined;
		const detail = entry.detail ?? null;
		items.push({
			label: entry.name,
			insertText: entry.name,
			sortKey: `${kind}:${entry.name.toLowerCase()}`,
			kind,
			detail,
			parameters,
		});
	}
	items.sort((a, b) => a.label.localeCompare(b.label));
	return items;
}

export function visibleRowCount(): number {
	return ide_state.cachedVisibleRowCount > 0 ? ide_state.cachedVisibleRowCount : 1;
}

export function visibleColumnCount(): number {
	return ide_state.cachedVisibleColumnCount > 0 ? ide_state.cachedVisibleColumnCount : 1;
}

export function resetBlink(): void {
	ide_state.blinkTimer = 0;
	ide_state.cursorVisible = true;
}

export function shouldFireRepeat(keyboard: KeyboardInput, code: string, deltaSeconds: number): boolean {
	return ide_state.input.shouldRepeatPublic(keyboard, code, deltaSeconds);
}


export type ConsoleCartEditor = {
	activate: typeof activate;
	deactivate: typeof deactivate;
	isActive: typeof isActive;
	update: typeof update;
	draw: typeof draw;
	shutdown: typeof shutdown;
	showWarningBanner: typeof ide_state.showWarningBanner;
	showRuntimeErrorInChunk: typeof showRuntimeErrorInChunk;
	showRuntimeError: typeof showRuntimeError;
	clearRuntimeErrorOverlay: typeof clearRuntimeErrorOverlay;
	clearAllRuntimeErrorOverlays: typeof clearAllRuntimeErrorOverlays;
	getSourceForChunk: typeof getSourceForChunk;
};

const editorFacade: ConsoleCartEditor = {
	activate,
	deactivate,
	isActive,
	update,
	draw,
	shutdown,
	showWarningBanner: ide_state.showWarningBanner,
	showRuntimeErrorInChunk,
	showRuntimeError,
	clearRuntimeErrorOverlay,
	clearAllRuntimeErrorOverlays,
	getSourceForChunk,
};

export function handleCodeFormattingShortcut(
	keyboard: KeyboardInput,
	_deltaSeconds: number,
	context: ConsoleEditorShortcutContext): boolean {
	if (!context.codeTabActive || context.inlineFieldFocused || context.resourcePanelFocused) {
		return false;
	}
	if (!context.altDown || !context.shiftDown || context.ctrlDown || context.metaDown) {
		return false;
	}
	if (!isKeyJustPressedGlobal(ide_state.playerIndex, 'KeyF')) {
		return false;
	}
	consumeKeyboardKey(keyboard, 'KeyF');
	applyDocumentFormatting();
	return true;
}
function applyDocumentFormatting(): void {
	const originalLines = [...ide_state.lines];
	const originalSource = originalLines.join('\n');
	try {
		const formatted = formatLuaDocument(originalSource);
		if (formatted === originalSource) {
			ide_state.showMessage('Document already formatted', constants.COLOR_STATUS_TEXT, 1.5);
			return;
		}
		const cursorOffset = computeDocumentOffset(originalLines, ide_state.cursorRow, ide_state.cursorColumn);
		prepareUndo('format-document', false);
		if (ide_state.lines.length === 0) {
			setSelectionAnchorPosition({ row: 0, column: 0 });
			setCursorPosition(0, 0);
		} else {
			const lastRow = ide_state.lines.length - 1;
			setSelectionAnchorPosition({ row: 0, column: 0 });
			setCursorPosition(lastRow, ide_state.lines[lastRow].length);
		}
		replaceSelectionWith(formatted);
		const updatedLines = [...ide_state.lines];
		const target = resolveOffsetPosition(updatedLines, cursorOffset);
		setCursorPosition(target.row, target.column);
		clearSelection();
		markDiagnosticsDirty();
		ide_state.showMessage('Document formatted', constants.COLOR_STATUS_SUCCESS, 1.6);
	} catch (error) {
		const message = error instanceof Error ? error.message : String(error);
		ide_state.showMessage(`Formatting failed: ${message}`, constants.COLOR_STATUS_ERROR, 3.2);
	}
}
function computeDocumentOffset(lines: readonly string[], row: number, column: number): number {
	let offset = 0;
	for (let index = 0; index < row; index += 1) {
		offset += lines[index].length + 1;
	}
	return offset + column;
}
function resolveOffsetPosition(lines: readonly string[], offset: number): { row: number; column: number; } {
	let remaining = offset;
	for (let row = 0; row < lines.length; row += 1) {
		const lineLength = lines[row].length;
		if (remaining <= lineLength) {
			return { row, column: remaining };
		}
		remaining -= lineLength + 1;
	}
	if (ide_state.lines.length === 0) {
		return { row: 0, column: 0 };
	}
	const lastRow = ide_state.lines.length - 1;
	return { row: lastRow, column: ide_state.lines[lastRow].length };
}

export function createConsoleCartEditor(options: ConsoleEditorOptions): ConsoleCartEditor {
	customKeybindingHandler = (keyboard, deltaSeconds, context) =>
		handleCodeFormattingShortcut(keyboard, deltaSeconds, context);
	initializeConsoleCartEditor(options);
	return editorFacade;
}

function initializeConsoleCartEditor(options: ConsoleEditorOptions): void {
	ide_state.playerIndex = options.playerIndex;
	ide_state.metadata = options.metadata;
	ide_state.fontVariant = options.fontVariant ?? DEFAULT_CONSOLE_FONT_VARIANT;
	ide_state.loadSourceFn = options.loadSource;
	ide_state.saveSourceFn = options.saveSource;
	ide_state.listResourcesFn = options.listResources;
	ide_state.loadLuaResourceFn = options.loadLuaResource;
	ide_state.saveLuaResourceFn = options.saveLuaResource;
	ide_state.createLuaResourceFn = options.createLuaResource;
	ide_state.inspectLuaExpressionFn = options.inspectLuaExpression;
	ide_state.listLuaObjectMembersFn = options.listLuaObjectMembers;
	ide_state.listLuaModuleSymbolsFn = options.listLuaModuleSymbols;
	ide_state.listLuaSymbolsFn = options.listLuaSymbols;
	ide_state.listGlobalLuaSymbolsFn = options.listGlobalLuaSymbols;
	ide_state.listBuiltinLuaFunctionsFn = options.listBuiltinLuaFunctions;
	ide_state.primaryAssetId = options.primaryAssetId;
	if ($.debug) {
		ide_state.listResourcesFn();
	}
	ide_state.viewportWidth = options.viewport.width;
	ide_state.viewportHeight = options.viewport.height;
	ide_state.font = new ConsoleEditorFont(ide_state.fontVariant);
	ide_state.clockNow = $.platform.clock.now;
	ide_state.searchField = createInlineTextField();
	ide_state.symbolSearchField = createInlineTextField();
	ide_state.resourceSearchField = createInlineTextField();
	ide_state.lineJumpField = createInlineTextField();
	ide_state.createResourceField = createInlineTextField();
	applySearchFieldText(ide_state.searchQuery, true);
	applySymbolSearchFieldText(ide_state.symbolSearchQuery, true);
	applyResourceSearchFieldText(ide_state.resourceSearchQuery, true);
	applyLineJumpFieldText(ide_state.lineJumpValue, true);
	applyCreateResourceFieldText(ide_state.createResourcePath, true);
	ide_state.lineHeight = ide_state.font.lineHeight();
	ide_state.charAdvance = ide_state.font.advance('M');
	ide_state.spaceAdvance = ide_state.font.advance(' ');
	ide_state.layout = new ConsoleCodeLayout(ide_state.font, ide_state.semanticWorkspace, {
		clockNow: ide_state.clockNow,
		getBuiltinIdentifiers: () => getBuiltinIdentifierSet(),
	});
	ide_state.inlineFieldMetricsRef = {
		measureText: (text: string) => measureText(text),
		advanceChar: (ch: string) => ide_state.font.advance(ch),
		spaceAdvance: ide_state.spaceAdvance,
		tabSpaces: constants.TAB_SPACES,
	};
	ide_state.gutterWidth = 2;
	const primaryBarHeight = ide_state.lineHeight + 4;
	ide_state.headerHeight = primaryBarHeight;
	ide_state.tabBarHeight = ide_state.lineHeight + 3;
	ide_state.baseBottomMargin = ide_state.lineHeight + 6;
	ide_state.scrollbars = {
		codeVertical: new ConsoleScrollbar('codeVertical', 'vertical'),
		codeHorizontal: new ConsoleScrollbar('codeHorizontal', 'horizontal'),
		resourceVertical: new ConsoleScrollbar('resourceVertical', 'vertical'),
		resourceHorizontal: new ConsoleScrollbar('resourceHorizontal', 'horizontal'),
		viewerVertical: new ConsoleScrollbar('viewerVertical', 'vertical'),
	};
	ide_state.scrollbarController = new ScrollbarController(ide_state.scrollbars);
	ide_state.resourcePanel = new ResourcePanelController({
		getViewportWidth: () => ide_state.viewportWidth,
		getViewportHeight: () => ide_state.viewportHeight,
		getBottomMargin: () => bottomMargin(),
		codeViewportTop: () => codeViewportTop(),
		lineHeight: ide_state.lineHeight,
		charAdvance: ide_state.charAdvance,
		measureText: (t) => measureText(t),
		drawText: (a, t, x, y, c) => drawEditorText(a, ide_state.font, t, x, y, c),
		drawColoredText: (a, t, colors, x, y) => drawEditorColoredText(a, ide_state.font, t, colors, x, y, constants.COLOR_CODE_TEXT),
		drawRectOutlineColor: (a, l, t, r, b, col) => drawRectOutlineColor(a, l, t, r, b, col),
		playerIndex: ide_state.playerIndex,
		listResources: () => listResourcesStrict(),
		openLuaCodeTab: (d) => openLuaCodeTab(d),
		openResourceViewerTab: (d) => openResourceViewerTab(d),
		focusEditorFromResourcePanel: () => focusEditorFromResourcePanel(),
		showMessage:  (text, color, duration) => ide_state.showMessage(text, color, duration),
	}, { resourceVertical: ide_state.scrollbars.resourceVertical, resourceHorizontal: ide_state.scrollbars.resourceHorizontal });
	ide_state.completion = new CompletionController({
		getPlayerIndex: () => ide_state.playerIndex,
		isCodeTabActive: () => isCodeTabActive(),
		getLines: () => ide_state.lines,
		getCursorRow: () => ide_state.cursorRow,
		getCursorColumn: () => ide_state.cursorColumn,
		setCursorPosition: (row, column) => { ide_state.cursorRow = row; ide_state.cursorColumn = column; },
		setSelectionAnchor: (row, column) => { ide_state.selectionAnchor = { row, column }; },
		replaceSelectionWith: (text) => replaceSelectionWith(text),
		updateDesiredColumn: () => updateDesiredColumn(),
		resetBlink: () => resetBlink(),
		revealCursor: () => revealCursor(),
		measureText: (text) => measureText(text),
		drawText: (api, text, x, y, color) => drawEditorText(api, ide_state.font, text, x, y, color),
		getCursorScreenInfo: () => ide_state.cursorScreenInfo,
		getLineHeight: () => ide_state.lineHeight,
		getSpaceAdvance: () => ide_state.spaceAdvance,
		getActiveCodeTabContext: () => getActiveCodeTabContext(),
		resolveHoverAssetId: (ctx) => resolveHoverAssetId(ctx as CodeTabContext),
		resolveHoverChunkName: (ctx) => resolveHoverChunkName(ctx as CodeTabContext),
		listLuaSymbols: (assetId, chunk) => ide_state.listLuaSymbolsFn(assetId, chunk),
		listGlobalLuaSymbols: () => ide_state.listGlobalLuaSymbolsFn(),
		listLuaModuleSymbols: (moduleName) => ide_state.listLuaModuleSymbolsFn(moduleName),
		listBuiltinLuaFunctions: () => ide_state.listBuiltinLuaFunctionsFn(),
		getSemanticDefinitions: () => getActiveSemanticDefinitions(),
		getLuaModuleAliases: (chunkName) => getLuaModuleAliases(chunkName),
		getMemberCompletionItems: (request) => buildMemberCompletionItems(request),
		charAt: (r, c) => charAt(r, c),
		getTextVersion: () => ide_state.textVersion,
		shouldFireRepeat: (kb, code, dt) => ide_state.input.shouldRepeatPublic(kb, code, dt),
	});
	ide_state.completion.setEnterCommitsEnabled(false);
	ide_state.input = new InputController({
		getPlayerIndex: () => ide_state.playerIndex,
		isCodeTabActive: () => isCodeTabActive(),
		getLines: () => ide_state.lines,
		setLines: (lines) => { ide_state.lines = lines; markDiagnosticsDirty(); },
		getCursorRow: () => ide_state.cursorRow,
		getCursorColumn: () => ide_state.cursorColumn,
		setCursorPosition: (row, column) => { ide_state.cursorRow = row; ide_state.cursorColumn = column; },
		setSelectionAnchor: (row, column) => { ide_state.selectionAnchor = { row, column }; },
		getSelection: () => getSelectionRange(),
		clearSelection: () => { ide_state.selectionAnchor = null; },
		updateDesiredColumn: () => updateDesiredColumn(),
		resetBlink: () => resetBlink(),
		revealCursor: () => revealCursor(),
		ensureCursorVisible: () => ensureCursorVisible(),
		recordPreMutationSnapshot: (key) => recordSnapshotPre(key),
		pushPostMutationSnapshot: (key) => recordSnapshotPost(key),
		deleteSelection: () => deleteSelection(),
		deleteCharLeft: () => deleteCharLeft(),
		deleteCharRight: () => deleteCharRight(),
		deleteActiveLines: () => deleteActiveLines(),
		deleteWordBackward: () => deleteWordBackward(),
		deleteWordForward: () => deleteWordForward(),
		insertNewline: () => insertNewline(),
		insertText: (text) => insertText(text),
		moveCursorLeft: (byWord, select) => moveCursorLeft(byWord, select),
		moveCursorRight: (byWord, select) => moveCursorRight(byWord, select),
		moveCursorUp: (select) => moveCursorUp(select),
		moveCursorDown: (select) => moveCursorDown(select),
		moveCursorHome: (select) => moveCursorHome(select),
		moveCursorEnd: (select) => moveCursorEnd(select),
		pageDown: (select) => pageDown(select),
		pageUp: (select) => pageUp(select),
		moveSelectionLines: (delta) => moveSelectionLines(delta),
		indentSelectionOrLine: () => indentSelectionOrLine(),
		unindentSelectionOrLine: () => unindentSelectionOrLine(),
		navigateBackward: () => goBackwardInNavigationHistory(),
		navigateForward: () => goForwardInNavigationHistory(),
	});
	ide_state.problemsPanel = new ProblemsPanelController({
		lineHeight: ide_state.lineHeight,
		measureText: (text) => measureText(text),
		drawText: (api, text, x, y, color) => drawEditorText(api, ide_state.font, text, x, y, color),
		drawRectOutlineColor: (api, l, t, r, b, col) => drawRectOutlineColor(api, l, t, r, b, col),
		truncateTextToWidth: (text, maxWidth) => truncateTextToWidth(text, maxWidth),
		gotoDiagnostic: (diagnostic) => gotoDiagnostic(diagnostic),
	});
	ide_state.problemsPanel.setDiagnostics(ide_state.diagnostics);
	ide_state.renameController = new RenameController({
		processFieldEdit: (field, keyboard, options) => processInlineFieldEditing(field, keyboard, options),
		shouldFireRepeat: (keyboard, code, deltaSeconds) => shouldFireRepeat(keyboard, code, deltaSeconds),
		undo: () => undo(),
		redo: () => redo(),
		showMessage:  (text, color, duration) => ide_state.showMessage(text, color, duration),
		commitRename: (payload) => commitRename(payload),
		onRenameSessionClosed: () => focusEditorFromRename(),
	}, ide_state.referenceState, ide_state.playerIndex);
	ide_state.codeVerticalScrollbarVisible = false;
	ide_state.codeHorizontalScrollbarVisible = false;
	ide_state.cachedVisibleRowCount = 1;
	ide_state.cachedVisibleColumnCount = 1;
	const entryContext = createEntryTabContext();
	if (entryContext) {
		ide_state.entryTabId = entryContext.id;
		ide_state.codeTabContexts.set(entryContext.id, entryContext);
	}
	initializeTabs(entryContext);
	resetResourcePanelState();
	if (entryContext) {
		activateCodeEditorTab(entryContext.id);
	}
	ide_state.desiredColumn = ide_state.cursorColumn;
	assertMonospace();
	const initialContext = entryContext ? ide_state.codeTabContexts.get(entryContext.id) ?? null : null;
	ide_state.lastSavedSource = initialContext ? initialContext.lastSavedSource : '';
	$.input.setKeyboardCapture(EDITOR_TOGGLE_KEY, true);
	applyResolutionModeToRuntime();
	ide_state.pendingWindowFocused = ide_state.windowFocused;
	installPlatformVisibilityListener();
	installWindowEventListeners();
	ide_state.navigationHistory.current = createNavigationEntry();
}export function updateBlink(deltaSeconds: number): void {
	ide_state.blinkTimer += deltaSeconds;
	if (ide_state.blinkTimer >= constants.CURSOR_BLINK_INTERVAL) {
		ide_state.blinkTimer -= constants.CURSOR_BLINK_INTERVAL;
		ide_state.cursorVisible = !ide_state.cursorVisible;
	}
}
export const caretNavigation = new CaretNavigationState();
export function drawCursor(api: BmsxConsoleApi, info: CursorScreenInfo, textX: number): void {
	const cursorX = info.x;
	const cursorY = info.y;
	const caretLeft = Math.floor(Math.max(textX, cursorX - 1));
	const caretRight = Math.max(caretLeft + 1, Math.floor(cursorX + info.width));
	const caretTop = Math.floor(cursorY);
	const caretBottom = caretTop + info.height;
	const problemsPanelHasFocus = ide_state.problemsPanel.isVisible() && ide_state.problemsPanel.isFocused();
	if (ide_state.searchActive || ide_state.lineJumpActive || ide_state.resourcePanelFocused || ide_state.createResourceActive || problemsPanelHasFocus) {
		const innerLeft = caretLeft + 1;
		const innerRight = caretRight - 1;
		const innerTop = caretTop + 1;
		const innerBottom = caretBottom - 1;
		if (innerRight > innerLeft && innerBottom > innerTop) {
			api.rectfill(innerLeft, innerTop, innerRight, innerBottom, constants.COLOR_CODE_BACKGROUND);
		}
		drawRectOutlineColor(api, caretLeft, caretTop, caretRight, caretBottom, constants.CARET_COLOR);
		drawEditorColoredText(api, ide_state.font, info.baseChar, [info.baseColor], cursorX, cursorY, info.baseColor);
	} else {
		api.rectfill_color(caretLeft, caretTop, caretRight, caretBottom, constants.CARET_COLOR);
		const caretPaletteIndex = resolvePaletteIndex(constants.CARET_COLOR);
		const caretInverseColor = caretPaletteIndex !== null
			? invertColorIndex(caretPaletteIndex)
			: invertColorIndex(info.baseColor);
		drawEditorColoredText(api, ide_state.font, info.baseChar, [caretInverseColor], cursorX, cursorY, caretInverseColor);
	}
}
export function drawInlineCaret(
	api: BmsxConsoleApi,
	field: InlineTextField,
	left: number,
	top: number,
	right: number,
	bottom: number,
	cursorX: number,
	active: boolean,
	caretColor: { r: number; g: number; b: number; a: number; } = constants.CARET_COLOR,
	baseTextColor: number = constants.COLOR_STATUS_TEXT
): void {
	if (!ide_state.cursorVisible) {
		return;
	}
	if (active) {
		api.rectfill_color(left, top, right, bottom, caretColor);
		const caretIndex = resolvePaletteIndex(caretColor);
		const inverseColor = caretIndex !== null
			? invertColorIndex(caretIndex)
			: invertColorIndex(baseTextColor);
		const glyph = field.cursor < field.text.length ? field.text.charAt(field.cursor) : ' ';
		drawEditorText(api, ide_state.font, glyph.length > 0 ? glyph : ' ', cursorX, top, inverseColor);
		return;
	}
	drawRectOutlineColor(api, left, top, right, bottom, caretColor);
}
