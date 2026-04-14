import { editorRuntimeState } from '../../common/editor_runtime_state';
import { showEditorMessage } from '../../../workbench/common/feedback_state';
import * as constants from '../../../common/constants';
import { clamp, clamp_wrap } from '../../../../utils/clamp';
import { getSelectionRange, getSelectionText } from '../../editing/text_editing_and_selection';
import type { GlobalSearchJob, GlobalSearchMatch, SearchComputationJob, SearchMatch, TextField } from '../../../common/types';
import type { ResourceDescriptor } from '../../../../emulator/types';
import { Runtime } from '../../../../emulator/runtime';
import * as runtimeLuaPipeline from '../../../../emulator/runtime_lua_pipeline';
import { enqueueBackgroundTask } from '../../../common/background_tasks';
import { beginNavigationCapture, completeNavigation } from '../../navigation/navigation_history';
import { updateDesiredColumn } from '../../ui/caret';
import { listResources } from '../../../../emulator/workspace';
import { openLuaCodeTab } from '../../../workbench/ui/tabs';
import { closeResourceSearch } from '../../../workbench/contrib/resources/resource_search';
import { closeLineJump } from './line_jump';
import { closeSymbolSearch } from '../symbols/symbol_search_shared';
import { clearReferenceHighlights } from '../intellisense/intellisense';
import { ensureCursorVisible, revealCursor } from '../../ui/caret';
import { resetBlink } from '../../render/render_caret';
import { scheduleMicrotask } from '../../../../platform/index';
import { textFromLines } from '../../text/source_text';
import { applyInlineFieldPointer, setFieldText } from '../../ui/inline_text_field';
import { setSingleCursorPosition, setSingleCursorSelectionAnchor } from '../../editing/cursor_state';
import { editorDocumentState } from '../../editing/editor_document_state';
import { editorViewState } from '../../ui/editor_view_state';
import { editorFeatureState } from '../../common/editor_feature_state';
import { renameController } from '../rename/rename_controller';

const LOCAL_ROWS_PER_SLICE = 256;
const GLOBAL_ROWS_PER_SLICE = 128;

type LocalSearchJob = SearchComputationJob & { version: number };

function normalizeQuery(raw: string): string {
	return editorRuntimeState.caseInsensitive ? raw.toLowerCase() : raw;
}

function forEachMatchInLine(line: string, query: string, cb: (start: number, end: number) => void): void {
	if (query.length === 0) return;
	const haystack = editorRuntimeState.caseInsensitive ? line.toLowerCase() : line;
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
	showEditorMessage('No matches found', constants.COLOR_STATUS_WARNING, 1.5);
}

export function activeSearchMatchCount(): number {
	return editorFeatureState.search.scope === 'global'
		? editorFeatureState.search.globalMatches.length
		: editorFeatureState.search.matches.length;
}

export function openSearch(useSelection: boolean, scope: 'local' | 'global' = 'local'): void {
	clearReferenceHighlights();
	closeSymbolSearch(false);
	closeResourceSearch(false);
	closeLineJump(false);
	renameController.cancel();

	editorFeatureState.search.scope = scope;
	editorFeatureState.search.displayOffset = 0;
	editorFeatureState.search.hoverIndex = -1;
	editorFeatureState.search.currentIndex = -1;

	if (scope === 'global') {
		cancelSearchJob();
		editorFeatureState.search.matches = [];
		editorFeatureState.search.globalMatches = [];
	} else {
		cancelGlobalSearchJob();
		editorFeatureState.search.globalMatches = [];
	}

	editorFeatureState.search.visible = true;
	editorFeatureState.search.active = true;

	applySearchFieldText(editorFeatureState.search.query, true);

	if (useSelection) {
		const range = getSelectionRange();
		const selected = getSelectionText();
		if (range && selected.length > 0 && selected.indexOf('\n') === -1) {
			applySearchFieldText(selected, true);
			editorDocumentState.cursorRow = range.start.row;
			editorDocumentState.cursorColumn = range.start.column;
		}
	}

	editorFeatureState.search.query = textFromLines(editorFeatureState.search.field.lines);
	onSearchQueryChanged();
	resetBlink();
}

export function closeSearch(clearQuery: boolean, forceHide = false): void {
	editorFeatureState.search.active = false;
	editorFeatureState.search.hoverIndex = -1;
	editorFeatureState.search.displayOffset = 0;

	if (clearQuery) {
		applySearchFieldText('', true);
	}
	editorFeatureState.search.query = textFromLines(editorFeatureState.search.field.lines);

	const hide = forceHide || clearQuery || editorFeatureState.search.query.length === 0;
	if (hide) {
		editorFeatureState.search.visible = false;
		editorFeatureState.search.scope = 'local';
		editorFeatureState.search.matches = [];
		editorFeatureState.search.globalMatches = [];
		editorFeatureState.search.currentIndex = -1;
		cancelSearchJob();
		cancelGlobalSearchJob();
	} else {
		if (editorFeatureState.search.scope !== 'local') {
			editorFeatureState.search.scope = 'local';
			cancelGlobalSearchJob();
			editorFeatureState.search.globalMatches = [];
		}
		editorFeatureState.search.matches = [];
		editorFeatureState.search.currentIndex = -1;
		editorFeatureState.search.visible = true;
		onSearchQueryChanged();
	}

	editorDocumentState.selectionAnchor = null;
	resetBlink();
}

export function focusEditorFromSearch(): void {
	editorFeatureState.search.active = false;
	editorFeatureState.search.hoverIndex = -1;
	editorFeatureState.search.field.selectionAnchor = null;
	editorFeatureState.search.field.pointerSelecting = false;
	if (editorFeatureState.search.query.length === 0) {
		editorFeatureState.search.visible = false;
		editorFeatureState.search.matches = [];
		editorFeatureState.search.globalMatches = [];
		editorFeatureState.search.currentIndex = -1;
		cancelSearchJob();
		cancelGlobalSearchJob();
	}
	resetBlink();
}

export function onSearchQueryChanged(): void {
	if (editorFeatureState.search.scope === 'global') {
		onGlobalSearchQueryChanged();
		return;
	}
	if (editorFeatureState.search.query.length === 0) {
		cancelSearchJob();
		editorFeatureState.search.matches = [];
		editorFeatureState.search.currentIndex = -1;
		editorDocumentState.selectionAnchor = null;
		editorFeatureState.search.displayOffset = 0;
		return;
	}
	startSearchJob();
}

export function onGlobalSearchQueryChanged(): void {
	editorFeatureState.search.displayOffset = 0;
	editorFeatureState.search.hoverIndex = -1;
	editorFeatureState.search.currentIndex = -1;
	if (editorFeatureState.search.query.length === 0) {
		cancelGlobalSearchJob();
		editorFeatureState.search.globalMatches = [];
		return;
	}
	startGlobalSearchJob();
}

export function startSearchJob(): void {
	cancelSearchJob();

	editorFeatureState.search.displayOffset = 0;
	editorFeatureState.search.hoverIndex = -1;
	editorFeatureState.search.currentIndex = -1;
	editorFeatureState.search.matches = [];
	editorDocumentState.selectionAnchor = null;

	const job: LocalSearchJob = {
		query: normalizeQuery(editorFeatureState.search.query),
		version: editorDocumentState.textVersion,
		nextRow: 0,
		matches: [],
		firstMatchAfterCursor: -1,
		cursorRow: editorDocumentState.cursorRow,
		cursorColumn: editorDocumentState.cursorColumn,
	};
	editorFeatureState.search.job = job;
	enqueueBackgroundTask(() => runLocalSearchSlice(job));
}

function runLocalSearchSlice(job: LocalSearchJob): boolean {
	if (editorFeatureState.search.job !== job) return false;
	if (job.query.length === 0 || job.version !== editorDocumentState.textVersion || editorFeatureState.search.query.length === 0) {
		editorFeatureState.search.job = null;
		return false;
	}
	let processed = 0;
	const lineCount = editorDocumentState.buffer.getLineCount();
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
	const line = editorDocumentState.buffer.getLineContent(row);
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
	if (editorFeatureState.search.job !== job) return;
	editorFeatureState.search.job = null;
	editorFeatureState.search.matches = job.matches;

	if (job.matches.length === 0) {
		editorFeatureState.search.currentIndex = -1;
		editorDocumentState.selectionAnchor = null;
		editorFeatureState.search.displayOffset = 0;
		return;
	}

	const initialIndex = job.firstMatchAfterCursor >= 0 ? job.firstMatchAfterCursor : 0;
	editorFeatureState.search.currentIndex = clamp(initialIndex, 0, job.matches.length - 1);
	ensureSearchSelectionVisible();
	if (editorFeatureState.search.active) {
		applySearchSelection(editorFeatureState.search.currentIndex, { preview: true, keepSearchActive: true });
	}
}

export function cancelSearchJob(): void {
	editorFeatureState.search.job = null;
}

function ensureLocalJobCompleted(): void {
	const job = editorFeatureState.search.job as LocalSearchJob;
	if (!job) return;
	while (editorFeatureState.search.job === job && runLocalSearchSlice(job)) {
		// run synchronously
	}
}

function startGlobalSearchJob(): void {
	cancelGlobalSearchJob();

	const descriptors = listResources().filter(entry => entry.type === 'lua');
	const job: GlobalSearchJob = {
		query: normalizeQuery(editorFeatureState.search.query),
		descriptors,
		descriptorIndex: 0,
		currentLines: null,
		nextRow: 0,
		matches: [],
		limitHit: false,
	};
	editorFeatureState.search.globalJob = job;
	editorFeatureState.search.globalMatches = [];
	editorFeatureState.search.currentIndex = -1;
	editorFeatureState.search.displayOffset = 0;
	editorFeatureState.search.hoverIndex = -1;
	enqueueBackgroundTask(() => runGlobalSearchSlice(job));
}

function runGlobalSearchSlice(job: GlobalSearchJob): boolean {
	if (editorFeatureState.search.globalJob !== job) return false;
	if (job.query.length === 0) {
		editorFeatureState.search.globalJob = null;
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
	if (editorFeatureState.search.globalJob !== job) return;
	editorFeatureState.search.globalJob = null;
	editorFeatureState.search.globalMatches = job.matches;

	if (job.matches.length === 0) {
		editorFeatureState.search.currentIndex = -1;
		editorFeatureState.search.displayOffset = 0;
		return;
	}

	editorFeatureState.search.currentIndex = clamp(editorFeatureState.search.currentIndex, 0, job.matches.length - 1);
	ensureSearchSelectionVisible();
}

export function cancelGlobalSearchJob(): void {
	editorFeatureState.search.globalJob = null;
}

function focusLocalMatch(index: number, recordNavigation: boolean): void {
	const match = editorFeatureState.search.matches[index];
	const navigationCheckpoint = recordNavigation ? beginNavigationCapture() : null;
	setSingleCursorPosition(editorDocumentState, match.row, match.start);
	setSingleCursorSelectionAnchor(editorDocumentState, match.row, match.end);
	updateDesiredColumn();
	resetBlink();
	revealCursor();
	if (recordNavigation) {
		completeNavigation(navigationCheckpoint);
	}
}

function focusGlobalMatch(index: number): void {
	const match = editorFeatureState.search.globalMatches[index];
	const navigationCheckpoint = beginNavigationCapture();
	openLuaCodeTab(match.descriptor);
	scheduleMicrotask(() => {
		const row = clamp(match.row, 0, editorDocumentState.buffer.getLineCount() - 1);
		const line = editorDocumentState.buffer.getLineContent(row);
		const startColumn = clamp(match.start, 0, line.length);
		const endColumn = clamp(match.end, 0, line.length);
		setSingleCursorPosition(editorDocumentState, row, startColumn);
		setSingleCursorSelectionAnchor(editorDocumentState, row, endColumn);
		ensureCursorVisible();
		resetBlink();
		completeNavigation(navigationCheckpoint);
	});
}

function nextSearchIndex(delta: number, wrap: boolean): number {
	const total = activeSearchMatchCount();
	let next = editorFeatureState.search.currentIndex;
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
	if (editorFeatureState.search.scope === 'local') {
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
	const keepSearchActive = options?.keepSearchActive === true || editorFeatureState.search.active;
	const next = nextSearchIndex(delta, wrap);
	applySearchSelection(next, { preview, keepSearchActive });
}

export function applySearchSelection(index: number, options?: { preview?: boolean; keepSearchActive?: boolean }): void {
	const total = activeSearchMatchCount();
	if (total === 0) return;

	const targetIndex = clamp(index, 0, total - 1);
	editorFeatureState.search.currentIndex = targetIndex;
	ensureSearchSelectionVisible();

	if (editorFeatureState.search.scope === 'local') {
		focusLocalMatch(targetIndex, options?.preview !== true);
	} else if (!options?.preview) {
		focusGlobalMatch(targetIndex);
	}

	if (!options?.preview && !options?.keepSearchActive) {
		editorFeatureState.search.active = false;
		editorFeatureState.search.field.selectionAnchor = null;
		editorFeatureState.search.field.pointerSelecting = false;
	}
}

export function jumpToNextMatch(): void {
	stepSearchSelection(1, { wrap: true });
}

export function jumpToPreviousMatch(): void {
	stepSearchSelection(-1, { wrap: true });
}

export function searchPageSize(): number {
	if (!editorFeatureState.search.visible) {
		return constants.SEARCH_MAX_RESULTS;
	}
	const baseHeight = editorViewState.lineHeight + constants.SEARCH_BAR_MARGIN_Y * 2;
	const rowHeight = editorViewState.lineHeight * 2;
	const reservedHeight = editorViewState.lineHeight * 6;
	const available = editorViewState.viewportHeight
		- editorViewState.headerHeight
		- editorViewState.tabBarHeight * editorViewState.tabBarRowCount
		- baseHeight
		- reservedHeight;
	const fit = Math.floor(available / rowHeight);
	return clamp(fit, 1, constants.GLOBAL_SEARCH_RESULT_LIMIT);
}

export function ensureSearchSelectionVisible(): void {
	const total = activeSearchMatchCount();
	if (total === 0) {
		editorFeatureState.search.displayOffset = 0;
		return;
	}
	const pageSize = searchPageSize();
	editorFeatureState.search.currentIndex = clamp(editorFeatureState.search.currentIndex, 0, total - 1);
	if (editorFeatureState.search.currentIndex < editorFeatureState.search.displayOffset) {
		editorFeatureState.search.displayOffset = editorFeatureState.search.currentIndex;
	} else if (editorFeatureState.search.currentIndex >= editorFeatureState.search.displayOffset + pageSize) {
		editorFeatureState.search.displayOffset = editorFeatureState.search.currentIndex - pageSize + 1;
	}
	const maxOffset = Math.max(0, total - pageSize);
	editorFeatureState.search.displayOffset = clamp(editorFeatureState.search.displayOffset, 0, maxOffset);
}

export function computeSearchPageStats(): { total: number; offset: number; visible: number } {
	const total = editorFeatureState.search.visible ? activeSearchMatchCount() : 0;
	if (total === 0) {
		editorFeatureState.search.displayOffset = 0;
		return { total: 0, offset: 0, visible: 0 };
	}

	const pageSize = searchPageSize();
	const maxOffset = Math.max(0, total - 1);
	editorFeatureState.search.displayOffset = clamp(editorFeatureState.search.displayOffset, 0, maxOffset);

	const remaining = total - editorFeatureState.search.displayOffset;
	const visible = Math.min(pageSize, remaining);
	return { total, offset: editorFeatureState.search.displayOffset, visible };
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
	if (editorFeatureState.search.scope === 'global') {
		const match = editorFeatureState.search.globalMatches[index];
		return {
			primary: match.pathLabel,
			secondary: match.snippet,
			detail: `:${match.row + 1}`,
		};
	}

	const match = editorFeatureState.search.matches[index];
	const lineText = editorDocumentState.buffer.getLineContent(match.row);
	return {
		primary: `Line ${match.row + 1}`,
		secondary: buildSnippet(lineText, match.start, match.end),
	};
}

export function applySearchFieldText(value: string, moveCursorToEnd: boolean): void {
	editorFeatureState.search.query = value;
	setFieldText(editorFeatureState.search.field, value, moveCursorToEnd);
}

export function processInlineFieldPointer(field: TextField, textLeft: number, pointerX: number, justPressed: boolean, pointerPressed: boolean): void {
	const result = applyInlineFieldPointer(field, {
		metrics: editorViewState.inlineFieldMetricsRef,
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
