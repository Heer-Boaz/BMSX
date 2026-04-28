import { editorRuntimeState } from '../../common/runtime_state';
import { showEditorMessage } from '../../../common/feedback_state';
import * as constants from '../../../common/constants';
import { clamp, clamp_wrap } from '../../../../common/clamp';
import { getSelectionRange, getSelectionText } from '../../editing/text_editing_and_selection';
import type { GlobalSearchJob, GlobalSearchMatch, SearchComputationJob, SearchMatch, TextField } from '../../../common/models';
import * as luaPipeline from '../../../runtime/lua_pipeline';
import { enqueueBackgroundTask } from '../../../common/background_tasks';
import { beginNavigationCapture, completeNavigation } from '../../../navigation/navigation_history';
import { updateDesiredColumn } from '../../ui/view/caret/caret';
import { listResources } from '../../../workspace/workspace';
import { closeLineJump } from './line_jump';
import { closeSymbolSearch } from '../symbols/shared';
import { clearReferenceHighlights } from '../intellisense/engine';
import { revealCursor } from '../../ui/view/caret/caret';
import { resetBlink } from '../../render/caret';
import { applyInlineFieldPointer, setFieldText } from '../../ui/inline/text_field';
import { setSingleCursorPosition, setSingleCursorSelectionAnchor } from '../../editing/cursor/state';
import { editorDocumentState } from '../../editing/document_state';
import { splitText } from '../../../../common/text_lines';
import { editorViewState } from '../../ui/view/state';
import type { RenameController } from '../rename/controller';
import { editorSearchState } from './widget_state';
import type { Runtime } from '../../../../machine/runtime/runtime';

const LOCAL_ROWS_PER_SLICE = 256;
const GLOBAL_ROWS_PER_SLICE = 128;

type LocalSearchJob = SearchComputationJob & { version: number };

function normalizeQuery(raw: string): string {
	return editorRuntimeState.caseInsensitive ? raw.toLowerCase() : raw;
}

function forEachMatchInLine(line: string, query: string, cb: (start: number, end: number) => void): void {
	if (query.length === 0) return;
	const haystack = normalizeQuery(line);
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
	const sliceStart = start - padding;
	const sliceEnd = Math.min(line.length, end + padding);
	let snippet = line.slice(sliceStart, sliceEnd).trim();
	if (sliceStart > 0) snippet = `…${snippet}`;
	if (sliceEnd < line.length) snippet = `${snippet}…`;
	return snippet.length === 0 ? '<blank>' : snippet;
}

export function activeSearchMatchCount(): number {
	return editorSearchState.scope === 'global'
		? editorSearchState.globalMatches.length
		: editorSearchState.matches.length;
}

export class EditorSearchController {
	public constructor(private readonly runtime: Runtime, private readonly renameController: RenameController) {
	}

	public openSearch(useSelection: boolean, scope: 'local' | 'global' = 'local'): void {
		clearReferenceHighlights();
		closeSymbolSearch(false);
		closeLineJump(false);
		this.renameController.cancel();

		editorSearchState.scope = scope;
		editorSearchState.displayOffset = 0;
		editorSearchState.hoverIndex = -1;
		editorSearchState.currentIndex = -1;

		if (scope === 'global') {
			cancelSearchJob();
			editorSearchState.matches = [];
			editorSearchState.globalMatches = [];
		} else {
			cancelGlobalSearchJob();
			editorSearchState.globalMatches = [];
		}

		editorSearchState.visible = true;
		editorSearchState.active = true;

		applySearchFieldText(editorSearchState.query, true);

		if (useSelection) {
			const range = getSelectionRange();
			const selected = getSelectionText();
			if (range && selected.length > 0 && selected.indexOf('\n') === -1) {
				applySearchFieldText(selected, true);
				editorDocumentState.cursorRow = range.start.row;
				editorDocumentState.cursorColumn = range.start.column;
			}
		}

		editorSearchState.query = editorSearchState.field.text;
		this.onSearchQueryChanged();
		resetBlink();
	}

	public onSearchQueryChanged(): void {
		if (editorSearchState.scope === 'global') {
			this.onGlobalSearchQueryChanged();
			return;
		}
		onLocalSearchQueryChanged();
	}

	private onGlobalSearchQueryChanged(): void {
		editorSearchState.displayOffset = 0;
		editorSearchState.hoverIndex = -1;
		editorSearchState.currentIndex = -1;
		if (editorSearchState.query.length === 0) {
			cancelGlobalSearchJob();
			editorSearchState.globalMatches = [];
			return;
		}
		startGlobalSearchJob(this.runtime);
	}
}

export function closeSearch(clearQuery: boolean, forceHide = false): void {
	editorSearchState.active = false;
	editorSearchState.hoverIndex = -1;
	editorSearchState.displayOffset = 0;

	if (clearQuery) {
		applySearchFieldText('', true);
	}
	editorSearchState.query = editorSearchState.field.text;

	const hide = forceHide || clearQuery || editorSearchState.query.length === 0;
	if (hide) {
		editorSearchState.visible = false;
		editorSearchState.scope = 'local';
		editorSearchState.matches = [];
		editorSearchState.globalMatches = [];
		editorSearchState.currentIndex = -1;
		cancelSearchJob();
		cancelGlobalSearchJob();
	} else {
		if (editorSearchState.scope !== 'local') {
			editorSearchState.scope = 'local';
			cancelGlobalSearchJob();
			editorSearchState.globalMatches = [];
		}
		editorSearchState.matches = [];
		editorSearchState.currentIndex = -1;
		editorSearchState.visible = true;
		onLocalSearchQueryChanged();
	}

	editorDocumentState.selectionAnchor = null;
	resetBlink();
}

export function focusEditorFromSearch(): void {
	editorSearchState.active = false;
	editorSearchState.hoverIndex = -1;
	editorSearchState.field.selectionAnchor = null;
	editorSearchState.field.pointerSelecting = false;
	if (editorSearchState.query.length === 0) {
		editorSearchState.visible = false;
		editorSearchState.matches = [];
		editorSearchState.globalMatches = [];
		editorSearchState.currentIndex = -1;
		cancelSearchJob();
		cancelGlobalSearchJob();
	}
	resetBlink();
}

function onLocalSearchQueryChanged(): void {
	if (editorSearchState.query.length === 0) {
		cancelSearchJob();
		editorSearchState.matches = [];
		editorSearchState.currentIndex = -1;
		editorDocumentState.selectionAnchor = null;
		editorSearchState.displayOffset = 0;
		return;
	}
	startSearchJob();
}

export function startSearchJob(): void {
	cancelSearchJob();

	editorSearchState.displayOffset = 0;
	editorSearchState.hoverIndex = -1;
	editorSearchState.currentIndex = -1;
	editorSearchState.matches = [];
	editorDocumentState.selectionAnchor = null;

	const job: LocalSearchJob = {
		query: normalizeQuery(editorSearchState.query),
		version: editorDocumentState.textVersion,
		nextRow: 0,
		matches: [],
		firstMatchAfterCursor: -1,
		cursorRow: editorDocumentState.cursorRow,
		cursorColumn: editorDocumentState.cursorColumn,
	};
	editorSearchState.job = job;
	enqueueBackgroundTask(() => runLocalSearchSlice(job));
}

function runLocalSearchSlice(job: LocalSearchJob): boolean {
	if (editorSearchState.job !== job) return false;
	if (job.query.length === 0 || job.version !== editorDocumentState.textVersion || editorSearchState.query.length === 0) {
		editorSearchState.job = null;
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
	if (editorSearchState.job !== job) return;
	editorSearchState.job = null;
	editorSearchState.matches = job.matches;

	if (job.matches.length === 0) {
		editorSearchState.currentIndex = -1;
		editorDocumentState.selectionAnchor = null;
		editorSearchState.displayOffset = 0;
		return;
	}

	const initialIndex = job.firstMatchAfterCursor >= 0 ? job.firstMatchAfterCursor : 0;
	editorSearchState.currentIndex = clamp(initialIndex, 0, job.matches.length - 1);
	ensureSearchSelectionVisible();
	if (editorSearchState.active) {
		applySearchSelection(editorSearchState.currentIndex, { preview: true, keepSearchActive: true });
	}
}

export function cancelSearchJob(): void {
	editorSearchState.job = null;
}

function ensureLocalJobCompleted(): void {
	const job = editorSearchState.job as LocalSearchJob;
	if (!job) return;
	while (editorSearchState.job === job && runLocalSearchSlice(job)) {
		// run synchronously
	}
}

function startGlobalSearchJob(runtime: Runtime): void {
	cancelGlobalSearchJob();

	const descriptors = listResources(runtime).filter(entry => entry.type === 'lua');
	const job: GlobalSearchJob = {
		query: normalizeQuery(editorSearchState.query),
		descriptors,
		descriptorIndex: 0,
		currentLines: null,
		nextRow: 0,
		matches: [],
		limitHit: false,
	};
	editorSearchState.globalJob = job;
	editorSearchState.globalMatches = [];
	editorSearchState.currentIndex = -1;
	editorSearchState.displayOffset = 0;
	editorSearchState.hoverIndex = -1;
	enqueueBackgroundTask(() => runGlobalSearchSlice(runtime, job));
}

function runGlobalSearchSlice(runtime: Runtime, job: GlobalSearchJob): boolean {
	if (editorSearchState.globalJob !== job) return false;
	if (job.query.length === 0) {
		editorSearchState.globalJob = null;
		return false;
	}

	let processed = 0;
	while (job.descriptorIndex < job.descriptors.length && processed < GLOBAL_ROWS_PER_SLICE && !job.limitHit) {
			if (job.currentLines === null) {
				const descriptor = job.descriptors[job.descriptorIndex];
				const source = luaPipeline.resourceSourceForChunk(runtime, descriptor.path);
				job.currentLines = splitText(source);
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
					pathLabel: descriptor.path.replace(/\\\\/g, '/'),
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
	if (editorSearchState.globalJob !== job) return;
	editorSearchState.globalJob = null;
	editorSearchState.globalMatches = job.matches;

	if (job.matches.length === 0) {
		editorSearchState.currentIndex = -1;
		editorSearchState.displayOffset = 0;
		return;
	}

	editorSearchState.currentIndex = clamp(editorSearchState.currentIndex, 0, job.matches.length - 1);
	ensureSearchSelectionVisible();
}

export function cancelGlobalSearchJob(): void {
	editorSearchState.globalJob = null;
}

function focusLocalMatch(index: number, recordNavigation: boolean): void {
	const match = editorSearchState.matches[index];
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

function nextSearchIndex(delta: number, wrap?: boolean): number {
	const total = activeSearchMatchCount();
	let next = editorSearchState.currentIndex;
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
	if (editorSearchState.scope === 'local') {
		ensureLocalJobCompleted();
	}
	const total = activeSearchMatchCount();
	if (total === 0) {
		if (!options?.preview) {
			showEditorMessage('No matches found', constants.COLOR_STATUS_WARNING, 1.5);
		}
		return;
	}
	const preview = options?.preview;
	const keepSearchActive = options?.keepSearchActive || editorSearchState.active;
	const next = nextSearchIndex(delta, options?.wrap);
	applySearchSelection(next, { preview, keepSearchActive });
}

export function applySearchSelection(index: number, options?: { preview?: boolean; keepSearchActive?: boolean }): void {
	const total = activeSearchMatchCount();
	if (total === 0) return;

	const targetIndex = clamp(index, 0, total - 1);
	editorSearchState.currentIndex = targetIndex;
	ensureSearchSelectionVisible();

	if (editorSearchState.scope === 'local') {
		focusLocalMatch(targetIndex, !options?.preview);
	}

	if (!options?.preview && !options?.keepSearchActive) {
		editorSearchState.active = false;
		editorSearchState.field.selectionAnchor = null;
		editorSearchState.field.pointerSelecting = false;
	}
}

export function jumpToNextMatch(): void {
	stepSearchSelection(1, { wrap: true });
}

export function jumpToPreviousMatch(): void {
	stepSearchSelection(-1, { wrap: true });
}

export function searchPageSize(): number {
	if (!editorSearchState.visible) {
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
		editorSearchState.displayOffset = 0;
		return;
	}
	const pageSize = searchPageSize();
	editorSearchState.currentIndex = clamp(editorSearchState.currentIndex, 0, total - 1);
	if (editorSearchState.currentIndex < editorSearchState.displayOffset) {
		editorSearchState.displayOffset = editorSearchState.currentIndex;
	} else if (editorSearchState.currentIndex >= editorSearchState.displayOffset + pageSize) {
		editorSearchState.displayOffset = editorSearchState.currentIndex - pageSize + 1;
	}
	const maxOffset = total - pageSize;
	editorSearchState.displayOffset = clamp(editorSearchState.displayOffset, 0, maxOffset);
}

export function computeSearchPageStats(): { total: number; offset: number; visible: number } {
	const total = editorSearchState.visible ? activeSearchMatchCount() : 0;
	if (total === 0) {
		editorSearchState.displayOffset = 0;
		return { total: 0, offset: 0, visible: 0 };
	}

	const pageSize = searchPageSize();
	const maxOffset = total - pageSize;
	editorSearchState.displayOffset = clamp(editorSearchState.displayOffset, 0, maxOffset);

	const remaining = total - editorSearchState.displayOffset;
	const visible = Math.min(pageSize, remaining);
	return { total, offset: editorSearchState.displayOffset, visible };
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
	if (editorSearchState.scope === 'global') {
		const match = editorSearchState.globalMatches[index];
		return {
			primary: match.pathLabel,
			secondary: match.snippet,
			detail: `:${match.row + 1}`,
		};
	}

	const match = editorSearchState.matches[index];
	const lineText = editorDocumentState.buffer.getLineContent(match.row);
	return {
		primary: `Line ${match.row + 1}`,
		secondary: buildSnippet(lineText, match.start, match.end),
	};
}

export function applySearchFieldText(value: string, moveCursorToEnd: boolean): void {
	editorSearchState.query = value;
	setFieldText(editorSearchState.field, value, moveCursorToEnd);
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
