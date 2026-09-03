import { breakUndoSequence } from '../../../editing/undo_controller';
import { currentLine, ensureVisualLines } from '../../../common/text/layout';
import { isShiftDown, isCtrlDown } from '../../../../input/keyboard/key_input';
import { resetBlink } from '../../../render/caret';
import { findWordLeft, findWordRight, hasSelection, collapseSelectionTo, clearSelection } from '../../../editing/text_editing_and_selection';
import { ensureSingleCursorSelectionAnchor } from '../../../editing/cursor/state';
import type { VisualLineSegment } from '../../../../common/models';
import { revealCursor, resolveViewportCapacity, setCursorFromVisualIndex, updateDesiredColumn } from './view';
import { activeCodeEditor } from '../../code_editor_state';
import { editorViewState } from '../state';
import { caretNavigation } from './state';
import { resolveCursorVisualIndex } from './visual_index';
import type { PlayerInput } from '../../../../../hosts/common/input/player';

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
	const buffer = activeCodeEditor.model.buffer;
	const targetRow = editorViewState.layout.clampBufferRow(buffer, row);
	const targetColumn = editorViewState.layout.clampBufferColumn(buffer, targetRow, column);
	activeCodeEditor.view.cursorRow = targetRow;
	activeCodeEditor.view.cursorColumn = targetColumn;
	updateDesiredColumn();
	resetBlink();
	revealCursor();
	activeCodeEditor.emitCursorMoved();
}

/**
 * Move cursor vertically by delta lines (supports word wrap)
 */
export function moveCursorVertical(delta: number): void {
	caretNavigation.clear();
	ensureVisualLines();
	const visualCount = editorViewState.layout.getVisualLineCount();
	if (visualCount === 0) {
		return;
	}
	const currentIndex = editorViewState.layout.positionToVisualIndex(activeCodeEditor.view.cursorRow, activeCodeEditor.view.cursorColumn);
	const targetIndex = editorViewState.layout.clampVisualIndex(visualCount, currentIndex + delta);
	const desired = activeCodeEditor.view.desiredColumn;
	const desiredDisplay = activeCodeEditor.view.desiredDisplayOffset;
	setCursorFromVisualIndex(targetIndex, desired, desiredDisplay);
	resetBlink();
	revealCursor();
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
	const visualCount = editorViewState.layout.getVisualLineCount();
	if (visualCount === 0) {
		return;
	}
	const visualIndex = editorViewState.layout.positionToVisualIndex(activeCodeEditor.view.cursorRow, activeCodeEditor.view.cursorColumn);
	const segment = editorViewState.layout.visualIndexToSegment(visualIndex);
	if (!segment) {
		return;
	}
	const buffer = activeCodeEditor.model.buffer;
	const line = buffer.getLineContent(segment.row);
	if (delta < 0) {
		// Move left
		if (activeCodeEditor.view.cursorColumn > segment.startColumn) {
			activeCodeEditor.view.cursorColumn -= 1;
		} else {
			let moved = false;
				if (editorViewState.wordWrapEnabled && visualIndex > 0) {
					const prevSegment = editorViewState.layout.visualIndexToSegment(visualIndex - 1);
					if (prevSegment && prevSegment.row === segment.row) {
						activeCodeEditor.view.cursorRow = prevSegment.row;
						const prevLine = buffer.getLineContent(prevSegment.row);
						const prevEnd = Math.max(prevSegment.endColumn, prevSegment.startColumn);
						const hasMoreBefore = prevEnd > prevSegment.startColumn;
						const targetColumn = hasMoreBefore && prevEnd < prevLine.length
						? Math.max(prevSegment.startColumn, prevEnd - 1)
						: Math.min(prevEnd, prevLine.length);
					activeCodeEditor.view.cursorColumn = editorViewState.layout.clampLineLength(prevLine.length, targetColumn);
					moved = true;
				}
			}
			if (!moved && segment.row > 0) {
				activeCodeEditor.view.cursorRow = segment.row - 1;
				activeCodeEditor.view.cursorColumn = buffer.getLineEndOffset(activeCodeEditor.view.cursorRow) - buffer.getLineStartOffset(activeCodeEditor.view.cursorRow);
			}
		}
	} else {
		// Move right
		if (activeCodeEditor.view.cursorColumn < segment.endColumn && activeCodeEditor.view.cursorColumn < line.length) {
			activeCodeEditor.view.cursorColumn += 1;
		} else {
			let moved = false;
			if (editorViewState.wordWrapEnabled && visualIndex < visualCount - 1) {
				const nextSegment = editorViewState.layout.visualIndexToSegment(visualIndex + 1);
				if (nextSegment && nextSegment.row === segment.row) {
					activeCodeEditor.view.cursorRow = nextSegment.row;
					activeCodeEditor.view.cursorColumn = nextSegment.startColumn;
					moved = true;
				}
			}
			if (!moved && segment.row < buffer.getLineCount() - 1) {
				activeCodeEditor.view.cursorRow = segment.row + 1;
				activeCodeEditor.view.cursorColumn = 0;
			}
		}
	}
	const cursorLength = buffer.getLineEndOffset(activeCodeEditor.view.cursorRow) - buffer.getLineStartOffset(activeCodeEditor.view.cursorRow);
	activeCodeEditor.view.cursorColumn = editorViewState.layout.clampLineLength(cursorLength, activeCodeEditor.view.cursorColumn);
	updateDesiredColumn();
	resetBlink();
	revealCursor();
	activeCodeEditor.emitCursorMoved();
}

/**
 * Move cursor one word to the left
 */
export function moveWordLeft(): void {
	caretNavigation.clear();
	const destination = findWordLeft(activeCodeEditor.view.cursorRow, activeCodeEditor.view.cursorColumn);
	activeCodeEditor.view.cursorRow = destination.row;
	activeCodeEditor.view.cursorColumn = destination.column;
	updateDesiredColumn();
	resetBlink();
	revealCursor();
	activeCodeEditor.emitCursorMoved();
}

/**
 * Move cursor one word to the right
 */
export function moveWordRight(): void {
	caretNavigation.clear();
	const destination = findWordRight(activeCodeEditor.view.cursorRow, activeCodeEditor.view.cursorColumn);
	activeCodeEditor.view.cursorRow = destination.row;
	activeCodeEditor.view.cursorColumn = destination.column;
	updateDesiredColumn();
	resetBlink();
	revealCursor();
	activeCodeEditor.emitCursorMoved();
}

/**
 * Move cursor left by character or word
 */
export function moveCursorLeft(playerInput: PlayerInput): void {
	const select = isShiftDown(playerInput);
	const byWord = isCtrlDown(playerInput);
	if (select) {
		ensureSingleCursorSelectionAnchor(activeCodeEditor.view, activeCodeEditor.view.cursorRow, activeCodeEditor.view.cursorColumn);
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
export function moveCursorRight(playerInput: PlayerInput): void {
	const select = isShiftDown(playerInput);
	const byWord = isCtrlDown(playerInput);

	if (select) {
		ensureSingleCursorSelectionAnchor(activeCodeEditor.view, activeCodeEditor.view.cursorRow, activeCodeEditor.view.cursorColumn);
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
export function moveCursorUp(playerInput: PlayerInput): void {
	const select = isShiftDown(playerInput);
	if (select) {
		ensureSingleCursorSelectionAnchor(activeCodeEditor.view, activeCodeEditor.view.cursorRow, activeCodeEditor.view.cursorColumn);
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
export function moveCursorDown(playerInput: PlayerInput): void {
	const select = isShiftDown(playerInput);
	if (select) {
		ensureSingleCursorSelectionAnchor(activeCodeEditor.view, activeCodeEditor.view.cursorRow, activeCodeEditor.view.cursorColumn);
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
export function moveCursorHome(playerInput: PlayerInput): void {
	const previousOverride = caretNavigation.lookup(activeCodeEditor.view.cursorRow, activeCodeEditor.view.cursorColumn);
	caretNavigation.clear();
	const buffer = activeCodeEditor.model.buffer;
	const select = isShiftDown(playerInput);
	if (select) {
		ensureSingleCursorSelectionAnchor(activeCodeEditor.view, activeCodeEditor.view.cursorRow, activeCodeEditor.view.cursorColumn);
	} else {
		clearSelection();
	}
	const ctrlDown = isCtrlDown(playerInput);
	if (ctrlDown) {
		activeCodeEditor.view.cursorRow = 0;
		activeCodeEditor.view.cursorColumn = 0;
	} else {
		ensureVisualLines();
		const visualIndex = previousOverride?.visualIndex ?? editorViewState.layout.positionToVisualIndex(activeCodeEditor.view.cursorRow, activeCodeEditor.view.cursorColumn);
		const segment = editorViewState.layout.visualIndexToSegment(visualIndex);
		if (segment) {
			activeCodeEditor.view.cursorRow = segment.row;
			const line = buffer.getLineContent(segment.row);
			activeCodeEditor.view.cursorColumn = resolveIndentAwareHome(line, segment, activeCodeEditor.view.cursorColumn);
			caretNavigation.capture(segment.row, activeCodeEditor.view.cursorColumn, visualIndex, segment.startColumn);
		} else {
			activeCodeEditor.view.cursorColumn = 0;
		}
	}
	updateDesiredColumn();
	resetBlink();
	breakUndoSequence();
	revealCursor();
	activeCodeEditor.emitCursorMoved();
}

/**
 * Move cursor to end of line or document
 */
export function moveCursorEnd(playerInput: PlayerInput): void {
	const previousOverride = caretNavigation.lookup(activeCodeEditor.view.cursorRow, activeCodeEditor.view.cursorColumn);
	caretNavigation.clear();
	const buffer = activeCodeEditor.model.buffer;
	const select = isShiftDown(playerInput);
	if (select) {
		ensureSingleCursorSelectionAnchor(activeCodeEditor.view, activeCodeEditor.view.cursorRow, activeCodeEditor.view.cursorColumn);
	} else {
		clearSelection();
	}
	const ctrlDown = isCtrlDown(playerInput);
	if (ctrlDown) {
		const lastRow = buffer.getLineCount() - 1;
		activeCodeEditor.view.cursorRow = lastRow;
		activeCodeEditor.view.cursorColumn = buffer.getLineEndOffset(lastRow) - buffer.getLineStartOffset(lastRow);
	} else {
		ensureVisualLines();
		const visualIndex = previousOverride?.visualIndex ?? editorViewState.layout.positionToVisualIndex(activeCodeEditor.view.cursorRow, activeCodeEditor.view.cursorColumn);
		const segment = editorViewState.layout.visualIndexToSegment(visualIndex);
		if (segment) {
			activeCodeEditor.view.cursorRow = segment.row;
			const line = buffer.getLineContent(segment.row);
			activeCodeEditor.view.cursorColumn = resolveSegmentEnd(line, segment);
			caretNavigation.capture(segment.row, activeCodeEditor.view.cursorColumn, visualIndex, segment.startColumn);
		} else {
			activeCodeEditor.view.cursorColumn = currentLine().length;
		}
	}
	updateDesiredColumn();
	resetBlink();
	breakUndoSequence();
	revealCursor();
	activeCodeEditor.emitCursorMoved();
}

/**
 * Move cursor up one page
 */
export function pageUp(playerInput: PlayerInput): void {
	const select = isShiftDown(playerInput);
	if (select) {
		ensureSingleCursorSelectionAnchor(activeCodeEditor.view, activeCodeEditor.view.cursorRow, activeCodeEditor.view.cursorColumn);
	} else {
		clearSelection();
	}
	const { rows } = resolveViewportCapacity();
	const visualCount = editorViewState.layout.getVisualLineCount();
	const currentVisual = resolveCursorVisualIndex();
	const targetVisual = editorViewState.layout.clampVisualScroll(currentVisual - rows, visualCount, rows);
	setCursorFromVisualIndex(targetVisual, activeCodeEditor.view.desiredColumn, activeCodeEditor.view.desiredDisplayOffset);
	resetBlink();
	breakUndoSequence();
	revealCursor();
}

/**
 * Move cursor down one page
 */
export function pageDown(playerInput: PlayerInput): void {
	const select = isShiftDown(playerInput);
	if (select) {
		ensureSingleCursorSelectionAnchor(activeCodeEditor.view, activeCodeEditor.view.cursorRow, activeCodeEditor.view.cursorColumn);
	} else {
		clearSelection();
	}
	const { rows } = resolveViewportCapacity();
	const visualCount = editorViewState.layout.getVisualLineCount();
	const currentVisual = resolveCursorVisualIndex();
	const targetVisual = editorViewState.layout.clampVisualIndex(visualCount, currentVisual + rows);
	setCursorFromVisualIndex(targetVisual, activeCodeEditor.view.desiredColumn, activeCodeEditor.view.desiredDisplayOffset);
	resetBlink();
	breakUndoSequence();
	revealCursor();
}
export { centerCursorVertically, ensureCursorVisible, revealCursor, setCursorFromVisualIndex, updateDesiredColumn } from './view';
