import type { CodeEditorControl } from '../../code_editor_control';
import { breakUndoSequence } from '../../../editing/undo_controller';
import { currentLine, ensureVisualLines } from '../../../common/text/layout';
import { isShiftDown, isCtrlDown } from '../../../../input/keyboard/key_input';
import { resetBlinkState } from './blink';
import { findWordLeft, findWordRight, hasSelection, collapseSelectionTo, clearSelection } from '../../../editing/text_editing_and_selection';
import { ensureSingleCursorSelectionAnchor } from '../../../editing/cursor/state';
import type { VisualLineSegment } from '../../../../common/models';
import { revealCursor, resolveViewportCapacity, setCursorFromVisualIndex, updateDesiredColumn } from './view';
import { resolveCursorVisualIndex } from './visual_index';
import type { ModifierState } from '../../../../../hosts/common/input/text';

export function resolveIndentAwareHome(code: CodeEditorControl, line: string, segment: VisualLineSegment, currentColumn: number): number {
	const lineLength = line.length;
	const segmentStart = code.layout.clampSegmentStart(lineLength, segment.startColumn);
	const segmentEnd = code.layout.clampSegmentEnd(lineLength, segmentStart, segment.endColumn);
	const preferred = findFirstNonWhitespace(line, segmentStart, segmentEnd);
	const targetColumn = currentColumn === preferred ? segmentStart : preferred;
	return code.layout.clampSegmentEnd(lineLength, segmentStart, targetColumn);
}

export function resolveSegmentEnd(code: CodeEditorControl, line: string, segment: VisualLineSegment): number {
	const lineLength = line.length;
	const segmentStart = code.layout.clampSegmentStart(lineLength, segment.startColumn);
	const segmentEnd = code.layout.clampSegmentEnd(lineLength, segmentStart, segment.endColumn);
	if (segmentEnd >= lineLength) {
		return lineLength;
	}
	if (segmentEnd <= segmentStart) {
		return segmentStart;
	}
	return segmentEnd - 1;
}

export function findFirstNonWhitespace(line: string, startColumn: number, endColumn: number): number {
	for (let column = startColumn; column < endColumn; column += 1) {
		const ch = line.charAt(column);
		if (ch !== ' ' && ch !== '\t') {
			return column;
		}
	}
	return endColumn;
}

/**
 * Set cursor to a specific row and column position
 */
export function setCursorPosition(code: CodeEditorControl, row: number, column: number): void {
	code.clearVisualCursor();
	const targetRow = code.model.clampRow(row);
	const targetColumn = code.model.clampColumn(targetRow, column);
	code.view.cursorRow = targetRow;
	code.view.cursorColumn = targetColumn;
	code.emitCursorMoved();
	updateDesiredColumn(code);
	resetBlinkState(code.caret);
	revealCursor(code);
}

/**
 * Move cursor vertically by delta lines (supports word wrap)
 */
export function moveCursorVertical(code: CodeEditorControl, delta: number): void {
	code.clearVisualCursor();
	ensureVisualLines(code);
	const visualCount = code.layout.getVisualLineCount();
	if (visualCount === 0) {
		return;
	}
	const currentIndex = code.layout.positionToVisualIndex(code.view.cursorRow, code.view.cursorColumn);
	const targetIndex = code.layout.clampVisualIndex(visualCount, currentIndex + delta);
	const desired = code.view.desiredColumn;
	const desiredDisplay = code.view.desiredDisplayOffset;
	setCursorFromVisualIndex(code, targetIndex, desired, desiredDisplay);
	resetBlinkState(code.caret);
	revealCursor(code);
}

/**
 * Move cursor horizontally by delta columns (supports word wrap)
 */
export function moveCursorHorizontal(code: CodeEditorControl, delta: number): void {
	if (delta === 0) {
		return;
	}
	code.clearVisualCursor();
	ensureVisualLines(code);
	const visualCount = code.layout.getVisualLineCount();
	if (visualCount === 0) {
		return;
	}
	const visualIndex = code.layout.positionToVisualIndex(code.view.cursorRow, code.view.cursorColumn);
	const segment = code.layout.visualIndexToSegment(visualIndex);
	if (!segment) {
		return;
	}
	const buffer = code.model.buffer;
	const line = buffer.getLineContent(segment.row);
	if (delta < 0) {
		// Move left
		if (code.view.cursorColumn > segment.startColumn) {
			code.view.cursorColumn -= 1;
		} else {
			let moved = false;
				if (code.wordWrapEnabled && visualIndex > 0) {
					const prevSegment = code.layout.visualIndexToSegment(visualIndex - 1);
					if (prevSegment && prevSegment.row === segment.row) {
						code.view.cursorRow = prevSegment.row;
						const prevLine = buffer.getLineContent(prevSegment.row);
						const prevEnd = Math.max(prevSegment.endColumn, prevSegment.startColumn);
						const hasMoreBefore = prevEnd > prevSegment.startColumn;
						const targetColumn = hasMoreBefore && prevEnd < prevLine.length
						? Math.max(prevSegment.startColumn, prevEnd - 1)
						: Math.min(prevEnd, prevLine.length);
					code.view.cursorColumn = code.layout.clampLineLength(prevLine.length, targetColumn);
					moved = true;
				}
			}
			if (!moved && segment.row > 0) {
				code.view.cursorRow = segment.row - 1;
				code.view.cursorColumn = buffer.getLineEndOffset(code.view.cursorRow) - buffer.getLineStartOffset(code.view.cursorRow);
			}
		}
	} else {
		// Move right
		if (code.view.cursorColumn < segment.endColumn && code.view.cursorColumn < line.length) {
			code.view.cursorColumn += 1;
		} else {
			let moved = false;
			if (code.wordWrapEnabled && visualIndex < visualCount - 1) {
				const nextSegment = code.layout.visualIndexToSegment(visualIndex + 1);
				if (nextSegment && nextSegment.row === segment.row) {
					code.view.cursorRow = nextSegment.row;
					code.view.cursorColumn = nextSegment.startColumn;
					moved = true;
				}
			}
			if (!moved && segment.row < buffer.getLineCount() - 1) {
				code.view.cursorRow = segment.row + 1;
				code.view.cursorColumn = 0;
			}
		}
	}
	code.view.cursorColumn = code.model.clampColumn(code.view.cursorRow, code.view.cursorColumn);
	code.emitCursorMoved();
	updateDesiredColumn(code);
	resetBlinkState(code.caret);
	revealCursor(code);
}

/**
 * Move cursor one word to the left
 */
export function moveWordLeft(code: CodeEditorControl): void {
	code.clearVisualCursor();
	const destination = findWordLeft(code, code.view.cursorRow, code.view.cursorColumn);
	code.view.cursorRow = destination.row;
	code.view.cursorColumn = destination.column;
	code.emitCursorMoved();
	updateDesiredColumn(code);
	resetBlinkState(code.caret);
	revealCursor(code);
}

/**
 * Move cursor one word to the right
 */
export function moveWordRight(code: CodeEditorControl): void {
	code.clearVisualCursor();
	const destination = findWordRight(code, code.view.cursorRow, code.view.cursorColumn);
	code.view.cursorRow = destination.row;
	code.view.cursorColumn = destination.column;
	code.emitCursorMoved();
	updateDesiredColumn(code);
	resetBlinkState(code.caret);
	revealCursor(code);
}

/**
 * Move cursor left by character or word
 */
export function moveCursorLeft(code: CodeEditorControl, playerInput: ModifierState): void {
	const select = isShiftDown(playerInput);
	const byWord = isCtrlDown(playerInput);
	if (select) {
		ensureSingleCursorSelectionAnchor(code.view, code.view.cursorRow, code.view.cursorColumn);
	} else if (hasSelection(code)) {
		collapseSelectionTo(code, 'start');
		breakUndoSequence(code);
		return;
	}
	if (byWord) {
		moveWordLeft(code);
	} else {
		moveCursorHorizontal(code, -1);
	}
	if (!select) {
		clearSelection(code);
	}
	breakUndoSequence(code);
	revealCursor(code);
}

/**
 * Move cursor right by character or word
 */
export function moveCursorRight(code: CodeEditorControl, playerInput: ModifierState): void {
	const select = isShiftDown(playerInput);
	const byWord = isCtrlDown(playerInput);

	if (select) {
		ensureSingleCursorSelectionAnchor(code.view, code.view.cursorRow, code.view.cursorColumn);
	} else if (hasSelection(code)) {
		collapseSelectionTo(code, 'end');
		breakUndoSequence(code);
		return;
	}
	if (byWord) {
		moveWordRight(code);
	} else {
		moveCursorHorizontal(code, 1);
	}
	if (!select) {
		clearSelection(code);
	}
	breakUndoSequence(code);
	revealCursor(code);
}

/**
 * Move cursor up one line
 */
export function moveCursorUp(code: CodeEditorControl, playerInput: ModifierState): void {
	const select = isShiftDown(playerInput);
	if (select) {
		ensureSingleCursorSelectionAnchor(code.view, code.view.cursorRow, code.view.cursorColumn);
	} else if (hasSelection(code)) {
		collapseSelectionTo(code, 'start');
		breakUndoSequence(code);
		return;
	}
	moveCursorVertical(code, -1);
	if (!select) {
		clearSelection(code);
	}
	breakUndoSequence(code);
	revealCursor(code);
}

/**
 * Move cursor down one line
 */
export function moveCursorDown(code: CodeEditorControl, playerInput: ModifierState): void {
	const select = isShiftDown(playerInput);
	if (select) {
		ensureSingleCursorSelectionAnchor(code.view, code.view.cursorRow, code.view.cursorColumn);
	} else if (hasSelection(code)) {
		collapseSelectionTo(code, 'end');
		breakUndoSequence(code);
		return;
	}
	moveCursorVertical(code, 1);
	if (!select) {
		clearSelection(code);
	}
	breakUndoSequence(code);
	revealCursor(code);
}

/**
 * Move cursor to start of line or document
 */
export function moveCursorHome(code: CodeEditorControl, playerInput: ModifierState): void {
	const previousOverride = code.visualCursor;
	code.clearVisualCursor();
	const buffer = code.model.buffer;
	const select = isShiftDown(playerInput);
	if (select) {
		ensureSingleCursorSelectionAnchor(code.view, code.view.cursorRow, code.view.cursorColumn);
	} else {
		clearSelection(code);
	}
	const ctrlDown = isCtrlDown(playerInput);
	if (ctrlDown) {
		code.view.cursorRow = 0;
		code.view.cursorColumn = 0;
	} else {
		ensureVisualLines(code);
		const visualIndex = previousOverride?.visualIndex ?? code.layout.positionToVisualIndex(code.view.cursorRow, code.view.cursorColumn);
		const segment = code.layout.visualIndexToSegment(visualIndex);
		if (segment) {
			code.view.cursorRow = segment.row;
			const line = buffer.getLineContent(segment.row);
			code.view.cursorColumn = resolveIndentAwareHome(code, line, segment, code.view.cursorColumn);
			code.captureVisualCursor(segment.row, code.view.cursorColumn, visualIndex);
		} else {
			code.view.cursorColumn = 0;
		}
	}
	code.emitCursorMoved();
	updateDesiredColumn(code);
	resetBlinkState(code.caret);
	breakUndoSequence(code);
	revealCursor(code);
}

/**
 * Move cursor to end of line or document
 */
export function moveCursorEnd(code: CodeEditorControl, playerInput: ModifierState): void {
	const previousOverride = code.visualCursor;
	code.clearVisualCursor();
	const buffer = code.model.buffer;
	const select = isShiftDown(playerInput);
	if (select) {
		ensureSingleCursorSelectionAnchor(code.view, code.view.cursorRow, code.view.cursorColumn);
	} else {
		clearSelection(code);
	}
	const ctrlDown = isCtrlDown(playerInput);
	if (ctrlDown) {
		const lastRow = buffer.getLineCount() - 1;
		code.view.cursorRow = lastRow;
		code.view.cursorColumn = buffer.getLineEndOffset(lastRow) - buffer.getLineStartOffset(lastRow);
	} else {
		ensureVisualLines(code);
		const visualIndex = previousOverride?.visualIndex ?? code.layout.positionToVisualIndex(code.view.cursorRow, code.view.cursorColumn);
		const segment = code.layout.visualIndexToSegment(visualIndex);
		if (segment) {
			code.view.cursorRow = segment.row;
			const line = buffer.getLineContent(segment.row);
			code.view.cursorColumn = resolveSegmentEnd(code, line, segment);
			code.captureVisualCursor(segment.row, code.view.cursorColumn, visualIndex);
		} else {
			code.view.cursorColumn = currentLine(code).length;
		}
	}
	code.emitCursorMoved();
	updateDesiredColumn(code);
	resetBlinkState(code.caret);
	breakUndoSequence(code);
	revealCursor(code);
}

/**
 * Move cursor up one page
 */
export function pageUp(code: CodeEditorControl, playerInput: ModifierState): void {
	const select = isShiftDown(playerInput);
	if (select) {
		ensureSingleCursorSelectionAnchor(code.view, code.view.cursorRow, code.view.cursorColumn);
	} else {
		clearSelection(code);
	}
	const { rows } = resolveViewportCapacity(code);
	const visualCount = code.layout.getVisualLineCount();
	const currentVisual = resolveCursorVisualIndex(code);
	const targetVisual = code.layout.clampVisualScroll(currentVisual - rows, visualCount, rows);
	setCursorFromVisualIndex(code, targetVisual, code.view.desiredColumn, code.view.desiredDisplayOffset);
	resetBlinkState(code.caret);
	breakUndoSequence(code);
	revealCursor(code);
}

/**
 * Move cursor down one page
 */
export function pageDown(code: CodeEditorControl, playerInput: ModifierState): void {
	const select = isShiftDown(playerInput);
	if (select) {
		ensureSingleCursorSelectionAnchor(code.view, code.view.cursorRow, code.view.cursorColumn);
	} else {
		clearSelection(code);
	}
	const { rows } = resolveViewportCapacity(code);
	const visualCount = code.layout.getVisualLineCount();
	const currentVisual = resolveCursorVisualIndex(code);
	const targetVisual = code.layout.clampVisualIndex(visualCount, currentVisual + rows);
	setCursorFromVisualIndex(code, targetVisual, code.view.desiredColumn, code.view.desiredDisplayOffset);
	resetBlinkState(code.caret);
	breakUndoSequence(code);
	revealCursor(code);
}
export { centerCursorVertically, ensureCursorVisible, revealCursor, setCursorFromVisualIndex, updateDesiredColumn } from './view';
