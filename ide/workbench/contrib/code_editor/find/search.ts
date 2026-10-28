import { pointerHover, type PointerHoverTarget } from '../../../../input/pointer/hover';
import { LiteralTextMatcher, buildTextSearchSnippet, type LiteralTextSearchCursor } from '../../../../common/search_text';
import { getTextSnapshot } from '../../../../editor/text/source_text';
import { inputFocus } from '../../../../input/focus';
import type { Position } from '../../../../common/models';
import { editorRuntimeState } from '../../../../editor/common/runtime_state';
import { showEditorMessage } from '../../../../common/feedback_state';
import * as constants from '../../../../common/constants';
import { clamp, clamp_wrap } from '../../../../../machine/ts/common/clamp';
import { getSelectionRange, getSelectionText } from '../../../../editor/editing/text_editing_and_selection';
import type { SearchMatch } from '../../../../common/models';
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
import type { RectBounds } from '../../../../../machine/ts/common/rect';
import { handleSearchInput } from '../../../../input/quick_input/search/input';
import { InlineBarFieldPointer } from '../../../../input/quick_input/pointer/field';
import type { EditorTextModel } from '../../../../editor/model/text_model';

type LocalSearchJob = {
	readonly query: string;
	readonly model: EditorTextModel;
	readonly version: number;
	readonly cursor: LiteralTextSearchCursor;
	readonly acceptMatch: (start: number, end: number) => void;
	readonly matchCase: boolean;
	readonly matches: SearchMatch[];
	firstMatchAfterCursor: number;
	readonly cursorRow: number;
	readonly cursorColumn: number;
};

type LocalSearchState = {
	readonly field: TextField;
	visible: boolean;
	query: string;
	matches: SearchMatch[];
	currentIndex: number;
	job: LocalSearchJob | null;
	displayOffset: number;
	hoverIndex: number;
};

type SearchSelectionOptions = { wrap?: boolean; preview?: boolean; keepSearchActive?: boolean };
type SearchNavigation = { readonly kind: 'step'; readonly delta: number; readonly options: SearchSelectionOptions | undefined }
	| { readonly kind: 'jump'; readonly direction: 1 | -1 };
type PendingSearchNavigation = {
	readonly job: LocalSearchJob;
	readonly action: SearchNavigation;
	readonly view: CodeEditorControl['view'];
	readonly context: number;
	readonly interaction: number;
	readonly row: number;
	readonly column: number;
	readonly anchor: Position | null;
};

export type SearchResultEntry = { primary: string; secondary: string };

export class EditorSearchController {
	private readonly layoutListeners = new Set<() => void>();
	public onDidChangeLayout(listener: () => void): () => void {
		this.layoutListeners.add(listener);
		return () => this.layoutListeners.delete(listener);
	}
	private emitLayoutChanged(): void { for (const listener of this.layoutListeners) listener(); }

	private readonly pageStats = { total: 0, offset: 0, visible: 0 };
	private readonly visibleResultEntries: SearchResultEntry[] = [];
	private resultEntriesSource: readonly SearchMatch[] | null = null;
	private resultEntriesOffset = -1;
	private resultEntriesCount = -1;
	private resultEntriesVersion = -1;
	private unbindQueryChange: (() => void) | undefined;
	private completedJob: LocalSearchJob | null = null;
	private pendingNavigation: PendingSearchNavigation | undefined;

	public readonly state: LocalSearchState;
	public readonly fieldLayout: InlineBarFieldLayout;
	public readonly fieldPointer: InlineBarFieldPointer;
	public readonly searchHover: PointerHoverTarget = { onPointerLeave: () => { this.state.hoverIndex = -1; } };
	public resultCapacity = 0;
	private layoutCount = -1;
	private layoutIndex = -1;
	private layoutWorking = false;
	private layoutDetail = '';
	private readonly unbindKeyboard: () => void;

	public constructor(public readonly code: CodeEditorControl) {
		const field = new TextField(code.focusTarget, { allowSpace: true, singleLine: true });
		this.state = { field, visible: false, query: '', matches: [], currentIndex: -1, job: null,
			displayOffset: 0, hoverIndex: -1 };
		this.fieldLayout = new InlineBarFieldLayout(code, field);
		this.fieldPointer = new InlineBarFieldPointer(code, field, this.fieldLayout);
		field.focusTarget.canFocus = () => this.state.visible && this.fieldLayout.visible;
		this.unbindKeyboard = field.focusTarget.bindKeyboard(input => handleSearchInput(input, this));
	}

	public focus(): void { this.state.field.focusTarget.focus(); }

	public dispose(): void { this.closeSearch(true); this.fieldPointer.dispose(); this.unbindKeyboard(); this.layoutListeners.clear(); }

	public clearInput(): void { this.closeSearch(false); }

	public layoutField(bounds: Readonly<RectBounds>, clip: Readonly<RectBounds> = bounds): void {
		const count = this.activeSearchMatchCount(), index = this.state.currentIndex;
		const working = this.state.job !== null;
		if (count !== this.layoutCount || index !== this.layoutIndex || working !== this.layoutWorking) {
			this.layoutCount = count; this.layoutIndex = index; this.layoutWorking = working;
			this.layoutDetail = working ? 'SEARCHING…' : `${index >= 0 ? index + 1 : 0}/${count}`;
		}
		this.fieldLayout.layout(bounds, 'FIND',
			count > 0 || this.state.query.length > 0 || working ? this.layoutDetail : '', constants.SEARCH_BAR_MARGIN_Y, clip);
	}

	public openSearch(useSelection: boolean): void {
		const model = this.code.model, view = this.code.view, context = this.code.focusTarget.scope.contextGeneration;
		const current = () => this.code.model === model && this.code.view === view && this.code.focusTarget.scope.contextGeneration === context;
		this.closeSearch(false);
		if (!current()) return;

		let query = this.state.query;
		if (useSelection) {
			const range = getSelectionRange(this.code);
			const selected = getSelectionText(this.code);
			if (range && selected.length > 0 && selected.indexOf('\n') === -1) {
				query = selected;
				this.code.view.cursorRow = range.start.row;
				this.code.view.cursorColumn = range.start.column;
				this.code.emitCursorMoved();
				if (!current()) return;
			}
		}

		// Seed before binding: one query, without clearing the source selection
		// before it has been read. Only a live find session observes field edits.
		this.applySearchFieldText(query, true);
		this.state.visible = true;
		this.emitLayoutChanged();
		if (!current()) return;
		this.unbindQueryChange = this.state.field.onDidChangeText(() => {
			this.state.query = this.state.field.text;
			this.onSearchQueryChanged();
			resetInlineBlink();
		});
		this.onSearchQueryChanged();
		resetInlineBlink();
	}

	public closeSearch(clearQuery: boolean): void {
		const wasVisible = this.state.visible;
		// End model-bound effects before resetting retained widget state. A source
		// navigation can close Find after its code pane has already detached.
		this.unbindQueryChange?.();
		this.unbindQueryChange = undefined;
		this.cancelSearchJob();
		pointerHover.release(this.searchHover);
		this.state.visible = false;
		this.state.field.selectionAnchor = null;
		this.state.field.pointerSelecting = false;
		this.state.matches = [];
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

	public activeSearchMatchCount(): number { return this.state.matches.length; }

	private onSearchQueryChanged(): void {
		const model = this.code.model, view = this.code.view, context = this.code.focusTarget.scope.contextGeneration;
		this.clearEditorSearchSelection();
		if (!this.state.visible || this.code.model !== model || this.code.view !== view || this.code.focusTarget.scope.contextGeneration !== context) return;
		if (this.state.query.length === 0) {
			this.cancelSearchJob();
			this.state.matches = [];
			this.state.currentIndex = -1;
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

		const model = this.code.model, query = this.state.query, position = { row: 0, column: 0 };
		const matchCase = !editorRuntimeState.caseInsensitive;
		const job: LocalSearchJob = {
			query, model, version: model.version, matchCase,
			cursor: new LiteralTextMatcher(query, matchCase).createCursor(getTextSnapshot(model.buffer)),
			matches: [], firstMatchAfterCursor: -1,
			cursorRow: this.code.view.cursorRow, cursorColumn: this.code.view.cursorColumn,
			acceptMatch: (start, end) => {
				model.buffer.positionAt(start, position);
				job.matches.push({ row: position.row, start: position.column, end: position.column + end - start });
				if (job.firstMatchAfterCursor === -1 && (position.row > job.cursorRow
					|| position.row === job.cursorRow && position.column >= job.cursorColumn)) job.firstMatchAfterCursor = job.matches.length - 1;
			},
		};
		this.state.job = job;
		this.emitLayoutChanged();
		enqueueBackgroundTask(() => this.runLocalSearchSlice(job));
	}

	private isCurrentJob(job: LocalSearchJob | null): boolean {
		return job !== null && job.model === this.code.model && job.version === job.model.version
			&& job.query === this.state.query && job.matchCase === !editorRuntimeState.caseInsensitive;
	}

	private runLocalSearchSlice(job: LocalSearchJob): boolean {
		if (this.state.job !== job) return false;
		if (!this.isCurrentJob(job)) { this.cancelSearchJob(); return false; }
		if (job.cursor.step(job.acceptMatch)) return true;
		this.completeLocalSearchJob(job);
		return false;
	}

	private completeLocalSearchJob(job: LocalSearchJob): void {
		if (this.state.job !== job) return;
		this.state.job = null;
		this.completedJob = job;
		this.state.matches = job.matches;
		const initialIndex = job.firstMatchAfterCursor >= 0 ? job.firstMatchAfterCursor : 0;
		this.state.currentIndex = job.matches.length === 0 ? -1 : clamp(initialIndex, 0, job.matches.length - 1);
		if (job.matches.length === 0) this.state.displayOffset = 0;
		this.emitLayoutChanged();
		if (!this.isCurrentJob(job) || this.completedJob !== job) return;
		const navigation = this.pendingNavigation;
		this.pendingNavigation = undefined;
		if (navigation !== undefined) {
			if (this.isCurrentNavigation(navigation)) this.applyNavigation(navigation.action);
			return;
		}
		this.ensureSearchSelectionVisible();
		if (job.matches.length > 0 && this.state.field.focusTarget.hasFocus)
			this.applySearchSelection(this.state.currentIndex, { preview: true, keepSearchActive: true });
	}

	public cancelSearchJob(): void {
		this.state.job = null; this.completedJob = null; this.pendingNavigation = undefined;
	}

	/** A new find query replaces its code selection; hiding the widget does not. */
	private clearEditorSearchSelection(): void {
		if (!this.code.view.selectionAnchor) {
			return;
		}
		this.code.view.selectionAnchor = null;
		this.code.emitCursorMoved();
	}

	private navigate(action: SearchNavigation): void {
		const model = this.code.model, view = this.code.view, context = this.code.focusTarget.scope.contextGeneration;
		if (this.state.job !== null && !this.isCurrentJob(this.state.job)) this.cancelSearchJob();
		if (this.state.job === null && !this.isCurrentJob(this.completedJob) && this.state.query.length > 0) this.startSearchJob();
		if (this.code.model !== model || this.code.view !== view || this.code.focusTarget.scope.contextGeneration !== context) return;
		const job = this.state.job;
		if (job === null) { this.applyNavigation(action); return; }
		this.pendingNavigation = { job, action, view, context, interaction: inputFocus.interactionRevision,
			row: view.cursorRow, column: view.cursorColumn, anchor: view.selectionAnchor === null ? null : { ...view.selectionAnchor } };
		// One bounded step keeps short-document navigation immediate; further work
		// remains on the normal background queue with its retained command intent.
		this.runLocalSearchSlice(job);
	}

	private isCurrentNavigation(navigation: PendingSearchNavigation): boolean {
		const view = this.code.view, anchor = view.selectionAnchor, previous = navigation.anchor;
		return this.completedJob === navigation.job && this.isCurrentJob(navigation.job) && view === navigation.view
			&& this.code.focusTarget.scope.contextGeneration === navigation.context && inputFocus.interactionRevision === navigation.interaction
			&& view.cursorRow === navigation.row && view.cursorColumn === navigation.column
			&& (anchor === null || previous === null ? anchor === previous : anchor.row === previous.row && anchor.column === previous.column);
	}

	private applyNavigation(action: SearchNavigation): void {
		if (action.kind === 'jump') this.jumpToMatch(action.direction);
		else this.stepMatches(action.delta, action.options);
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

	public stepSearchSelection(delta: number, options?: SearchSelectionOptions): void { this.navigate({ kind: 'step', delta, options }); }

	private stepMatches(delta: number, options?: SearchSelectionOptions): void {
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

		this.focusLocalMatch(targetIndex, !options?.preview);

		if (!options?.preview && !options?.keepSearchActive) {
			this.state.field.focusTarget.release();
			this.state.field.selectionAnchor = null;
			this.state.field.pointerSelecting = false;
		}
		this.emitLayoutChanged();
	}

	public jumpToNextMatch(): void { this.navigate({ kind: 'jump', direction: 1 }); }
	public jumpToPreviousMatch(): void { this.navigate({ kind: 'jump', direction: -1 }); }

	private jumpToMatch(direction: 1 | -1): void {
		const matches = this.state.matches;
		if (matches.length === 0) { showEditorMessage('No matches found', 'warning', 1.5); return; }
		const selection = getSelectionRange(this.code);
		const position = selection === null ? { row: this.code.view.cursorRow, column: this.code.view.cursorColumn }
			: direction === 1 ? selection.end : selection.start;
		let index: number;
		if (direction === 1) {
			index = matches.findIndex(match => match.row > position.row || match.row === position.row && match.start >= position.column);
			if (index === -1) index = 0;
		} else {
			index = matches.length - 1;
			for (let candidate = matches.length - 1; candidate >= 0; candidate--) {
				const match = matches[candidate];
				if (match.row < position.row || match.row === position.row && match.start < position.column) { index = candidate; break; }
			}
		}
		this.applySearchSelection(index, { keepSearchActive: this.state.field.focusTarget.hasFocus });
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
		const source = this.state.matches;
		const version = stats.visible > 0 ? this.code.model.version : -1;
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
		const match = this.state.matches[index];
		const buffer = this.code.model.buffer;
		return {
			primary: `Line ${match.row + 1}`,
			secondary: buildTextSearchSnippet(getTextSnapshot(buffer), buffer.offsetAt(match.row, match.start), match.end - match.start).text,
		};
	}

	public applySearchFieldText(value: string, moveCursorToEnd: boolean): void {
		this.state.query = value;
		setFieldText(this.state.field, value, moveCursorToEnd);
	}
}
