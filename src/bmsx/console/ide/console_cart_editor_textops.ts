import { clamp } from '../../utils/utils';
import { isWhitespace, isWordChar, isIdentifierChar, isIdentifierStartChar } from './text_utils';
import * as constants from './constants';
import {
	isModifierPressed as isModifierPressedGlobal,
	resetKeyPressRecords,
} from './input_helpers';
import { CaretNavigationState, resolveIndentAwareHome, resolveSegmentEnd } from './caret_navigation';
import type { EditorSnapshot, Position, VisualLineSegment } from './types';

/**
 * ConsoleCartEditorTextOps hosts the core text-buffer state and mutation logic for ConsoleCartEditor.
 * It is intentionally abstract so the derived editor can supply rendering and runtime integrations.
 */
export abstract class ConsoleCartEditorTextOps {
	protected lines: string[] = [''];
	protected cursorRow = 0;
	protected cursorColumn = 0;
	protected scrollRow = 0;
	protected scrollColumn = 0;
	protected dirty = false;
	protected desiredColumn = 0;
	protected desiredDisplayOffset = 0;
	protected selectionAnchor: Position | null = null;
	protected undoStack: EditorSnapshot[] = [];
	protected redoStack: EditorSnapshot[] = [];
	protected lastHistoryKey: string | null = null;
	protected lastHistoryTimestamp = 0;
	protected readonly caretNavigation = new CaretNavigationState();

	protected clearCursorVisualOverride(): void {
		this.caretNavigation.clear();
	}

	protected setCursorVisualOverride(row: number, column: number, visualIndex: number, segmentStartColumn: number): void {
		this.caretNavigation.capture(row, column, visualIndex, segmentStartColumn);
	}

	protected getCursorVisualOverride(row: number, column: number): { visualIndex: number; segmentStartColumn: number } | null {
		return this.caretNavigation.peek(row, column);
	}

	protected abstract readonly playerIndex: number;
	protected abstract wordWrapEnabled: boolean;
	protected abstract cursorRevealSuspended: boolean;

	protected abstract resetBlink(): void;
	protected abstract revealCursor(): void;
	protected abstract updateDesiredColumn(): void;
	protected abstract markTextMutated(): void;
	protected abstract invalidateLine(row: number): void;
	protected abstract invalidateAllHighlights(): void;
	protected abstract invalidateHighlightsFromRow(startRow: number): void;
	protected invalidateLineRange(startRow: number, endRow: number): void {
		if (this.lines.length === 0) {
			return;
		}
		let from = Math.min(startRow, endRow);
		let to = Math.max(startRow, endRow);
		const lastRow = this.lines.length - 1;
		from = clamp(from, 0, lastRow);
		to = clamp(to, 0, lastRow);
		for (let row = from; row <= to; row += 1) {
			this.invalidateLine(row);
		}
	}
	protected abstract recordEditContext(kind: 'insert' | 'delete' | 'replace', text: string): void;
	protected abstract onCursorMoved(): void;
	protected abstract ensureVisualLines(): void;
	protected abstract getVisualLineCount(): number;
	protected abstract visibleRowCount(): number;
	protected abstract visibleColumnCount(): number;
	protected abstract positionToVisualIndex(row: number, column: number): number;
	protected abstract visualIndexToSegment(index: number): VisualLineSegment | null;
	protected abstract setCursorFromVisualIndex(visualIndex: number, desiredColumn?: number, desiredOffset?: number): void;
	protected abstract showMessage(text: string, color: number, durationSeconds: number): void;
	protected abstract captureSnapshot(): EditorSnapshot;
	protected abstract restoreSnapshot(snapshot: EditorSnapshot, preserveSelection?: boolean): void;
	protected abstract markDiagnosticsDirty(): void;

	protected maximumLineLength(): number {
		let maxLength = 0;
		for (let i = 0; i < this.lines.length; i += 1) {
			const length = this.lines[i].length;
			if (length > maxLength) {
				maxLength = length;
			}
		}
		return maxLength;
	}

	protected computeMaximumScrollColumn(): number {
		const maxLength = this.maximumLineLength();
		const visible = this.visibleColumnCount();
		const limit = maxLength - visible;
		if (limit <= 0) {
			return 0;
		}
		return limit;
	}

	protected setCursorPosition(row: number, column: number): void {
		this.caretNavigation.clear();
		let targetRow = row;
		if (targetRow < 0) {
			targetRow = 0;
		}
		const lastRow = this.lines.length - 1;
		if (targetRow > lastRow) {
			targetRow = lastRow >= 0 ? lastRow : 0;
		}
		let targetColumn = column;
		if (targetColumn < 0) {
			targetColumn = 0;
		}
		const lineLength = this.lines[targetRow]?.length ?? 0;
		if (targetColumn > lineLength) {
			targetColumn = lineLength;
		}
		this.cursorRow = targetRow;
		this.cursorColumn = targetColumn;
		this.updateDesiredColumn();
		this.resetBlink();
		this.revealCursor();
		this.onCursorMoved();
	}

	protected moveCursorVertical(delta: number): void {
		this.caretNavigation.clear();
		this.ensureVisualLines();
		const visualCount = this.getVisualLineCount();
		if (visualCount === 0) {
			return;
		}
		const currentIndex = this.positionToVisualIndex(this.cursorRow, this.cursorColumn);
		const targetIndex = clamp(currentIndex + delta, 0, visualCount - 1);
		const desired = this.desiredColumn;
		const desiredDisplay = this.desiredDisplayOffset;
		this.setCursorFromVisualIndex(targetIndex, desired, desiredDisplay);
		this.resetBlink();
		this.revealCursor();
		this.onCursorMoved();
	}

	protected moveCursorHorizontal(delta: number): void {
		if (delta === 0) {
			return;
		}
		this.caretNavigation.clear();
		this.ensureVisualLines();
		const visualCount = this.getVisualLineCount();
		if (visualCount === 0) {
			return;
		}
		const visualIndex = this.positionToVisualIndex(this.cursorRow, this.cursorColumn);
		const segment = this.visualIndexToSegment(visualIndex);
		if (!segment) {
			return;
		}
		const line = this.lines[segment.row] ?? '';
		if (delta < 0) {
			if (this.cursorColumn > segment.startColumn) {
				this.cursorColumn -= 1;
			} else {
				let moved = false;
				if (this.wordWrapEnabled && visualIndex > 0) {
					const prevSegment = this.visualIndexToSegment(visualIndex - 1);
					if (prevSegment && prevSegment.row === segment.row) {
						this.cursorRow = prevSegment.row;
						const prevLine = this.lines[prevSegment.row] ?? '';
						const prevEnd = Math.max(prevSegment.endColumn, prevSegment.startColumn);
						const hasMoreBefore = prevEnd > prevSegment.startColumn;
						const targetColumn = hasMoreBefore && prevEnd < prevLine.length
							? Math.max(prevSegment.startColumn, prevEnd - 1)
							: Math.min(prevEnd, prevLine.length);
						this.cursorColumn = clamp(targetColumn, 0, prevLine.length);
						moved = true;
					}
				}
				if (!moved && segment.row > 0) {
					this.cursorRow = segment.row - 1;
					this.cursorColumn = this.lines[this.cursorRow].length;
				}
			}
		} else {
			if (this.cursorColumn < segment.endColumn && this.cursorColumn < line.length) {
				this.cursorColumn += 1;
			} else {
				let moved = false;
				if (this.wordWrapEnabled && visualIndex < visualCount - 1) {
					const nextSegment = this.visualIndexToSegment(visualIndex + 1);
					if (nextSegment && nextSegment.row === segment.row) {
						this.cursorRow = nextSegment.row;
						this.cursorColumn = nextSegment.startColumn;
						moved = true;
					}
				}
				if (!moved && segment.row < this.lines.length - 1) {
					this.cursorRow = segment.row + 1;
					this.cursorColumn = 0;
				}
			}
		}
		this.cursorColumn = clamp(this.cursorColumn, 0, this.lines[this.cursorRow]?.length ?? 0);
		this.updateDesiredColumn();
		this.resetBlink();
		this.revealCursor();
		this.onCursorMoved();
	}

	protected moveWordLeft(): void {
		this.clearCursorVisualOverride();
		const destination = this.findWordLeft(this.cursorRow, this.cursorColumn);
		this.cursorRow = destination.row;
		this.cursorColumn = destination.column;
		this.updateDesiredColumn();
		this.resetBlink();
		this.revealCursor();
		this.onCursorMoved();
	}

	protected moveWordRight(): void {
		this.clearCursorVisualOverride();
		const destination = this.findWordRight(this.cursorRow, this.cursorColumn);
		this.cursorRow = destination.row;
		this.cursorColumn = destination.column;
		this.updateDesiredColumn();
		this.resetBlink();
		this.revealCursor();
		this.onCursorMoved();
	}

	protected findWordLeft(row: number, column: number): { row: number; column: number } {
		let currentRow = row;
		let currentColumn = column;
		let step = this.stepLeft(currentRow, currentColumn);
		if (!step) {
			return { row: 0, column: 0 };
		}
		currentRow = step.row;
		currentColumn = step.column;
		let currentChar = this.charAt(currentRow, currentColumn);
		while (isWhitespace(currentChar)) {
			const previous = this.stepLeft(currentRow, currentColumn);
			if (!previous) {
				return { row: 0, column: 0 };
			}
			currentRow = previous.row;
			currentColumn = previous.column;
			currentChar = this.charAt(currentRow, currentColumn);
		}
		const word = isWordChar(currentChar);
		while (true) {
			const previous = this.stepLeft(currentRow, currentColumn);
			if (!previous) {
				currentRow = 0;
				currentColumn = 0;
				break;
			}
			const previousChar = this.charAt(previous.row, previous.column);
			if (isWhitespace(previousChar) || isWordChar(previousChar) !== word) {
				break;
			}
			currentRow = previous.row;
			currentColumn = previous.column;
		}
		return { row: currentRow, column: currentColumn };
	}

	protected findWordRight(row: number, column: number): { row: number; column: number } {
		let currentRow = row;
		let currentColumn = column;
		let step = this.stepRight(currentRow, currentColumn);
		if (!step) {
			const lastRow = this.lines.length - 1;
			return { row: lastRow, column: this.lines[lastRow].length };
		}
		currentRow = step.row;
		currentColumn = step.column;
		let currentChar = this.charAt(currentRow, currentColumn);
		while (isWhitespace(currentChar)) {
			const next = this.stepRight(currentRow, currentColumn);
			if (!next) {
				const lastRow = this.lines.length - 1;
				return { row: lastRow, column: this.lines[lastRow].length };
			}
			currentRow = next.row;
			currentColumn = next.column;
			currentChar = this.charAt(currentRow, currentColumn);
		}
		const word = isWordChar(currentChar);
		while (true) {
			const next = this.stepRight(currentRow, currentColumn);
			if (!next) {
				const lastRow = this.lines.length - 1;
				currentRow = lastRow;
				currentColumn = this.lines[lastRow].length;
				break;
			}
			const nextChar = this.charAt(next.row, next.column);
			if (isWhitespace(nextChar) || isWordChar(nextChar) !== word) {
				currentRow = next.row;
				currentColumn = next.column;
				break;
			}
			currentRow = next.row;
			currentColumn = next.column;
		}
		while (isWhitespace(this.charAt(currentRow, currentColumn))) {
			const next = this.stepRight(currentRow, currentColumn);
			if (!next) {
				const lastRow = this.lines.length - 1;
				currentRow = lastRow;
				currentColumn = this.lines[lastRow].length;
				break;
			}
			currentRow = next.row;
			currentColumn = next.column;
		}
		return { row: currentRow, column: currentColumn };
	}

	protected moveCursorLeft(byWord: boolean, select: boolean): void {
		const previous: Position = { row: this.cursorRow, column: this.cursorColumn };
		if (select) {
			this.ensureSelectionAnchor(previous);
		} else if (this.hasSelection()) {
			this.collapseSelectionTo('start');
			this.breakUndoSequence();
			return;
		}
		if (byWord) {
			this.moveWordLeft();
		} else {
			this.moveCursorHorizontal(-1);
		}
		if (!select) {
			this.clearSelection();
		}
		this.breakUndoSequence();
		this.revealCursor();
	}

	protected moveCursorRight(byWord: boolean, select: boolean): void {
		const previous: Position = { row: this.cursorRow, column: this.cursorColumn };
		if (select) {
			this.ensureSelectionAnchor(previous);
		} else if (this.hasSelection()) {
			this.collapseSelectionTo('end');
			this.breakUndoSequence();
			return;
		}
		if (byWord) {
			this.moveWordRight();
		} else {
			this.moveCursorHorizontal(1);
		}
		if (!select) {
			this.clearSelection();
		}
		this.breakUndoSequence();
		this.revealCursor();
	}

	protected moveCursorUp(select: boolean): void {
		const previous: Position = { row: this.cursorRow, column: this.cursorColumn };
		if (select) {
			this.ensureSelectionAnchor(previous);
		} else if (this.hasSelection()) {
			this.collapseSelectionTo('start');
			this.breakUndoSequence();
			return;
		}
		this.moveCursorVertical(-1);
		if (!select) {
			this.clearSelection();
		}
		this.breakUndoSequence();
		this.revealCursor();
	}

	protected moveCursorDown(select: boolean): void {
		const previous: Position = { row: this.cursorRow, column: this.cursorColumn };
		if (select) {
			this.ensureSelectionAnchor(previous);
		} else if (this.hasSelection()) {
			this.collapseSelectionTo('end');
			this.breakUndoSequence();
			return;
		}
		this.moveCursorVertical(1);
		if (!select) {
			this.clearSelection();
		}
		this.breakUndoSequence();
		this.revealCursor();
	}

	protected moveCursorHome(select: boolean): void {
		const previousOverride = this.getCursorVisualOverride(this.cursorRow, this.cursorColumn);
		this.clearCursorVisualOverride();
		const previous: Position = { row: this.cursorRow, column: this.cursorColumn };
		if (select) {
			this.ensureSelectionAnchor(previous);
		} else {
			this.clearSelection();
		}
		const ctrlDown = isModifierPressedGlobal(this.playerIndex, 'ControlLeft') || isModifierPressedGlobal(this.playerIndex, 'ControlRight');
		if (ctrlDown) {
			this.cursorRow = 0;
			this.cursorColumn = 0;
		} else {
			this.ensureVisualLines();
			const visualIndex = previousOverride?.visualIndex ?? this.positionToVisualIndex(this.cursorRow, this.cursorColumn);
			const segment = this.visualIndexToSegment(visualIndex);
			if (segment) {
				this.cursorRow = segment.row;
				const line = this.lines[segment.row] ?? '';
				this.cursorColumn = resolveIndentAwareHome(line, segment, this.cursorColumn);
				this.setCursorVisualOverride(segment.row, this.cursorColumn, visualIndex, segment.startColumn);
			} else {
				this.cursorColumn = 0;
			}
		}
		this.updateDesiredColumn();
		this.resetBlink();
		this.breakUndoSequence();
		this.revealCursor();
	}

	protected moveCursorEnd(select: boolean): void {
		const previousOverride = this.getCursorVisualOverride(this.cursorRow, this.cursorColumn);
		this.clearCursorVisualOverride();
		const previous: Position = { row: this.cursorRow, column: this.cursorColumn };
		if (select) {
			this.ensureSelectionAnchor(previous);
		} else {
			this.clearSelection();
		}
		const ctrlDown = isModifierPressedGlobal(this.playerIndex, 'ControlLeft') || isModifierPressedGlobal(this.playerIndex, 'ControlRight');
		if (ctrlDown) {
			const lastRow = this.lines.length - 1;
			if (lastRow < 0) {
				this.cursorRow = 0;
				this.cursorColumn = 0;
			} else {
				this.cursorRow = lastRow;
				this.cursorColumn = this.lines[lastRow].length;
			}
		} else {
			this.ensureVisualLines();
			const visualIndex = previousOverride?.visualIndex ?? this.positionToVisualIndex(this.cursorRow, this.cursorColumn);
			const segment = this.visualIndexToSegment(visualIndex);
			if (segment) {
				this.cursorRow = segment.row;
				const line = this.lines[segment.row] ?? '';
				this.cursorColumn = resolveSegmentEnd(line, segment);
				this.setCursorVisualOverride(segment.row, this.cursorColumn, visualIndex, segment.startColumn);
			} else {
				this.cursorColumn = this.currentLine().length;
			}
		}
		this.updateDesiredColumn();
		this.resetBlink();
		this.breakUndoSequence();
		this.revealCursor();
	}

	protected pageUp(select: boolean): void {
		const previous: Position = { row: this.cursorRow, column: this.cursorColumn };
		if (select) {
			this.ensureSelectionAnchor(previous);
		} else {
			this.clearSelection();
		}
		const rows = this.visibleRowCount();
		this.ensureVisualLines();
		const visualCount = this.getVisualLineCount();
		const currentVisual = this.positionToVisualIndex(this.cursorRow, this.cursorColumn);
		const targetVisual = clamp(currentVisual - rows, 0, Math.max(0, visualCount - 1));
		this.setCursorFromVisualIndex(targetVisual, this.desiredColumn, this.desiredDisplayOffset);
		this.resetBlink();
		this.breakUndoSequence();
		this.revealCursor();
	}

	protected pageDown(select: boolean): void {
		const previous: Position = { row: this.cursorRow, column: this.cursorColumn };
		if (select) {
			this.ensureSelectionAnchor(previous);
		} else {
			this.clearSelection();
		}
		const rows = this.visibleRowCount();
		this.ensureVisualLines();
		const visualCount = this.getVisualLineCount();
		const currentVisual = this.positionToVisualIndex(this.cursorRow, this.cursorColumn);
		const targetVisual = clamp(currentVisual + rows, 0, Math.max(0, visualCount - 1));
		this.setCursorFromVisualIndex(targetVisual, this.desiredColumn, this.desiredDisplayOffset);
		this.resetBlink();
		this.breakUndoSequence();
		this.revealCursor();
	}

	protected resetKeyPressGuards(): void {
		resetKeyPressRecords();
	}

	protected insertText(text: string): void {
		if (text.length === 0) {
			return;
		}
		const coalesce = text.length === 1;
		this.prepareUndo('insert-text', coalesce);
		if (this.deleteSelectionIfPresent()) {
			// Selection replaced.
		}
		const line = this.currentLine();
		const before = line.slice(0, this.cursorColumn);
		const after = line.slice(this.cursorColumn);
		this.lines[this.cursorRow] = before + text + after;
		this.invalidateLine(this.cursorRow);
		this.recordEditContext('insert', text);
		this.cursorColumn += text.length;
		this.markTextMutated();
		this.resetBlink();
		this.updateDesiredColumn();
		this.clearSelection();
		this.revealCursor();
	}

	protected insertLineBreak(): void {
		const sourceRow = this.cursorRow;
		this.prepareUndo('insert-line-break', false);
		this.deleteSelectionIfPresent();
		const line = this.currentLine();
		const before = line.slice(0, this.cursorColumn);
		const after = line.slice(this.cursorColumn);
		this.lines[sourceRow] = before;
		const indentation = this.extractIndentation(before);
		const newLine = indentation + after;
		this.lines.splice(sourceRow + 1, 0, newLine);
		this.invalidateLineRange(sourceRow, sourceRow + 1);
		this.invalidateHighlightsFromRow(sourceRow);
		this.cursorRow = sourceRow + 1;
		this.cursorColumn = indentation.length;
		this.recordEditContext('insert', '\n');
		this.markTextMutated();
		this.resetBlink();
		this.updateDesiredColumn();
		this.clearSelection();
		this.revealCursor();
	}

	protected extractIndentation(value: string): string {
		let result = '';
		for (let i = 0; i < value.length; i += 1) {
			const ch = value.charAt(i);
			if (ch === ' ' || ch === '\t') {
				result += ch;
			} else {
				break;
			}
		}
		return result;
	}

	protected backspace(): void {
		if (!this.hasSelection() && this.cursorColumn === 0 && this.cursorRow === 0) {
			return;
		}
		this.prepareUndo('backspace', true);
		if (this.deleteSelectionIfPresent()) {
			return;
		}
		if (this.cursorColumn > 0) {
			const line = this.currentLine();
			const removedChar = line.charAt(this.cursorColumn - 1);
			const before = line.slice(0, this.cursorColumn - 1);
			const after = line.slice(this.cursorColumn);
			this.lines[this.cursorRow] = before + after;
			this.invalidateLine(this.cursorRow);
			this.cursorColumn -= 1;
			this.recordEditContext('delete', removedChar);
			this.markTextMutated();
			this.resetBlink();
			this.updateDesiredColumn();
			this.revealCursor();
			return;
		}
		if (this.cursorRow === 0) {
			return;
		}
		const mergedRow = this.cursorRow - 1;
		const previousLine = this.lines[mergedRow];
		const currentLine = this.currentLine();
		this.recordEditContext('delete', '\n');
		this.lines[mergedRow] = previousLine + currentLine;
		this.lines.splice(this.cursorRow, 1);
		this.invalidateLine(mergedRow);
		this.invalidateHighlightsFromRow(mergedRow);
		this.cursorRow = mergedRow;
		this.cursorColumn = previousLine.length;
		this.markTextMutated();
		this.resetBlink();
		this.updateDesiredColumn();
		this.revealCursor();
	}

	protected deleteForward(): void {
		if (!this.hasSelection() && this.cursorColumn >= this.currentLine().length && this.cursorRow >= this.lines.length - 1) {
			return;
		}
		this.prepareUndo('delete-forward', true);
		if (this.deleteSelectionIfPresent()) {
			return;
		}
		const line = this.currentLine();
		if (this.cursorColumn < line.length) {
			const removedChar = line.charAt(this.cursorColumn);
			const before = line.slice(0, this.cursorColumn);
			const after = line.slice(this.cursorColumn + 1);
			this.lines[this.cursorRow] = before + after;
			this.invalidateLine(this.cursorRow);
			this.recordEditContext('delete', removedChar);
			this.markTextMutated();
			this.resetBlink();
			this.updateDesiredColumn();
			this.revealCursor();
			return;
		}
		if (this.cursorRow >= this.lines.length - 1) {
			return;
		}
		const nextLine = this.lines[this.cursorRow + 1];
		const updatedLine = line + nextLine;
		this.lines[this.cursorRow] = updatedLine;
		this.lines.splice(this.cursorRow + 1, 1);
		this.invalidateLine(this.cursorRow);
		this.invalidateHighlightsFromRow(this.cursorRow);
		this.recordEditContext('delete', '\n');
		this.markTextMutated();
		this.resetBlink();
		this.updateDesiredColumn();
		this.revealCursor();
	}

	protected deleteWordBackward(): void {
		if (!this.hasSelection() && this.cursorColumn === 0 && this.cursorRow === 0) {
			return;
		}
		this.prepareUndo('delete-word-backward', false);
		if (this.deleteSelectionIfPresent()) {
			return;
		}
		const target = this.findWordLeft(this.cursorRow, this.cursorColumn);
		if (target.row === this.cursorRow && target.column === this.cursorColumn) {
			this.backspace();
			return;
		}
		const startRow = target.row;
		const startColumn = target.column;
		const endRow = this.cursorRow;
		const endColumn = this.cursorColumn;
		if (startRow === endRow) {
			const line = this.lines[startRow];
			const removed = line.slice(startColumn, endColumn);
			this.lines[startRow] = line.slice(0, startColumn) + line.slice(endColumn);
			this.cursorColumn = startColumn;
			this.invalidateLine(startRow);
			this.recordEditContext('delete', removed);
			this.markTextMutated();
			this.resetBlink();
			this.updateDesiredColumn();
			this.revealCursor();
			return;
		}
		const firstLine = this.lines[startRow];
		const lastLine = this.lines[endRow];
		const removedParts: string[] = [];
		removedParts.push(firstLine.slice(startColumn));
		for (let row = startRow + 1; row < endRow; row += 1) {
			removedParts.push(this.lines[row]);
		}
		removedParts.push(lastLine.slice(0, endColumn));
		this.lines[startRow] = firstLine.slice(0, startColumn) + lastLine.slice(endColumn);
		this.lines.splice(startRow + 1, endRow - startRow);
		this.cursorRow = startRow;
		this.cursorColumn = startColumn;
		this.invalidateLine(startRow);
		this.invalidateHighlightsFromRow(startRow);
		this.recordEditContext('delete', removedParts.join('\n'));
		this.markTextMutated();
		this.resetBlink();
		this.updateDesiredColumn();
		this.revealCursor();
	}

	protected deleteWordForward(): void {
		if (!this.hasSelection() && this.cursorRow >= this.lines.length - 1 && this.cursorColumn >= this.currentLine().length) {
			return;
		}
		this.prepareUndo('delete-word-forward', false);
		if (this.deleteSelectionIfPresent()) {
			return;
		}
		const destination = this.findWordRight(this.cursorRow, this.cursorColumn);
		if (destination.row === this.cursorRow && destination.column === this.cursorColumn) {
			this.deleteForward();
			return;
		}
		const startRow = this.cursorRow;
		const startColumn = this.cursorColumn;
		const endRow = destination.row;
		const endColumn = destination.column;
		if (startRow === endRow) {
			const line = this.lines[startRow];
			const removed = line.slice(startColumn, endColumn);
			this.lines[startRow] = line.slice(0, startColumn) + line.slice(endColumn);
			this.invalidateLine(startRow);
			this.recordEditContext('delete', removed);
		} else {
			const firstLine = this.lines[startRow];
			const lastLine = this.lines[endRow];
			const removedParts: string[] = [];
			removedParts.push(firstLine.slice(startColumn));
			for (let row = startRow + 1; row < endRow; row += 1) {
				removedParts.push(this.lines[row]);
			}
			removedParts.push(lastLine.slice(0, endColumn));
			this.lines[startRow] = firstLine.slice(0, startColumn) + lastLine.slice(endColumn);
			this.lines.splice(startRow + 1, endRow - startRow);
			this.invalidateLine(startRow);
			this.invalidateHighlightsFromRow(startRow);
			this.recordEditContext('delete', removedParts.join('\n'));
		}
		this.cursorRow = startRow;
		this.cursorColumn = startColumn;
		this.markTextMutated();
		this.resetBlink();
		this.updateDesiredColumn();
		this.revealCursor();
	}

	protected deleteActiveLines(): void {
		if (this.lines.length === 0) {
			return;
		}
		this.prepareUndo('delete-active-lines', false);
		const range = this.getSelectionRange();
		if (!range) {
			const removedRow = this.cursorRow;
			this.lines.splice(removedRow, 1);
			if (this.lines.length === 0) {
				this.lines = [''];
				this.cursorRow = 0;
				this.cursorColumn = 0;
			} else if (this.cursorRow >= this.lines.length) {
				this.cursorRow = this.lines.length - 1;
				this.cursorColumn = this.lines[this.cursorRow].length;
			} else {
				const line = this.lines[this.cursorRow];
				this.cursorColumn = Math.min(this.cursorColumn, line.length);
			}
			this.invalidateLine(this.cursorRow);
			this.invalidateHighlightsFromRow(Math.min(removedRow, this.lines.length - 1));
			this.recordEditContext('delete', '\n');
			this.markTextMutated();
			this.resetBlink();
			this.updateDesiredColumn();
			this.revealCursor();
			return;
		}
		const { start, end } = range;
		const deletionStart = start.row;
		let deletionEnd = end.row;
		if (end.column === 0 && end.row > start.row) {
			deletionEnd -= 1;
		}
		const count = deletionEnd - deletionStart + 1;
		const deletedLines = this.lines.slice(deletionStart, deletionStart + count);
			this.lines.splice(deletionStart, count);
			if (this.lines.length === 0) {
				this.lines = [''];
			}
			this.cursorRow = clamp(deletionStart, 0, this.lines.length - 1);
			this.cursorColumn = 0;
			this.selectionAnchor = null;
			this.invalidateLine(this.cursorRow);
			this.invalidateHighlightsFromRow(deletionStart);
		this.recordEditContext('delete', deletedLines.join('\n'));
		this.markTextMutated();
		this.resetBlink();
		this.updateDesiredColumn();
		this.revealCursor();
	}

	protected moveSelectionLines(delta: number): void {
		if (delta === 0) {
			return;
		}
		const range = this.getLineRangeForMovement();
		if (delta < 0 && range.startRow === 0) {
			return;
		}
		if (delta > 0 && range.endRow >= this.lines.length - 1) {
			return;
		}
		this.prepareUndo('move-lines', false);
		const count = range.endRow - range.startRow + 1;
		const block = this.lines.splice(range.startRow, count);
		const targetIndex = range.startRow + delta;
		this.lines.splice(targetIndex, 0, ...block);
		const affectedStart = Math.max(0, Math.min(range.startRow, targetIndex));
		const affectedEnd = Math.min(this.lines.length - 1, Math.max(range.endRow, targetIndex + count - 1));
		if (affectedStart <= affectedEnd) {
			for (let row = affectedStart; row <= affectedEnd; row += 1) {
				this.invalidateLine(row);
			}
		}
		this.invalidateHighlightsFromRow(affectedStart);
		this.cursorRow += delta;
		if (this.selectionAnchor) {
			this.selectionAnchor = { row: this.selectionAnchor.row + delta, column: this.selectionAnchor.column };
		}
		this.clampCursorColumn();
		this.markTextMutated();
		this.resetBlink();
		this.updateDesiredColumn();
		this.revealCursor();
	}

	protected getLineRangeForMovement(): { startRow: number; endRow: number } {
		const range = this.getSelectionRange();
		if (!range) {
			return { startRow: this.cursorRow, endRow: this.cursorRow };
		}
		let endRow = range.end.row;
		if (range.end.column === 0 && endRow > range.start.row) {
			endRow -= 1;
		}
		return { startRow: range.start.row, endRow };
	}

	protected indentSelectionOrLine(): void {
		this.prepareUndo('indent', false);
		const range = this.getSelectionRange();
		if (!range) {
			const line = this.currentLine();
			this.lines[this.cursorRow] = '\t' + line;
			this.cursorColumn += 1;
			this.invalidateLine(this.cursorRow);
			this.recordEditContext('insert', '\t');
			this.markTextMutated();
			this.resetBlink();
			this.updateDesiredColumn();
			this.revealCursor();
			return;
		}
		for (let row = range.start.row; row <= range.end.row; row += 1) {
			this.lines[row] = '\t' + this.lines[row];
			this.invalidateLine(row);
		}
		if (this.selectionAnchor) {
			this.selectionAnchor = { row: this.selectionAnchor.row, column: this.selectionAnchor.column + 1 };
		}
		this.cursorColumn += 1;
		this.recordEditContext('insert', '\t');
		this.markTextMutated();
		this.resetBlink();
		this.updateDesiredColumn();
		this.revealCursor();
	}

	protected unindentSelectionOrLine(): void {
		this.prepareUndo('unindent', false);
		const range = this.getSelectionRange();
		if (!range) {
			const line = this.currentLine();
			const indentation = this.countLeadingIndent(line);
			if (indentation === 0) {
				return;
			}
			const remove = Math.min(indentation, 1);
			this.lines[this.cursorRow] = line.slice(remove);
			this.cursorColumn = Math.max(0, this.cursorColumn - remove);
			this.invalidateLine(this.cursorRow);
			this.recordEditContext('delete', line.slice(0, remove));
			this.markTextMutated();
			this.resetBlink();
			this.updateDesiredColumn();
			this.revealCursor();
			return;
		}
		for (let row = range.start.row; row <= range.end.row; row += 1) {
			const line = this.lines[row];
			const indentation = this.countLeadingIndent(line);
			if (indentation > 0) {
				this.lines[row] = line.slice(1);
				this.invalidateLine(row);
			}
		}
		if (this.selectionAnchor) {
			this.selectionAnchor = { row: this.selectionAnchor.row, column: Math.max(0, this.selectionAnchor.column - 1) };
		}
		this.cursorColumn = Math.max(0, this.cursorColumn - 1);
		this.recordEditContext('delete', '\t');
		this.markTextMutated();
		this.resetBlink();
		this.updateDesiredColumn();
		this.revealCursor();
	}

	private countLeadingIndent(line: string): number {
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

	protected deleteSelection(): void {
		if (!this.hasSelection()) {
			return;
		}
		this.prepareUndo('delete-selection', false);
		this.replaceSelectionWith('');
	}

	protected deleteSelectionIfPresent(): boolean {
		if (!this.hasSelection()) {
			return false;
		}
		this.replaceSelectionWith('');
		return true;
	}

	protected replaceSelectionWith(text: string): void {
		const range = this.getSelectionRange();
		if (!range) {
			return;
		}
		this.recordEditContext(text.length === 0 ? 'delete' : 'replace', text);
		const { start, end } = range;
		const startLine = this.lines[start.row];
		const endLine = this.lines[end.row];
		const leading = startLine.slice(0, start.column);
		const trailing = endLine.slice(end.column);
		const fragments = text.split('\n');
		if (fragments.length === 1) {
			const combined = leading + fragments[0] + trailing;
			this.lines.splice(start.row, end.row - start.row + 1, combined);
			this.cursorRow = start.row;
			this.cursorColumn = leading.length + fragments[0].length;
		} else {
			const firstLine = leading + fragments[0];
			const lastFragment = fragments[fragments.length - 1];
			const lastLine = lastFragment + trailing;
			const middle = fragments.slice(1, -1);
			this.lines.splice(start.row, end.row - start.row + 1, firstLine, ...middle, lastLine);
			this.cursorRow = start.row + fragments.length - 1;
			this.cursorColumn = lastFragment.length;
		}
		this.invalidateLineRange(start.row, start.row + fragments.length - 1);
		this.invalidateHighlightsFromRow(start.row);
		this.selectionAnchor = null;
		this.markTextMutated();
		this.resetBlink();
		this.updateDesiredColumn();
		this.revealCursor();
	}

	protected selectWordAtPosition(row: number, column: number): void {
		if (row < 0 || row >= this.lines.length) {
			return;
		}
		const line = this.lines[row];
		if (line.length === 0) {
			this.selectionAnchor = null;
			this.cursorRow = row;
			this.cursorColumn = 0;
			this.updateDesiredColumn();
			this.resetBlink();
			this.revealCursor();
			return;
		}
		let index = column;
		if (index >= line.length) {
			index = line.length - 1;
		}
		if (index < 0) {
			index = 0;
		}
		let start = index;
		let end = index + 1;
		const current = line.charAt(index);
		if (isWordChar(current)) {
			while (start > 0 && isWordChar(line.charAt(start - 1))) {
				start -= 1;
			}
			while (end < line.length && isWordChar(line.charAt(end))) {
				end += 1;
			}
		} else if (isWhitespace(current)) {
			while (start > 0 && isWhitespace(line.charAt(start - 1))) {
				start -= 1;
			}
			while (end < line.length && isWhitespace(line.charAt(end))) {
				end += 1;
			}
		} else {
			while (start > 0) {
				const previous = line.charAt(start - 1);
				if (isWordChar(previous) || isWhitespace(previous)) {
					break;
				}
				start -= 1;
			}
			while (end < line.length) {
				const next = line.charAt(end);
				if (isWordChar(next) || isWhitespace(next)) {
					break;
				}
				end += 1;
			}
		}
		if (end < start) {
			end = start;
		}
		this.selectionAnchor = { row, column: start };
		this.cursorRow = row;
		this.cursorColumn = end;
		this.updateDesiredColumn();
		this.resetBlink();
		this.revealCursor();
	}

	protected getSelectionText(): string | null {
		const range = this.getSelectionRange();
		if (!range) {
			return null;
		}
		const { start, end } = range;
		if (start.row === end.row) {
			return this.lines[start.row].slice(start.column, end.column);
		}
		const parts: string[] = [];
		parts.push(this.lines[start.row].slice(start.column));
		for (let row = start.row + 1; row < end.row; row += 1) {
			parts.push(this.lines[row]);
		}
		parts.push(this.lines[end.row].slice(0, end.column));
		return parts.join('\n');
	}

	protected insertClipboardText(text: string): void {
		const normalized = text.replace(/\r\n/g, '\n').replace(/\r/g, '\n');
		const fragments = normalized.split('\n');
		const currentLine = this.currentLine();
		const before = currentLine.slice(0, this.cursorColumn);
		const after = currentLine.slice(this.cursorColumn);
		if (fragments.length === 1) {
			const fragment = fragments[0];
			this.lines[this.cursorRow] = before + fragment + after;
			this.invalidateLine(this.cursorRow);
			this.cursorColumn = before.length + fragment.length;
			this.recordEditContext('insert', fragment);
		} else {
			const firstLine = before + fragments[0];
			const lastIndex = fragments.length - 1;
			const lastFragment = fragments[lastIndex];
			const newLines: string[] = [];
			newLines.push(firstLine);
			for (let i = 1; i < lastIndex; i += 1) {
				newLines.push(fragments[i]);
			}
			newLines.push(lastFragment + after);
			const insertionRow = this.cursorRow;
			this.lines.splice(insertionRow, 1, ...newLines);
			this.invalidateLineRange(insertionRow, insertionRow + newLines.length - 1);
			this.invalidateHighlightsFromRow(insertionRow);
			this.cursorRow = insertionRow + lastIndex;
			this.cursorColumn = lastFragment.length;
			this.recordEditContext('insert', normalized);
		}
		this.markTextMutated();
		this.resetBlink();
		this.updateDesiredColumn();
		this.revealCursor();
	}

	protected ensureSelectionAnchor(anchor: Position): void {
		if (!this.selectionAnchor) {
			this.selectionAnchor = { row: anchor.row, column: anchor.column };
		}
	}

	protected clearSelection(): void {
		this.selectionAnchor = null;
	}

	protected hasSelection(): boolean {
		return this.getSelectionRange() !== null;
	}

	protected comparePositions(a: Position, b: Position): number {
		if (a.row !== b.row) {
			return a.row - b.row;
		}
		return a.column - b.column;
	}

	protected getSelectionRange(): { start: Position; end: Position } | null {
		const anchor = this.selectionAnchor;
		if (!anchor) {
			return null;
		}
		const cursor: Position = { row: this.cursorRow, column: this.cursorColumn };
		if (anchor.row === cursor.row && anchor.column === cursor.column) {
			return null;
		}
		if (this.comparePositions(cursor, anchor) < 0) {
			return { start: cursor, end: anchor };
		}
		return { start: anchor, end: cursor };
	}

	protected collapseSelectionTo(target: 'start' | 'end'): void {
		const range = this.getSelectionRange();
		if (!range) {
			return;
		}
		const destination = target === 'start' ? range.start : range.end;
		this.cursorRow = destination.row;
		this.cursorColumn = destination.column;
		this.selectionAnchor = null;
		this.updateDesiredColumn();
		this.resetBlink();
		this.revealCursor();
	}

	protected stepLeft(row: number, column: number): { row: number; column: number } | null {
		if (column > 0) {
			return { row, column: column - 1 };
		}
		if (row > 0) {
			return { row: row - 1, column: this.lines[row - 1].length };
		}
		return null;
	}

	protected stepRight(row: number, column: number): { row: number; column: number } | null {
		const length = this.lines[row].length;
		if (column < length) {
			return { row, column: column + 1 };
		}
		if (row < this.lines.length - 1) {
			return { row: row + 1, column: 0 };
		}
		return null;
	}

	protected charAt(row: number, column: number): string {
		if (row < 0 || row >= this.lines.length) {
			return '';
		}
		const line = this.lines[row];
		if (column < 0 || column >= line.length) {
			return '';
		}
		return line.charAt(column);
	}

	protected currentLine(): string {
		if (this.cursorRow < 0 || this.cursorRow >= this.lines.length) {
			return '';
		}
		return this.lines[this.cursorRow];
	}

	protected clampCursorRow(): void {
		if (this.cursorRow < 0) {
			this.cursorRow = 0;
		} else if (this.cursorRow >= this.lines.length) {
			this.cursorRow = this.lines.length - 1;
		}
	}

	protected clampCursorColumn(): void {
		const line = this.currentLine();
		if (this.cursorColumn < 0) {
			this.cursorColumn = 0;
			return;
		}
		const length = line.length;
		if (this.cursorColumn > length) {
			this.cursorColumn = length;
		}
	}

	protected clampSelectionPosition(position: Position | null): Position | null {
		if (!position || this.lines.length === 0) {
			return null;
		}
		let row = position.row;
		if (row < 0) {
			row = 0;
		} else if (row >= this.lines.length) {
			row = this.lines.length - 1;
		}
		const line = this.lines[row] ?? '';
		let column = position.column;
		if (column < 0) {
			column = 0;
		} else if (column > line.length) {
			column = line.length;
		}
		return { row, column };
	}

	protected prepareUndo(key: string, allowMerge: boolean): void {
		const now = Date.now();
		const shouldMerge = allowMerge
			&& this.lastHistoryKey === key
			&& now - this.lastHistoryTimestamp <= constants.UNDO_COALESCE_INTERVAL_MS;
		if (shouldMerge) {
			this.lastHistoryTimestamp = now;
			return;
		}
		const snapshot = this.captureSnapshot();
		if (this.undoStack.length >= constants.UNDO_HISTORY_LIMIT) {
			this.undoStack.shift();
		}
		this.undoStack.push(snapshot);
		this.redoStack.length = 0;
		this.lastHistoryTimestamp = now;
		if (allowMerge) {
			this.lastHistoryKey = key;
		} else {
			this.lastHistoryKey = null;
		}
	}

	protected undo(): void {
		if (this.undoStack.length === 0) {
			return;
		}
		const snapshot = this.undoStack.pop();
		if (!snapshot) {
			return;
		}
		const current = this.captureSnapshot();
		if (this.redoStack.length >= constants.UNDO_HISTORY_LIMIT) {
			this.redoStack.shift();
		}
		this.redoStack.push(current);
		this.restoreSnapshot(snapshot, true);
		this.breakUndoSequence();
	}

	protected redo(): void {
		if (this.redoStack.length === 0) {
			return;
		}
		const snapshot = this.redoStack.pop();
		if (!snapshot) {
			return;
		}
		const current = this.captureSnapshot();
		if (this.undoStack.length >= constants.UNDO_HISTORY_LIMIT) {
			this.undoStack.shift();
		}
		this.undoStack.push(current);
		this.restoreSnapshot(snapshot, true);
		this.breakUndoSequence();
	}

	protected breakUndoSequence(): void {
		this.lastHistoryKey = null;
		this.lastHistoryTimestamp = 0;
	}

	protected extractIdentifierAt(row: number, column: number): string | null {
		if (row < 0 || row >= this.lines.length) {
			return null;
		}
		const line = this.lines[row];
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

	protected clampScrollRow(): void {
		this.ensureVisualLines();
		const rows = this.visibleRowCount();
		const totalVisual = this.getVisualLineCount();
		const cursorVisualIndex = this.positionToVisualIndex(this.cursorRow, this.cursorColumn);
		if (cursorVisualIndex < this.scrollRow) {
			this.scrollRow = cursorVisualIndex;
		}
		if (cursorVisualIndex >= this.scrollRow + rows) {
			this.scrollRow = cursorVisualIndex - rows + 1;
		}
		const maxScrollRow = Math.max(0, totalVisual - rows);
		this.scrollRow = clamp(this.scrollRow, 0, maxScrollRow);
	}

	protected clampScrollColumn(): void {
		if (this.wordWrapEnabled) {
			this.scrollColumn = 0;
			return;
		}
		const columns = this.visibleColumnCount();
		if (this.cursorColumn < this.scrollColumn) {
			this.scrollColumn = this.cursorColumn;
		}
		const maxScrollColumn = this.cursorColumn - columns + 1;
		if (maxScrollColumn > this.scrollColumn) {
			this.scrollColumn = maxScrollColumn;
		}
		if (this.scrollColumn < 0) {
			this.scrollColumn = 0;
		}
		const lineLength = this.currentLine().length;
		const maxColumn = lineLength - columns;
		if (maxColumn < 0) {
			this.scrollColumn = 0;
		} else if (this.scrollColumn > maxColumn) {
			this.scrollColumn = maxColumn;
		}
	}
}
