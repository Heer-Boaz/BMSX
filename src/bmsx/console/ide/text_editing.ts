export function addLineComments(range?: { startRow: number; endRow: number }

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

export function currentLine(): string {
	if (ide_state.cursorRow < 0 || ide_state.cursorRow >= ide_state.lines.length) {
		return '';
	}
	return ide_state.lines[ide_state.cursorRow];
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

export function deleteCharLeft(): void {
	backspace();
}

export function deleteCharRight(): void {
	deleteForward();
}

export function deleteSelection(): void {
	if (!hasSelection()) {
		return;
	}
	prepareUndo('delete-selection', false);
	replaceSelectionWith('');
}

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

export function firstNonWhitespaceIndex(value: string): number {
	for (let index = 0; index < value.length; index++) {
		const ch = value.charAt(index);
		if (ch !== ' ' && ch !== '\t') {
			return index;
		}
	}
	return value.length;
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

export function insertNewline(): void {
	insertLineBreak();
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

export function removeLineComments(range?: { startRow: number; endRow: number }

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

export function toggleLineComments(): void {
	if (!isEditableCodeTab()) {
		notifyReadOnlyEdit();
		return;
	}
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
