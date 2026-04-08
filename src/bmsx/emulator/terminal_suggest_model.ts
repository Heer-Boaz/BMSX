import { clamp } from '../utils/clamp';
import type { CompletionContext, LuaCompletionItem } from './ide/core/types';
import type { SymbolEntry } from './types';
import {
	computePanelGridLayout,
	findSymbolCompletionBounds,
	matchesAnySymbolSegment,
	matchesSymbolSegmentChain,
	splitSymbolQuerySegments,
	type TerminalPanelGridLayout,
} from './terminal_completion_panel_model';

export type TerminalSymbolPanelMode = 'browse' | 'complete';

export type TerminalSymbolQueryContext = {
	prefix: string;
	replaceStart: number;
	replaceEnd: number;
};

export type TerminalSymbolPanelState = {
	mode: TerminalSymbolPanelMode;
	entries: SymbolEntry[];
	filtered: SymbolEntry[];
	filter: string;
	selectionIndex: number;
	displayRowOffset: number;
	queryStart: number;
	queryEnd: number;
	originalText: string;
	originalCursor: number;
};

export type TerminalCompletionPanelState = {
	entries: LuaCompletionItem[];
	filtered: LuaCompletionItem[];
	filter: string;
	selectionIndex: number;
	displayRowOffset: number;
	context: CompletionContext;
	originalText: string;
	originalCursor: number;
};

type TerminalCompletionSnapshot = {
	context: CompletionContext;
	items: LuaCompletionItem[];
	filteredItems: LuaCompletionItem[];
};

type TerminalSuggestModelOptions = {
	getInputText: () => string;
	getCursorOffset: () => number;
	restoreInput: (text: string, cursor: number) => void;
	replaceInputRange: (start: number, end: number, value: string) => void;
	listCompletionCandidates: () => TerminalCompletionSnapshot | null;
	closeCompletionSession: () => void;
	applyCompletionItem: (context: CompletionContext, item: LuaCompletionItem) => void;
	buildSymbolCatalog: () => SymbolEntry[];
};

type TerminalPanelState<TItem> = {
	entries: TItem[];
	filtered: TItem[];
	filter: string;
	selectionIndex: number;
	displayRowOffset: number;
	originalText: string;
	originalCursor: number;
};

export class TerminalSuggestModel {
	private symbolPanel: TerminalSymbolPanelState | null = null;
	private symbolPanelLayout: TerminalPanelGridLayout | null = null;
	private completionPanel: TerminalCompletionPanelState | null = null;
	private completionPanelLayout: TerminalPanelGridLayout | null = null;

	public constructor(private readonly options: TerminalSuggestModelOptions) {}

	public get symbolPanelState(): TerminalSymbolPanelState | null {
		return this.symbolPanel;
	}

	public get symbolPanelGridLayout(): TerminalPanelGridLayout | null {
		return this.symbolPanelLayout;
	}

	public get completionPanelState(): TerminalCompletionPanelState | null {
		return this.completionPanel;
	}

	public get completionPanelGridLayout(): TerminalPanelGridLayout | null {
		return this.completionPanelLayout;
	}

	public get hasOpenPanel(): boolean {
		return this.symbolPanel !== null || this.completionPanel !== null;
	}

	public clear(): void {
		this.clearSymbolPanel();
		this.clearCompletionPanel();
	}

	public openSymbolBrowser(): void {
		const entries = this.buildSortedSymbolCatalog();
		this.openSymbolPanel('browse', entries, entries.slice(), null);
	}

	public buildSortedSymbolCatalog(): SymbolEntry[] {
		return this.sortSymbolEntries(this.dedupeSymbolEntries(this.options.buildSymbolCatalog()));
	}

	public resolveSymbolCompletionContext(): TerminalSymbolQueryContext {
		const text = this.options.getInputText();
		const cursor = this.options.getCursorOffset();
		const bounds = findSymbolCompletionBounds(text, cursor);
		return {
			prefix: text.slice(bounds.start, cursor),
			replaceStart: bounds.start,
			replaceEnd: bounds.end,
		};
	}

	public filterSymbolEntries(entries: SymbolEntry[], prefix: string): SymbolEntry[] {
		if (prefix.length === 0) {
			return entries.slice();
		}
		const needle = prefix.toLowerCase();
		const needleSegments = splitSymbolQuerySegments(needle);
		const filtered: SymbolEntry[] = [];
		for (let index = 0; index < entries.length; index += 1) {
			const entry = entries[index];
			const nameLower = entry.name.toLowerCase();
			if (nameLower.startsWith(needle)) {
				filtered.push(entry);
				continue;
			}
			if (matchesSymbolSegmentChain(nameLower, needleSegments)) {
				filtered.push(entry);
				continue;
			}
			if (matchesAnySymbolSegment(nameLower, needleSegments)) {
				filtered.push(entry);
			}
		}
		return filtered;
	}

	public openSymbolPanel(mode: TerminalSymbolPanelMode, entries: SymbolEntry[], filtered: SymbolEntry[], query: TerminalSymbolQueryContext | null): void {
		const base = this.createPanelState(entries, filtered, query ? query.prefix : '');
		this.clearCompletionPanel();
		this.symbolPanel = {
			mode,
			entries: base.entries,
			filtered: base.filtered,
			filter: base.filter,
			selectionIndex: base.selectionIndex,
			displayRowOffset: base.displayRowOffset,
			queryStart: query ? query.replaceStart : 0,
			queryEnd: query ? query.replaceEnd : 0,
			originalText: base.originalText,
			originalCursor: base.originalCursor,
		};
		this.symbolPanelLayout = null;
		this.options.closeCompletionSession();
	}

	public closeSymbolPanel(restoreInput: boolean): void {
		const panel = this.symbolPanel;
		if (!panel) {
			return;
		}
		this.clearSymbolPanel();
		if (restoreInput) {
			this.options.restoreInput(panel.originalText, panel.originalCursor);
		}
	}

	public openCompletionPanel(context: CompletionContext, entries: LuaCompletionItem[], filtered: LuaCompletionItem[]): void {
		const dedupedEntries = this.dedupeCompletionItems(entries);
		const dedupedFiltered = this.dedupeCompletionItems(filtered);
		const base = this.createPanelState(dedupedEntries, dedupedFiltered, context.prefix);
		this.clearSymbolPanel();
		this.completionPanel = {
			entries: base.entries,
			filtered: base.filtered,
			filter: base.filter,
			selectionIndex: base.selectionIndex,
			displayRowOffset: base.displayRowOffset,
			context,
			originalText: base.originalText,
			originalCursor: base.originalCursor,
		};
		this.completionPanelLayout = null;
		this.options.closeCompletionSession();
	}

	public closeCompletionPanel(restoreInput: boolean): void {
		const panel = this.completionPanel;
		if (!panel) {
			return;
		}
		this.clearCompletionPanel();
		if (restoreInput) {
			this.options.restoreInput(panel.originalText, panel.originalCursor);
		}
	}

	public acceptCompletionPanelSelection(): void {
		const panel = this.completionPanel;
		if (!panel) {
			return;
		}
		if (panel.selectionIndex < 0 || panel.selectionIndex >= panel.filtered.length) {
			this.closeCompletionPanel(false);
			return;
		}
		const item = panel.filtered[panel.selectionIndex];
		const context = panel.context;
		this.closeCompletionPanel(false);
		this.options.applyCompletionItem(context, item);
	}

	public acceptSymbolPanelSelection(): void {
		const panel = this.symbolPanel;
		if (!panel) {
			return;
		}
		if (panel.selectionIndex < 0 || panel.selectionIndex >= panel.filtered.length) {
			this.closeSymbolPanel(false);
			return;
		}
		const entry = panel.filtered[panel.selectionIndex];
		if (panel.mode === 'complete') {
			this.closeSymbolPanel(false);
			this.applySymbolCompletion({
				prefix: panel.filter,
				replaceStart: panel.queryStart,
				replaceEnd: panel.queryEnd,
			}, entry.name);
			return;
		}
		this.closeSymbolPanel(false);
	}

	public applySymbolCompletion(context: TerminalSymbolQueryContext, name: string): void {
		this.options.replaceInputRange(context.replaceStart, context.replaceEnd, name);
	}

	public refreshOpenPanelFilter(): boolean {
		if (this.completionPanel) {
			this.refreshCompletionPanelFilter();
			return true;
		}
		if (this.symbolPanel) {
			this.refreshSymbolPanelFilter();
			return true;
		}
		return false;
	}

	public updateSymbolPanelLayout(maxColumns: number, maxRows: number, minCellWidth: number, columnGap: number, paddingX: number, paddingY: number): TerminalPanelGridLayout | null {
		const panel = this.symbolPanel;
		if (!panel) {
			this.symbolPanelLayout = null;
			return null;
		}
		const maxLabelLength = this.measureMaxLabelLength(panel.filtered, entry => entry.name);
		this.symbolPanelLayout = computePanelGridLayout(panel.filtered.length, maxColumns, maxRows, maxLabelLength, minCellWidth, columnGap, paddingX, paddingY);
		return this.symbolPanelLayout;
	}

	public updateCompletionPanelLayout(maxColumns: number, maxRows: number, minCellWidth: number, columnGap: number, paddingX: number, paddingY: number): TerminalPanelGridLayout | null {
		const panel = this.completionPanel;
		if (!panel) {
			this.completionPanelLayout = null;
			return null;
		}
		const maxLabelLength = this.measureMaxLabelLength(panel.filtered, entry => entry.label);
		this.completionPanelLayout = computePanelGridLayout(panel.filtered.length, maxColumns, maxRows, maxLabelLength, minCellWidth, columnGap, paddingX, paddingY);
		return this.completionPanelLayout;
	}

	public ensureSymbolPanelSelectionVisible(layout: TerminalPanelGridLayout): void {
		this.ensureSelectionVisible(this.symbolPanel, layout);
	}

	public ensureCompletionPanelSelectionVisible(layout: TerminalPanelGridLayout): void {
		this.ensureSelectionVisible(this.completionPanel, layout);
	}

	public moveSymbolSelectionRow(delta: number): void {
		this.moveSelectionRow(this.symbolPanel, this.symbolPanelLayout, delta);
	}

	public moveSymbolSelectionColumn(delta: number): void {
		this.moveSelectionColumn(this.symbolPanel, this.symbolPanelLayout, delta);
	}

	public moveSymbolSelectionPage(delta: number): void {
		this.moveSelectionPage(this.symbolPanel, this.symbolPanelLayout, delta);
	}

	public moveCompletionSelectionRow(delta: number): void {
		this.moveSelectionRow(this.completionPanel, this.completionPanelLayout, delta);
	}

	public moveCompletionSelectionColumn(delta: number): void {
		this.moveSelectionColumn(this.completionPanel, this.completionPanelLayout, delta);
	}

	public moveCompletionSelectionPage(delta: number): void {
		this.moveSelectionPage(this.completionPanel, this.completionPanelLayout, delta);
	}

	private clearSymbolPanel(): void {
		this.symbolPanel = null;
		this.symbolPanelLayout = null;
	}

	private clearCompletionPanel(): void {
		this.completionPanel = null;
		this.completionPanelLayout = null;
	}

	private createPanelState<TItem>(entries: TItem[], filtered: TItem[], filter: string): TerminalPanelState<TItem> {
		return {
			entries,
			filtered,
			filter,
			selectionIndex: filtered.length > 0 ? 0 : -1,
			displayRowOffset: 0,
			originalText: this.options.getInputText(),
			originalCursor: this.options.getCursorOffset(),
		};
	}

	private sortSymbolEntries(entries: SymbolEntry[]): SymbolEntry[] {
		const kindOrder: Record<SymbolEntry['kind'], number> = {
			function: 0,
			table: 1,
			constant: 2,
		};
		const indexed = entries.map((entry, index) => ({
			entry,
			index,
			normalized: entry.name.toLowerCase(),
		}));
		indexed.sort((a, b) => {
			const kindDelta = kindOrder[a.entry.kind] - kindOrder[b.entry.kind];
			if (kindDelta !== 0) {
				return kindDelta;
			}
			if (a.normalized < b.normalized) {
				return -1;
			}
			if (a.normalized > b.normalized) {
				return 1;
			}
			if (a.entry.name < b.entry.name) {
				return -1;
			}
			if (a.entry.name > b.entry.name) {
				return 1;
			}
			return a.index - b.index;
		});
		return indexed.map(item => item.entry);
	}

	private refreshCompletionPanelFilter(): void {
		const panel = this.completionPanel;
		if (!panel) {
			return;
		}
		const previousLabel = panel.selectionIndex >= 0 && panel.selectionIndex < panel.filtered.length
			? panel.filtered[panel.selectionIndex].label
			: null;
		const snapshot = this.options.listCompletionCandidates();
		if (!snapshot) {
			this.closeCompletionPanel(false);
			return;
		}
		panel.entries = this.dedupeCompletionItems(snapshot.items);
		panel.filtered = this.dedupeCompletionItems(snapshot.filteredItems);
		panel.filter = snapshot.context.prefix;
		panel.context = snapshot.context;
		panel.selectionIndex = this.resolveSelectionIndex(panel.filtered, previousLabel, item => item.label);
		panel.displayRowOffset = 0;
	}

	private dedupeCompletionItems(items: LuaCompletionItem[]): LuaCompletionItem[] {
		const seen = new Set<string>();
		const deduped: LuaCompletionItem[] = [];
		for (let index = 0; index < items.length; index += 1) {
			const item = items[index];
			if (seen.has(item.label)) {
				continue;
			}
			seen.add(item.label);
			deduped.push(item);
		}
		return deduped;
	}

	private dedupeSymbolEntries(entries: SymbolEntry[]): SymbolEntry[] {
		const seen = new Set<string>();
		const deduped: SymbolEntry[] = [];
		for (let index = 0; index < entries.length; index += 1) {
			const entry = entries[index];
			if (seen.has(entry.name)) {
				continue;
			}
			seen.add(entry.name);
			deduped.push(entry);
		}
		return deduped;
	}

	private refreshSymbolPanelFilter(): void {
		const panel = this.symbolPanel;
		if (!panel) {
			return;
		}
		const previousName = panel.selectionIndex >= 0 && panel.selectionIndex < panel.filtered.length
			? panel.filtered[panel.selectionIndex].name
			: null;
		if (panel.mode === 'complete') {
			const context = this.resolveSymbolCompletionContext();
			panel.queryStart = context.replaceStart;
			panel.queryEnd = context.replaceEnd;
			panel.filter = context.prefix;
		} else {
			panel.filter = this.options.getInputText().trim();
		}
		panel.filtered = this.filterSymbolEntries(panel.entries, panel.filter);
		panel.selectionIndex = this.resolveSelectionIndex(panel.filtered, previousName, entry => entry.name);
		panel.displayRowOffset = 0;
	}

	private resolveSelectionIndex<TItem>(entries: TItem[], preferredValue: string | null, getValue: (entry: TItem) => string): number {
		if (entries.length === 0) {
			return -1;
		}
		if (preferredValue) {
			for (let index = 0; index < entries.length; index += 1) {
				if (getValue(entries[index]) === preferredValue) {
					return index;
				}
			}
		}
		return 0;
	}

	private measureMaxLabelLength<TItem>(entries: TItem[], getLabel: (entry: TItem) => string): number {
		let maxLength = 0;
		for (let index = 0; index < entries.length; index += 1) {
			const length = getLabel(entries[index]).length;
			if (length > maxLength) {
				maxLength = length;
			}
		}
		return maxLength;
	}

	private resolveLayoutForNavigation<TItem>(panel: TerminalPanelState<TItem>, panelLayout: TerminalPanelGridLayout): TerminalPanelGridLayout {
		if (panelLayout) {
			return panelLayout;
		}
		const rows = Math.max(1, panel.filtered.length);
		return {
			columns: 1,
			rows,
			cellWidth: 1,
			gap: 0,
			visibleRows: rows,
			paddingX: 0,
			paddingY: 0,
		};
	}

	private ensureSelectionVisible<TItem>(panel: TerminalPanelState<TItem> | null, layout: TerminalPanelGridLayout): void {
		if (!panel) {
			return;
		}
		if (panel.filtered.length === 0 || panel.selectionIndex < 0) {
			panel.displayRowOffset = 0;
			return;
		}
		const row = panel.selectionIndex % layout.rows;
		const maxOffset = Math.max(0, layout.rows - layout.visibleRows);
		let offset = clamp(panel.displayRowOffset, 0, maxOffset);
		if (row < offset) {
			offset = row;
		}
		if (row >= offset + layout.visibleRows) {
			offset = row - layout.visibleRows + 1;
		}
		panel.displayRowOffset = clamp(offset, 0, maxOffset);
	}

	private moveSelectionRow<TItem>(panel: TerminalPanelState<TItem> | null, panelLayout: TerminalPanelGridLayout, delta: number): void {
		if (!panel) {
			return;
		}
		const total = panel.filtered.length;
		if (total === 0) {
			panel.selectionIndex = -1;
			return;
		}
		panel.selectionIndex = clamp((panel.selectionIndex < 0 ? 0 : panel.selectionIndex) + delta, 0, total - 1);
		this.ensureSelectionVisible(panel, this.resolveLayoutForNavigation(panel, panelLayout));
	}

	private moveSelectionColumn<TItem>(panel: TerminalPanelState<TItem> | null, panelLayout: TerminalPanelGridLayout, delta: number): void {
		if (!panel) {
			return;
		}
		const total = panel.filtered.length;
		if (total === 0) {
			panel.selectionIndex = -1;
			return;
		}
		const layout = this.resolveLayoutForNavigation(panel, panelLayout);
		const current = panel.selectionIndex < 0 ? 0 : panel.selectionIndex;
		const row = current % layout.rows;
		const col = Math.floor(current / layout.rows);
		const nextCol = clamp(col + delta, 0, Math.max(0, layout.columns - 1));
		const columnStart = nextCol * layout.rows;
		const columnEnd = Math.min(total - 1, columnStart + layout.rows - 1);
		panel.selectionIndex = clamp(columnStart + row, columnStart, columnEnd);
		this.ensureSelectionVisible(panel, layout);
	}

	private moveSelectionPage<TItem>(panel: TerminalPanelState<TItem> | null, panelLayout: TerminalPanelGridLayout, delta: number): void {
		if (!panel) {
			return;
		}
		const total = panel.filtered.length;
		if (total === 0) {
			panel.selectionIndex = -1;
			return;
		}
		const layout = this.resolveLayoutForNavigation(panel, panelLayout);
		const step = Math.max(1, layout.visibleRows);
		panel.selectionIndex = clamp((panel.selectionIndex < 0 ? 0 : panel.selectionIndex) + step * delta, 0, total - 1);
		this.ensureSelectionVisible(panel, layout);
	}
}
