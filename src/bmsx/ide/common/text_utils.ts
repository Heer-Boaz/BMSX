import { getResourcePanelWidth, updateGutterWidth } from '../editor/ui/editor_view';
import * as constants from './constants';
import { ERROR_OVERLAY_CONNECTOR_OFFSET, ERROR_OVERLAY_PADDING_X } from './constants';
import { startSearchJob } from '../editor/contrib/find/editor_search';
import { getActiveCodeTabContext, findCodeTabContext, updateActiveContextDirtyFlag } from '../workbench/ui/tabs';
import { caretNavigation } from '../editor/ui/caret';
import { clearForwardNavigationHistory } from '../editor/navigation/navigation_history';
import { rebuildRuntimeErrorOverlayView } from '../editor/contrib/runtime_error/runtime_error_overlay';
import { runtimeErrorState } from '../editor/contrib/runtime_error/runtime_error_state';
import * as TextEditing from '../editor/editing/text_editing_and_selection';
import { handlePostEditMutation } from '../editor/editing/text_editing_and_selection';
import type { HighlightLine, RuntimeErrorOverlay, VisualLineSegment } from './types';
import { markDiagnosticsDirty } from '../workbench/contrib/problems/diagnostics';
import { requestSemanticRefresh, clearReferenceHighlights } from '../editor/contrib/intellisense/intellisense';
import { getTextSnapshot, splitText } from '../editor/text/source_text';
import type { TextBuffer } from '../editor/text/text_buffer';
import { Runtime } from '../../emulator/runtime';
import * as runtimeLuaPipeline from '../../emulator/runtime_lua_pipeline';
import { buildDirtyFilePath } from '../workbench/common/workspace_storage';
import { getWorkspaceCachedSource } from '../../emulator/workspace_cache';
import { editorFeedbackState } from '../workbench/common/feedback_state';
import { editorDocumentState } from '../editor/editing/editor_document_state';
import { editorSessionState } from '../editor/ui/editor_session_state';
import { editorViewState } from '../editor/ui/editor_view_state';
import { editorFeatureState } from '../editor/common/editor_feature_state';
import { resourcePanel } from '../workbench/contrib/resources/resource_panel_controller';
import { editorRuntimeState } from '../editor/common/editor_runtime_state';

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
		if (ch === '\t') { width += editorViewState.spaceAdvance * constants.TAB_SPACES; continue; }
		if (ch === '\n') continue;
		width += editorViewState.font.advance(ch);
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
	buffer: TextBuffer,
	targetRow: number,
	targetColumn: number
): boolean {
	const lineCount = buffer.getLineCount();
	if (targetRow < 0 || targetRow >= lineCount) {
		return false;
	}
	const cache = getLuaCommentContextCache(buffer);
	ensureLuaCommentStateUpTo(buffer, cache, targetRow);
	const line = buffer.getLineContent(targetRow);
	let mode = cache.modeState[targetRow];
	let level = cache.levelState[targetRow];
	let index = 0;
	while (index < line.length && index < targetColumn) {
		if (mode === MODE_LONG_COMMENT) {
			const ch = line.charCodeAt(index);
			if (ch === 93) {
				const closeLen = longBracketCloseLengthAt(line, index, level);
				if (closeLen > 0) {
					mode = MODE_NORMAL;
					level = 0;
					index += closeLen;
					continue;
				}
			}
			index += 1;
			continue;
		}
		if (mode === MODE_LONG_STRING) {
			const ch = line.charCodeAt(index);
			if (ch === 93) {
				const closeLen = longBracketCloseLengthAt(line, index, level);
				if (closeLen > 0) {
					mode = MODE_NORMAL;
					level = 0;
					index += closeLen;
					continue;
				}
			}
			index += 1;
			continue;
		}
		if (mode === MODE_STRING_SINGLE || mode === MODE_STRING_DOUBLE) {
			const ch = line.charCodeAt(index);
			if (ch === 92) {
				const escape = index + 1 < line.length ? line.charCodeAt(index + 1) : 0;
				index += escape === 122 ? 2 + skipLuaStringWhitespace(line, index + 2) : 2;
				continue;
			}
			if ((mode === MODE_STRING_SINGLE && ch === 39) || (mode === MODE_STRING_DOUBLE && ch === 34)) {
				mode = MODE_NORMAL;
				index += 1;
				continue;
			}
			index += 1;
			continue;
		}

		const ch = line.charCodeAt(index);
		const next = index + 1 < line.length ? line.charCodeAt(index + 1) : 0;
		if (ch === 45 && next === 45) {
			const openIndex = index + 2;
			const openLevel = openIndex < line.length ? longBracketLevelAt(line, openIndex) : -1;
			if (openLevel >= 0) {
				mode = MODE_LONG_COMMENT;
				level = openLevel;
				index = openIndex + openLevel + 2;
				continue;
			}
			return true;
		}
		if (ch === 91) {
			const openLevel = longBracketLevelAt(line, index);
			if (openLevel >= 0) {
				mode = MODE_LONG_STRING;
				level = openLevel;
				index += openLevel + 2;
				continue;
			}
		}
		if (ch === 39) {
			mode = MODE_STRING_SINGLE;
			index += 1;
			continue;
		}
		if (ch === 34) {
			mode = MODE_STRING_DOUBLE;
			index += 1;
			continue;
		}
		index += 1;
	}
	return mode === MODE_LONG_COMMENT;
}

class LuaCommentContextCache {
	public version = -1;
	public lineCount = 0;
	public validThroughRow = 0;
	public modeState = new Uint8Array(1);
	public levelState = new Uint32Array(1);

	public reset(lineCount: number, version: number): void {
		this.version = version;
		this.lineCount = lineCount;
		this.validThroughRow = 0;
		this.modeState = new Uint8Array(lineCount + 1);
		this.levelState = new Uint32Array(lineCount + 1);
	}
}

const luaCommentContextCache = new WeakMap<TextBuffer, LuaCommentContextCache>();

export function invalidateLuaCommentContextFromRow(buffer: TextBuffer, row: number): void {
	let cache = luaCommentContextCache.get(buffer);
	if (!cache) {
		cache = new LuaCommentContextCache();
		cache.reset(buffer.getLineCount(), buffer.version);
		luaCommentContextCache.set(buffer, cache);
	}
	const lineCount = buffer.getLineCount();
	const clampedRow = Math.max(0, Math.min(row, lineCount));
	if (cache.lineCount !== lineCount) {
		const validThroughRow = Math.min(cache.validThroughRow, clampedRow);
		const nextModeState = new Uint8Array(lineCount + 1);
		const nextLevelState = new Uint32Array(lineCount + 1);
		nextModeState.set(cache.modeState.subarray(0, validThroughRow + 1));
		nextLevelState.set(cache.levelState.subarray(0, validThroughRow + 1));
		cache.version = buffer.version;
		cache.lineCount = lineCount;
		cache.validThroughRow = validThroughRow;
		cache.modeState = nextModeState;
		cache.levelState = nextLevelState;
		return;
	}
	cache.version = buffer.version;
	cache.validThroughRow = Math.min(cache.validThroughRow, clampedRow);
}

function getLuaCommentContextCache(buffer: TextBuffer): LuaCommentContextCache {
	let cache = luaCommentContextCache.get(buffer);
	if (!cache) {
		cache = new LuaCommentContextCache();
		cache.reset(buffer.getLineCount(), buffer.version);
		luaCommentContextCache.set(buffer, cache);
	}
	return cache;
}

function ensureLuaCommentStateUpTo(buffer: TextBuffer, cache: LuaCommentContextCache, targetRow: number): void {
	const lineCount = buffer.getLineCount();
	if (cache.lineCount !== lineCount) {
		cache.reset(lineCount, buffer.version);
	}
	if (cache.version !== buffer.version) {
		cache.version = buffer.version;
		cache.validThroughRow = 0;
	}
	while (cache.validThroughRow < targetRow) {
		const row = cache.validThroughRow;
		let mode = cache.modeState[row];
		let level = cache.levelState[row];
		const line = buffer.getLineContent(row);
		let index = 0;
		while (index < line.length) {
			if (mode === MODE_LONG_COMMENT) {
				const ch = line.charCodeAt(index);
				if (ch === 93) {
					const closeLen = longBracketCloseLengthAt(line, index, level);
					if (closeLen > 0) {
						mode = MODE_NORMAL;
						level = 0;
						index += closeLen;
						continue;
					}
				}
				index += 1;
				continue;
			}
			if (mode === MODE_LONG_STRING) {
				const ch = line.charCodeAt(index);
				if (ch === 93) {
					const closeLen = longBracketCloseLengthAt(line, index, level);
					if (closeLen > 0) {
						mode = MODE_NORMAL;
						level = 0;
						index += closeLen;
						continue;
					}
				}
				index += 1;
				continue;
			}
			if (mode === MODE_STRING_SINGLE || mode === MODE_STRING_DOUBLE) {
				const ch = line.charCodeAt(index);
				if (ch === 92) {
					const escape = index + 1 < line.length ? line.charCodeAt(index + 1) : 0;
					index += escape === 122 ? 2 + skipLuaStringWhitespace(line, index + 2) : 2;
					continue;
				}
				if ((mode === MODE_STRING_SINGLE && ch === 39) || (mode === MODE_STRING_DOUBLE && ch === 34)) {
					mode = MODE_NORMAL;
					index += 1;
					continue;
				}
				index += 1;
				continue;
			}

			const ch = line.charCodeAt(index);
			const next = index + 1 < line.length ? line.charCodeAt(index + 1) : 0;
			if (ch === 45 && next === 45) {
				const openIndex = index + 2;
				const openLevel = openIndex < line.length ? longBracketLevelAt(line, openIndex) : -1;
				if (openLevel >= 0) {
					mode = MODE_LONG_COMMENT;
					level = openLevel;
					index = openIndex + openLevel + 2;
					continue;
				}
				break;
			}
			if (ch === 91) {
				const openLevel = longBracketLevelAt(line, index);
				if (openLevel >= 0) {
					mode = MODE_LONG_STRING;
					level = openLevel;
					index += openLevel + 2;
					continue;
				}
			}
			if (ch === 39) {
				mode = MODE_STRING_SINGLE;
				index += 1;
				continue;
			}
			if (ch === 34) {
				mode = MODE_STRING_DOUBLE;
				index += 1;
				continue;
			}
			index += 1;
		}
		cache.modeState[row + 1] = mode;
		cache.levelState[row + 1] = level;
		cache.validThroughRow = row + 1;
	}
}

const MODE_NORMAL = 0;
const MODE_STRING_SINGLE = 1;
const MODE_STRING_DOUBLE = 2;
const MODE_LONG_STRING = 3;
const MODE_LONG_COMMENT = 4;

function longBracketLevelAt(line: string, index: number): number {
	if (line.charCodeAt(index) !== 91) {
		return -1;
	}
	let level = 0;
	let cursor = index + 1;
	while (cursor < line.length && line.charCodeAt(cursor) === 61) {
		level += 1;
		cursor += 1;
	}
	return cursor < line.length && line.charCodeAt(cursor) === 91 ? level : -1;
}

function longBracketCloseLengthAt(line: string, index: number, level: number): number {
	if (line.charCodeAt(index) !== 93) {
		return 0;
	}
	let cursor = index + 1;
	for (let i = 0; i < level; i += 1) {
		if (cursor >= line.length || line.charCodeAt(cursor) !== 61) {
			return 0;
		}
		cursor += 1;
	}
	return cursor < line.length && line.charCodeAt(cursor) === 93 ? level + 2 : 0;
}

function skipLuaStringWhitespace(line: string, index: number): number {
	let skipped = 0;
	let cursor = index;
	while (cursor < line.length) {
		const code = line.charCodeAt(cursor);
		if (code !== 32 && code !== 9 && code !== 13 && code !== 10 && code !== 11 && code !== 12) {
			break;
		}
		cursor += 1;
		skipped += 1;
	}
	return skipped;
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
	const reference = editorViewState.font.advance('M');
	for (let i = 0; i < sample.length; i++) {
		const candidate = editorViewState.font.advance(sample.charAt(i));
		if (candidate !== reference) {
			editorFeedbackState.warnNonMonospace = true;
			break;
		}
	}
}

export function visibleRowCount(): number {
	return editorViewState.cachedVisibleRowCount > 0 ? editorViewState.cachedVisibleRowCount : 1;
}

export function visibleColumnCount(): number {
	return editorViewState.cachedVisibleColumnCount > 0 ? editorViewState.cachedVisibleColumnCount : 1;
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
	const lineLength = editorDocumentState.buffer.getLineEndOffset(lineIndex) - editorDocumentState.buffer.getLineStartOffset(lineIndex);
	let selectionEndColumn = lineIndex === end.row ? end.column : lineLength;
	if (lineIndex === end.row && end.column === 0 && end.row > start.row) {
		selectionEndColumn = 0;
	}
	if (selectionStartColumn === selectionEndColumn) {
		return null;
	}
	const startDisplay = editorViewState.layout.columnToDisplay(highlight, selectionStartColumn);
	const endDisplay = editorViewState.layout.columnToDisplay(highlight, selectionEndColumn);
	const visibleStart = Math.max(sliceStart, startDisplay);
	const visibleEnd = Math.min(sliceEnd, endDisplay);
	if (visibleEnd <= visibleStart) {
		return null;
	}
	return { startDisplay: visibleStart, endDisplay: visibleEnd };
}

export function ensureVisualLines(): void {
	const activeContext = getActiveCodeTabContext();
	const path = activeContext.descriptor.path;
	const estimatedVisibleRowCount = Math.max(1, editorViewState.cachedVisibleRowCount);
	editorViewState.scrollRow = editorViewState.layout.ensureVisualLines({
		buffer: editorDocumentState.buffer,
		wordWrapEnabled: editorViewState.wordWrapEnabled,
		scrollRow: editorViewState.scrollRow,
		documentVersion: editorDocumentState.textVersion,
		path,
		computeWrapWidth: () => computeWrapWidth(),
		estimatedVisibleRowCount,
	});
	const visualLineCount = editorViewState.layout.getVisualLineCount();
	editorViewState.scrollRow = editorViewState.layout.clampVisualScroll(editorViewState.scrollRow, visualLineCount, estimatedVisibleRowCount);
}

export function computeWrapWidth(): number {
	const resourceWidth = resourcePanel.isVisible() ? getResourcePanelWidth() : 0;
	const gutterSpace = updateGutterWidth() + 2;
	const verticalScrollbarSpace = 0;
	const available = editorViewState.viewportWidth - resourceWidth - gutterSpace - verticalScrollbarSpace;
	return Math.max(editorViewState.charAdvance, available - 2);
}

export function getVisualLineCount(): number {
	ensureVisualLines();
	return editorViewState.layout.getVisualLineCount();
}

export function visualIndexToSegment(index: number): VisualLineSegment {
	ensureVisualLines();
	return editorViewState.layout.visualIndexToSegment(index);
}

export function positionToVisualIndex(row: number, column: number): number {
	ensureVisualLines();
	const override = caretNavigation.lookup(row, column);
	if (override) {
		return override.visualIndex;
	}
	return editorViewState.layout.positionToVisualIndex(editorDocumentState.buffer, row, column);
}
export function computeRuntimeErrorOverlayMaxWidth(): number {
	const resourceWidth = resourcePanel.isVisible() ? getResourcePanelWidth() : 0;
	const gutterSpace = updateGutterWidth() + 2;
	const scrollbarSpace = editorViewState.codeVerticalScrollbarVisible ? constants.SCROLLBAR_WIDTH : 0;
	const rightMargin = constants.CODE_AREA_RIGHT_MARGIN;
	const connectorOffset = ERROR_OVERLAY_CONNECTOR_OFFSET + ERROR_OVERLAY_PADDING_X * 2;
	const available = editorViewState.viewportWidth - resourceWidth - gutterSpace - scrollbarSpace - rightMargin - connectorOffset;
	return Math.max(editorViewState.charAdvance, available);
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
	overlay.messageLines = splitText(overlay.message);
	rebuildRuntimeErrorOverlayView(overlay);
}

export function rewrapRuntimeErrorOverlays(): void {
	const visited = new Set<RuntimeErrorOverlay>();
	if (runtimeErrorState.activeOverlay) {
		visited.add(runtimeErrorState.activeOverlay);
		rewrapRuntimeErrorOverlay(runtimeErrorState.activeOverlay);
	}
	for (const context of editorSessionState.codeTabContexts.values()) {
		const overlay = context.runtimeErrorOverlay;
		if (overlay && !visited.has(overlay)) {
			visited.add(overlay);
			rewrapRuntimeErrorOverlay(overlay);
		}
	}
}
export function normalizeCaseOutsideStrings(text: string): string {
	if (!editorRuntimeState.caseInsensitive || editorRuntimeState.canonicalization === 'none') {
		return text;
	}
	const transform = editorRuntimeState.canonicalization === 'upper'
		? (ch: string) => ch.toUpperCase()
		: (ch: string) => ch.toLowerCase();
	return applyCaseOutsideStrings(text, transform);
}

export function capturePreMutationSource(): void {
	if (!editorRuntimeState.caseInsensitive) {
		return;
	}
	if (editorDocumentState.preMutationSource === null) {
		editorDocumentState.preMutationSource = getTextSnapshot(editorDocumentState.buffer);
	}
}

export function markTextMutated(): void {
	const record = editorDocumentState.undoStack[editorDocumentState.undoStack.length - 1];
	const anchor = editorDocumentState.selectionAnchor;
	record.setAfterState(
		editorDocumentState.cursorRow,
		editorDocumentState.cursorColumn,
		editorViewState.scrollRow,
		editorViewState.scrollColumn,
		anchor ? anchor.row : 0,
		anchor ? anchor.column : 0,
		anchor !== null,
	);
	editorDocumentState.saveGeneration = editorDocumentState.saveGeneration + 1;
	editorDocumentState.dirty = editorDocumentState.undoStack.length !== editorDocumentState.savePointDepth;
	const context = getActiveCodeTabContext();
	if (context) {
		context.saveGeneration = editorDocumentState.saveGeneration;
	}
	editorViewState.maxLineLengthDirty = true;
	markDiagnosticsDirty(getActiveCodeTabContext().id);
	bumpTextVersion();
	clearReferenceHighlights();
	updateActiveContextDirtyFlag();
	editorViewState.layout.ensureVisualLinesDirty();
	requestSemanticRefresh();
	clearForwardNavigationHistory();
	handlePostEditMutation();
	if (editorFeatureState.search.query.length > 0) startSearchJob();
}
export function bumpTextVersion(): void {
	editorDocumentState.textVersion = editorDocumentState.buffer.version;
}

export function getSourceForChunk(path: string): string {
	const asset = runtimeLuaPipeline.resolveLuaSourceRecord(Runtime.instance, path);
	const context = findCodeTabContext(path);
	if (context) {
		if (context.id === editorSessionState.activeCodeTabContextId) {
			return getTextSnapshot(editorDocumentState.buffer);
		}
		return getTextSnapshot(context.buffer);
	}
	const dirtyPath = buildDirtyFilePath(asset.source_path);
	const cached = getWorkspaceCachedSource(asset.source_path) ?? getWorkspaceCachedSource(dirtyPath);
	if (cached !== null) {
		return cached;
	}
	return asset.src;
}

export function invalidateLineRange(startRow: number, endRow: number): void {
	let from = Math.min(startRow, endRow);
	let to = Math.max(startRow, endRow);
	from = editorViewState.layout.clampBufferRow(editorDocumentState.buffer, from);
	to = editorViewState.layout.clampBufferRow(editorDocumentState.buffer, to);
	for (let row = from; row <= to; row += 1) {
		editorViewState.layout.invalidateLine(row);
	}
}

export function getLineRangeForMovement(): { startRow: number; endRow: number } {
	const range = TextEditing.getSelectionRange();
	if (!range) {
		return { startRow: editorDocumentState.cursorRow, endRow: editorDocumentState.cursorRow };
	}
	let endRow = range.end.row;
	if (range.end.column === 0 && endRow > range.start.row) {
		endRow -= 1;
	}
	return { startRow: range.start.row, endRow };
}

export function currentLine(): string {
	if (editorDocumentState.cursorRow < 0 || editorDocumentState.cursorRow >= editorDocumentState.buffer.getLineCount()) {
		return '';
	}
	return editorDocumentState.buffer.getLineContent(editorDocumentState.cursorRow);
}
