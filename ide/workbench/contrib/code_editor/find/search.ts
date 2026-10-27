import { pointerHover, type PointerHoverTarget } from '../../../../input/pointer/hover';
import { editorRuntimeState } from '../../../../editor/common/runtime_state';
import { showEditorMessage } from '../../../../common/feedback_state';
import * as constants from '../../../../common/constants';
import { clamp, clamp_wrap } from '../../../../../machine/ts/common/clamp';
import { getSelectionRange, getSelectionText } from '../../../../editor/editing/text_editing_and_selection';
import type { GlobalSearchJob, GlobalSearchMatch, SearchComputationJob, SearchMatch } from '../../../../common/models';
import { readWorkspaceLuaSourceText } from '../../../../workspace/files';
import { enqueueBackgroundTask } from '../../../../common/background_tasks';
import { beginNavigationCapture, completeNavigation } from '../../../../navigation/navigation_history';
import { updateDesiredColumn } from '../../../../editor/ui/view/caret/caret';
import { revealCursor } from '../../../../editor/ui/view/caret/caret';
import { resetInlineBlink } from '../../../../editor/render/caret';
import { resetBlinkState } from '../../../../editor/ui/view/caret/blink';
import { setFieldText } from '../../../../editor/ui/inline/text_field';
import { setSingleCursorPosition, setSingleCursorSelectionAnchor } from '../../../../editor/editing/cursor/state';
import type { CodeEditorControl } from '../../../../editor/ui/code_editor_control';
import { TextField } from '../../../../editor/ui/inline/text_field_model';
import { InlineBarFieldLayout } from '../inline_bar/field';
import type { SearchState } from '../../../../common/models';
import type { RectBounds } from '../../../../../machine/ts/common/rect';
import { handleSearchInput } from '../../../../input/quick_input/search/input';
import { InlineBarFieldPointer } from '../../../../input/quick_input/pointer/field';
import { openGlobalSearchMatch } from '../../find/global_search_navigation';
import { findEditorGroup } from '../../../services/editor/editor_group';
import { splitText } from '../../../../../machine/ts/common/text_lines';
import type { WorkspaceSourceCatalog } from '../../../../workspace/source_catalog';
import type { EditorTextModel } from '../../../../editor/model/text_model';

const LOCAL_ROWS_PER_SLICE = 256;
const GLOBAL_ROWS_PER_SLICE = 128;

type LocalSearchJob = SearchComputationJob & {
	model: EditorTextModel;
	version: number;
};

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

export type SearchResultEntry = { primary: string; secondary?: string; detail?: string };

export class EditorSearchController {
	private readonly layoutListeners = new Set<() => void>();
	public onDidChangeLayout(listener: () => void): () => void {
		this.layoutListeners.add(listener);
		return () => this.layoutListeners.delete(listener);
	}
	private emitLayoutChanged(): void { for (const listener of this.layoutListeners) listener(); }

	private readonly pageStats = { total: 0, offset: 0, visible: 0 };
	private readonly visibleResultEntries: SearchResultEntry[] = [];
	private resultEntriesSource: readonly SearchMatch[] | readonly GlobalSearchMatch[] | null = null;
	private resultEntriesOffset = -1;
	private resultEntriesCount = -1;
	private resultEntriesVersion = -1;
	private unbindQueryChange: (() => void) | undefined;

	public readonly state: SearchState;
	public readonly fieldLayout: InlineBarFieldLayout;
	public readonly fieldPointer: InlineBarFieldPointer;
	public readonly searchHover: PointerHoverTarget = { onPointerLeave: () => { this.state.hoverIndex = -1; } };
	public resultCapacity = 0;
	private layoutCount = -1;
	private layoutIndex = -1;
	private layoutWorking = false;
	private layoutDetail = '';
	private readonly unbindKeyboard: () => void;

	public constructor(public readonly code: CodeEditorControl, private readonly catalog: WorkspaceSourceCatalog) {
		const field = new TextField(code.focusTarget, { allowSpace: true, singleLine: true });
		this.state = { field, visible: false, query: '', matches: [], currentIndex: -1, job: null,
			displayOffset: 0, hoverIndex: -1, scope: 'local', globalMatches: [], globalJob: null };
		this.fieldLayout = new InlineBarFieldLayout(code, field);
		this.fieldPointer = new InlineBarFieldPointer(code, field, this.fieldLayout);
		field.focusTarget.canFocus = () => this.state.visible && this.fieldLayout.visible;
		this.unbindKeyboard = field.focusTarget.bindKeyboard(input => handleSearchInput(input, this));
	}

	public focus(): void { this.state.field.focusTarget.focus(); }

	public dispose(): void { this.closeSearch(true); this.fieldPointer.dispose(); this.unbindKeyboard(); this.layoutListeners.clear(); }

	public clearInput(): void { this.closeSearch(false); }

	public layoutField(bounds: Readonly<RectBounds>): void {
		const count = this.activeSearchMatchCount(), index = this.state.currentIndex;
		const working = this.state.scope === 'global' ? this.state.globalJob !== null : this.state.job !== null;
		if (count !== this.layoutCount || index !== this.layoutIndex || working !== this.layoutWorking) {
			this.layoutCount = count; this.layoutIndex = index; this.layoutWorking = working;
			this.layoutDetail = working ? 'SEARCHING…' : `${index >= 0 ? index + 1 : 0}/${count}`;
		}
		this.fieldLayout.layout(bounds, this.state.scope === 'global' ? 'FIND ALL' : 'FIND',
			count > 0 || this.state.query.length > 0 || working ? this.layoutDetail : '', constants.SEARCH_BAR_MARGIN_Y);
	}

	public openSearch(useSelection: boolean, scope: 'local' | 'global' = 'local'): void {
		this.closeSearch(false);

		let query = this.state.query;
		if (useSelection) {
			const range = getSelectionRange(this.code);
			const selected = getSelectionText(this.code);
			if (range && selected.length > 0 && selected.indexOf('\n') === -1) {
				query = selected;
				this.code.view.cursorRow = range.start.row;
				this.code.view.cursorColumn = range.start.column;
				this.code.emitCursorMoved();
			}
		}

		// Seed before binding: one query, without clearing the source selection
		// before it has been read. Only a live find session observes field edits.
		this.applySearchFieldText(query, true);
		this.state.scope = scope;
		this.state.visible = true;
		this.emitLayoutChanged();
		this.unbindQueryChange = this.state.field.onDidChangeText(() => {
			this.state.query = this.state.field.text;
			this.onSearchQueryChanged();
			resetInlineBlink();
		});
		this.onSearchQueryChanged();
		resetInlineBlink();
	}

	public switchScope(scope: 'local' | 'global'): void {
		this.cancelSearchJob(); this.cancelGlobalSearchJob();
		this.state.scope = scope;
		this.onSearchQueryChanged();
	}

	public closeSearch(clearQuery: boolean): void {
		const wasVisible = this.state.visible;
		// End model-bound effects before resetting retained widget state. A source
		// navigation can close Find after its code pane has already detached.
		this.unbindQueryChange?.();
		this.unbindQueryChange = undefined;
		this.cancelSearchJob();
		this.cancelGlobalSearchJob();
		pointerHover.release(this.searchHover);
		this.state.visible = false;
		this.state.field.selectionAnchor = null;
		this.state.field.pointerSelecting = false;
		this.state.scope = 'local';
		this.state.matches = [];
		this.state.globalMatches = [];
		this.state.currentIndex = -1;
		this.state.hoverIndex = -1;
		this.state.displayOffset = 0;
		if (clearQuery) {
			this.applySearchFieldText('', true);
		}
		if (wasVisible) this.emitLayoutChanged();
		this.fieldLayout.hide();
	}

	public focusEditorFromSearch(): void {
		if (this.state.query.length === 0) {
			this.closeSearch(false);
			return;
		}
		pointerHover.release(this.searchHover);
		this.state.field.focusTarget.release();
		this.state.hoverIndex = -1;
		this.state.field.selectionAnchor = null;
		this.state.field.pointerSelecting = false;
		resetInlineBlink();
	}

	private onSearchQueryChanged(): void {
		if (this.state.scope === 'global') {
			this.onGlobalSearchQueryChanged();
			return;
		}
		this.onLocalSearchQueryChanged();
	}

	private onGlobalSearchQueryChanged(): void {
		this.state.displayOffset = 0;
		this.state.hoverIndex = -1;
		this.state.currentIndex = -1;
		if (this.state.query.length === 0) {
			this.cancelGlobalSearchJob();
			this.state.globalMatches = [];
			this.emitLayoutChanged();
			return;
		}
		this.startGlobalSearchJob(this.catalog);
	}
	public activeSearchMatchCount(): number {
		return this.state.scope === 'global' ? this.state.globalMatches.length : this.state.matches.length;
	}

	private onLocalSearchQueryChanged(): void {
		if (this.state.query.length === 0) {
			this.cancelSearchJob();
			this.state.matches = [];
			this.state.currentIndex = -1;
			this.clearEditorSearchSelection();
			this.state.displayOffset = 0;
			this.emitLayoutChanged();
			return;
		}
		this.startSearchJob();
	}

	public startSearchJob(): void {
		this.cancelSearchJob();

		this.state.displayOffset = 0;
		this.state.hoverIndex = -1;
		this.state.currentIndex = -1;
		this.state.matches = [];
		this.clearEditorSearchSelection();
		this.emitLayoutChanged();

		const job: LocalSearchJob = {
			query: normalizeQuery(this.state.query),
			model: this.code.model,
			version: this.code.model.version,
			nextRow: 0,
			matches: [],
			firstMatchAfterCursor: -1,
			cursorRow: this.code.view.cursorRow,
			cursorColumn: this.code.view.cursorColumn,
		};
		this.state.job = job;
		enqueueBackgroundTask(() => this.runLocalSearchSlice(job));
	}

	private runLocalSearchSlice(job: LocalSearchJob): boolean {
		if (this.state.job !== job) return false;
		if (job.query.length === 0
			|| job.model !== this.code.model
			|| job.version !== job.model.version
			|| this.state.query.length === 0) {
			this.state.job = null;
			return false;
		}
		let processed = 0;
		const lineCount = job.model.buffer.getLineCount();
		while (job.nextRow < lineCount && processed < LOCAL_ROWS_PER_SLICE) {
			const row = job.nextRow;
			job.nextRow += 1;
			processed += 1;
			this.collectLocalMatches(job, row);
		}
		if (job.nextRow >= lineCount) {
			this.completeLocalSearchJob(job);
			return false;
		}
		return true;
	}

	private collectLocalMatches(job: LocalSearchJob, row: number): void {
		const line = job.model.buffer.getLineContent(row);
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

	private completeLocalSearchJob(job: LocalSearchJob): void {
		if (this.state.job !== job) return;
		this.state.job = null;
		this.state.matches = job.matches;

		if (job.matches.length === 0) {
			this.state.currentIndex = -1;
			this.clearEditorSearchSelection();
			this.state.displayOffset = 0;
			this.emitLayoutChanged();
			return;
		}

		const initialIndex = job.firstMatchAfterCursor >= 0 ? job.firstMatchAfterCursor : 0;
		this.state.currentIndex = clamp(initialIndex, 0, job.matches.length - 1);
		this.emitLayoutChanged();
		this.ensureSearchSelectionVisible();
		if (this.state.field.focusTarget.hasFocus) {
			this.applySearchSelection(this.state.currentIndex, { preview: true, keepSearchActive: true });
		}
	}

	public cancelSearchJob(): void {
		this.state.job = null;
	}

	/** A new find query replaces its code selection; hiding the widget does not. */
	private clearEditorSearchSelection(): void {
		if (!this.code.view.selectionAnchor) {
			return;
		}
		this.code.view.selectionAnchor = null;
		this.code.emitCursorMoved();
	}

	private ensureLocalJobCompleted(): void {
		const job = this.state.job as LocalSearchJob;
		if (!job) return;
		while (this.state.job === job && this.runLocalSearchSlice(job)) {
			// run synchronously
		}
	}

	private startGlobalSearchJob(catalog: WorkspaceSourceCatalog): void {
		this.cancelGlobalSearchJob();

		const job: GlobalSearchJob = {
			query: normalizeQuery(this.state.query),
			resources: catalog.luaResources,
			resourceIndex: 0,
			currentLines: null,
			nextRow: 0,
			matches: [],
			limitHit: false,
		};
		this.state.globalJob = job;
		this.state.globalMatches = [];
		this.state.currentIndex = -1;
		this.state.displayOffset = 0;
		this.state.hoverIndex = -1;
		this.emitLayoutChanged();
		enqueueBackgroundTask(() => this.runGlobalSearchSlice(catalog, job));
	}

	private runGlobalSearchSlice(catalog: WorkspaceSourceCatalog, job: GlobalSearchJob): boolean {
		if (this.state.globalJob !== job) return false;
		if (job.query.length === 0) {
			this.state.globalJob = null;
			return false;
		}

		let processed = 0;
		while (job.resourceIndex < job.resources.length && processed < GLOBAL_ROWS_PER_SLICE && !job.limitHit) {
				if (job.currentLines === null) {
					const resource = job.resources[job.resourceIndex];
					const source = catalog.resolveLuaSource(resource)!;
					job.currentLines = splitText(readWorkspaceLuaSourceText(source.registry, source.record));
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
					const resource = job.resources[job.resourceIndex];
					const match: GlobalSearchMatch = {
						resource,
						pathLabel: resource.path.replace(/\\\\/g, '/'),
						row,
						start,
						end,
						snippet: buildSnippet(line, start, end),
						path: resource.path,
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
				job.resourceIndex += 1;
			}
		}

		if (job.limitHit || job.resourceIndex >= job.resources.length) {
			this.completeGlobalSearchJob(job);
			return false;
		}
		return true;
	}

	private completeGlobalSearchJob(job: GlobalSearchJob): void {
		if (this.state.globalJob !== job) return;
		this.state.globalJob = null;
		this.state.globalMatches = job.matches;

		if (job.matches.length === 0) {
			this.state.currentIndex = -1;
			this.state.displayOffset = 0;
			this.emitLayoutChanged();
			return;
		}

		this.state.currentIndex = clamp(this.state.currentIndex, 0, job.matches.length - 1);
		this.emitLayoutChanged();
		this.ensureSearchSelectionVisible();
	}

	public cancelGlobalSearchJob(): void {
		this.state.globalJob = null;
	}

	private focusLocalMatch(index: number, recordNavigation: boolean): void {
		const match = this.state.matches[index];

		const navigationCheckpoint = recordNavigation ? beginNavigationCapture() : null;
		setSingleCursorPosition(this.code.view, match.row, match.start);
		setSingleCursorSelectionAnchor(this.code.view, match.row, match.end);
		this.code.emitCursorMoved();
		updateDesiredColumn(this.code);
		resetBlinkState(this.code.caret);
		revealCursor(this.code);
		if (recordNavigation) {
			completeNavigation(navigationCheckpoint);
		}
	}

	private nextSearchIndex(delta: number, wrap?: boolean): number {
		const total = this.activeSearchMatchCount();
		let next = this.state.currentIndex;
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

	public stepSearchSelection(delta: number, options?: { wrap?: boolean; preview?: boolean; keepSearchActive?: boolean }): void {
		if (this.state.scope === 'local') {
			this.ensureLocalJobCompleted();
		}
		const total = this.activeSearchMatchCount();
		if (total === 0) {
			if (!options?.preview) {
				showEditorMessage('No matches found', 'warning', 1.5);
			}
			return;
		}
		const preview = options?.preview;
		const keepSearchActive = options?.keepSearchActive || this.state.field.focusTarget.hasFocus;
		const next = this.nextSearchIndex(delta, options?.wrap);
		this.applySearchSelection(next, { preview, keepSearchActive });
	}

	public applySearchSelection(index: number, options?: { preview?: boolean; keepSearchActive?: boolean }): void {
		const total = this.activeSearchMatchCount();
		if (total === 0) return;

		const targetIndex = clamp(index, 0, total - 1);
		this.state.currentIndex = targetIndex;
		this.ensureSearchSelectionVisible();
		this.emitLayoutChanged();

		if (this.state.scope === 'local') {
			this.focusLocalMatch(targetIndex, !options?.preview);
		}

		if (!options?.preview && !options?.keepSearchActive) {
			this.state.field.focusTarget.release();
			this.state.field.selectionAnchor = null;
			this.state.field.pointerSelecting = false;
		}
	}

	public jumpToNextMatch(): void {
		this.stepSearchSelection(1, { wrap: true });
	}

	public jumpToPreviousMatch(): void {
		this.stepSearchSelection(-1, { wrap: true });
	}

	public searchPageSize(): number {
		if (!this.state.visible) {
			return constants.SEARCH_MAX_RESULTS;
		}
		return Math.max(1, this.resultCapacity);
	}

	public ensureSearchSelectionVisible(): void {
		const total = this.activeSearchMatchCount();
		if (total === 0) {
			this.state.displayOffset = 0;
			return;
		}
		this.state.currentIndex = clamp(this.state.currentIndex, 0, total - 1);
		const pageSize = this.resultCapacity;
		if (pageSize === 0) {
			this.state.displayOffset = this.state.currentIndex;
			return;
		}
		if (this.state.currentIndex < this.state.displayOffset) {
			this.state.displayOffset = this.state.currentIndex;
		} else if (this.state.currentIndex >= this.state.displayOffset + pageSize) {
			this.state.displayOffset = this.state.currentIndex - pageSize + 1;
		}
		const maxOffset = Math.max(0, total - pageSize);
		this.state.displayOffset = clamp(this.state.displayOffset, 0, maxOffset);
	}

	public computeSearchPageStats(): Readonly<{ total: number; offset: number; visible: number }> {
		const stats = this.pageStats;
		stats.total = this.state.visible ? this.activeSearchMatchCount() : 0;
		if (stats.total === 0) {
			this.state.displayOffset = 0;
			stats.offset = 0; stats.visible = 0;
			return stats;
		}
		const pageSize = this.resultCapacity;
		const maxOffset = Math.max(0, stats.total - Math.max(1, pageSize));
		this.state.displayOffset = clamp(this.state.displayOffset, 0, maxOffset);
		stats.offset = this.state.displayOffset;
		stats.visible = Math.min(pageSize, stats.total - stats.offset);
		return stats;
	}

	public getVisibleSearchResultEntries(): readonly SearchResultEntry[] {
		const stats = this.computeSearchPageStats();
		const source = this.state.scope === 'global' ? this.state.globalMatches : this.state.matches;
		const version = this.state.scope === 'local' && stats.visible > 0 ? this.code.model.version : -1;
		if (source !== this.resultEntriesSource || stats.offset !== this.resultEntriesOffset
			|| stats.visible !== this.resultEntriesCount || version !== this.resultEntriesVersion) {
			this.resultEntriesSource = source; this.resultEntriesOffset = stats.offset;
			this.resultEntriesCount = stats.visible; this.resultEntriesVersion = version;
			this.visibleResultEntries.length = stats.visible;
			for (let index = 0; index < stats.visible; index++) {
				this.visibleResultEntries[index] = this.buildSearchResultEntry(stats.offset + index);
			}
		}
		return this.visibleResultEntries;
	}

	private buildSearchResultEntry(index: number): SearchResultEntry {
		if (this.state.scope === 'global') {
			const match = this.state.globalMatches[index];
			return {
				primary: match.pathLabel,
				secondary: match.snippet,
				detail: `:${match.row + 1}`,
			};
		}

		const match = this.state.matches[index];
		const lineText = this.code.model.buffer.getLineContent(match.row);
		return {
			primary: `Line ${match.row + 1}`,
			secondary: buildSnippet(lineText, match.start, match.end),
		};
	}

	public openSelectedGlobalMatch(): void {
		if (this.state.scope !== 'global') return;
		const match = this.state.globalMatches[this.state.currentIndex];
		if (match) openGlobalSearchMatch(findEditorGroup(this.code.focusTarget)!, this.catalog, match);
	}

	public applySearchFieldText(value: string, moveCursorToEnd: boolean): void {
		this.state.query = value;
		setFieldText(this.state.field, value, moveCursorToEnd);
	}
}
