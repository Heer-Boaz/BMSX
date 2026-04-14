import { breakUndoSequence } from '../editing/undo_controller';
import { currentLine } from '../core/text_utils';
import { ensureVisualLines, getVisualLineCount, positionToVisualIndex, visualIndexToSegment } from '../core/text_utils';
import { isShiftDown, isCtrlDown } from '../input/keyboard/key_input';
import { resetBlink } from '../render/render_caret';
import { findWordLeft, findWordRight, hasSelection, collapseSelectionTo, clearSelection } from '../editing/text_editing_and_selection';
import { ensureSingleCursorSelectionAnchor } from '../editing/cursor_state';
import type { VisualLineSegment } from '../core/types';
import { revealCursor, resolveViewportCapacity, setCursorFromVisualIndex, updateDesiredColumn } from './caret_view';
import { editorDocumentState } from '../editing/editor_document_state';
import { editorViewState } from './editor_view_state';
import { editorFeatureState } from '../core/editor_feature_state';

export type VisualCursorOverride = {
	row: number;
	column: number;
	visualIndex: number;
	segmentStartColumn: number;
};

export class CaretNavigationState {
	private override: VisualCursorOverride = null;

	public clear(): void {
		this.override = null;
	}

	public capture(row: number, column: number, visualIndex: number, segmentStartColumn: number): void {
		this.override = {
			row,
			column,
			visualIndex,
			segmentStartColumn,
		};
	}

	public lookup(row: number, column: number): { visualIndex: number; segmentStartColumn: number } {
		const current = this.override;
		if (!current) {
			return null;
		}
		if (current.row !== row || current.column !== column) {
			return null;
		}
		return {
			visualIndex: current.visualIndex,
			segmentStartColumn: current.segmentStartColumn,
		};
	}
}

export const caretNavigation = new CaretNavigationState();

export function resolveIndentAwareHome(line: string, segment: VisualLineSegment, currentColumn: number): number {
	const lineLength = line.length;
	const segmentStart = editorViewState.layout.clampSegmentStart(lineLength, segment.startColumn);
	const segmentEnd = editorViewState.layout.clampSegmentEnd(lineLength, segmentStart, segment.endColumn);
	const preferred = findFirstNonWhitespace(line, segmentStart, segmentEnd);
	const targetColumn = currentColumn === preferred ? segmentStart : preferred;
	return editorViewState.layout.clampSegmentEnd(lineLength, segmentStart, targetColumn);
}

export function resolveSegmentEnd(line: string, segment: VisualLineSegment): number {
	const lineLength = line.length;
	const segmentStart = editorViewState.layout.clampSegmentStart(lineLength, segment.startColumn);
	const segmentEnd = editorViewState.layout.clampSegmentEnd(lineLength, segmentStart, segment.endColumn);
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
export function setCursorPosition(row: number, column: number): void {
	caretNavigation.clear();
	const buffer = editorDocumentState.buffer;
	const targetRow = editorViewState.layout.clampBufferRow(buffer, row);
	const targetColumn = editorViewState.layout.clampBufferColumn(buffer, targetRow, column);
	editorDocumentState.cursorRow = targetRow;
	editorDocumentState.cursorColumn = targetColumn;
	updateDesiredColumn();
	resetBlink();
	revealCursor();
	editorFeatureState.completion.onCursorMoved();
}

/**
 * Move cursor vertically by delta lines (supports word wrap)
 */
export function moveCursorVertical(delta: number): void {
	caretNavigation.clear();
	ensureVisualLines();
	const visualCount = getVisualLineCount();
	if (visualCount === 0) {
		return;
	}
	const currentIndex = positionToVisualIndex(editorDocumentState.cursorRow, editorDocumentState.cursorColumn);
	const targetIndex = editorViewState.layout.clampVisualIndex(visualCount, currentIndex + delta);
	const desired = editorDocumentState.desiredColumn;
	const desiredDisplay = editorDocumentState.desiredDisplayOffset;
	setCursorFromVisualIndex(targetIndex, desired, desiredDisplay);
	resetBlink();
	revealCursor();
	editorFeatureState.completion.onCursorMoved();
}

/**
 * Move cursor horizontally by delta columns (supports word wrap)
 */
export function moveCursorHorizontal(delta: number): void {
	if (delta === 0) {
		return;
	}
	caretNavigation.clear();
	ensureVisualLines();
	const visualCount = getVisualLineCount();
	if (visualCount === 0) {
		return;
	}
	const visualIndex = positionToVisualIndex(editorDocumentState.cursorRow, editorDocumentState.cursorColumn);
	const segment = visualIndexToSegment(visualIndex);
	if (!segment) {
		return;
	}
	const buffer = editorDocumentState.buffer;
	const line = buffer.getLineContent(segment.row);
	if (delta < 0) {
		// Move left
		if (editorDocumentState.cursorColumn > segment.startColumn) {
			editorDocumentState.cursorColumn -= 1;
		} else {
			let moved = false;
				if (editorViewState.wordWrapEnabled && visualIndex > 0) {
					const prevSegment = visualIndexToSegment(visualIndex - 1);
					if (prevSegment && prevSegment.row === segment.row) {
						editorDocumentState.cursorRow = prevSegment.row;
						const prevLine = buffer.getLineContent(prevSegment.row);
						const prevEnd = Math.max(prevSegment.endColumn, prevSegment.startColumn);
						const hasMoreBefore = prevEnd > prevSegment.startColumn;
						const targetColumn = hasMoreBefore && prevEnd < prevLine.length
						? Math.max(prevSegment.startColumn, prevEnd - 1)
						: Math.min(prevEnd, prevLine.length);
					editorDocumentState.cursorColumn = editorViewState.layout.clampLineLength(prevLine.length, targetColumn);
					moved = true;
				}
			}
			if (!moved && segment.row > 0) {
				editorDocumentState.cursorRow = segment.row - 1;
				editorDocumentState.cursorColumn = buffer.getLineEndOffset(editorDocumentState.cursorRow) - buffer.getLineStartOffset(editorDocumentState.cursorRow);
			}
		}
	} else {
		// Move right
		if (editorDocumentState.cursorColumn < segment.endColumn && editorDocumentState.cursorColumn < line.length) {
			editorDocumentState.cursorColumn += 1;
		} else {
			let moved = false;
			if (editorViewState.wordWrapEnabled && visualIndex < visualCount - 1) {
				const nextSegment = visualIndexToSegment(visualIndex + 1);
				if (nextSegment && nextSegment.row === segment.row) {
					editorDocumentState.cursorRow = nextSegment.row;
					editorDocumentState.cursorColumn = nextSegment.startColumn;
					moved = true;
				}
			}
			if (!moved && segment.row < buffer.getLineCount() - 1) {
				editorDocumentState.cursorRow = segment.row + 1;
				editorDocumentState.cursorColumn = 0;
			}
		}
	}
	const cursorLength = buffer.getLineEndOffset(editorDocumentState.cursorRow) - buffer.getLineStartOffset(editorDocumentState.cursorRow);
	editorDocumentState.cursorColumn = editorViewState.layout.clampLineLength(cursorLength, editorDocumentState.cursorColumn);
	updateDesiredColumn();
	resetBlink();
	revealCursor();
	editorFeatureState.completion.onCursorMoved();
}

/**
 * Move cursor one word to the left
 */
export function moveWordLeft(): void {
	caretNavigation.clear();
	const destination = findWordLeft(editorDocumentState.cursorRow, editorDocumentState.cursorColumn);
	editorDocumentState.cursorRow = destination.row;
	editorDocumentState.cursorColumn = destination.column;
	updateDesiredColumn();
	resetBlink();
	revealCursor();
	editorFeatureState.completion.onCursorMoved();
}

/**
 * Move cursor one word to the right
 */
export function moveWordRight(): void {
	caretNavigation.clear();
	const destination = findWordRight(editorDocumentState.cursorRow, editorDocumentState.cursorColumn);
	editorDocumentState.cursorRow = destination.row;
	editorDocumentState.cursorColumn = destination.column;
	updateDesiredColumn();
	resetBlink();
	revealCursor();
	editorFeatureState.completion.onCursorMoved();
}

/**
 * Move cursor left by character or word
 */
export function moveCursorLeft(): void {
	const select = isShiftDown();
	const byWord = isCtrlDown();
	if (select) {
		ensureSingleCursorSelectionAnchor(editorDocumentState, editorDocumentState.cursorRow, editorDocumentState.cursorColumn);
	} else if (hasSelection()) {
		collapseSelectionTo('start');
		breakUndoSequence();
		return;
	}
	if (byWord) {
		moveWordLeft();
	} else {
		moveCursorHorizontal(-1);
	}
	if (!select) {
		clearSelection();
	}
	breakUndoSequence();
	revealCursor();
}

/**
 * Move cursor right by character or word
 */
export function moveCursorRight(): void {
	const select = isShiftDown();
	const byWord = isCtrlDown();

	if (select) {
		ensureSingleCursorSelectionAnchor(editorDocumentState, editorDocumentState.cursorRow, editorDocumentState.cursorColumn);
	} else if (hasSelection()) {
		collapseSelectionTo('end');
		breakUndoSequence();
		return;
	}
	if (byWord) {
		moveWordRight();
	} else {
		moveCursorHorizontal(1);
	}
	if (!select) {
		clearSelection();
	}
	breakUndoSequence();
	revealCursor();
}

/**
 * Move cursor up one line
 */
export function moveCursorUp(): void {
	const select = isShiftDown();
	if (select) {
		ensureSingleCursorSelectionAnchor(editorDocumentState, editorDocumentState.cursorRow, editorDocumentState.cursorColumn);
	} else if (hasSelection()) {
		collapseSelectionTo('start');
		breakUndoSequence();
		return;
	}
	moveCursorVertical(-1);
	if (!select) {
		clearSelection();
	}
	breakUndoSequence();
	revealCursor();
}

/**
 * Move cursor down one line
 */
export function moveCursorDown(): void {
	const select = isShiftDown();
	if (select) {
		ensureSingleCursorSelectionAnchor(editorDocumentState, editorDocumentState.cursorRow, editorDocumentState.cursorColumn);
	} else if (hasSelection()) {
		collapseSelectionTo('end');
		breakUndoSequence();
		return;
	}
	moveCursorVertical(1);
	if (!select) {
		clearSelection();
	}
	breakUndoSequence();
	revealCursor();
}

/**
 * Move cursor to start of line or document
 */
export function moveCursorHome(): void {
	const previousOverride = caretNavigation.lookup(editorDocumentState.cursorRow, editorDocumentState.cursorColumn);
	caretNavigation.clear();
	const buffer = editorDocumentState.buffer;
	const select = isShiftDown();
	if (select) {
		ensureSingleCursorSelectionAnchor(editorDocumentState, editorDocumentState.cursorRow, editorDocumentState.cursorColumn);
	} else {
		clearSelection();
	}
	const ctrlDown = isCtrlDown();
	if (ctrlDown) {
		editorDocumentState.cursorRow = 0;
		editorDocumentState.cursorColumn = 0;
	} else {
		ensureVisualLines();
		const visualIndex = previousOverride?.visualIndex ?? positionToVisualIndex(editorDocumentState.cursorRow, editorDocumentState.cursorColumn);
		const segment = visualIndexToSegment(visualIndex);
		if (segment) {
			editorDocumentState.cursorRow = segment.row;
			const line = buffer.getLineContent(segment.row);
			editorDocumentState.cursorColumn = resolveIndentAwareHome(line, segment, editorDocumentState.cursorColumn);
			caretNavigation.capture(segment.row, editorDocumentState.cursorColumn, visualIndex, segment.startColumn);
		} else {
			editorDocumentState.cursorColumn = 0;
		}
	}
	updateDesiredColumn();
	resetBlink();
	breakUndoSequence();
	revealCursor();
}

/**
 * Move cursor to end of line or document
 */
export function moveCursorEnd(): void {
	const previousOverride = caretNavigation.lookup(editorDocumentState.cursorRow, editorDocumentState.cursorColumn);
	caretNavigation.clear();
	const buffer = editorDocumentState.buffer;
	const select = isShiftDown();
	if (select) {
		ensureSingleCursorSelectionAnchor(editorDocumentState, editorDocumentState.cursorRow, editorDocumentState.cursorColumn);
	} else {
		clearSelection();
	}
	const ctrlDown = isCtrlDown();
	if (ctrlDown) {
		const lastRow = buffer.getLineCount() - 1;
		editorDocumentState.cursorRow = lastRow;
		editorDocumentState.cursorColumn = buffer.getLineEndOffset(lastRow) - buffer.getLineStartOffset(lastRow);
	} else {
		ensureVisualLines();
		const visualIndex = previousOverride?.visualIndex ?? positionToVisualIndex(editorDocumentState.cursorRow, editorDocumentState.cursorColumn);
		const segment = visualIndexToSegment(visualIndex);
		if (segment) {
			editorDocumentState.cursorRow = segment.row;
			const line = buffer.getLineContent(segment.row);
			editorDocumentState.cursorColumn = resolveSegmentEnd(line, segment);
			caretNavigation.capture(segment.row, editorDocumentState.cursorColumn, visualIndex, segment.startColumn);
		} else {
			editorDocumentState.cursorColumn = currentLine().length;
		}
	}
	updateDesiredColumn();
	resetBlink();
	breakUndoSequence();
	revealCursor();
}

/**
 * Move cursor up one page
 */
export function pageUp(): void {
	const select = isShiftDown();
	if (select) {
		ensureSingleCursorSelectionAnchor(editorDocumentState, editorDocumentState.cursorRow, editorDocumentState.cursorColumn);
	} else {
		clearSelection();
	}
	const { rows } = resolveViewportCapacity();
	const visualCount = getVisualLineCount();
	const currentVisual = positionToVisualIndex(editorDocumentState.cursorRow, editorDocumentState.cursorColumn);
	const targetVisual = editorViewState.layout.clampVisualScroll(currentVisual - rows, visualCount, rows);
	setCursorFromVisualIndex(targetVisual, editorDocumentState.desiredColumn, editorDocumentState.desiredDisplayOffset);
	resetBlink();
	breakUndoSequence();
	revealCursor();
}

/**
 * Move cursor down one page
 */
export function pageDown(): void {
	const select = isShiftDown();
	if (select) {
		ensureSingleCursorSelectionAnchor(editorDocumentState, editorDocumentState.cursorRow, editorDocumentState.cursorColumn);
	} else {
		clearSelection();
	}
	const { rows } = resolveViewportCapacity();
	const visualCount = getVisualLineCount();
	const currentVisual = positionToVisualIndex(editorDocumentState.cursorRow, editorDocumentState.cursorColumn);
	const targetVisual = editorViewState.layout.clampVisualIndex(visualCount, currentVisual + rows);
	setCursorFromVisualIndex(targetVisual, editorDocumentState.desiredColumn, editorDocumentState.desiredDisplayOffset);
	resetBlink();
	breakUndoSequence();
	revealCursor();
}
export { centerCursorVertically, ensureCursorVisible, revealCursor, setCursorFromVisualIndex, updateDesiredColumn } from './caret_view';
