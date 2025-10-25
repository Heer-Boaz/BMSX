import { isWhitespace, isWordChar } from './text_utils';
import type { InlineTextField } from './types';

export type InlineFieldMetrics = {
	measureText: (text: string) => number;
	advanceChar: (ch: string) => number;
	spaceAdvance: number;
	tabSpaces: number;
};

export function createInlineTextField(): InlineTextField {
	return {
		text: '',
		cursor: 0,
		selectionAnchor: null,
		desiredColumn: 0,
		pointerSelecting: false,
		lastPointerClickTimeMs: 0,
		lastPointerClickColumn: -1,
	};
}

export function clampCursor(field: InlineTextField): void {
	if (field.cursor < 0) {
		field.cursor = 0;
	}
	const length = field.text.length;
	if (field.cursor > length) {
		field.cursor = length;
	}
}

export function selectionRange(field: InlineTextField): { start: number; end: number } | null {
	const anchor = field.selectionAnchor;
	if (anchor === null) {
		return null;
	}
	const cursor = field.cursor;
	if (anchor === cursor) {
		return null;
	}
	if (anchor < cursor) {
		return { start: Math.max(0, anchor), end: Math.min(field.text.length, cursor) };
	}
	return { start: Math.max(0, cursor), end: Math.min(field.text.length, anchor) };
}

export function clampSelectionAnchor(field: InlineTextField): void {
	if (field.selectionAnchor === null) {
		return;
	}
	const length = field.text.length;
	if (field.selectionAnchor < 0) {
		field.selectionAnchor = 0;
		return;
	}
	if (field.selectionAnchor > length) {
		field.selectionAnchor = length;
	}
}

export function deleteSelection(field: InlineTextField): boolean {
	const range = selectionRange(field);
	if (!range) {
		return false;
	}
	const text = field.text;
	field.text = text.slice(0, range.start) + text.slice(range.end);
	field.cursor = range.start;
	field.selectionAnchor = null;
	field.desiredColumn = field.cursor;
	return true;
}

export function selectionLength(field: InlineTextField): number {
	const range = selectionRange(field);
	if (!range) {
		return 0;
	}
	return range.end - range.start;
}

export function insertValue(field: InlineTextField, value: string): boolean {
	if (value.length === 0) {
		return false;
	}
	deleteSelection(field);
	const text = field.text;
	const before = text.slice(0, field.cursor);
	const after = text.slice(field.cursor);
	field.text = before + value + after;
	field.cursor += value.length;
	field.desiredColumn = field.cursor;
	return true;
}

export function backspace(field: InlineTextField): boolean {
	if (deleteSelection(field)) {
		return true;
	}
	if (field.cursor === 0) {
		return false;
	}
	const text = field.text;
	field.text = text.slice(0, field.cursor - 1) + text.slice(field.cursor);
	field.cursor -= 1;
	field.desiredColumn = field.cursor;
	return true;
}

export function deleteForward(field: InlineTextField): boolean {
	if (deleteSelection(field)) {
		return true;
	}
	if (field.cursor >= field.text.length) {
		return false;
	}
	const text = field.text;
	field.text = text.slice(0, field.cursor) + text.slice(field.cursor + 1);
	field.desiredColumn = field.cursor;
	return true;
}

export function deleteWordBackward(field: InlineTextField): boolean {
	if (deleteSelection(field)) {
		return true;
	}
	if (field.cursor === 0) {
		return false;
	}
	const text = field.text;
	let index = field.cursor;
	while (index > 0 && isWhitespace(text.charAt(index - 1))) {
		index -= 1;
	}
	while (index > 0 && !isWhitespace(text.charAt(index - 1)) && !isWordChar(text.charAt(index - 1))) {
		index -= 1;
	}
	while (index > 0 && isWordChar(text.charAt(index - 1))) {
		index -= 1;
	}
	if (index === field.cursor) {
		return false;
	}
	field.text = text.slice(0, index) + text.slice(field.cursor);
	field.cursor = index;
	field.desiredColumn = field.cursor;
	field.selectionAnchor = null;
	return true;
}

export function deleteWordForward(field: InlineTextField): boolean {
	if (deleteSelection(field)) {
		return true;
	}
	const length = field.text.length;
	if (field.cursor >= length) {
		return false;
	}
	const text = field.text;
	let index = field.cursor;
	while (index < length && isWhitespace(text.charAt(index))) {
		index += 1;
	}
	while (index < length && !isWhitespace(text.charAt(index)) && !isWordChar(text.charAt(index))) {
		index += 1;
	}
	while (index < length && isWordChar(text.charAt(index))) {
		index += 1;
	}
	if (index === field.cursor) {
		return false;
	}
	field.text = text.slice(0, field.cursor) + text.slice(index);
	field.desiredColumn = field.cursor;
	field.selectionAnchor = null;
	return true;
}

export function moveCursor(field: InlineTextField, column: number, extendSelection: boolean): void {
	const clamped = Math.max(0, Math.min(field.text.length, column));
	if (extendSelection) {
		if (field.selectionAnchor === null) {
			field.selectionAnchor = field.cursor;
		}
	} else {
		field.selectionAnchor = null;
	}
	field.cursor = clamped;
	field.desiredColumn = clamped;
}

export function moveCursorRelative(field: InlineTextField, delta: number, extendSelection: boolean): void {
	moveCursor(field, field.cursor + delta, extendSelection);
}

export function moveWordLeft(field: InlineTextField, extendSelection: boolean): void {
	if (field.cursor === 0) {
		if (!extendSelection) {
			field.selectionAnchor = null;
		}
		return;
	}
	const text = field.text;
	let index = field.cursor;
	while (index > 0 && isWhitespace(text.charAt(index - 1))) {
		index -= 1;
	}
	while (index > 0 && !isWhitespace(text.charAt(index - 1)) && !isWordChar(text.charAt(index - 1))) {
		index -= 1;
	}
	while (index > 0 && isWordChar(text.charAt(index - 1))) {
		index -= 1;
	}
	moveCursor(field, index, extendSelection);
}

export function moveWordRight(field: InlineTextField, extendSelection: boolean): void {
	const length = field.text.length;
	if (field.cursor >= length) {
		if (!extendSelection) {
			field.selectionAnchor = null;
		}
		return;
	}
	const text = field.text;
	let index = field.cursor;
	while (index < length && isWhitespace(text.charAt(index))) {
		index += 1;
	}
	while (index < length && !isWhitespace(text.charAt(index)) && !isWordChar(text.charAt(index))) {
		index += 1;
	}
	while (index < length && isWordChar(text.charAt(index))) {
		index += 1;
	}
	moveCursor(field, index, extendSelection);
}

export function moveToStart(field: InlineTextField, extendSelection: boolean): void {
	moveCursor(field, 0, extendSelection);
}

export function moveToEnd(field: InlineTextField, extendSelection: boolean): void {
	moveCursor(field, field.text.length, extendSelection);
}

export function selectAll(field: InlineTextField): void {
	field.selectionAnchor = 0;
	field.cursor = field.text.length;
	field.desiredColumn = field.cursor;
}

export function selectedText(field: InlineTextField): string | null {
	const range = selectionRange(field);
	if (!range) {
		return null;
	}
	return field.text.slice(range.start, range.end);
}

export function selectWordAt(field: InlineTextField, column: number): void {
	const text = field.text;
	if (text.length === 0) {
		field.selectionAnchor = null;
		field.cursor = 0;
		field.desiredColumn = 0;
		return;
	}
	let index = column;
	if (index >= text.length) {
		index = text.length - 1;
	}
	if (index < 0) {
		index = 0;
	}
	const ch = text.charAt(index);
	let start = index;
	let end = index + 1;
	if (isWordChar(ch)) {
		while (start > 0 && isWordChar(text.charAt(start - 1))) {
			start -= 1;
		}
		while (end < text.length && isWordChar(text.charAt(end))) {
			end += 1;
		}
	} else if (isWhitespace(ch)) {
		while (start > 0 && isWhitespace(text.charAt(start - 1))) {
			start -= 1;
		}
		while (end < text.length && isWhitespace(text.charAt(end))) {
			end += 1;
		}
	} else {
		while (start > 0) {
			const previous = text.charAt(start - 1);
			if (isWordChar(previous) || isWhitespace(previous)) {
				break;
			}
			start -= 1;
		}
		while (end < text.length) {
			const next = text.charAt(end);
			if (isWordChar(next) || isWhitespace(next)) {
				break;
			}
			end += 1;
		}
	}
	if (end < start) {
		end = start;
	}
	field.selectionAnchor = start;
	field.cursor = end;
	field.desiredColumn = field.cursor;
}

export function measureRange(field: InlineTextField, metrics: InlineFieldMetrics, start: number, end: number): number {
	const clampedStart = Math.max(0, Math.min(start, field.text.length));
	const clampedEnd = Math.max(clampedStart, Math.min(end, field.text.length));
	if (clampedEnd <= clampedStart) {
		return 0;
	}
	const slice = field.text.slice(clampedStart, clampedEnd);
	return metrics.measureText(slice);
}

export function resolveColumn(field: InlineTextField, metrics: InlineFieldMetrics, textLeft: number, pointerX: number): number {
	const relative = pointerX - textLeft;
	if (relative <= 0) {
		return 0;
	}
	let advance = 0;
	const length = field.text.length;
	for (let index = 0; index < length; index += 1) {
		const ch = field.text.charAt(index);
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
	return length;
}

export function caretX(field: InlineTextField, textLeft: number, measureText: (text: string) => number): number {
	if (field.cursor <= 0) {
		return textLeft;
	}
	const slice = field.text.slice(0, field.cursor);
	return textLeft + measureText(slice);
}

export function registerPointerClick(field: InlineTextField, column: number, now: () => number, doubleClickInterval: number): boolean {
	const timestamp = now();
	const interval = timestamp - field.lastPointerClickTimeMs;
	const sameColumn = column === field.lastPointerClickColumn;
	const isDouble = field.lastPointerClickTimeMs > 0
		&& interval <= doubleClickInterval
		&& sameColumn;
	field.lastPointerClickTimeMs = timestamp;
	field.lastPointerClickColumn = column;
	return isDouble;
}

export function setFieldText(field: InlineTextField, value: string, moveCursorToEnd: boolean): void {
	field.text = value;
	if (moveCursorToEnd) {
		field.cursor = value.length;
	} else {
		if (field.cursor > value.length) {
			field.cursor = value.length;
		}
		if (field.cursor < 0) {
			field.cursor = 0;
		}
	}
	field.selectionAnchor = null;
	field.desiredColumn = field.cursor;
	field.pointerSelecting = false;
	field.lastPointerClickTimeMs = 0;
	field.lastPointerClickColumn = -1;
}
