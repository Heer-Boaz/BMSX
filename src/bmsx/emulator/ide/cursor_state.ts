import type { Position } from './types';

export type MutableSingleCursorState = {
	cursorRow: number;
	cursorColumn: number;
	selectionAnchor?: Position;
	selectionAnchorScratch: Position;
	desiredColumn?: number;
};

export type CursorSelectionRange = {
	start: Position;
	end: Position;
};

const selectionRangeScratch: CursorSelectionRange = {
	start: { row: 0, column: 0 },
	end: { row: 0, column: 0 },
};

export function comparePositions(a: Position, b: Position): number {
	if (a.row !== b.row) {
		return a.row - b.row;
	}
	return a.column - b.column;
}

function compareRowColumns(aRow: number, aColumn: number, bRow: number, bColumn: number): number {
	if (aRow !== bRow) {
		return aRow - bRow;
	}
	return aColumn - bColumn;
}

export function clearSingleCursorSelection(state: MutableSingleCursorState): void {
	state.selectionAnchor = null;
}

export function setSingleCursorSelectionAnchor(state: MutableSingleCursorState, row: number, column: number): void {
	const anchor = state.selectionAnchor ?? state.selectionAnchorScratch;
	anchor.row = row;
	anchor.column = column;
	state.selectionAnchor = anchor;
}

export function ensureSingleCursorSelectionAnchor(state: MutableSingleCursorState, row: number, column: number): void {
	if (!state.selectionAnchor) {
		const anchor = state.selectionAnchorScratch;
		anchor.row = row;
		anchor.column = column;
		state.selectionAnchor = anchor;
	}
}

export function setSingleCursorPosition(state: MutableSingleCursorState, row: number, column: number): void {
	state.cursorRow = row;
	state.cursorColumn = column;
	state.desiredColumn = column;
}

export function moveSingleCursor(state: MutableSingleCursorState, row: number, column: number, extendSelection: boolean): void {
	if (extendSelection) {
		ensureSingleCursorSelectionAnchor(state, state.cursorRow, state.cursorColumn);
	} else {
		clearSingleCursorSelection(state);
	}
	setSingleCursorPosition(state, row, column);
}

export function selectAllSingleCursor(state: MutableSingleCursorState, lastRow: number, lastColumn: number): void {
	setSingleCursorSelectionAnchor(state, 0, 0);
	setSingleCursorPosition(state, lastRow, lastColumn);
}

export function getSingleCursorSelectionRange(state: MutableSingleCursorState, out: CursorSelectionRange = selectionRangeScratch): CursorSelectionRange {
	const anchor = state.selectionAnchor;
	if (!anchor) {
		return null;
	}
	const cursorRow = state.cursorRow;
	const cursorColumn = state.cursorColumn;
	if (anchor.row === cursorRow && anchor.column === cursorColumn) {
		return null;
	}
	const start = out.start;
	const end = out.end;
	if (compareRowColumns(cursorRow, cursorColumn, anchor.row, anchor.column) < 0) {
		start.row = cursorRow;
		start.column = cursorColumn;
		end.row = anchor.row;
		end.column = anchor.column;
		return out;
	}
	start.row = anchor.row;
	start.column = anchor.column;
	end.row = cursorRow;
	end.column = cursorColumn;
	return out;
}

export function collapseSingleCursorSelection(state: MutableSingleCursorState, target: 'start' | 'end'): boolean {
	const range = getSingleCursorSelectionRange(state);
	if (!range) {
		return false;
	}
	const destination = target === 'start' ? range.start : range.end;
	setSingleCursorPosition(state, destination.row, destination.column);
	clearSingleCursorSelection(state);
	return true;
}
