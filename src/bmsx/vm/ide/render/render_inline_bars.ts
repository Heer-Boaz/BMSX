import { BmsxVMApi } from '../../vm_api';
import { drawInlineCaret } from './render_caret';
import * as constants from '../constants';
import type { TextField } from '../types';
import { ide_state } from '../ide_state';
import { caretX, getFieldText, measureRange, selectionRange } from '../inline_text_field';
import { api } from '../../vm_tooling_runtime';
import { drawEditorText } from '../text_renderer';
import { getCreateResourceBarHeight, getResourceSearchBarHeight, getSearchBarHeight, isResourceSearchCompactMode, resourceSearchEntryHeight, resourceSearchVisibleResultCount } from '../vm_cart_editor';
import { measureText } from '../text_utils';

type InlineResultListOptions<T> = {
	entries: readonly T[];
	visibleCount: number;
	displayOffset: number;
	entriesBaseOffset?: number;
	rowHeight: number;
	rowTop: number;
	viewportWidth: number;
	selectionIndex: number;
	hoverIndex: number;
	drawRow: (entry: T, rowTop: number) => void;
};

export interface InlineBarsHost {
	viewportWidth: number;
	headerHeight: number;
	tabBarHeight: number;
	lineHeight: number;
	spaceAdvance: number;
	charAdvance?: number;
	measureText: (text: string) => number;
	drawText: (text: string, x: number, y: number, color: number) => void;
	inlineFieldMetrics: () => { spaceAdvance: number };
	createResourceActive: boolean;
	createResourceVisible: boolean;
	createResourceField: TextField;
	createResourceWorking: boolean;
	createResourceError: string;
	drawCreateResourceErrorDialog: (api: BmsxVMApi, errorText: string) => void;
	getCreateResourceBarHeight: () => number;
	// Additional height getters for other bars (editor will supply these)
	getSearchBarHeight: () => number;
	getResourceSearchBarHeight: () => number;
	getSymbolSearchBarHeight: () => number;
	getRenameBarHeight: () => number;
	getLineJumpBarHeight: () => number;
	drawInlineCaret: typeof drawInlineCaret;
	inlineFieldSelectionRange: (field: unknown) => { start: number; end: number };
	inlineFieldMeasureRange: (field: unknown, metrics: { spaceAdvance: number }, start: number, end: number) => number;
	inlineFieldCaretX: (field: unknown, originX: number, measureText: (text: string) => number) => number;

	// When true, all inline carets should render as outlines (not active),
	// e.g. when another panel has focus (Problems panel).
	blockActiveCarets?: boolean;

	// Search bar state
	searchActive?: boolean;
	searchField?: unknown;
	searchQuery?: string;
	searchMatchesCount?: number;
	searchCurrentIndex?: number;
	searchScope?: 'local' | 'global';
	searchWorking?: boolean;
	searchVisibleResultCount?: () => number;
	searchResultEntryHeight?: () => number;
	searchResultEntries?: Array<{ primary: string; secondary?: string; detail?: string }>;
	searchResultEntriesBaseOffset?: number;
	searchSelectionIndex?: number;
	searchHoverIndex?: number;
	searchDisplayOffset?: number;

	// Resource search bar state and helpers
	resourceSearchActive?: boolean;
	resourceSearchField?: unknown;
	resourceSearchVisibleResultCount?: () => number;
	resourceSearchEntryHeight?: () => number;
	isResourceSearchCompactMode?: () => boolean;
	resourceSearchMatches?: Array<{ entry: { typeLabel: string; displayPath: string; assetLabel?: string } }>;
	resourceSearchSelectionIndex?: number;
	resourceSearchHoverIndex?: number;
	resourceSearchDisplayOffset?: number;

	// Symbol search bar state and helpers
	symbolSearchGlobal?: boolean;
	symbolSearchActive?: boolean;
	symbolSearchMode?: 'symbols' | 'references';
	symbolSearchField?: unknown;
	symbolSearchVisibleResultCount?: () => number;
	symbolSearchEntryHeight?: () => number;
	isSymbolSearchCompactMode?: () => boolean;
	symbolSearchMatches?: Array<{ entry: { kindLabel: string; displayName: string; line: number; sourceLabel?: string; symbol?: unknown } }>;
	symbolSearchSelectionIndex?: number;
	symbolSearchHoverIndex?: number;
	symbolSearchDisplayOffset?: number;

	// Line jump bar state
	lineJumpActive?: boolean;
	lineJumpField?: unknown;

	// Rename bar state
	renameActive?: boolean;
	renameField?: unknown;
	renameMatchCount?: number;
	renameExpression?: string;
	renameOriginalName?: string;
}

export function renderCreateResourceBar(api: BmsxVMApi, host: InlineBarsHost): void {
	const height = host.getCreateResourceBarHeight();
	if (height <= 0) return;
	const barTop = host.headerHeight + host.tabBarHeight;
	const barBottom = barTop + height;
	api.rectfill(0, barTop, host.viewportWidth, barBottom, undefined, constants.COLOR_CREATE_RESOURCE_BACKGROUND);
	api.rectfill(0, barTop, host.viewportWidth, barTop + 1, undefined, constants.COLOR_CREATE_RESOURCE_OUTLINE);
	api.rectfill(0, barBottom - 1, host.viewportWidth, barBottom, undefined, constants.COLOR_CREATE_RESOURCE_OUTLINE);

	const label = 'NEW FILE:';
	const labelX = 4;
	const labelY = barTop + constants.CREATE_RESOURCE_BAR_MARGIN_Y;
	host.drawText(label, labelX, labelY, constants.COLOR_CREATE_RESOURCE_TEXT);

	const field = host.createResourceField;
	const pathX = labelX + host.measureText(label + ' ');
	const fieldText = getFieldText(field);
	let displayPath = fieldText;
	let pathColor = constants.COLOR_CREATE_RESOURCE_TEXT;
	if (displayPath.length === 0 && !host.createResourceActive) {
		displayPath = 'ENTER LUA PATH';
		pathColor = constants.COLOR_CREATE_RESOURCE_PLACEHOLDER;
	}

	const selection = host.inlineFieldSelectionRange(field);
	if (selection && fieldText.length > 0) {
		const selectionLeft = pathX + host.inlineFieldMeasureRange(field, ide_state.inlineFieldMetricsRef, 0, selection.start);
		const selectionWidth = host.inlineFieldMeasureRange(field, ide_state.inlineFieldMetricsRef, selection.start, selection.end);
		if (selectionWidth > 0) {
			api.rectfill_color(selectionLeft, labelY, selectionLeft + selectionWidth, labelY + host.lineHeight, undefined, constants.SELECTION_OVERLAY);
		}
	}

	host.drawText(displayPath, pathX, labelY, pathColor);

	const caretBaseX = host.inlineFieldCaretX(field, pathX, host.measureText);
	const caretLeft = Math.floor(caretBaseX);
	const caretRight = Math.max(caretLeft + 1, Math.floor(caretBaseX + host.spaceAdvance));
	const caretTop = Math.floor(labelY);
	const caretBottom = caretTop + host.lineHeight;
	host.drawInlineCaret(api, field, caretLeft, caretTop, caretRight, caretBottom, caretBaseX, (host.createResourceActive && !host.blockActiveCarets), constants.INLINE_CARET_COLOR, pathColor);

	// Status or error overlay on the right
	if (host.createResourceWorking) {
		const status = 'CREATING...';
		const statusWidth = host.measureText(status);
		const statusX = Math.max(pathX + host.measureText(displayPath) + host.spaceAdvance, host.viewportWidth - statusWidth - 4);
		host.drawText(status, statusX, labelY, constants.COLOR_CREATE_RESOURCE_TEXT);
	} else if (host.createResourceError && host.createResourceError.length > 0) {
		host.drawCreateResourceErrorDialog(api, host.createResourceError);
	}
}

export function renderSearchBar(host: InlineBarsHost): void {
	const height = host.getSearchBarHeight();
	if (height <= 0) return;
	const barTop = host.headerHeight + host.tabBarHeight + host.getCreateResourceBarHeight();
	const barBottom = barTop + height;
	api.rectfill(0, barTop, host.viewportWidth, barBottom, undefined, constants.COLOR_SEARCH_BACKGROUND);
	api.rectfill(0, barTop, host.viewportWidth, barTop + 1, undefined, constants.COLOR_SEARCH_OUTLINE);
	api.rectfill(0, barBottom - 1, host.viewportWidth, barBottom, undefined, constants.COLOR_SEARCH_OUTLINE);

	const field = host.searchField as TextField;
	const label = host.searchScope === 'global' ? 'SEARCH ALL:' : 'SEARCH:';
	const labelX = 4;
	const labelY = barTop + constants.SEARCH_BAR_MARGIN_Y;
	host.drawText(label, labelX, labelY, constants.COLOR_SEARCH_TEXT);

	const active = !!host.searchActive && !host.blockActiveCarets;
	const fieldText = field ? getFieldText(field) : '';
	let queryText = fieldText;
	let queryColor = constants.COLOR_SEARCH_TEXT;
	if (queryText.length === 0 && !active) {
		queryText = 'TYPE TO SEARCH';
		queryColor = constants.COLOR_SEARCH_PLACEHOLDER;
	}
	const queryX = labelX + host.measureText(label + ' ');

	const selection = field ? host.inlineFieldSelectionRange(field) : null;
	if (selection && fieldText.length > 0) {
		const selectionLeft = queryX + host.inlineFieldMeasureRange(field, ide_state.inlineFieldMetricsRef, 0, selection.start);
		const selectionWidth = host.inlineFieldMeasureRange(field, ide_state.inlineFieldMetricsRef, selection.start, selection.end);
		if (selectionWidth > 0) {
			api.rectfill_color(selectionLeft, labelY, selectionLeft + selectionWidth, labelY + host.lineHeight, undefined, constants.SELECTION_OVERLAY);
		}
	}

	host.drawText(queryText, queryX, labelY, queryColor);

	if (field) {
		const caretX = host.inlineFieldCaretX(field, queryX, host.measureText);
		const caretLeft = Math.floor(caretX);
		const caretRight = Math.max(caretLeft + 1, Math.floor(caretX + (host.charAdvance ?? host.spaceAdvance)));
		const caretTop = Math.floor(labelY);
		const caretBottom = caretTop + host.lineHeight;
		host.drawInlineCaret(api, field, caretLeft, caretTop, caretRight, caretBottom, caretX, active, constants.INLINE_CARET_COLOR, queryColor);
	}

	const infoX = host.viewportWidth - 4;
	const total = host.searchMatchesCount ?? 0;
	const current = host.searchCurrentIndex ?? -1;
	if (host.searchWorking) {
		const workingText = 'SEARCHING...';
		const workingWidth = host.measureText(workingText);
		host.drawText(workingText, infoX - workingWidth, labelY, constants.COLOR_SEARCH_TEXT);
	} else if (total > 0 || (host.searchQuery && host.searchQuery.length > 0)) {
		const infoText = total === 0 ? '0/0' : `${(current >= 0 ? current + 1 : 0)}/${total}`;
		const infoColor = total === 0 ? constants.COLOR_STATUS_WARNING : constants.COLOR_SEARCH_TEXT;
		const infoWidth = host.measureText(infoText);
		host.drawText(infoText, infoX - infoWidth, labelY, infoColor);
	}

	const visible = host.searchVisibleResultCount ? host.searchVisibleResultCount() : 0;
	if (visible <= 0) {
		return;
	}
	const baseHeight = host.lineHeight + constants.SEARCH_BAR_MARGIN_Y * 2;
	const separatorTop = barTop + baseHeight;
	api.rectfill(0, separatorTop, host.viewportWidth, separatorTop + constants.SEARCH_RESULT_SPACING, undefined, constants.COLOR_SEARCH_OUTLINE);
	const resultsTop = separatorTop + constants.SEARCH_RESULT_SPACING;
	const rowHeight = host.searchResultEntryHeight ? host.searchResultEntryHeight() : host.lineHeight * 2;

	renderResultList({
		entries: host.searchResultEntries,
		visibleCount: visible,
		displayOffset: host.searchDisplayOffset ?? 0,
		entriesBaseOffset: host.searchResultEntriesBaseOffset ?? 0,
		rowHeight,
		rowTop: resultsTop,
		viewportWidth: host.viewportWidth,
		selectionIndex: host.searchSelectionIndex ?? -1,
		hoverIndex: host.searchHoverIndex ?? -1,
		drawRow: (entry, rowTop) => {
			const paddingX = constants.QUICK_OPEN_RESULT_PADDING_X;
			const primaryY = rowTop;
			const secondaryY = rowTop + host.lineHeight;
			if (entry.primary) {
				host.drawText(entry.primary, paddingX, primaryY, constants.COLOR_SEARCH_TEXT);
			}
			if (entry.detail) {
				const detailWidth = host.measureText(entry.detail);
				const detailX = host.viewportWidth - detailWidth - paddingX;
				host.drawText(entry.detail, detailX, primaryY, constants.COLOR_SEARCH_SECONDARY_TEXT);
			}
			if (entry.secondary) {
				host.drawText(entry.secondary, paddingX, secondaryY, constants.COLOR_SEARCH_SECONDARY_TEXT);
			}
		},
	});
}

export function renderResourceSearchBar(): void {
	const height = getResourceSearchBarHeight();
	if (height <= 0) return;
	const barTop = ide_state.headerHeight + ide_state.tabBarHeight + getCreateResourceBarHeight() + getSearchBarHeight();
	const barBottom = barTop + height;
	api.rectfill(0, barTop, ide_state.viewportWidth, barBottom, undefined, constants.COLOR_QUICK_OPEN_BACKGROUND);
	api.rectfill(0, barTop, ide_state.viewportWidth, barTop + 1, undefined, constants.COLOR_QUICK_OPEN_OUTLINE);
	api.rectfill(0, barBottom - 1, ide_state.viewportWidth, barBottom, undefined, constants.COLOR_QUICK_OPEN_OUTLINE);

	const field = ide_state.resourceSearchField as TextField;
	const label = 'FILE :';
	const labelX = 4;
	const labelY = barTop + constants.QUICK_OPEN_BAR_MARGIN_Y;
	drawEditorText(ide_state.font, label, labelX, labelY, undefined, constants.COLOR_QUICK_OPEN_TEXT);

	const active = !!ide_state.resourceSearchActive && !ide_state.problemsPanel.isVisible && !ide_state.problemsPanel.isFocused;
	const fieldText = field ? getFieldText(field) : '';
	let queryText = fieldText;
	let queryColor = constants.COLOR_QUICK_OPEN_TEXT;
	if (queryText.length === 0 && !active) {
		queryText = 'TYPE TO FILTER (@/# PREFIX)';
		queryColor = constants.COLOR_QUICK_OPEN_PLACEHOLDER;
	}
	const queryX = labelX + measureText(label + ' ');

	const selection = field ? selectionRange(field) : null;
	if (selection && fieldText.length > 0) {
		const selectionLeft = queryX + measureRange(field, ide_state.inlineFieldMetricsRef, 0, selection.start);
		const selectionWidth = measureRange(field, ide_state.inlineFieldMetricsRef, selection.start, selection.end);
		if (selectionWidth > 0) {
			api.rectfill_color(selectionLeft, labelY, selectionLeft + selectionWidth, labelY + ide_state.lineHeight, undefined, constants.SELECTION_OVERLAY);
		}
	}

	drawEditorText(ide_state.font, queryText, queryX, labelY, undefined, queryColor);

	if (field) {
		const caretLeft = caretX(field, queryX, measureText);
		const caretRight = Math.max(caretLeft + 1, caretLeft + (ide_state.charAdvance));
		const caretTop = labelY;
		const caretBottom = caretTop + ide_state.lineHeight;
		drawInlineCaret(api, field, caretLeft, caretTop, caretRight, caretBottom, caretLeft, active, constants.INLINE_CARET_COLOR, queryColor);
	}

	const visible = resourceSearchVisibleResultCount();
	if (visible <= 0) return;
	const baseHeight = ide_state.lineHeight + constants.QUICK_OPEN_BAR_MARGIN_Y * 2;
	const separatorTop = barTop + baseHeight;
	api.rectfill(0, separatorTop, ide_state.viewportWidth, separatorTop + constants.QUICK_OPEN_RESULT_SPACING, undefined, constants.COLOR_QUICK_OPEN_OUTLINE);
	const resultsTop = separatorTop + constants.QUICK_OPEN_RESULT_SPACING;
	const rowHeight = resourceSearchEntryHeight();
	const compactMode = isResourceSearchCompactMode();

	renderResultList({
		entries: ide_state.resourceSearchMatches,
		visibleCount: visible,
		displayOffset: ide_state.resourceSearchDisplayOffset ?? 0,
		rowHeight,
		rowTop: resultsTop,
		viewportWidth: ide_state.viewportWidth,
		selectionIndex: ide_state.resourceSearchSelectionIndex ?? -1,
		hoverIndex: ide_state.resourceSearchHoverIndex ?? -1,
		drawRow: (match, rowTop) => {
			let textX = constants.QUICK_OPEN_RESULT_PADDING_X;
			const kindText = match?.entry.typeLabel ?? '';
			const detail = match?.entry.assetLabel ?? '';
			if (kindText.length > 0) {
				drawEditorText(ide_state.font, kindText, textX, rowTop, undefined, constants.COLOR_QUICK_OPEN_KIND);
				textX += measureText(kindText + ' ');
			}
			drawEditorText(ide_state.font, match?.entry.displayPath ?? '', textX, rowTop, undefined, constants.COLOR_QUICK_OPEN_TEXT);
			if (compactMode) {
				const secondaryY = rowTop + ide_state.lineHeight;
				if (detail.length > 0) {
					drawEditorText(ide_state.font, detail, constants.QUICK_OPEN_RESULT_PADDING_X, secondaryY, undefined, constants.COLOR_QUICK_OPEN_KIND);
				}
			} else if (detail.length > 0) {
				const detailWidth = measureText(detail);
				const detailX = ide_state.viewportWidth - detailWidth - constants.QUICK_OPEN_RESULT_PADDING_X;
				drawEditorText(ide_state.font, detail, detailX, rowTop, undefined, constants.COLOR_QUICK_OPEN_KIND);
			}
		},
	});
}

export function renderSymbolSearchBar(api: BmsxVMApi, host: InlineBarsHost): void {
	const height = host.getSymbolSearchBarHeight();
	if (height <= 0) return;
	const barTop = host.headerHeight + host.tabBarHeight + host.getCreateResourceBarHeight() + host.getSearchBarHeight() + host.getResourceSearchBarHeight();
	const barBottom = barTop + height;
	api.rectfill(0, barTop, host.viewportWidth, barBottom, undefined, constants.COLOR_SYMBOL_SEARCH_BACKGROUND);
	api.rectfill(0, barTop, host.viewportWidth, barTop + 1, undefined, constants.COLOR_SYMBOL_SEARCH_OUTLINE);
	api.rectfill(0, barBottom - 1, host.viewportWidth, barBottom, undefined, constants.COLOR_SYMBOL_SEARCH_OUTLINE);

	const field = host.symbolSearchField as TextField;
	const mode = host.symbolSearchMode ?? 'symbols';
	const label = mode === 'references' ? 'REFS :' : host.symbolSearchGlobal ? 'SYMBOL #:' : 'SYMBOL @:';
	const labelX = 4;
	const labelY = barTop + constants.SYMBOL_SEARCH_BAR_MARGIN_Y;
	host.drawText(label, labelX, labelY, constants.COLOR_SYMBOL_SEARCH_TEXT);

	const active = !!host.symbolSearchActive;
	const fieldText = field ? getFieldText(field) : '';
	let queryText = fieldText;
	let queryColor = constants.COLOR_SYMBOL_SEARCH_TEXT;
	const placeholder = mode === 'references' ? 'FILTER REFERENCES' : 'TYPE TO FILTER';
	if (queryText.length === 0 && !active) {
		queryText = placeholder;
		queryColor = constants.COLOR_SYMBOL_SEARCH_PLACEHOLDER;
	}
	const queryX = labelX + host.measureText(label + ' ');

	const selection = field ? host.inlineFieldSelectionRange(field) : null;
	if (selection && fieldText.length > 0) {
		const selectionLeft = queryX + host.inlineFieldMeasureRange(field, ide_state.inlineFieldMetricsRef, 0, selection.start);
		const selectionWidth = host.inlineFieldMeasureRange(field, ide_state.inlineFieldMetricsRef, selection.start, selection.end);
		if (selectionWidth > 0) {
			api.rectfill_color(selectionLeft, labelY, selectionLeft + selectionWidth, labelY + host.lineHeight, undefined, constants.SELECTION_OVERLAY);
		}
	}

	host.drawText(queryText, queryX, labelY, queryColor);

	if (field) {
		const caretX = host.inlineFieldCaretX(field, queryX, host.measureText);
		const caretLeft = Math.floor(caretX);
		const caretRight = Math.max(caretLeft + 1, Math.floor(caretX + (host.charAdvance ?? host.spaceAdvance)));
		const caretTop = Math.floor(labelY);
		const caretBottom = caretTop + host.lineHeight;
		host.drawInlineCaret(api, field, caretLeft, caretTop, caretRight, caretBottom, caretX, active, constants.INLINE_CARET_COLOR, queryColor);
	}

	const visible = host.symbolSearchVisibleResultCount ? host.symbolSearchVisibleResultCount() : 0;
	if (visible <= 0) {
		return;
	}
	const baseHeight = host.lineHeight + constants.SYMBOL_SEARCH_BAR_MARGIN_Y * 2;
	const separatorTop = barTop + baseHeight;
	api.rectfill(0, separatorTop, host.viewportWidth, separatorTop + constants.SYMBOL_SEARCH_RESULT_SPACING, undefined, constants.COLOR_SYMBOL_SEARCH_OUTLINE);
	const resultsTop = separatorTop + constants.SYMBOL_SEARCH_RESULT_SPACING;
	const entryHeight = host.symbolSearchEntryHeight ? host.symbolSearchEntryHeight() : host.lineHeight * 2;
	const compactMode = mode === 'references'
		? true
		: (host.symbolSearchGlobal && host.isSymbolSearchCompactMode ? host.isSymbolSearchCompactMode() : false) as boolean;
	renderResultList({
		entries: host.symbolSearchMatches,
		visibleCount: visible,
		displayOffset: host.symbolSearchDisplayOffset ?? 0,
		rowHeight: entryHeight,
		rowTop: resultsTop,
		viewportWidth: host.viewportWidth,
		selectionIndex: host.symbolSearchSelectionIndex ?? -1,
		hoverIndex: host.symbolSearchHoverIndex ?? -1,
		drawRow: (match, rowTop) => {
			let textX = constants.SYMBOL_SEARCH_RESULT_PADDING_X;
			const kindText = match?.entry.kindLabel ?? '';
			const symbol = match?.entry.symbol as { __referenceColumn?: number };
			const referenceColumn = symbol?.__referenceColumn;
			const lineValue = match?.entry.line ?? 0;
			const lineText = mode === 'references' && typeof referenceColumn === 'number'
				? `:${lineValue}:${referenceColumn}`
				: `:${lineValue}`;
			const lineWidth = host.measureText(lineText);
			if (kindText.length > 0) {
				host.drawText(kindText, textX, rowTop, constants.COLOR_SYMBOL_SEARCH_KIND);
				textX += host.measureText(kindText + ' ');
			}
			host.drawText(match?.entry.displayName ?? '', textX, rowTop, constants.COLOR_SYMBOL_SEARCH_TEXT);
			if (compactMode) {
				const secondaryY = rowTop + host.lineHeight;
				const lineX = host.viewportWidth - lineWidth - constants.SYMBOL_SEARCH_RESULT_PADDING_X;
				host.drawText(lineText, lineX, secondaryY, constants.COLOR_SYMBOL_SEARCH_TEXT);
				const sourceLabel = match?.entry.sourceLabel ?? '';
				if (sourceLabel) {
					host.drawText(sourceLabel, constants.SYMBOL_SEARCH_RESULT_PADDING_X, secondaryY, constants.COLOR_SYMBOL_SEARCH_KIND);
				}
			} else {
				const lineX = host.viewportWidth - lineWidth - constants.SYMBOL_SEARCH_RESULT_PADDING_X;
				host.drawText(lineText, lineX, rowTop, constants.COLOR_SYMBOL_SEARCH_TEXT);
				const sourceLabel = match?.entry.sourceLabel ?? '';
				if (sourceLabel) {
					const sourceWidth = host.measureText(sourceLabel);
					const sourceX = Math.max(textX, lineX - host.spaceAdvance - sourceWidth);
					host.drawText(sourceLabel, sourceX, rowTop, constants.COLOR_SYMBOL_SEARCH_KIND);
				}
			}
		},
	});
}

function renderResultList<T>(options: InlineResultListOptions<T>): void {
	const { entries, visibleCount } = options;
	if (!entries || visibleCount <= 0) {
		return;
	}
	const baseOffset = options.entriesBaseOffset ?? 0;
	for (let i = 0; i < visibleCount; i += 1) {
		const matchIndex = options.displayOffset + i;
		const entryIndex = matchIndex - baseOffset;
		if (entryIndex < 0 || entryIndex >= entries.length) {
			continue;
		}
		const entry = entries[entryIndex];
		if (!entry) {
			continue;
		}
		const rowTop = options.rowTop + i * options.rowHeight;
		const rowBottom = rowTop + options.rowHeight;
		if (matchIndex === options.selectionIndex) {
			api.rectfill_color(0, rowTop, options.viewportWidth, rowBottom, undefined, constants.SEARCH_RESULT_SELECTION_OVERLAY);
		} else if (matchIndex === options.hoverIndex) {
			api.rectfill_color(0, rowTop, options.viewportWidth, rowBottom, undefined, constants.SEARCH_RESULT_HOVER_OVERLAY);
		}
		options.drawRow(entry, rowTop);
	}
}

export function renderRenameBar(api: BmsxVMApi, host: InlineBarsHost): void {
	const height = host.getRenameBarHeight();
	if (height <= 0) return;
	const barTop = host.headerHeight + host.tabBarHeight
		+ host.getCreateResourceBarHeight()
		+ host.getSearchBarHeight()
		+ host.getResourceSearchBarHeight()
		+ host.getSymbolSearchBarHeight()
		+ host.getRenameBarHeight();
	const barBottom = barTop + height;
	api.rectfill(0, barTop, host.viewportWidth, barBottom, undefined, constants.COLOR_SEARCH_BACKGROUND);
	api.rectfill(0, barTop, host.viewportWidth, barTop + 1, undefined, constants.COLOR_SEARCH_OUTLINE);
	api.rectfill(0, barBottom - 1, host.viewportWidth, barBottom, undefined, constants.COLOR_SEARCH_OUTLINE);

	const field = host.renameField as TextField;
	const label = 'RENAME:';
	const labelX = 4;
	const labelY = barTop + constants.SEARCH_BAR_MARGIN_Y;
	host.drawText(label, labelX, labelY, constants.COLOR_SEARCH_TEXT);

	const active = !!host.renameActive && !host.blockActiveCarets;
	const fieldText = field ? getFieldText(field) : '';
	let valueText = fieldText;
	let valueColor = constants.COLOR_SEARCH_TEXT;
	if (valueText.length === 0 && !active) {
		valueText = 'TYPE NEW NAME';
		valueColor = constants.COLOR_SEARCH_PLACEHOLDER;
	}
	const valueX = labelX + host.measureText(label + ' ');

	const selection = field ? host.inlineFieldSelectionRange(field) : null;
	if (selection && fieldText.length > 0) {
		const selectionLeft = valueX + host.inlineFieldMeasureRange(field, ide_state.inlineFieldMetricsRef, 0, selection.start);
		const selectionWidth = host.inlineFieldMeasureRange(field, ide_state.inlineFieldMetricsRef, selection.start, selection.end);
		if (selectionWidth > 0) {
			api.rectfill_color(selectionLeft, labelY, selectionLeft + selectionWidth, labelY + host.lineHeight, undefined, constants.SELECTION_OVERLAY);
		}
	}

	host.drawText(valueText, valueX, labelY, valueColor);

	if (field) {
		const caretX = host.inlineFieldCaretX(field, valueX, host.measureText);
		const caretLeft = Math.floor(caretX);
		const caretRight = Math.max(caretLeft + 1, Math.floor(caretX + (host.charAdvance ?? host.spaceAdvance)));
		const caretTop = Math.floor(labelY);
		const caretBottom = caretTop + host.lineHeight;
		host.drawInlineCaret(api, field, caretLeft, caretTop, caretRight, caretBottom, caretX, active, constants.INLINE_CARET_COLOR, valueColor);
	}

	const matchCount = host.renameMatchCount ?? 0;
	const expression = host.renameExpression ?? host.renameOriginalName ?? '';
	let status = '';
	if (expression && expression.length > 0) {
		status = expression;
	}
	if (matchCount > 0) {
		const countLabel = matchCount === 1 ? '1 REF' : `${matchCount} REFS`;
		status = status.length > 0 ? `${status} · ${countLabel}` : countLabel;
	}
	if (status.length > 0) {
		const statusWidth = host.measureText(status);
		const statusX = Math.max(valueX + host.measureText(valueText) + host.spaceAdvance, host.viewportWidth - statusWidth - 4);
		host.drawText(status, statusX, labelY, constants.COLOR_SEARCH_TEXT);
	}
}

export function renderLineJumpBar(api: BmsxVMApi, host: InlineBarsHost): void {
	const height = host.getLineJumpBarHeight();
	if (height <= 0) return;
	const barTop = host.headerHeight + host.tabBarHeight
		+ host.getCreateResourceBarHeight()
		+ host.getSearchBarHeight()
		+ host.getResourceSearchBarHeight()
		+ host.getSymbolSearchBarHeight();
	const barBottom = barTop + height;
	api.rectfill(0, barTop, host.viewportWidth, barBottom, undefined, constants.COLOR_LINE_JUMP_BACKGROUND);
	api.rectfill(0, barTop, host.viewportWidth, barTop + 1, undefined, constants.COLOR_LINE_JUMP_OUTLINE);
	api.rectfill(0, barBottom - 1, host.viewportWidth, barBottom, undefined, constants.COLOR_LINE_JUMP_OUTLINE);

	const label = 'LINE #:';
	const labelX = 4;
	const labelY = barTop + constants.LINE_JUMP_BAR_MARGIN_Y;
	host.drawText(label, labelX, labelY, constants.COLOR_LINE_JUMP_TEXT);

	const field = host.lineJumpField as TextField;
	const active = !!host.lineJumpActive;
	const fieldText = field ? getFieldText(field) : '';
	let valueText = fieldText;
	let valueColor = constants.COLOR_LINE_JUMP_TEXT;
	if (valueText.length === 0 && !active) {
		valueText = 'ENTER LINE NUMBER';
		valueColor = constants.COLOR_LINE_JUMP_PLACEHOLDER;
	}
	const valueX = labelX + host.measureText(label + ' ');

	const selection = field ? host.inlineFieldSelectionRange(field) : null;
	if (selection && fieldText.length > 0) {
		const selectionLeft = valueX + host.inlineFieldMeasureRange(field, ide_state.inlineFieldMetricsRef, 0, selection.start);
		const selectionWidth = host.inlineFieldMeasureRange(field, ide_state.inlineFieldMetricsRef, selection.start, selection.end);
		if (selectionWidth > 0) {
			api.rectfill_color(selectionLeft, labelY, selectionLeft + selectionWidth, labelY + host.lineHeight, undefined, constants.SELECTION_OVERLAY);
		}
	}

	host.drawText(valueText, valueX, labelY, valueColor);

	if (field) {
		const caretX = host.inlineFieldCaretX(field, valueX, host.measureText);
		const caretLeft = Math.floor(caretX);
		const caretRight = Math.max(caretLeft + 1, Math.floor(caretX + (host.charAdvance ?? host.spaceAdvance)));
		const caretTop = Math.floor(labelY);
		const caretBottom = caretTop + host.lineHeight;
		host.drawInlineCaret(api, field, caretLeft, caretTop, caretRight, caretBottom, caretX, active, constants.INLINE_CARET_COLOR, valueColor);
	}
}
