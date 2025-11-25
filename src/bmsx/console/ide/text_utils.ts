import { columnToDisplay, getResourcePanelWidth } from './console_cart_editor';
import * as constants from './constants';
import { getActiveCodeTabContext } from './editor_tabs';
import { caretNavigation, ide_state } from './ide_state';
import { resolveHoverChunkName } from './intellisense';
import * as TextEditing from './text_editing_and_selection';
import type { HighlightLine, VisualLineSegment } from './types';

export function isWhitespace(ch: string): boolean {
	return ch === '' || ch === ' ' || ch === '\t';
}

export function isWordChar(ch: string): boolean {
	if (!ch) {
		return false;
	}
	const code = ch.charCodeAt(0);
	return (code >= 48 && code <= 57)
		|| (code >= 65 && code <= 90)
		|| (code >= 97 && code <= 122)
		|| ch === '_';
}

export function isIdentifierStartChar(code: number): boolean {
	if (code >= 65 && code <= 90) {
		return true;
	}
	if (code >= 97 && code <= 122) {
		return true;
	}
	return code === 95;
}

export function isIdentifierChar(code: number): boolean {
	return isIdentifierStartChar(code) || (code >= 48 && code <= 57);
}
export function splitLines(source: string): string[] {
	return source.split(/\r?\n/);
}
export type AdvanceMeasure = (ch: string) => number;

export function expandTabs(source: string): string {
	if (source.indexOf('\t') === -1) return source;
	let result = '';
	for (let i = 0; i < source.length; i++) {
		const ch = source.charAt(i);
		if (ch === '\t') {
			for (let j = 0; j < constants.TAB_SPACES; j++) result += ' ';
		} else {
			result += ch;
		}
	}
	return result;
}

export function measureTextGeneric(text: string, advance: AdvanceMeasure, spaceAdvance: number): number {
	let width = 0;
	for (let i = 0; i < text.length; i++) {
		const ch = text.charAt(i);
		if (ch === '\t') { width += spaceAdvance * constants.TAB_SPACES; continue; }
		if (ch === '\n') continue;
		width += advance(ch);
	}
	return width;
}

export function truncateTextToWidth(text: string, maxWidth: number, advance: AdvanceMeasure, spaceAdvance: number): string {
	if (maxWidth <= 0) return '';
	if (measureTextGeneric(text, advance, spaceAdvance) <= maxWidth) return text;
	const ellipsis = '...';
	const ellipsisWidth = measureTextGeneric(ellipsis, advance, spaceAdvance);
	if (ellipsisWidth > maxWidth) return '';
	let low = 0, high = text.length, best = '';
	while (low <= high) {
		const mid = Math.floor((low + high) / 2);
		const candidate = text.slice(0, mid) + ellipsis;
		if (measureTextGeneric(candidate, advance, spaceAdvance) <= maxWidth) {
			best = candidate; low = mid + 1;
		} else {
			high = mid - 1;
		}
	}
	return best;
}
// Generic measurement-based wrapper using a callback measure(string)->width

export function wrapTextDynamic(
	text: string,
	firstLineWidth: number,
	subsequentWidth: number,
	measure: (text: string) => number,
	maxLines: number
): string[] {
	const lines: string[] = [];
	if (maxLines <= 1) {
		if (firstLineWidth <= 0) return [''];
		const truncated = truncateWithMeasure(text, firstLineWidth, measure);
		lines.push(truncated);
		return lines;
	}
	let remaining = text;
	let width = firstLineWidth;
	for (let i = 0; i < maxLines; i += 1) {
		if (remaining.length === 0) break;
		const sliceIndex = findMaxFittingIndexMeasure(remaining, width, measure);
		const lineText = remaining.slice(0, sliceIndex).trimEnd();
		lines.push(lineText);
		remaining = remaining.slice(sliceIndex).trimStart();
		width = subsequentWidth;
	}
	if (lines.length === 0) {
		lines.push('');
		return lines;
	}
	if (remaining.length > 0) {
		const lastIndex = lines.length - 1;
		const last = `${lines[lastIndex]}…`;
		const lastLineWidth = lines.length === 1 ? firstLineWidth : subsequentWidth;
		lines[lastIndex] = truncateWithMeasure(last, lastLineWidth, measure);
	}
	return lines;
}

export function isLuaCommentContext(
	lines: readonly string[],
	targetRow: number,
	targetColumn: number
): boolean {
	if (targetRow < 0 || targetRow >= lines.length) {
		return false;
	}
	let blockComment = false;
	let stringDelimiter: '\'' | '"' | null = null;
	for (let row = 0; row <= targetRow; row += 1) {
		const line = lines[row] ?? '';
		let index = 0;
		let lineComment = false;
		const limitColumn = row === targetRow ? targetColumn : line.length;
		while (index <= line.length) {
			if (row === targetRow && index >= limitColumn) {
				return blockComment || lineComment;
			}
			if (index === line.length) {
				break;
			}
			const ch = line.charAt(index);
			const next = index + 1 < line.length ? line.charAt(index + 1) : '';
			if (lineComment) {
				index += 1;
				continue;
			}
			if (stringDelimiter !== null) {
				if (ch === '\\') {
					index += 2;
				} else if (ch === stringDelimiter) {
					stringDelimiter = null;
					index += 1;
				} else {
					index += 1;
				}
				continue;
			}
			if (blockComment) {
				if (ch === ']' && next === ']') {
					blockComment = false;
					index += 2;
				} else {
					index += 1;
				}
				continue;
			}
			if (ch === '-' && next === '-') {
				const next2 = index + 2 < line.length ? line.charAt(index + 2) : '';
				const next3 = index + 3 < line.length ? line.charAt(index + 3) : '';
				if (next2 === '[' && next3 === '[') {
					blockComment = true;
					index += 4;
					continue;
				}
				lineComment = true;
				index += 2;
				continue;
			}
			if (ch === '\'' || ch === '"') {
				stringDelimiter = ch as '\'' | '"';
				index += 1;
				continue;
			}
			index += 1;
		}
	}
	return blockComment;
}
function findMaxFittingIndexMeasure(text: string, maxWidth: number, measure: (t: string) => number): number {
	if (text.length === 0) return 0;
	if (maxWidth <= 0) return 1;
	let low = 1;
	let high = text.length;
	let best = 0;
	while (low <= high) {
		const mid = (low + high) >> 1;
		const candidate = text.slice(0, mid);
		const w = measure(candidate);
		if (w <= maxWidth) { best = mid; low = mid + 1; }
		else { high = mid - 1; }
	}
	if (best <= 0) return 1;
	if (best >= text.length) return text.length;
	let breakIndex = best;
	for (let i = best - 1; i >= 0; i -= 1) {
		const ch = text.charAt(i);
		if (ch === ' ' || ch === '\t') { breakIndex = i + 1; break; }
	}
	return breakIndex;
}
function truncateWithMeasure(text: string, maxWidth: number, measure: (t: string) => number): string {
	if (maxWidth <= 0) return '';
	if (measure(text) <= maxWidth) return text;
	const ellipsis = '...';
	const ellipsisWidth = measure(ellipsis);
	if (ellipsisWidth > maxWidth) return '';
	let low = 0, high = text.length, best = '';
	while (low <= high) {
		const mid = Math.floor((low + high) / 2);
		const candidate = text.slice(0, mid) + ellipsis;
		if (measure(candidate) <= maxWidth) { best = candidate; low = mid + 1; }
		else { high = mid - 1; }
	}
	return best;
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

export function visibleRowCount(): number {
	return ide_state.cachedVisibleRowCount > 0 ? ide_state.cachedVisibleRowCount : 1;
}

export function visibleColumnCount(): number {
	return ide_state.cachedVisibleColumnCount > 0 ? ide_state.cachedVisibleColumnCount : 1;
}
export function computeSelectionSlice(lineIndex: number, highlight: HighlightLine, sliceStart: number, sliceEnd: number): { startDisplay: number; endDisplay: number; } | null {
	const range = TextEditing.getSelectionRange();
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

