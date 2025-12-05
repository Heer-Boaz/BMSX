import { applySourceToDocument, getResourcePanelWidth } from './console_cart_editor';
import { clearReferenceHighlights } from './intellisense';
import { requestSemanticRefresh } from './intellisense';
import { markDiagnosticsDirty } from './diagnostics';
import * as constants from './constants';
import { ERROR_OVERLAY_CONNECTOR_OFFSET, ERROR_OVERLAY_PADDING_X } from './constants';
import { startSearchJob } from './editor_search';
import { getActiveCodeTabContext, updateActiveContextDirtyFlag } from './editor_tabs';
import { caretNavigation, ide_state } from './ide_state';
import { resolveHoverChunkName } from './intellisense';
import { rebuildRuntimeErrorOverlayView } from './runtime_error_overlay';
import * as TextEditing from './text_editing_and_selection';
import { computeEditContextFromSources, handlePostEditMutation } from './text_editing_and_selection';
import type { EditContext, HighlightLine, RuntimeErrorOverlay, VisualLineSegment } from './types';

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
		|| ch === '_' || ch === '$';
}

export function splitLines(source: string): string[] {
	return source.split(/\r?\n/);
}

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

export function applyCaseOutsideStrings(text: string, transform: (ch: string) => string): string {
	if (text.length === 0) {
		return text;
	}
	let inString = false;
	let quote: string = null;
	let escapeNext = false;
	let mutated = false;
	for (let i = 0; i < text.length; i += 1) {
		const ch = text.charAt(i);
		if (inString) {
			if (escapeNext) {
				escapeNext = false;
				continue;
			}
			if (ch === '\\') {
				escapeNext = true;
				continue;
			}
			if (ch === quote) {
				inString = false;
				quote = null;
			}
			continue;
		}
		if (ch === '"' || ch === '\'' || ch === '`') {
			inString = true;
			quote = ch;
			continue;
		}
		if (transform(ch) !== ch) {
			mutated = true;
			break;
		}
	}
	if (!mutated) {
		return text;
	}
	let result = '';
	inString = false;
	quote = null;
	escapeNext = false;
	for (let i = 0; i < text.length; i += 1) {
		const ch = text.charAt(i);
		if (inString) {
			result += ch;
			if (escapeNext) {
				escapeNext = false;
				continue;
			}
			if (ch === '\\') {
				escapeNext = true;
				continue;
			}
			if (ch === quote) {
				inString = false;
				quote = null;
			}
			continue;
		}
		if (ch === '"' || ch === '\'' || ch === '`') {
			inString = true;
			quote = ch;
			result += ch;
			continue;
		}
		result += transform(ch);
	}
	return result;
}

export function measureText(text: string): number {
	let width = 0;
	for (let i = 0; i < text.length; i++) {
		const ch = text.charAt(i);
		if (ch === '\t') { width += ide_state.spaceAdvance * constants.TAB_SPACES; continue; }
		if (ch === '\n') continue;
		width += ide_state.font.advance(ch);
	}
	return width;
}

export function truncateTextToWidth(text: string, maxWidth: number): string {
	if (maxWidth <= 0) return '';
	if (measureText(text) <= maxWidth) return text;
	const ellipsis = '...';
	const ellipsisWidth = measureText(ellipsis);
	if (ellipsisWidth > maxWidth) return '';
	let low = 0, high = text.length, best = '';
	while (low <= high) {
		const mid = Math.floor((low + high) / 2);
		const candidate = text.slice(0, mid) + ellipsis;
		if (measureText(candidate) <= maxWidth) {
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
	let stringDelimiter: '\'' | '"' = null;
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
export function computeSelectionSlice(lineIndex: number, highlight: HighlightLine, sliceStart: number, sliceEnd: number): { startDisplay: number; endDisplay: number; } {
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
	const startDisplay = ide_state.layout.columnToDisplay(highlight, selectionStartColumn);
	const endDisplay = ide_state.layout.columnToDisplay(highlight, selectionEndColumn);
	const visibleStart = Math.max(sliceStart, startDisplay);
	const visibleEnd = Math.min(sliceEnd, endDisplay);
	if (visibleEnd <= visibleStart) {
		return null;
	}
	return { startDisplay: visibleStart, endDisplay: visibleEnd };
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

export function visualIndexToSegment(index: number): VisualLineSegment {
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
export function computeRuntimeErrorOverlayMaxWidth(): number {
	const resourceWidth = ide_state.resourcePanelVisible ? getResourcePanelWidth() : 0;
	const gutterSpace = ide_state.gutterWidth + 2;
	const scrollbarSpace = ide_state.codeVerticalScrollbarVisible ? constants.SCROLLBAR_WIDTH : 0;
	const rightMargin = constants.CODE_AREA_RIGHT_MARGIN;
	const connectorOffset = ERROR_OVERLAY_CONNECTOR_OFFSET + ERROR_OVERLAY_PADDING_X * 2;
	const available = ide_state.viewportWidth - resourceWidth - gutterSpace - scrollbarSpace - rightMargin - connectorOffset;
	return Math.max(ide_state.charAdvance, available);
}

export function wrapOverlayLine(line: string, maxWidth: number): string[] {
	if (line.length === 0) return [''];
	const segments: string[] = [];
	let segmentStart = 0;
	let lastBreak = -1;
	for (let index = 0; index < line.length; index += 1) {
		const ch = line.charAt(index);
		if (ch === ' ' || ch === '\t') {
			lastBreak = index;
		}
		const candidateWidth = measureText(line.slice(segmentStart, index + 1));
		if (candidateWidth <= maxWidth) {
			continue;
		}
		if (lastBreak >= segmentStart) {
			segments.push(line.slice(segmentStart, lastBreak));
			segmentStart = lastBreak + 1;
			lastBreak = -1;
			index = segmentStart - 1;
			continue;
		}
		if (index === segmentStart) {
			segments.push(line.charAt(index));
			segmentStart = index + 1;
		} else {
			segments.push(line.slice(segmentStart, index));
			segmentStart = index;
		}
		lastBreak = -1;
	}
	if (segmentStart < line.length) {
		segments.push(line.slice(segmentStart));
	}
	return segments.length > 0 ? segments : [''];
}

function rewrapRuntimeErrorOverlay(overlay: RuntimeErrorOverlay): void {
	overlay.messageLines = normalizeEndingsAndSplitLines(overlay.message);
	rebuildRuntimeErrorOverlayView(overlay);
}

export function rewrapRuntimeErrorOverlays(): void {
	const visited = new Set<RuntimeErrorOverlay>();
	if (ide_state.runtimeErrorOverlay) {
		visited.add(ide_state.runtimeErrorOverlay);
		rewrapRuntimeErrorOverlay(ide_state.runtimeErrorOverlay);
	}
	for (const context of ide_state.codeTabContexts.values()) {
		const overlay = context.runtimeErrorOverlay;
		if (overlay && !visited.has(overlay)) {
			visited.add(overlay);
			rewrapRuntimeErrorOverlay(overlay);
		}
	}
}
export function normalizeCaseOutsideStrings(text: string): string {
	if (!ide_state.caseInsensitive || ide_state.canonicalization === 'none') {
		return text;
	}
	const transform = ide_state.canonicalization === 'upper'
		? (ch: string) => ch.toUpperCase()
		: (ch: string) => ch.toLowerCase();
	return applyCaseOutsideStrings(text, transform);
}

export function applyCaseNormalizationIfNeeded(editContext: EditContext): EditContext {
	if (!ide_state.caseInsensitive) {
		ide_state.preMutationSource = null;
		return editContext;
	}
	const currentSource = serializeCurrentSource();
	const normalized = normalizeCaseOutsideStrings(currentSource);
	const previousSource = ide_state.preMutationSource;
	ide_state.preMutationSource = null;
	if (normalized === currentSource) {
		if (!previousSource) {
			return editContext;
		}
		return computeEditContextFromSources(previousSource, currentSource) ?? editContext;
	}
	applySourceToDocument(normalized);
	bumpTextVersion();
	requestSemanticRefresh();
	const derived = computeEditContextFromSources(previousSource ?? currentSource, normalized);
	return derived ?? editContext;
}export function serializeCurrentSource(): string {
	return ide_state.lines.join('\n');
}

export function capturePreMutationSource(): void {
	if (!ide_state.caseInsensitive) {
		return;
	}
	if (ide_state.preMutationSource === null) {
		ide_state.preMutationSource = serializeCurrentSource();
	}
}
export function markTextMutated(): void {
	ide_state.saveGeneration = ide_state.saveGeneration + 1;
	ide_state.dirty = true;
	const context = getActiveCodeTabContext();
	if (context) {
		context.saveGeneration = ide_state.saveGeneration;
	}
	markDiagnosticsDirty();
	bumpTextVersion();
	clearReferenceHighlights();
	updateActiveContextDirtyFlag();
	ide_state.layout.markVisualLinesDirty();
	requestSemanticRefresh();
	ide_state.navigationHistory.forward.length = 0;
	handlePostEditMutation();
	if (ide_state.searchQuery.length > 0) startSearchJob();
}
export function bumpTextVersion(): void {
	ide_state.textVersion += 1;
}

export function normalizeLineEndings(source: string): string {
	return source.replace(/\r\n/g, '\n').replace(/\r/g, '\n');
}

export function normalizeEndingsAndSplitLines(message: string): string[] {
	const rawLines = normalizeLineEndings(message).split('\n');
	return rawLines.length > 0 ? rawLines : [''];
}
