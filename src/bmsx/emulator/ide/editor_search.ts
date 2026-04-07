import { ide_state } from './ide_state';
import * as constants from './constants';
import { clamp, clamp_wrap } from '../../utils/clamp';
import { getSelectionRange, getSelectionText } from './text_editing_and_selection';
import type { GlobalSearchJob, GlobalSearchMatch, SearchComputationJob, SearchMatch, TextField } from './types';
import type { ResourceDescriptor } from '../types';
import { Runtime } from '../runtime';
import * as runtimeLuaPipeline from '../runtime_lua_pipeline';
import { enqueueBackgroundTask } from './background_tasks';
import { beginNavigationCapture, completeNavigation } from './navigation_history';
import { updateDesiredColumn } from './caret';
import { listResources } from '../workspace';
import { openLuaCodeTab } from './editor_tabs';
import { closeSymbolSearch, closeResourceSearch, closeLineJump } from './search_bars';
import { clearReferenceHighlights } from './intellisense';
import { ensureCursorVisible, revealCursor } from './caret';
import { resetBlink } from './render/render_caret';
import { scheduleMicrotask } from '../../platform';
import { textFromLines } from './text/source_text';
import { applyInlineFieldPointer, setFieldText } from './inline_text_field';
import { setSingleCursorPosition, setSingleCursorSelectionAnchor } from './cursor_state';

const LOCAL_ROWS_PER_SLICE = 256;
const GLOBAL_ROWS_PER_SLICE = 128;

type LocalSearchJob = SearchComputationJob & { version: number };

function normalizeQuery(raw: string): string {
	return ide_state.caseInsensitive ? raw.toLowerCase() : raw;
}

function forEachMatchInLine(line: string, query: string, cb: (start: number, end: number) => void): void {
	if (query.length === 0) return;
	const haystack = ide_state.caseInsensitive ? line.toLowerCase() : line;
	let from = 0;
	const needleLength = query.length;
	while (from <= haystack.length - needleLength) {
		const index = haystack.indexOf(query, from);
		if (index === -1) return;
		cb(index, index + needleLength);
		from = index + needleLength;
	}
}

function buildSnippet(line: string, start: number, end: number): string {
	const padding = 32;
	const sliceStart = Math.max(0, start - padding);
	const sliceEnd = Math.min(line.length, end + padding);
	let snippet = line.slice(sliceStart, sliceEnd).trim();
	if (sliceStart > 0) snippet = `…${snippet}`;
	if (sliceEnd < line.length) snippet = `${snippet}…`;
	return snippet.length === 0 ? '<blank>' : snippet;
}

function descriptorLabel(descriptor: ResourceDescriptor): string {
	return descriptor.path.replace(/\\\\/g, '/');
}

function showNoMatches(): void {
	ide_state.showMessage('No matches found', constants.COLOR_STATUS_WARNING, 1.5);
}

export function activeSearchMatchCount(): number {
	return ide_state.searchScope === 'global'
		? ide_state.globalSearchMatches.length
		: ide_state.searchMatches.length;
}

export function openSearch(useSelection: boolean, scope: 'local' | 'global' = 'local'): void {
	clearReferenceHighlights();
	closeSymbolSearch(false);
	closeResourceSearch(false);
	closeLineJump(false);
	ide_state.renameController.cancel();

	ide_state.searchScope = scope;
	ide_state.searchDisplayOffset = 0;
	ide_state.searchHoverIndex = -1;
	ide_state.searchCurrentIndex = -1;

	if (scope === 'global') {
		cancelSearchJob();
		ide_state.searchMatches = [];
		ide_state.globalSearchMatches = [];
	} else {
		cancelGlobalSearchJob();
		ide_state.globalSearchMatches = [];
	}

	ide_state.searchVisible = true;
	ide_state.searchActive = true;

	applySearchFieldText(ide_state.searchQuery, true);

	if (useSelection) {
		const range = getSelectionRange();
		const selected = getSelectionText();
		if (range && selected.length > 0 && selected.indexOf('\n') === -1) {
			applySearchFieldText(selected, true);
			ide_state.cursorRow = range.start.row;
			ide_state.cursorColumn = range.start.column;
		}
	}

	ide_state.searchQuery = textFromLines(ide_state.searchField.lines);
	onSearchQueryChanged();
	resetBlink();
}

export function closeSearch(clearQuery: boolean, forceHide = false): void {
	ide_state.searchActive = false;
	ide_state.searchHoverIndex = -1;
	ide_state.searchDisplayOffset = 0;

	if (clearQuery) {
		applySearchFieldText('', true);
	}
	ide_state.searchQuery = textFromLines(ide_state.searchField.lines);

	const hide = forceHide || clearQuery || ide_state.searchQuery.length === 0;
	if (hide) {
		ide_state.searchVisible = false;
		ide_state.searchScope = 'local';
		ide_state.searchMatches = [];
		ide_state.globalSearchMatches = [];
		ide_state.searchCurrentIndex = -1;
		cancelSearchJob();
		cancelGlobalSearchJob();
	} else {
		if (ide_state.searchScope !== 'local') {
			ide_state.searchScope = 'local';
			cancelGlobalSearchJob();
			ide_state.globalSearchMatches = [];
		}
		ide_state.searchMatches = [];
		ide_state.searchCurrentIndex = -1;
		ide_state.searchVisible = true;
		onSearchQueryChanged();
	}

	ide_state.selectionAnchor = null;
	resetBlink();
}

export function focusEditorFromSearch(): void {
	ide_state.searchActive = false;
	ide_state.searchHoverIndex = -1;
	ide_state.searchField.selectionAnchor = null;
	ide_state.searchField.pointerSelecting = false;
	if (ide_state.searchQuery.length === 0) {
		ide_state.searchVisible = false;
		ide_state.searchMatches = [];
		ide_state.globalSearchMatches = [];
		ide_state.searchCurrentIndex = -1;
		cancelSearchJob();
		cancelGlobalSearchJob();
	}
	resetBlink();
}

export function onSearchQueryChanged(): void {
	if (ide_state.searchScope === 'global') {
		onGlobalSearchQueryChanged();
		return;
	}
	if (ide_state.searchQuery.length === 0) {
		cancelSearchJob();
		ide_state.searchMatches = [];
		ide_state.searchCurrentIndex = -1;
		ide_state.selectionAnchor = null;
		ide_state.searchDisplayOffset = 0;
		return;
	}
	startSearchJob();
}

export function onGlobalSearchQueryChanged(): void {
	ide_state.searchDisplayOffset = 0;
	ide_state.searchHoverIndex = -1;
	ide_state.searchCurrentIndex = -1;
	if (ide_state.searchQuery.length === 0) {
		cancelGlobalSearchJob();
		ide_state.globalSearchMatches = [];
		return;
	}
	startGlobalSearchJob();
}

export function startSearchJob(): void {
	cancelSearchJob();

	ide_state.searchDisplayOffset = 0;
	ide_state.searchHoverIndex = -1;
	ide_state.searchCurrentIndex = -1;
	ide_state.searchMatches = [];
	ide_state.selectionAnchor = null;

	const job: LocalSearchJob = {
		query: normalizeQuery(ide_state.searchQuery),
		version: ide_state.textVersion,
		nextRow: 0,
		matches: [],
		firstMatchAfterCursor: -1,
		cursorRow: ide_state.cursorRow,
		cursorColumn: ide_state.cursorColumn,
	};
	ide_state.searchJob = job;
	enqueueBackgroundTask(() => runLocalSearchSlice(job));
}

function runLocalSearchSlice(job: LocalSearchJob): boolean {
	if (ide_state.searchJob !== job) return false;
	if (job.query.length === 0 || job.version !== ide_state.textVersion || ide_state.searchQuery.length === 0) {
		ide_state.searchJob = null;
		return false;
	}
	let processed = 0;
	const lineCount = ide_state.buffer.getLineCount();
	while (job.nextRow < lineCount && processed < LOCAL_ROWS_PER_SLICE) {
		const row = job.nextRow;
		job.nextRow += 1;
		processed += 1;
		collectLocalMatches(job, row);
	}
	if (job.nextRow >= lineCount) {
		completeLocalSearchJob(job);
		return false;
	}
	return true;
}

function collectLocalMatches(job: LocalSearchJob, row: number): void {
	const line = ide_state.buffer.getLineContent(row);
	if (line.length === 0) return;
	forEachMatchInLine(line, job.query, (start, end) => {
		const match: SearchMatch = { row, start, end };
		job.matches.push(match);
		const matchIndex = job.matches.length - 1;
		if (job.firstMatchAfterCursor === -1) {
			if (row > job.cursorRow || (row === job.cursorRow && start >= job.cursorColumn)) {
				job.firstMatchAfterCursor = matchIndex;
			}
		}
	});
}

function completeLocalSearchJob(job: LocalSearchJob): void {
	if (ide_state.searchJob !== job) return;
	ide_state.searchJob = null;
	ide_state.searchMatches = job.matches;

	if (job.matches.length === 0) {
		ide_state.searchCurrentIndex = -1;
		ide_state.selectionAnchor = null;
		ide_state.searchDisplayOffset = 0;
		return;
	}

	const initialIndex = job.firstMatchAfterCursor >= 0 ? job.firstMatchAfterCursor : 0;
	ide_state.searchCurrentIndex = clamp(initialIndex, 0, job.matches.length - 1);
	ensureSearchSelectionVisible();
	if (ide_state.searchActive) {
		applySearchSelection(ide_state.searchCurrentIndex, { preview: true, keepSearchActive: true });
	}
}

export function cancelSearchJob(): void {
	ide_state.searchJob = null;
}

function ensureLocalJobCompleted(): void {
	const job = ide_state.searchJob as LocalSearchJob;
	if (!job) return;
	while (ide_state.searchJob === job && runLocalSearchSlice(job)) {
		// run synchronously
	}
}

function startGlobalSearchJob(): void {
	cancelGlobalSearchJob();

	const descriptors = listResources().filter(entry => entry.type === 'lua');
	const job: GlobalSearchJob = {
		query: normalizeQuery(ide_state.searchQuery),
		descriptors,
		descriptorIndex: 0,
		currentLines: null,
		nextRow: 0,
		matches: [],
		limitHit: false,
	};
	ide_state.globalSearchJob = job;
	ide_state.globalSearchMatches = [];
	ide_state.searchCurrentIndex = -1;
	ide_state.searchDisplayOffset = 0;
	ide_state.searchHoverIndex = -1;
	enqueueBackgroundTask(() => runGlobalSearchSlice(job));
}

function runGlobalSearchSlice(job: GlobalSearchJob): boolean {
	if (ide_state.globalSearchJob !== job) return false;
	if (job.query.length === 0) {
		ide_state.globalSearchJob = null;
		return false;
	}

	let processed = 0;
	while (job.descriptorIndex < job.descriptors.length && processed < GLOBAL_ROWS_PER_SLICE && !job.limitHit) {
		if (job.currentLines === null) {
			const descriptor = job.descriptors[job.descriptorIndex];
			const source = runtimeLuaPipeline.resourceSourceForChunk(Runtime.instance, descriptor.path);
			job.currentLines = source.split(/\r?\n/);
			job.nextRow = 0;
		}

		const lines = job.currentLines;
		while (job.nextRow < lines.length && processed < GLOBAL_ROWS_PER_SLICE && !job.limitHit) {
			const row = job.nextRow;
			job.nextRow += 1;
			processed += 1;
			const line = lines[row];
			if (line.length === 0) continue;
			forEachMatchInLine(line, job.query, (start, end) => {
				if (job.limitHit) return;
				const descriptor = job.descriptors[job.descriptorIndex];
				const match: GlobalSearchMatch = {
					descriptor,
					pathLabel: descriptorLabel(descriptor),
					row,
					start,
					end,
					snippet: buildSnippet(line, start, end),
					path: descriptor.path,
				};
				job.matches.push(match);
				if (job.matches.length >= constants.GLOBAL_SEARCH_RESULT_LIMIT) {
					job.limitHit = true;
				}
			});
		}

		if (job.nextRow >= lines.length) {
			job.currentLines = null;
			job.nextRow = 0;
			job.descriptorIndex += 1;
		}
	}

	if (job.limitHit || job.descriptorIndex >= job.descriptors.length) {
		completeGlobalSearchJob(job);
		return false;
	}
	return true;
}

function completeGlobalSearchJob(job: GlobalSearchJob): void {
	if (ide_state.globalSearchJob !== job) return;
	ide_state.globalSearchJob = null;
	ide_state.globalSearchMatches = job.matches;

	if (job.matches.length === 0) {
		ide_state.searchCurrentIndex = -1;
		ide_state.searchDisplayOffset = 0;
		return;
	}

	ide_state.searchCurrentIndex = clamp(ide_state.searchCurrentIndex, 0, job.matches.length - 1);
	ensureSearchSelectionVisible();
}

export function cancelGlobalSearchJob(): void {
	ide_state.globalSearchJob = null;
}

function focusLocalMatch(index: number, recordNavigation: boolean): void {
	const match = ide_state.searchMatches[index];
	const navigationCheckpoint = recordNavigation ? beginNavigationCapture() : null;
	setSingleCursorPosition(ide_state, match.row, match.start);
	setSingleCursorSelectionAnchor(ide_state, match.row, match.end);
	updateDesiredColumn();
	resetBlink();
	revealCursor();
	if (recordNavigation) {
		completeNavigation(navigationCheckpoint);
	}
}

function focusGlobalMatch(index: number): void {
	const match = ide_state.globalSearchMatches[index];
	const navigationCheckpoint = beginNavigationCapture();
	openLuaCodeTab(match.descriptor);
	scheduleMicrotask(() => {
		const row = clamp(match.row, 0, ide_state.buffer.getLineCount() - 1);
		const line = ide_state.buffer.getLineContent(row);
		const startColumn = clamp(match.start, 0, line.length);
		const endColumn = clamp(match.end, 0, line.length);
		setSingleCursorPosition(ide_state, row, startColumn);
		setSingleCursorSelectionAnchor(ide_state, row, endColumn);
		ensureCursorVisible();
		resetBlink();
		completeNavigation(navigationCheckpoint);
	});
}

function nextSearchIndex(delta: number, wrap: boolean): number {
	const total = activeSearchMatchCount();
	let next = ide_state.searchCurrentIndex;
	if (next < 0) {
		next = delta >= 0 ? 0 : total - 1;
	} else {
		next += delta;
	}
	if (wrap) {
		return clamp_wrap(next, 0, total - 1);
	}
	return clamp(next, 0, total - 1);
}

export function stepSearchSelection(delta: number, options?: { wrap?: boolean; preview?: boolean; keepSearchActive?: boolean }): void {
	if (ide_state.searchScope === 'local') {
		ensureLocalJobCompleted();
	}
	const total = activeSearchMatchCount();
	if (total === 0) {
		if (!options?.preview) {
			showNoMatches();
		}
		return;
	}
	const wrap = options?.wrap === true;
	const preview = options?.preview === true;
	const keepSearchActive = options?.keepSearchActive === true || ide_state.searchActive;
	const next = nextSearchIndex(delta, wrap);
	applySearchSelection(next, { preview, keepSearchActive });
}

export function applySearchSelection(index: number, options?: { preview?: boolean; keepSearchActive?: boolean }): void {
	const total = activeSearchMatchCount();
	if (total === 0) return;

	const targetIndex = clamp(index, 0, total - 1);
	ide_state.searchCurrentIndex = targetIndex;
	ensureSearchSelectionVisible();

	if (ide_state.searchScope === 'local') {
		focusLocalMatch(targetIndex, options?.preview !== true);
	} else if (!options?.preview) {
		focusGlobalMatch(targetIndex);
	}

	if (!options?.preview && !options?.keepSearchActive) {
		ide_state.searchActive = false;
		ide_state.searchField.selectionAnchor = null;
		ide_state.searchField.pointerSelecting = false;
	}
}

export function jumpToNextMatch(): void {
	stepSearchSelection(1, { wrap: true });
}

export function jumpToPreviousMatch(): void {
	stepSearchSelection(-1, { wrap: true });
}

export function searchPageSize(): number {
	if (!ide_state.searchVisible) {
		return constants.SEARCH_MAX_RESULTS;
	}
	const baseHeight = ide_state.lineHeight + constants.SEARCH_BAR_MARGIN_Y * 2;
	const rowHeight = ide_state.lineHeight * 2;
	const reservedHeight = ide_state.lineHeight * 6;
	const available = ide_state.viewportHeight
		- ide_state.headerHeight
		- ide_state.tabBarHeight * ide_state.tabBarRowCount
		- baseHeight
		- reservedHeight;
	const fit = Math.floor(available / rowHeight);
	return clamp(fit, 1, constants.GLOBAL_SEARCH_RESULT_LIMIT);
}

export function ensureSearchSelectionVisible(): void {
	const total = activeSearchMatchCount();
	if (total === 0) {
		ide_state.searchDisplayOffset = 0;
		return;
	}
	const pageSize = searchPageSize();
	ide_state.searchCurrentIndex = clamp(ide_state.searchCurrentIndex, 0, total - 1);
	if (ide_state.searchCurrentIndex < ide_state.searchDisplayOffset) {
		ide_state.searchDisplayOffset = ide_state.searchCurrentIndex;
	} else if (ide_state.searchCurrentIndex >= ide_state.searchDisplayOffset + pageSize) {
		ide_state.searchDisplayOffset = ide_state.searchCurrentIndex - pageSize + 1;
	}
	const maxOffset = Math.max(0, total - pageSize);
	ide_state.searchDisplayOffset = clamp(ide_state.searchDisplayOffset, 0, maxOffset);
}

export function computeSearchPageStats(): { total: number; offset: number; visible: number } {
	const total = ide_state.searchVisible ? activeSearchMatchCount() : 0;
	if (total === 0) {
		ide_state.searchDisplayOffset = 0;
		return { total: 0, offset: 0, visible: 0 };
	}

	const pageSize = searchPageSize();
	const maxOffset = Math.max(0, total - 1);
	ide_state.searchDisplayOffset = clamp(ide_state.searchDisplayOffset, 0, maxOffset);

	const remaining = total - ide_state.searchDisplayOffset;
	const visible = Math.min(pageSize, remaining);
	return { total, offset: ide_state.searchDisplayOffset, visible };
}

export function getVisibleSearchResultEntries(): Array<{ primary: string; secondary?: string; detail?: string }> {
	const stats = computeSearchPageStats();
	const results: Array<{ primary: string; secondary?: string; detail?: string }> = [];
	for (let i = 0; i < stats.visible; i += 1) {
		results.push(buildSearchResultEntry(stats.offset + i));
	}
	return results;
}

function buildSearchResultEntry(index: number): { primary: string; secondary?: string; detail?: string } {
	if (ide_state.searchScope === 'global') {
		const match = ide_state.globalSearchMatches[index];
		return {
			primary: match.pathLabel,
			secondary: match.snippet,
			detail: `:${match.row + 1}`,
		};
	}

	const match = ide_state.searchMatches[index];
	const lineText = ide_state.buffer.getLineContent(match.row);
	return {
		primary: `Line ${match.row + 1}`,
		secondary: buildSnippet(lineText, match.start, match.end),
	};
}

export function applySearchFieldText(value: string, moveCursorToEnd: boolean): void {
	ide_state.searchQuery = value;
	setFieldText(ide_state.searchField, value, moveCursorToEnd);
}

export function processInlineFieldPointer(field: TextField, textLeft: number, pointerX: number, justPressed: boolean, pointerPressed: boolean): void {
	const result = applyInlineFieldPointer(field, {
		metrics: ide_state.inlineFieldMetricsRef,
		textLeft,
		pointerX,
		justPressed,
		pointerPressed,
		doubleClickInterval: constants.DOUBLE_CLICK_MAX_INTERVAL_MS,
	});
	if (result.requestBlinkReset) {
		resetBlink();
	}
}
