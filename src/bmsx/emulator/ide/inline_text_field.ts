import { $ } from '../../core/engine_core';
import { CHARACTER_CODES, CHARACTER_MAP } from './character_map';
import * as constants from './constants';
import { ide_state } from './ide_state';
import { consumeIdeKey, isAltDown, isCtrlDown, isKeyJustPressed, isMetaDown, isShiftDown, shouldRepeatKeyFromPlayer } from './ide_input';
import type { InlineInputOptions, Position, TextField } from './types';
import { clamp } from '../../utils/clamp';
import { LuaLexer } from '../../lua/syntax/lualexer';
import { splitText, textFromLines } from './text/source_text';

export type InlineFieldMetrics = {
	measureText: (text: string) => number;
	advanceChar: (ch: string) => number;
	spaceAdvance: number;
	tabSpaces: number;
};

const positionToOffset = (lines: string[], position: Position): number => {
	let offset = 0;
	for (let row = 0; row < position.row; row += 1) {
		offset += lines[row].length + 1;
	}
	return offset + position.column;
};

const offsetToPosition = (lines: string[], offset: number): Position => {
	let remaining = Math.max(0, offset);
	for (let row = 0; row < lines.length; row += 1) {
		const line = lines[row];
		const lineLength = line.length;
		if (remaining <= lineLength) {
			return { row, column: remaining };
		}
		remaining -= lineLength;
		if (remaining === 0) {
			return { row, column: lineLength };
		}
		remaining -= 1; // newline
	}
	const lastRow = Math.max(0, lines.length - 1);
	return { row: lastRow, column: lines[lastRow]?.length ?? 0 };
};

const clampRowColumn = (field: TextField, row: number, column: number): Position => {
	const clampedRow = clamp(row, 0, field.lines.length - 1);
	const line = field.lines[clampedRow] ?? '';
	const clampedColumn = clamp(column, 0, line.length);
	return { row: clampedRow, column: clampedColumn };
};

const applyTextUpdate = (field: TextField, nextText: string, nextCursorOffset: number): void => {
	const lines = splitText(nextText);
	field.lines = lines;
	const cursor = offsetToPosition(lines, nextCursorOffset);
	field.cursorRow = cursor.row;
	field.cursorColumn = cursor.column;
	field.desiredColumn = field.cursorColumn;
	field.selectionAnchor = null;
};

const cursorOffset = (field: TextField): number => positionToOffset(field.lines, { row: field.cursorRow, column: field.cursorColumn });

const totalLength = (field: TextField): number => {
	let length = 0;
	for (let row = 0; row < field.lines.length; row += 1) {
		length += field.lines[row].length;
		if (row < field.lines.length - 1) {
			length += 1;
		}
	}
	return length;
};

const fieldText = (field: TextField): string => textFromLines(field.lines);

export function createInlineTextField(): TextField {
	return {
		lines: [''],
		cursorRow: 0,
		cursorColumn: 0,
		selectionAnchor: null,
		desiredColumn: 0,
		pointerSelecting: false,
		lastPointerClickTimeMs: 0,
		lastPointerClickColumn: -1,
	};
}

export function getFieldText(field: TextField): string {
	return fieldText(field);
}

export function getCursorOffset(field: TextField): number {
	return cursorOffset(field);
}

export function setCursorFromOffset(field: TextField, offset: number): void {
	const length = totalLength(field);
	const clamped = clamp(offset, 0, length);
	const next = offsetToPosition(field.lines, clamped);
	field.cursorRow = next.row;
	field.cursorColumn = next.column;
	field.desiredColumn = field.cursorColumn;
}

export function selectionAnchorOffset(field: TextField): number {
	if (!field.selectionAnchor) {
		return null;
	}
	return positionToOffset(field.lines, field.selectionAnchor);
}

export function setSelectionAnchorFromOffset(field: TextField, offset: number): void {
	if (offset === null) {
		field.selectionAnchor = null;
		return;
	}
	const length = totalLength(field);
	const clamped = clamp(offset, 0, length);
	field.selectionAnchor = offsetToPosition(field.lines, clamped);
}

export function clampCursor(field: TextField): void {
	const { row, column } = clampRowColumn(field, field.cursorRow, field.cursorColumn);
	field.cursorRow = row;
	field.cursorColumn = column;
}

export function selectionRange(field: TextField): { start: number; end: number } {
	const anchor = field.selectionAnchor;
	if (!anchor) {
		return null;
	}
	const cursor: Position = { row: field.cursorRow, column: field.cursorColumn };
	if (anchor.row === cursor.row && anchor.column === cursor.column) {
		return null;
	}
	const start = positionToOffset(field.lines, anchor);
	const end = positionToOffset(field.lines, cursor);
	if (start < end) {
		return { start, end };
	}
	return { start: end, end: start };
}

export function clampSelectionAnchor(field: TextField): void {
	const anchor = field.selectionAnchor;
	if (!anchor) return;
	const clamped = clampRowColumn(field, anchor.row, anchor.column);
	field.selectionAnchor = clamped;
}

export function deleteSelection(field: TextField): boolean {
	const range = selectionRange(field);
	if (!range) {
		return false;
	}
	const text = fieldText(field);
	const nextText = text.slice(0, range.start) + text.slice(range.end);
	applyTextUpdate(field, nextText, range.start);
	return true;
}

export function selectionLength(field: TextField): number {
	const range = selectionRange(field);
	if (!range) {
		return 0;
	}
	return range.end - range.start;
}

export function insertValue(field: TextField, value: string): boolean {
	if (value.length === 0) {
		return false;
	}
	if (deleteSelection(field)) {
		// selection already removed, cursor updated
		// TODO: Why is the if-statement then still here?
	}
	const text = fieldText(field);
	const offset = cursorOffset(field);
	const nextText = text.slice(0, offset) + value + text.slice(offset);
	const nextCursor = offset + value.length;
	applyTextUpdate(field, nextText, nextCursor);
	return true;
}

export function backspace(field: TextField): boolean {
	if (deleteSelection(field)) {
		return true;
	}
	const offset = cursorOffset(field);
	if (offset === 0) {
		return false;
	}
	const text = fieldText(field);
	const nextText = text.slice(0, offset - 1) + text.slice(offset);
	applyTextUpdate(field, nextText, offset - 1);
	return true;
}

export function deleteForward(field: TextField): boolean {
	if (deleteSelection(field)) {
		return true;
	}
	const text = fieldText(field);
	const offset = cursorOffset(field);
	if (offset >= text.length) {
		return false;
	}
	const nextText = text.slice(0, offset) + text.slice(offset + 1);
	applyTextUpdate(field, nextText, offset);
	return true;
}

export function deleteWordBackward(field: TextField): boolean {
	if (deleteSelection(field)) {
		return true;
	}
	const text = fieldText(field);
	const offset = cursorOffset(field);
	if (offset === 0) {
		return false;
	}
	let index = offset;
	while (index > 0 && LuaLexer.isWhitespace(text.charAt(index - 1))) {
		index -= 1;
	}
	while (index > 0 && !LuaLexer.isWhitespace(text.charAt(index - 1)) && !LuaLexer.isIdentifierPart(text.charAt(index - 1))) {
		index -= 1;
	}
	while (index > 0 && LuaLexer.isIdentifierPart(text.charAt(index - 1))) {
		index -= 1;
	}
	if (index === offset) {
		return false;
	}
	const nextText = text.slice(0, index) + text.slice(offset);
	applyTextUpdate(field, nextText, index);
	return true;
}

export function deleteWordForward(field: TextField): boolean {
	if (deleteSelection(field)) {
		return true;
	}
	const text = fieldText(field);
	const offset = cursorOffset(field);
	if (offset >= text.length) {
		return false;
	}
	let index = offset;
	while (index < text.length && LuaLexer.isWhitespace(text.charAt(index))) {
		index += 1;
	}
	while (index < text.length && !LuaLexer.isWhitespace(text.charAt(index)) && !LuaLexer.isIdentifierPart(text.charAt(index))) {
		index += 1;
	}
	while (index < text.length && LuaLexer.isIdentifierPart(text.charAt(index))) {
		index += 1;
	}
	if (index === offset) {
		return false;
	}
	const nextText = text.slice(0, offset) + text.slice(index);
	applyTextUpdate(field, nextText, offset);
	return true;
}

export function moveCursor(field: TextField, row: number, column: number, extendSelection: boolean): void {
	const clamped = clampRowColumn(field, row, column);
	if (extendSelection) {
		if (!field.selectionAnchor) {
			field.selectionAnchor = { row: field.cursorRow, column: field.cursorColumn };
		}
	} else {
		field.selectionAnchor = null;
	}
	field.cursorRow = clamped.row;
	field.cursorColumn = clamped.column;
	field.desiredColumn = field.cursorColumn;
}

export function moveCursorRelative(field: TextField, delta: number, extendSelection: boolean): void {
	const offset = cursorOffset(field);
	const length = totalLength(field);
	const nextOffset = clamp(offset + delta, 0, length);
	const nextPosition = offsetToPosition(field.lines, nextOffset);
	moveCursor(field, nextPosition.row, nextPosition.column, extendSelection);
}

export function moveWordLeft(field: TextField, extendSelection: boolean): void {
	const text = fieldText(field);
	const offset = cursorOffset(field);
	if (offset === 0) {
		if (!extendSelection) {
			field.selectionAnchor = null;
		}
		return;
	}
	let index = offset;
	while (index > 0 && LuaLexer.isWhitespace(text.charAt(index - 1))) {
		index -= 1;
	}
	while (index > 0 && !LuaLexer.isWhitespace(text.charAt(index - 1)) && !LuaLexer.isIdentifierPart(text.charAt(index - 1))) {
		index -= 1;
	}
	while (index > 0 && LuaLexer.isIdentifierPart(text.charAt(index - 1))) {
		index -= 1;
	}
	const next = offsetToPosition(field.lines, index);
	moveCursor(field, next.row, next.column, extendSelection);
}

export function moveWordRight(field: TextField, extendSelection: boolean): void {
	const text = fieldText(field);
	const offset = cursorOffset(field);
	if (offset >= text.length) {
		if (!extendSelection) {
			field.selectionAnchor = null;
		}
		return;
	}
	let index = offset;
	while (index < text.length && LuaLexer.isWhitespace(text.charAt(index))) {
		index += 1;
	}
	while (index < text.length && !LuaLexer.isWhitespace(text.charAt(index)) && !LuaLexer.isIdentifierPart(text.charAt(index))) {
		index += 1;
	}
	while (index < text.length && LuaLexer.isIdentifierPart(text.charAt(index))) {
		index += 1;
	}
	const next = offsetToPosition(field.lines, index);
	moveCursor(field, next.row, next.column, extendSelection);
}

export function moveToStart(field: TextField, extendSelection: boolean): void {
	moveCursor(field, 0, 0, extendSelection);
}

export function moveToEnd(field: TextField, extendSelection: boolean): void {
	const lastRow = Math.max(0, field.lines.length - 1);
	const lastColumn = field.lines[lastRow]?.length ?? 0;
	moveCursor(field, lastRow, lastColumn, extendSelection);
}

export function selectAll(field: TextField): void {
	field.selectionAnchor = { row: 0, column: 0 };
	const lastRow = Math.max(0, field.lines.length - 1);
	const lastColumn = field.lines[lastRow]?.length ?? 0;
	field.cursorRow = lastRow;
	field.cursorColumn = lastColumn;
	field.desiredColumn = field.cursorColumn;
}

export function selectedText(field: TextField): string {
	const range = selectionRange(field);
	if (!range) {
		return null;
	}
	const text = fieldText(field);
	return text.slice(range.start, range.end);
}

export function selectWordAt(field: TextField, row: number, column: number): void {
	const clamped = clampRowColumn(field, row, column);
	const text = fieldText(field);
	if (text.length === 0) {
		field.selectionAnchor = null;
		field.cursorRow = 0;
		field.cursorColumn = 0;
		field.desiredColumn = 0;
		return;
	}
	let index = positionToOffset(field.lines, clamped);
	if (index >= text.length) {
		index = Math.max(0, text.length - 1);
	}
	const ch = text.charAt(index);
	let start = index;
	let end = index + 1;
	if (LuaLexer.isIdentifierPart(ch)) {
		while (start > 0 && LuaLexer.isIdentifierPart(text.charAt(start - 1))) {
			start -= 1;
		}
		while (end < text.length && LuaLexer.isIdentifierPart(text.charAt(end))) {
			end += 1;
		}
	} else if (LuaLexer.isWhitespace(ch)) {
		while (start > 0 && LuaLexer.isWhitespace(text.charAt(start - 1))) {
			start -= 1;
		}
		while (end < text.length && LuaLexer.isWhitespace(text.charAt(end))) {
			end += 1;
		}
	} else {
		while (start > 0) {
			const previous = text.charAt(start - 1);
			if (LuaLexer.isIdentifierPart(previous) || LuaLexer.isWhitespace(previous)) {
				break;
			}
			start -= 1;
		}
		while (end < text.length) {
			const next = text.charAt(end);
			if (LuaLexer.isIdentifierPart(next) || LuaLexer.isWhitespace(next)) {
				break;
			}
			end += 1;
		}
	}
	const startPos = offsetToPosition(field.lines, start);
	const endPos = offsetToPosition(field.lines, end);
	field.selectionAnchor = startPos;
	field.cursorRow = endPos.row;
	field.cursorColumn = endPos.column;
	field.desiredColumn = field.cursorColumn;
}

export function measureRange(field: TextField, metrics: InlineFieldMetrics, start: number, end: number): number {
	const length = totalLength(field);
	const clampedStart = clamp(start, 0, length);
	const clampedEnd = clamp(end, clampedStart, length);
	if (clampedEnd <= clampedStart) {
		return 0;
	}
	const slice = fieldText(field).slice(clampedStart, clampedEnd);
	return metrics.measureText(slice);
}

export function resolveColumn(field: TextField, metrics: InlineFieldMetrics, textLeft: number, pointerX: number): number {
	const relative = pointerX - textLeft;
	if (relative <= 0) {
		return 0;
	}
	let advance = 0;
	const line = field.lines[field.cursorRow] ?? '';
	for (let index = 0; index < line.length; index += 1) {
		const ch = line.charAt(index);
		const width = ch === '\t'
			? metrics.spaceAdvance * metrics.tabSpaces
			: metrics.advanceChar(ch);
		const midpoint = advance + width * 0.5;
		if (relative < midpoint) {
			return index;
		}
		advance += width;
		if (relative < advance) {
			return index + 1;
		}
	}
	return line.length;
}

export function caretX(field: TextField, textLeft: number, measureText: (text: string) => number): number {
	const line = field.lines[field.cursorRow] ?? '';
	if (field.cursorColumn <= 0) {
		return textLeft;
	}
	const slice = line.slice(0, field.cursorColumn);
	return textLeft + measureText(slice);
}

export function registerPointerClick(field: TextField, column: number, doubleClickInterval: number): boolean {
	const timestamp = $.platform.clock.now();
	const interval = timestamp - field.lastPointerClickTimeMs;
	const sameColumn = column === field.lastPointerClickColumn;
	const isDouble = field.lastPointerClickTimeMs > 0
		&& interval <= doubleClickInterval
		&& sameColumn;
	field.lastPointerClickTimeMs = timestamp;
	field.lastPointerClickColumn = column;
	return isDouble;
}

export function setFieldText(field: TextField, value: string, moveCursorToEnd: boolean): void {
	const lines = splitText(value);
	field.lines = lines;
	if (moveCursorToEnd) {
		const lastRow = Math.max(0, lines.length - 1);
		field.cursorRow = lastRow;
		field.cursorColumn = lines[lastRow]?.length ?? 0;
	} else {
		clampCursor(field);
	}
	field.selectionAnchor = null;
	field.desiredColumn = field.cursorColumn;
	field.pointerSelecting = false;
	field.lastPointerClickTimeMs = 0;
	field.lastPointerClickColumn = -1;
}

export function applyInlineFieldEditing(
	field: TextField,
	options: InlineInputOptions,
): boolean {
	const { ctrlDown, metaDown, shiftDown, altDown } = { ctrlDown: isCtrlDown(), metaDown: isMetaDown(), shiftDown: isShiftDown(), altDown: isAltDown() };
	const { allowSpace } = options;
	const characterFilter = options.characterFilter;
	const maxLength = options.maxLength !== undefined ? options.maxLength : null;
	const useCtrl = ctrlDown || metaDown;
	const initialText = fieldText(field);
	const initialCursorRow = field.cursorRow;
	const initialCursorColumn = field.cursorColumn;
	const initialAnchor = field.selectionAnchor;

	const shouldRepeatKey = (code: string): boolean => shouldRepeatKeyFromPlayer(code);

	const readClipboard = (): string => ide_state.customClipboard ;
	const writeClipboard = (payload: string): void => {
		ide_state.customClipboard = payload;
		try {
			void $.platform.clipboard.writeText(payload);
		} catch {
			// ignore clipboard failures
		}
	};

	if (useCtrl && isKeyJustPressed('KeyA')) {
		consumeIdeKey('KeyA');
		selectAll(field);
	}

	if (useCtrl && isKeyJustPressed('KeyC')) {
		const selected = selectedText(field);
		const payload = selected && selected.length > 0 ? selected : fieldText(field);
		if (payload.length > 0) {
			writeClipboard(payload);
		}
		consumeIdeKey('KeyC');
	}

	if (useCtrl && isKeyJustPressed('KeyX')) {
		const selected = selectedText(field);
		let payload = selected;
		if (!payload || payload.length === 0) {
			payload = fieldText(field);
			if (payload.length > 0) {
				selectAll(field);
			}
		}
		if (payload && payload.length > 0) {
			writeClipboard(payload);
			deleteSelection(field);
		}
		consumeIdeKey('KeyX');
	}

	if (useCtrl && isKeyJustPressed('KeyV')) {
		const clipboard = readClipboard();
		if (clipboard && clipboard.length > 0) {
			const normalized = clipboard;
			const merged = normalized;
			if (merged.length > 0) {
				const filtered = characterFilter ? merged.split('').filter(characterFilter).join('') : merged;
				if (filtered.length > 0) {
					let insertion = filtered;
					if (maxLength !== null) {
						const remaining = Math.max(0, maxLength - (totalLength(field) - selectionLength(field)));
						if (remaining <= 0) {
							insertion = '';
						} else if (insertion.length > remaining) {
							insertion = insertion.slice(0, remaining);
						}
					}
					if (insertion.length > 0) {
						insertValue(field, insertion);
					}
				}
			}
		}
		consumeIdeKey('KeyV');
	}

	if (shouldRepeatKey('Backspace')) {
		consumeIdeKey('Backspace');
		if (useCtrl) {
			deleteWordBackward(field);
		} else {
			backspace(field);
		}
	}

	if (shouldRepeatKey('Delete')) {
		consumeIdeKey('Delete');
		if (useCtrl) {
			deleteWordForward(field);
		} else {
			deleteForward(field);
		}
	}

	if (shouldRepeatKey('ArrowLeft')) {
		consumeIdeKey('ArrowLeft');
		if (useCtrl) {
			moveWordLeft(field, shiftDown);
		} else {
			moveCursorRelative(field, -1, shiftDown);
		}
	}

	if (shouldRepeatKey('ArrowRight')) {
		consumeIdeKey('ArrowRight');
		if (useCtrl) {
			moveWordRight(field, shiftDown);
		} else {
			moveCursorRelative(field, 1, shiftDown);
		}
	}

	if (shouldRepeatKey('Home')) {
		consumeIdeKey('Home');
		moveToStart(field, shiftDown);
	}

	if (shouldRepeatKey('End')) {
		consumeIdeKey('End');
		moveToEnd(field, shiftDown);
	}

	if (allowSpace && !useCtrl && !metaDown && !altDown && shouldRepeatKey('Space')) {
		consumeIdeKey('Space');
		const remaining = maxLength !== null
			? Math.max(0, maxLength - (totalLength(field) - selectionLength(field)))
			: undefined;
		if (remaining === undefined || remaining > 0) {
			insertValue(field, ' ');
		}
	}

	if (!altDown) {
		for (let i = 0; i < CHARACTER_CODES.length; i += 1) {
			const code = CHARACTER_CODES[i];
			if (!isKeyJustPressed(code)) {
				continue;
			}
			const entry = CHARACTER_MAP[code];
			const value = shiftDown ? entry.shift : entry.normal;
			if (value.length === 0) {
				consumeIdeKey(code);
				continue;
			}
			if (characterFilter && !characterFilter(value)) {
				consumeIdeKey(code);
				continue;
			}
			if (maxLength !== null) {
				const available = maxLength - (totalLength(field) - selectionLength(field));
				if (available <= 0) {
					consumeIdeKey(code);
					continue;
				}
			}
			insertValue(field, value);
			consumeIdeKey(code);
		}
	}

	clampCursor(field);
	clampSelectionAnchor(field);
	const textChanged = fieldText(field) !== initialText;
	const anchorChanged = initialAnchor
		? !field.selectionAnchor || field.selectionAnchor.row !== initialAnchor.row || field.selectionAnchor.column !== initialAnchor.column
		: field.selectionAnchor !== null;
	if (!textChanged && field.cursorRow === initialCursorRow && field.cursorColumn === initialCursorColumn && !anchorChanged) {
		return false;
	}
	return textChanged;
}

export type InlineFieldPointerOptions = {
	metrics: InlineFieldMetrics;
	textLeft: number;
	pointerX: number;
	justPressed: boolean;
	pointerPressed: boolean;
	now: () => number;
	doubleClickInterval: number;
};

export type InlineFieldPointerResult = {
	requestBlinkReset: boolean;
};

export function applyInlineFieldPointer(field: TextField, options: InlineFieldPointerOptions): InlineFieldPointerResult {
	const { metrics, textLeft, pointerX, justPressed, pointerPressed, doubleClickInterval } = options;
	const column = resolveColumn(field, metrics, textLeft, pointerX);
	if (justPressed) {
		const isDouble = registerPointerClick(field, column, doubleClickInterval);
		if (isDouble) {
			selectWordAt(field, field.cursorRow, column);
			field.pointerSelecting = false;
		} else {
			field.selectionAnchor = { row: field.cursorRow, column };
			field.cursorRow = field.cursorRow;
			field.cursorColumn = column;
			field.desiredColumn = column;
			field.pointerSelecting = true;
		}
		clampCursor(field);
		clampSelectionAnchor(field);
		return { requestBlinkReset: true };
	}
	if (!pointerPressed) {
		field.pointerSelecting = false;
		return { requestBlinkReset: false };
	}
	if (field.pointerSelecting) {
		moveCursor(field, field.cursorRow, column, true);
		clampCursor(field);
		clampSelectionAnchor(field);
	}
	return { requestBlinkReset: false };
}
export function updateBlink(deltaSeconds: number): void {
	ide_state.blinkTimer += deltaSeconds;
	if (ide_state.blinkTimer >= constants.CURSOR_BLINK_INTERVAL) {
		ide_state.blinkTimer -= constants.CURSOR_BLINK_INTERVAL;
		ide_state.cursorVisible = !ide_state.cursorVisible;
	}
}
