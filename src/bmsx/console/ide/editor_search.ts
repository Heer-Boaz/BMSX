import { ide_state } from './ide_state';
import * as constants from './constants';
import { clamp } from '../../utils/clamp';;
import { getSelectionRange, getSelectionText } from './text_editing_and_selection';

import type { ConsoleResourceDescriptor } from '../types';
import { activateCodeTab, applySearchFieldText, clearReferenceHighlights, closeLineJump, closeResourceSearch, closeSymbolSearch, ensureCursorVisible, listResourcesStrict, openLuaCodeTab, resetBlink, revealCursor, scheduleNextFrame, updateDesiredColumn } from './console_cart_editor';
import { enqueueBackgroundTask } from './console_cart_editor_background';

// Types used by search pipelines
export interface SearchMatch { row: number; start: number; end: number }
export interface SearchComputationJob {
	query: string;
	version: number;
	nextRow: number;
	matches: SearchMatch[];
	firstMatchAfterCursor: number;
	cursorRow: number;
	cursorColumn: number;
}

export interface GlobalSearchMatch {
	descriptor: ConsoleResourceDescriptor;
	pathLabel: string;
	row: number;
	start: number;
	end: number;
	snippet: string;
	assetId: string | null;
	chunkName: string | null;
}

export interface GlobalSearchJob {
	query: string;
	descriptors: ConsoleResourceDescriptor[];
	descriptorIndex: number;
	currentLines: string[] | null;
	nextRow: number;
	matches: GlobalSearchMatch[];
	limitHit: boolean;
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
	let appliedSelection = false;
	if (useSelection) {
		const range = getSelectionRange();
		const selected = getSelectionText();
		if (range && selected !== null && selected.length > 0 && selected.indexOf('\n') === -1) {
			applySearchFieldText(selected, true);
			ide_state.cursorRow = range.start.row;
			ide_state.cursorColumn = range.start.column;
			appliedSelection = true;
		}
	}
	if (!appliedSelection && ide_state.searchField.text.length === 0) {
		ide_state.searchCurrentIndex = -1;
	}
	ide_state.searchQuery = ide_state.searchField.text;
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
	ide_state.searchQuery = ide_state.searchField.text;
	const shouldHide = forceHide || clearQuery || ide_state.searchQuery.length === 0;
	if (shouldHide) {
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
	// if (!ide_state.searchActive && !ide_state.searchVisible) {
	// 	return;
	// }
	ide_state.searchActive = false;
	ide_state.searchScope = 'local';
	ide_state.searchDisplayOffset = 0;
	ide_state.searchHoverIndex = -1;
	cancelGlobalSearchJob();
	if (ide_state.searchQuery.length === 0) {
		ide_state.searchVisible = false;
		ide_state.searchMatches = [];
		ide_state.globalSearchMatches = [];
		ide_state.searchCurrentIndex = -1;
	} else {
		ide_state.searchMatches = [];
		ide_state.globalSearchMatches = [];
		ide_state.searchCurrentIndex = -1;
	}
	ide_state.selectionAnchor = null;
	ide_state.searchField.selectionAnchor = null as any;
	ide_state.searchField.pointerSelecting = false;
	cancelSearchJob();
	cancelGlobalSearchJob();
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

export function focusSearchResult(index: number): void {
	if (index < 0 || index >= ide_state.searchMatches.length) {
		return;
	}
	const match = ide_state.searchMatches[index];
	ide_state.cursorRow = match.row;
	ide_state.cursorColumn = match.start;
	ide_state.selectionAnchor = { row: match.row, column: match.end } as any;
	updateDesiredColumn();
	resetBlink();
	revealCursor();
}

export function jumpToNextMatch(): void {
	if (ide_state.searchScope === 'global') {
		if (activeSearchMatchCount() === 0) {
			ide_state.showMessage('No matches found', constants.COLOR_STATUS_WARNING, 1.5);
			return;
		}
		moveSearchSelection(1, { wrap: true });
		applySearchSelection(ide_state.searchCurrentIndex);
		return;
	}
	ensureSearchJobCompleted();
	if (ide_state.searchMatches.length === 0) {
		ide_state.showMessage('No matches found', constants.COLOR_STATUS_WARNING, 1.5);
		return;
	}
	if (ide_state.searchCurrentIndex < 0) {
		ide_state.searchCurrentIndex = 0;
	} else {
		ide_state.searchCurrentIndex += 1;
		if (ide_state.searchCurrentIndex >= ide_state.searchMatches.length) {
			ide_state.searchCurrentIndex = 0;
		}
	}
	focusSearchResult(ide_state.searchCurrentIndex);
}

export function jumpToPreviousMatch(): void {
	if (ide_state.searchScope === 'global') {
		if (activeSearchMatchCount() === 0) {
			ide_state.showMessage('No matches found', constants.COLOR_STATUS_WARNING, 1.5);
			return;
		}
		moveSearchSelection(-1, { wrap: true });
		applySearchSelection(ide_state.searchCurrentIndex);
		return;
	}
	ensureSearchJobCompleted();
	if (ide_state.searchMatches.length === 0) {
		ide_state.showMessage('No matches found', constants.COLOR_STATUS_WARNING, 1.5);
		return;
	}
	if (ide_state.searchCurrentIndex < 0) {
		ide_state.searchCurrentIndex = ide_state.searchMatches.length - 1;
	} else {
		ide_state.searchCurrentIndex -= 1;
		if (ide_state.searchCurrentIndex < 0) {
			ide_state.searchCurrentIndex = ide_state.searchMatches.length - 1;
		}
	}
	focusSearchResult(ide_state.searchCurrentIndex);
}

export function startSearchJob(): void {
	cancelSearchJob();
	ide_state.searchDisplayOffset = 0;
	ide_state.searchHoverIndex = -1;
	const normalized = ide_state.searchQuery.toLowerCase();
	const job: SearchComputationJob = {
		query: normalized,
		version: ide_state.textVersion,
		nextRow: 0,
		matches: [],
		firstMatchAfterCursor: -1,
		cursorRow: ide_state.cursorRow,
		cursorColumn: ide_state.cursorColumn,
	};
	ide_state.searchJob = job as any;
	ide_state.searchMatches = [];
	ide_state.searchCurrentIndex = -1;
	ide_state.selectionAnchor = null;
	enqueueBackgroundTask(() => runSearchJobSlice(job));
}

export function runSearchJobSlice(job: SearchComputationJob): boolean {
	if (ide_state.searchJob !== (job as any)) {
		return false;
	}
	if (job.query.length === 0 || job.version !== ide_state.textVersion || ide_state.searchQuery.length === 0) {
		ide_state.searchJob = null;
		return false;
	}
	const rowsPerSlice = 200;
	let processed = 0;
	while (job.nextRow < ide_state.lines.length && processed < rowsPerSlice) {
		const row = job.nextRow;
		job.nextRow += 1;
		processed += 1;
		collectSearchMatchesForRow(job, row);
	}
	if (job.nextRow >= ide_state.lines.length) {
		completeSearchJob(job);
		return false;
	}
	return true;
}

export function collectSearchMatchesForRow(job: SearchComputationJob, row: number): void {
	const line = ide_state.lines[row] ?? '';
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

export function forEachMatchInLine(line: string, needle: string, cb: (start: number, end: number) => void): void {
	if (!line || needle.length === 0 || line.length === 0) return;
	const lower = line.toLowerCase();
	const query = needle.toLowerCase();
	if (lower.length < query.length) return;
	let startIndex = 0;
	while (startIndex <= lower.length - query.length) {
		const index = lower.indexOf(query, startIndex);
		if (index === -1) break;
		cb(index, index + query.length);
		startIndex = index + query.length;
	}
}

export function completeSearchJob(job: SearchComputationJob): void {
	if (ide_state.searchJob !== (job as any)) return;
	ide_state.searchJob = null;
	ide_state.searchMatches = job.matches;
	if (job.matches.length === 0) {
		ide_state.searchCurrentIndex = -1;
		ide_state.selectionAnchor = null;
		ide_state.searchDisplayOffset = 0;
	} else {
		const index = job.firstMatchAfterCursor >= 0 ? job.firstMatchAfterCursor : 0;
		ide_state.searchCurrentIndex = clamp(index, 0, job.matches.length - 1);
		ensureSearchSelectionVisible();
		focusSearchResult(ide_state.searchCurrentIndex);
	}
}

export function cancelSearchJob(): void {
	ide_state.searchJob = null;
}

export function ensureSearchJobCompleted(): void {
	const job = ide_state.searchJob as any as SearchComputationJob | null;
	if (!job) return;
	while (ide_state.searchJob === (job as any) && runSearchJobSlice(job)) {
		// process synchronously until complete
	}
}

export function startGlobalSearchJob(): void {
	cancelGlobalSearchJob();
	const normalized = ide_state.searchQuery.toLowerCase();
	if (normalized.length === 0) {
		ide_state.globalSearchMatches = [];
		return;
	}
	let descriptors: ConsoleResourceDescriptor[] = [];
	try {
		descriptors = listResourcesStrict().filter(entry => entry.type === 'lua');
	} catch {
		descriptors = [];
	}
	const job: GlobalSearchJob = {
		query: normalized,
		descriptors,
		descriptorIndex: 0,
		currentLines: null,
		nextRow: 0,
		matches: [],
		limitHit: false,
	};
	ide_state.globalSearchJob = job as any;
	ide_state.globalSearchMatches = [];
	ide_state.searchCurrentIndex = -1;
	ide_state.searchDisplayOffset = 0;
	ide_state.searchHoverIndex = -1;
	enqueueBackgroundTask(() => runGlobalSearchJobSlice(job));
}

export function runGlobalSearchJobSlice(job: GlobalSearchJob): boolean {
	if (ide_state.globalSearchJob !== (job as any)) return false;
	if (job.query.length === 0) {
		ide_state.globalSearchJob = null;
		return false;
	}
	const rowsPerSlice = 200;
	let processed = 0;
	while (job.descriptorIndex < job.descriptors.length && processed < rowsPerSlice && !job.limitHit) {
		if (!job.currentLines) {
			const descriptor = job.descriptors[job.descriptorIndex];
			job.currentLines = loadDescriptorLines(descriptor);
			job.nextRow = 0;
			if (!job.currentLines) {
				job.descriptorIndex += 1;
				continue;
			}
		}
		const lines = job.currentLines;
		if (!lines) {
			job.descriptorIndex += 1;
			job.currentLines = null;
			continue;
		}
		while (job.nextRow < lines.length && processed < rowsPerSlice && !job.limitHit) {
			const row = job.nextRow;
			job.nextRow += 1;
			processed += 1;
			const line = lines[row] ?? '';
			forEachMatchInLine(line, job.query, (start, end) => {
				if (job.limitHit) return;
				const descriptor = job.descriptors[job.descriptorIndex];
				const match: GlobalSearchMatch = {
					descriptor,
					pathLabel: describeDescriptor(descriptor),
					row,
					start,
					end,
					snippet: buildSearchSnippet(line, start, end),
					assetId: descriptor.assetId ?? null,
					chunkName: descriptor.path ?? null,
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

export function completeGlobalSearchJob(job: GlobalSearchJob): void {
	if (ide_state.globalSearchJob !== (job as any)) return;
	ide_state.globalSearchJob = null;
	ide_state.globalSearchMatches = job.matches;
	if (ide_state.globalSearchMatches.length === 0) {
		ide_state.searchCurrentIndex = -1;
		ide_state.searchDisplayOffset = 0;
		return;
	}
	if (ide_state.searchCurrentIndex < 0 || ide_state.searchCurrentIndex >= ide_state.globalSearchMatches.length) {
		ide_state.searchCurrentIndex = 0;
	}
	ensureSearchSelectionVisible();
}

export function cancelGlobalSearchJob(): void {
	ide_state.globalSearchJob = null;
}

export function loadDescriptorLines(descriptor: ConsoleResourceDescriptor): string[] | null {
	try {
		const assetId = descriptor.assetId;
		if (!assetId) return null;
		const source = ide_state.loadLuaResourceFn(assetId);
		if (typeof source !== 'string') return null;
		return source.split(/\r?\n/);
	} catch {
		return null;
	}
}

export function describeDescriptor(descriptor: ConsoleResourceDescriptor): string {
	if (descriptor.path && descriptor.path.length > 0) {
		return descriptor.path.replace(/\\/g, '/');
	}
	if (descriptor.assetId && descriptor.assetId.length > 0) {
		return descriptor.assetId;
	}
	return '<resource>';
}

export function buildSearchSnippet(line: string, start: number, end: number): string {
	if (!line || line.length === 0) return '<blank>';
	const padding = 32;
	const sliceStart = Math.max(0, start - padding);
	const sliceEnd = Math.min(line.length, end + padding);
	let snippet = line.slice(sliceStart, sliceEnd).trim();
	if (sliceStart > 0) snippet = `…${snippet}`;
	if (sliceEnd < line.length) snippet = `${snippet}…`;
	return snippet;
}

export function ensureSearchSelectionVisible(): void {
	const total = activeSearchMatchCount();
	if (total === 0) {
		ide_state.searchDisplayOffset = 0;
		return;
	}
	if (ide_state.searchCurrentIndex < 0) {
		ide_state.searchCurrentIndex = 0;
	}
	const pageSize = searchPageSize();
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
	if (total <= 0) {
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

export function getVisibleSearchResultEntries(): Array<{ primary: string; secondary?: string | null; detail?: string | null }> {
	const stats = computeSearchPageStats();
	if (stats.visible <= 0) return [];
	const results: Array<{ primary: string; secondary?: string | null; detail?: string | null }> = [];
	for (let i = 0; i < stats.visible; i += 1) {
		const entry = buildSearchResultEntry(stats.offset + i);
		if (entry) results.push(entry);
	}
	return results;
}

export function buildSearchResultEntry(index: number): { primary: string; secondary?: string | null; detail?: string | null } | null {
	if (ide_state.searchScope === 'global') {
		const match = ide_state.globalSearchMatches[index];
		if (!match) return null;
		return {
			primary: match.pathLabel,
			secondary: match.snippet,
			detail: `:${match.row + 1}`,
		};
	}
	const match = ide_state.searchMatches[index];
	if (!match) return null;
	const lineText = ide_state.lines[match.row] ?? '';
	return {
		primary: `Line ${match.row + 1}`,
		secondary: buildSearchSnippet(lineText, match.start, match.end),
		detail: null,
	};
}

export function moveSearchSelection(delta: number, options?: { wrap?: boolean; preview?: boolean }): void {
	const total = activeSearchMatchCount();
	if (total === 0) return;
	let next = ide_state.searchCurrentIndex;
	if (next === -1) {
		next = delta > 0 ? 0 : total - 1;
	} else {
		next += delta;
	}
	if (options?.wrap) {
		next = ((next % total) + total) % total;
	} else {
		next = clamp(next, 0, total - 1);
	}
	if (next === ide_state.searchCurrentIndex) {
		if (options?.preview) {
			applySearchSelection(next, { preview: true });
		}
		return;
	}
	ide_state.searchCurrentIndex = next;
	ensureSearchSelectionVisible();
	if (options?.preview) {
		applySearchSelection(next, { preview: true });
	}
}

export function applySearchSelection(index: number, options?: { preview?: boolean }): void {
	const total = activeSearchMatchCount();
	if (total === 0) return;
	let targetIndex = index;
	if (targetIndex < 0 || targetIndex >= total) {
		targetIndex = clamp(targetIndex, 0, total - 1);
		ide_state.searchCurrentIndex = targetIndex;
	}
	ide_state.searchCurrentIndex = targetIndex;
	if (ide_state.searchScope === 'global') {
		if (options?.preview) return;
		focusGlobalSearchResult(targetIndex, options?.preview === true);
	} else {
		focusSearchResult(targetIndex);
	}
}

export function focusGlobalSearchResult(index: number, previewOnly: boolean = false): void {
	const match = ide_state.globalSearchMatches[index];
	if (!match) {
		if (!previewOnly) {
			ide_state.showMessage('Search result unavailable', constants.COLOR_STATUS_WARNING, 1.5);
		}
		return;
	}
	if (previewOnly) return;
	if (match.descriptor) {
		openLuaCodeTab(match.descriptor);
	} else {
		activateCodeTab();
	}
	scheduleNextFrame(() => {
		const row = clamp(match.row, 0, Math.max(0, ide_state.lines.length - 1));
		const line = ide_state.lines[row] ?? '';
		const endColumn = Math.min(match.end, line.length);
		ide_state.cursorRow = row;
		ide_state.cursorColumn = clamp(match.start, 0, line.length);
		ide_state.selectionAnchor = { row, column: endColumn } as any;
		ensureCursorVisible();
		resetBlink();
	});
}

export function searchPageSize(): number {
	// Mirror legacy behavior based on constant limit (viewport adaptive sizing handled elsewhere)
	return constants.SEARCH_MAX_RESULTS;
}
