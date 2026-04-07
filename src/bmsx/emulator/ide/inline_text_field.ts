import { $ } from '../../core/engine_core';
import { CHARACTER_CODES, CHARACTER_MAP } from './character_map';
import * as constants from './constants';
import { ide_state } from './ide_state';
import { consumeIdeKey, isAltDown, isCtrlDown, isKeyJustPressed, isMetaDown, isShiftDown, shouldRepeatKeyFromPlayer } from './ide_input';
import type { InlineInputOptions, Position, TextField } from './types';
import { clamp } from '../../utils/clamp';
import { LuaLexer } from '../../lua/syntax/lualexer';
import { splitText, textFromLines } from './text/source_text';
import { advanceToggleBlink } from './caret_blink';

export type InlineFieldMetrics = {
	advanceChar: (ch: string) => number;
	spaceAdvance: number;
	tabSpaces: number;
};

const scratchPosition: Position = { row: 0, column: 0 };

const positionToOffset = (lines: string[], row: number, column: number): number => {
	let offset = 0;
	for (let currentRow = 0; currentRow < row; currentRow += 1) {
		offset += lines[currentRow].length + 1;
	}
	return offset + column;
};

const offsetToPosition = (lines: string[], offset: number, out: Position): void => {
	let remaining = Math.max(0, offset);
	for (let row = 0; row < lines.length; row += 1) {
		const line = lines[row];
		const lineLength = line.length;
		if (remaining <= lineLength) {
			out.row = row;
			out.column = remaining;
			return;
		}
		remaining -= lineLength;
		if (remaining === 0) {
			out.row = row;
			out.column = lineLength;
			return;
		}
		remaining -= 1; // newline
	}
	const lastRow = lines.length - 1;
	out.row = lastRow;
	out.column = lines[lastRow].length;
};

const clampRowColumn = (field: TextField, row: number, column: number): Position => {
	const clampedRow = clamp(row, 0, field.lines.length - 1);
	const line = field.lines[clampedRow];
	scratchPosition.row = clampedRow;
	scratchPosition.column = clamp(column, 0, line.length);
	return scratchPosition;
};

const charAdvance = (metrics: InlineFieldMetrics, ch: string): number => (
	ch === '\t'
		? metrics.spaceAdvance * metrics.tabSpaces
		: metrics.advanceChar(ch)
);

const setSelectionAnchorPosition = (field: TextField, row: number, column: number): void => {
	const anchor = field.selectionAnchor;
	if (anchor) {
		anchor.row = row;
		anchor.column = column;
		return;
	}
	field.selectionAnchor = { row, column };
};

const writeInlineFieldClipboard = (payload: string): void => {
	ide_state.customClipboard = payload;
	try {
		void $.platform.clipboard.writeText(payload);
	} catch {
		// ignore clipboard failures
	}
};

const applyTextUpdate = (field: TextField, nextText: string, nextCursorOffset: number): void => {
	const lines = splitText(nextText);
	field.lines = lines;
	offsetToPosition(lines, nextCursorOffset, scratchPosition);
	field.cursorRow = scratchPosition.row;
	field.cursorColumn = scratchPosition.column;
	field.desiredColumn = field.cursorColumn;
	field.selectionAnchor = null;
};

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

const cursorOffset = (field: TextField): number => positionToOffset(field.lines, field.cursorRow, field.cursorColumn);

export function getCursorOffset(field: TextField): number {
	return cursorOffset(field);
}

export function setCursorFromOffset(field: TextField, offset: number): void {
	const length = totalLength(field);
	const clamped = clamp(offset, 0, length);
	offsetToPosition(field.lines, clamped, scratchPosition);
	field.cursorRow = scratchPosition.row;
	field.cursorColumn = scratchPosition.column;
	field.desiredColumn = field.cursorColumn;
}

export function selectionAnchorOffset(field: TextField): number | null {
	if (!field.selectionAnchor) {
		return null;
	}
	return positionToOffset(field.lines, field.selectionAnchor.row, field.selectionAnchor.column);
}

export function setSelectionAnchorFromOffset(field: TextField, offset: number): void {
	const length = totalLength(field);
	const clamped = clamp(offset, 0, length);
	offsetToPosition(field.lines, clamped, scratchPosition);
	setSelectionAnchorPosition(field, scratchPosition.row, scratchPosition.column);
}

export type InlineFieldDecoration = {
	hasSelection: boolean;
	selectionLeft: number;
	selectionWidth: number;
	caretBaseX: number;
};

const scratchInlineFieldDecoration: InlineFieldDecoration = {
	hasSelection: false,
	selectionLeft: 0,
	selectionWidth: 0,
	caretBaseX: 0,
};

export function measureInlineFieldDecoration(field: TextField, metrics: InlineFieldMetrics, textLeft: number, out: InlineFieldDecoration = scratchInlineFieldDecoration): InlineFieldDecoration {
	const cursor = cursorOffset(field);
	const anchor = selectionAnchorOffset(field);
	const hasSelection = anchor !== null && anchor !== cursor;
	const selectionStart = hasSelection && anchor < cursor ? anchor : cursor;
	const selectionEnd = hasSelection && anchor > cursor ? anchor : cursor;

	let offset = 0;
	let width = 0;
	let selectionStartWidth = 0;
	let selectionEndWidth = 0;
	let selectionStartCaptured = selectionStart === 0;
	let selectionEndCaptured = selectionEnd === 0;

	for (let row = 0; row < field.lines.length; row += 1) {
		const line = field.lines[row];
		for (let index = 0; index < line.length; index += 1) {
			if (!selectionStartCaptured && offset === selectionStart) {
				selectionStartWidth = width;
				selectionStartCaptured = true;
			}
			if (!selectionEndCaptured && offset === selectionEnd) {
				selectionEndWidth = width;
				selectionEndCaptured = true;
			}
			width += charAdvance(metrics, line.charAt(index));
			offset += 1;
		}
		if (!selectionStartCaptured && offset === selectionStart) {
			selectionStartWidth = width;
			selectionStartCaptured = true;
		}
		if (!selectionEndCaptured && offset === selectionEnd) {
			selectionEndWidth = width;
			selectionEndCaptured = true;
		}
		if (selectionStartCaptured && selectionEndCaptured) {
			break;
		}
		if (row < field.lines.length - 1) {
			offset += 1;
			if (!selectionStartCaptured && offset === selectionStart) {
				selectionStartWidth = width;
				selectionStartCaptured = true;
			}
			if (!selectionEndCaptured && offset === selectionEnd) {
				selectionEndWidth = width;
				selectionEndCaptured = true;
			}
			if (selectionStartCaptured && selectionEndCaptured) {
				break;
			}
		}
	}

	if (!selectionStartCaptured) {
		selectionStartWidth = width;
	}
	if (!selectionEndCaptured) {
		selectionEndWidth = width;
	}

	out.hasSelection = hasSelection;
	out.selectionLeft = textLeft + selectionStartWidth;
	out.selectionWidth = hasSelection ? selectionEndWidth - selectionStartWidth : 0;
	out.caretBaseX = textLeft + (cursor === selectionStart ? selectionStartWidth : selectionEndWidth);
	return out;
}

export function clampCursor(field: TextField): void {
	const clamped = clampRowColumn(field, field.cursorRow, field.cursorColumn);
	field.cursorRow = clamped.row;
	field.cursorColumn = clamped.column;
}

export function clampSelectionAnchor(field: TextField): void {
	const anchor = field.selectionAnchor;
	if (!anchor) return;
	const clamped = clampRowColumn(field, anchor.row, anchor.column);
	anchor.row = clamped.row;
	anchor.column = clamped.column;
}

export function deleteSelection(field: TextField): boolean {
	const anchorOffset = selectionAnchorOffset(field);
	if (anchorOffset === null) {
		return false;
	}
	const cursorOffsetValue = cursorOffset(field);
	if (anchorOffset === cursorOffsetValue) {
		return false;
	}
	const start = anchorOffset < cursorOffsetValue ? anchorOffset : cursorOffsetValue;
	const end = anchorOffset < cursorOffsetValue ? cursorOffsetValue : anchorOffset;
	const text = textFromLines(field.lines);
	const nextText = text.slice(0, start) + text.slice(end);
	applyTextUpdate(field, nextText, start);
	return true;
}

export function selectionLength(field: TextField): number {
	const anchorOffset = selectionAnchorOffset(field);
	if (anchorOffset === null) {
		return 0;
	}
	const cursorOffsetValue = cursorOffset(field);
	if (anchorOffset === cursorOffsetValue) {
		return 0;
	}
	return anchorOffset < cursorOffsetValue
		? cursorOffsetValue - anchorOffset
		: anchorOffset - cursorOffsetValue;
}

export function insertValue(field: TextField, value: string): boolean {
	if (value.length === 0) {
		return false;
	}
	deleteSelection(field);
	const text = textFromLines(field.lines);
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
	const text = textFromLines(field.lines);
	const nextText = text.slice(0, offset - 1) + text.slice(offset);
	applyTextUpdate(field, nextText, offset - 1);
	return true;
}

export function deleteForward(field: TextField): boolean {
	if (deleteSelection(field)) {
		return true;
	}
	const text = textFromLines(field.lines);
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
	const text = textFromLines(field.lines);
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
	const text = textFromLines(field.lines);
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
	const nextRow = clamped.row;
	const nextColumn = clamped.column;
	if (extendSelection) {
		if (!field.selectionAnchor) {
			setSelectionAnchorPosition(field, field.cursorRow, field.cursorColumn);
		}
	} else {
		field.selectionAnchor = null;
	}
	field.cursorRow = nextRow;
	field.cursorColumn = nextColumn;
	field.desiredColumn = field.cursorColumn;
}

export function moveCursorRelative(field: TextField, delta: number, extendSelection: boolean): void {
	const offset = cursorOffset(field);
	const length = totalLength(field);
	const nextOffset = clamp(offset + delta, 0, length);
	offsetToPosition(field.lines, nextOffset, scratchPosition);
	moveCursor(field, scratchPosition.row, scratchPosition.column, extendSelection);
}

export function moveWordLeft(field: TextField, extendSelection: boolean): void {
	const text = textFromLines(field.lines);
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
	offsetToPosition(field.lines, index, scratchPosition);
	moveCursor(field, scratchPosition.row, scratchPosition.column, extendSelection);
}

export function moveWordRight(field: TextField, extendSelection: boolean): void {
	const text = textFromLines(field.lines);
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
	offsetToPosition(field.lines, index, scratchPosition);
	moveCursor(field, scratchPosition.row, scratchPosition.column, extendSelection);
}

export function moveToStart(field: TextField, extendSelection: boolean): void {
	moveCursor(field, 0, 0, extendSelection);
}

export function moveToEnd(field: TextField, extendSelection: boolean): void {
	const lastRow = field.lines.length - 1;
	const lastColumn = field.lines[lastRow].length;
	moveCursor(field, lastRow, lastColumn, extendSelection);
}

export function selectAll(field: TextField): void {
	setSelectionAnchorPosition(field, 0, 0);
	const lastRow = field.lines.length - 1;
	const lastColumn = field.lines[lastRow].length;
	field.cursorRow = lastRow;
	field.cursorColumn = lastColumn;
	field.desiredColumn = field.cursorColumn;
}

export function selectedText(field: TextField): string {
	const anchorOffset = selectionAnchorOffset(field);
	if (anchorOffset === null) {
		return null;
	}
	const cursorOffsetValue = cursorOffset(field);
	if (anchorOffset === cursorOffsetValue) {
		return null;
	}
	const start = anchorOffset < cursorOffsetValue ? anchorOffset : cursorOffsetValue;
	const end = anchorOffset < cursorOffsetValue ? cursorOffsetValue : anchorOffset;
	const text = textFromLines(field.lines);
	return text.slice(start, end);
}

export function selectWordAt(field: TextField, row: number, column: number): void {
	const clamped = clampRowColumn(field, row, column);
	const text = textFromLines(field.lines);
	if (text.length === 0) {
		field.selectionAnchor = null;
		field.cursorRow = 0;
		field.cursorColumn = 0;
		field.desiredColumn = 0;
		return;
	}
	let index = positionToOffset(field.lines, clamped.row, clamped.column);
	if (index >= text.length) {
		index = text.length - 1;
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
	offsetToPosition(field.lines, start, scratchPosition);
	const startRow = scratchPosition.row;
	const startColumn = scratchPosition.column;
	offsetToPosition(field.lines, end, scratchPosition);
	setSelectionAnchorPosition(field, startRow, startColumn);
	field.cursorRow = scratchPosition.row;
	field.cursorColumn = scratchPosition.column;
	field.desiredColumn = field.cursorColumn;
}

export function resolveColumn(field: TextField, metrics: InlineFieldMetrics, textLeft: number, pointerX: number): number {
	const relative = pointerX - textLeft;
	if (relative <= 0) {
		return 0;
	}
	let advance = 0;
	const line = field.lines[field.cursorRow];
	for (let index = 0; index < line.length; index += 1) {
		const ch = line.charAt(index);
		const width = charAdvance(metrics, ch);
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
		const lastRow = lines.length - 1;
		field.cursorRow = lastRow;
		field.cursorColumn = lines[lastRow].length;
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
	const ctrlDown = isCtrlDown();
	const metaDown = isMetaDown();
	const shiftDown = isShiftDown();
	const altDown = isAltDown();
	const { allowSpace } = options;
	const characterFilter = options.characterFilter;
	const maxLength = options.maxLength ?? null;
	const useCtrl = ctrlDown || metaDown;
	let textChanged = false;

	if (useCtrl && isKeyJustPressed('KeyA')) {
		consumeIdeKey('KeyA');
		selectAll(field);
	}

	if (useCtrl && isKeyJustPressed('KeyC')) {
		const selected = selectedText(field);
		const payload = selected && selected.length > 0 ? selected : textFromLines(field.lines);
		if (payload.length > 0) {
			writeInlineFieldClipboard(payload);
		}
		consumeIdeKey('KeyC');
	}

	if (useCtrl && isKeyJustPressed('KeyX')) {
		const selected = selectedText(field);
		let payload = selected;
		if (!payload || payload.length === 0) {
			payload = textFromLines(field.lines);
			if (payload.length > 0) {
				selectAll(field);
			}
		}
		if (payload && payload.length > 0) {
			writeInlineFieldClipboard(payload);
			textChanged = deleteSelection(field) || textChanged;
		}
		consumeIdeKey('KeyX');
	}

	if (useCtrl && isKeyJustPressed('KeyV')) {
		const clipboard = ide_state.customClipboard;
		if (clipboard.length > 0) {
			let insertion = clipboard;
			if (characterFilter) {
				let filtered = '';
				for (let i = 0; i < insertion.length; i += 1) {
					const ch = insertion.charAt(i);
					if (characterFilter(ch)) {
						filtered += ch;
					}
				}
				insertion = filtered;
			}
			if (insertion.length > 0) {
				if (maxLength !== null) {
					const currentLength = totalLength(field);
					const selectedLength = selectionLength(field);
					const remaining = maxLength - (currentLength - selectedLength);
					if (remaining <= 0) {
						insertion = '';
					} else if (insertion.length > remaining) {
						insertion = insertion.slice(0, remaining);
					}
				}
				if (insertion.length > 0) {
					textChanged = insertValue(field, insertion) || textChanged;
				}
			}
		}
		consumeIdeKey('KeyV');
	}

	if (shouldRepeatKeyFromPlayer('Backspace')) {
		consumeIdeKey('Backspace');
		if (useCtrl) {
			textChanged = deleteWordBackward(field) || textChanged;
		} else {
			textChanged = backspace(field) || textChanged;
		}
	}

	if (shouldRepeatKeyFromPlayer('Delete')) {
		consumeIdeKey('Delete');
		if (useCtrl) {
			textChanged = deleteWordForward(field) || textChanged;
		} else {
			textChanged = deleteForward(field) || textChanged;
		}
	}

	if (shouldRepeatKeyFromPlayer('ArrowLeft')) {
		consumeIdeKey('ArrowLeft');
		if (useCtrl) {
			moveWordLeft(field, shiftDown);
		} else {
			moveCursorRelative(field, -1, shiftDown);
		}
	}

	if (shouldRepeatKeyFromPlayer('ArrowRight')) {
		consumeIdeKey('ArrowRight');
		if (useCtrl) {
			moveWordRight(field, shiftDown);
		} else {
			moveCursorRelative(field, 1, shiftDown);
		}
	}

	if (shouldRepeatKeyFromPlayer('Home')) {
		consumeIdeKey('Home');
		moveToStart(field, shiftDown);
	}

	if (shouldRepeatKeyFromPlayer('End')) {
		consumeIdeKey('End');
		moveToEnd(field, shiftDown);
	}

	if (allowSpace && !useCtrl && !metaDown && !altDown && shouldRepeatKeyFromPlayer('Space')) {
		consumeIdeKey('Space');
		if (maxLength === null) {
			textChanged = insertValue(field, ' ') || textChanged;
		} else {
			const currentLength = totalLength(field);
			const selectedLength = selectionLength(field);
			if (maxLength - (currentLength - selectedLength) > 0) {
				textChanged = insertValue(field, ' ') || textChanged;
			}
		}
	}

	if (!useCtrl && !altDown) {
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
					const currentLength = totalLength(field);
					const selectedLength = selectionLength(field);
					const available = maxLength - (currentLength - selectedLength);
					if (available <= 0) {
						consumeIdeKey(code);
						continue;
				}
			}
			textChanged = insertValue(field, value) || textChanged;
			consumeIdeKey(code);
		}
	}

	return textChanged;
}

export type InlineFieldPointerOptions = {
	metrics: InlineFieldMetrics;
	textLeft: number;
	pointerX: number;
	justPressed: boolean;
	pointerPressed: boolean;
	doubleClickInterval: number;
};

export type InlineFieldPointerResult = {
	requestBlinkReset: boolean;
};

const POINTER_BLINK_RESET: InlineFieldPointerResult = { requestBlinkReset: true };
const POINTER_NO_BLINK_RESET: InlineFieldPointerResult = { requestBlinkReset: false };

export function applyInlineFieldPointer(field: TextField, options: InlineFieldPointerOptions): InlineFieldPointerResult {
	const { metrics, textLeft, pointerX, justPressed, pointerPressed, doubleClickInterval } = options;
	const column = resolveColumn(field, metrics, textLeft, pointerX);
	if (justPressed) {
		const isDouble = registerPointerClick(field, column, doubleClickInterval);
		if (isDouble) {
			selectWordAt(field, field.cursorRow, column);
			field.pointerSelecting = false;
		} else {
			setSelectionAnchorPosition(field, field.cursorRow, column);
			field.cursorColumn = column;
			field.desiredColumn = column;
			field.pointerSelecting = true;
		}
		return POINTER_BLINK_RESET;
	}
	if (!pointerPressed) {
		field.pointerSelecting = false;
		return POINTER_NO_BLINK_RESET;
	}
	if (field.pointerSelecting) {
		moveCursor(field, field.cursorRow, column, true);
	}
	return POINTER_NO_BLINK_RESET;
}
export function updateBlink(deltaSeconds: number): void {
	advanceToggleBlink(ide_state, deltaSeconds, constants.CURSOR_BLINK_INTERVAL);
}
