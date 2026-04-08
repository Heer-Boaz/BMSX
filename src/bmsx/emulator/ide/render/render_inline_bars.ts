import { drawInlineCaret } from './render_caret';
import * as constants from '../core/constants';
import type { TextField } from '../core/types';
import { ide_state } from '../core/ide_state';
import { measureInlineFieldDecoration } from '../browser/inline_field_view';
import { api } from '../../overlay_api';
import { drawEditorText } from './text_renderer';
import { drawCreateResourceErrorDialog } from './render_resource_panel';
import { activeSearchMatchCount, getVisibleSearchResultEntries } from '../contrib/find/editor_search';
import { getCreateResourceBarHeight, getLineJumpBarHeight, getRenameBarHeight, getResourceSearchBarHeight, getSearchBarHeight, getSymbolSearchBarHeight, isResourceSearchCompactMode, isSymbolSearchCompactMode, resourceSearchEntryHeight, resourceSearchVisibleResultCount, searchResultEntryHeight, searchVisibleResultCount, symbolSearchEntryHeight, symbolSearchVisibleResultCount } from '../browser/editor_view';
import { measureText } from '../core/text_utils';
import { textFromLines } from '../text/source_text';

type InlineSearchResultEntry = {
	primary: string;
	secondary?: string;
	detail?: string;
};

type InlineResourceSearchResult = {
	entry: {
		typeLabel: string;
		displayPath: string;
		assetLabel?: string;
	};
};

type InlineSymbolSearchResult = {
	entry: {
		kindLabel: string;
		displayName: string;
		line: number;
		sourceLabel?: string;
		symbol: unknown;
	};
};

const drawSearchResultRow = (entry: InlineSearchResultEntry, rowTop: number): void => {
	const paddingX = constants.QUICK_OPEN_RESULT_PADDING_X;
	const secondaryY = rowTop + ide_state.lineHeight;
	if (entry.primary) {
		drawEditorText(ide_state.font, entry.primary, paddingX, rowTop, undefined, constants.COLOR_SEARCH_TEXT);
	}
	if (entry.detail) {
		const detailWidth = measureText(entry.detail);
		const detailX = ide_state.viewportWidth - detailWidth - paddingX;
		drawEditorText(ide_state.font, entry.detail, detailX, rowTop, undefined, constants.COLOR_SEARCH_SECONDARY_TEXT);
	}
	if (entry.secondary) {
		drawEditorText(ide_state.font, entry.secondary, paddingX, secondaryY, undefined, constants.COLOR_SEARCH_SECONDARY_TEXT);
	}
};

const drawResourceSearchResultRow = (match: InlineResourceSearchResult, rowTop: number): void => {
	let textX = constants.QUICK_OPEN_RESULT_PADDING_X;
	const kindText = match.entry.typeLabel;
	const detail = match.entry.assetLabel ?? '';
	if (kindText.length > 0) {
		drawEditorText(ide_state.font, kindText, textX, rowTop, undefined, constants.COLOR_QUICK_OPEN_KIND);
		textX += measureText(kindText) + ide_state.spaceAdvance;
	}
	drawEditorText(ide_state.font, match.entry.displayPath, textX, rowTop, undefined, constants.COLOR_QUICK_OPEN_TEXT);
	if (isResourceSearchCompactMode()) {
		const secondaryY = rowTop + ide_state.lineHeight;
		if (detail.length > 0) {
			drawEditorText(ide_state.font, detail, constants.QUICK_OPEN_RESULT_PADDING_X, secondaryY, undefined, constants.COLOR_QUICK_OPEN_KIND);
		}
	} else if (detail.length > 0) {
		const detailWidth = measureText(detail);
		const detailX = ide_state.viewportWidth - detailWidth - constants.QUICK_OPEN_RESULT_PADDING_X;
		drawEditorText(ide_state.font, detail, detailX, rowTop, undefined, constants.COLOR_QUICK_OPEN_KIND);
	}
};

const drawSymbolSearchResultRow = (match: InlineSymbolSearchResult, rowTop: number): void => {
	const mode = ide_state.symbolSearchMode ?? 'symbols';
	const compactMode = mode === 'references'
		? true
		: (ide_state.symbolSearchGlobal && isSymbolSearchCompactMode());
	let textX = constants.SYMBOL_SEARCH_RESULT_PADDING_X;
	const kindText = match.entry.kindLabel;
	const symbol = match.entry.symbol as { __referenceColumn?: number };
	const referenceColumn = symbol.__referenceColumn;
	const lineValue = match.entry.line;
	const lineText = mode === 'references' && typeof referenceColumn === 'number'
		? `:${lineValue}:${referenceColumn}`
		: `:${lineValue}`;
	const lineWidth = measureText(lineText);
	if (kindText.length > 0) {
		drawEditorText(ide_state.font, kindText, textX, rowTop, undefined, constants.COLOR_SYMBOL_SEARCH_KIND);
		textX += measureText(kindText) + ide_state.spaceAdvance;
	}
	drawEditorText(ide_state.font, match.entry.displayName, textX, rowTop, undefined, constants.COLOR_SYMBOL_SEARCH_TEXT);
	if (compactMode) {
		const secondaryY = rowTop + ide_state.lineHeight;
		const lineX = ide_state.viewportWidth - lineWidth - constants.SYMBOL_SEARCH_RESULT_PADDING_X;
		drawEditorText(ide_state.font, lineText, lineX, secondaryY, undefined, constants.COLOR_SYMBOL_SEARCH_TEXT);
		const sourceLabel = match.entry.sourceLabel ?? '';
		if (sourceLabel) {
			drawEditorText(ide_state.font, sourceLabel, constants.SYMBOL_SEARCH_RESULT_PADDING_X, secondaryY, undefined, constants.COLOR_SYMBOL_SEARCH_KIND);
		}
	} else {
		const lineX = ide_state.viewportWidth - lineWidth - constants.SYMBOL_SEARCH_RESULT_PADDING_X;
		drawEditorText(ide_state.font, lineText, lineX, rowTop, undefined, constants.COLOR_SYMBOL_SEARCH_TEXT);
		const sourceLabel = match.entry.sourceLabel ?? '';
		if (sourceLabel) {
			const sourceWidth = measureText(sourceLabel);
			const sourceX = Math.max(textX, lineX - ide_state.spaceAdvance - sourceWidth);
			drawEditorText(ide_state.font, sourceLabel, sourceX, rowTop, undefined, constants.COLOR_SYMBOL_SEARCH_KIND);
		}
	}
};

export function renderCreateResourceBar(): void {
	const height = getCreateResourceBarHeight();
	if (height <= 0) return;
	const barTop = ide_state.headerHeight + ide_state.tabBarHeight;
	const barBottom = barTop + height;
	api.fill_rect(0, barTop, ide_state.viewportWidth, barBottom, undefined, constants.COLOR_CREATE_RESOURCE_BACKGROUND);
	api.fill_rect(0, barTop, ide_state.viewportWidth, barTop + 1, undefined, constants.COLOR_CREATE_RESOURCE_OUTLINE);
	api.fill_rect(0, barBottom - 1, ide_state.viewportWidth, barBottom, undefined, constants.COLOR_CREATE_RESOURCE_OUTLINE);

	const label = 'NEW FILE:';
	const labelX = 4;
	const labelY = barTop + constants.CREATE_RESOURCE_BAR_MARGIN_Y;
	drawEditorText(ide_state.font, label, labelX, labelY, undefined, constants.COLOR_CREATE_RESOURCE_TEXT);

	const field = ide_state.createResourceField;
	const pathX = labelX + measureText(label) + ide_state.spaceAdvance;
	const fieldText = textFromLines(field.lines);
	let displayPath = fieldText;
	let pathColor = constants.COLOR_CREATE_RESOURCE_TEXT;
	const blockActiveCarets = ide_state.problemsPanel.isVisible && ide_state.problemsPanel.isFocused;
	if (displayPath.length === 0 && !ide_state.createResourceActive) {
		displayPath = 'ENTER LUA PATH';
		pathColor = constants.COLOR_CREATE_RESOURCE_PLACEHOLDER;
	}

	const decoration = measureInlineFieldDecoration(field, ide_state.inlineFieldMetricsRef, pathX);
	if (decoration.hasSelection && decoration.selectionWidth > 0) {
		api.fill_rect_color(decoration.selectionLeft, labelY, decoration.selectionLeft + decoration.selectionWidth, labelY + ide_state.lineHeight, undefined, constants.SELECTION_OVERLAY);
	}
	drawEditorText(ide_state.font, displayPath, pathX, labelY, undefined, pathColor);

	const caretLeft = Math.floor(decoration.caretBaseX);
	const caretRight = Math.max(caretLeft + 1, Math.floor(decoration.caretBaseX + ide_state.spaceAdvance));
	drawInlineCaret(api, field, caretLeft, labelY, caretRight, labelY + ide_state.lineHeight, decoration.caretBaseX, (ide_state.createResourceActive && !blockActiveCarets), constants.INLINE_CARET_COLOR, pathColor);

	// Status or error overlay on the right
	if (ide_state.createResourceWorking) {
		const status = 'CREATING...';
		const statusWidth = measureText(status);
		const displayWidth = measureText(displayPath);
		const statusX = Math.max(pathX + displayWidth + ide_state.spaceAdvance, ide_state.viewportWidth - statusWidth - 4);
		drawEditorText(ide_state.font, status, statusX, labelY, undefined, constants.COLOR_CREATE_RESOURCE_TEXT);
	} else if (ide_state.createResourceError && ide_state.createResourceError.length > 0) {
		drawCreateResourceErrorDialog(ide_state.createResourceError);
	}
}

export function renderSearchBar(): void {
	const height = getSearchBarHeight();
	if (height <= 0) return;
	const barTop = ide_state.headerHeight + ide_state.tabBarHeight + getCreateResourceBarHeight();
	const barBottom = barTop + height;
	api.fill_rect(0, barTop, ide_state.viewportWidth, barBottom, undefined, constants.COLOR_SEARCH_BACKGROUND);
	api.fill_rect(0, barTop, ide_state.viewportWidth, barTop + 1, undefined, constants.COLOR_SEARCH_OUTLINE);
	api.fill_rect(0, barBottom - 1, ide_state.viewportWidth, barBottom, undefined, constants.COLOR_SEARCH_OUTLINE);

	const field = ide_state.searchField as TextField;
	const label = ide_state.searchScope === 'global' ? 'SEARCH ALL:' : 'SEARCH:';
	const labelX = 4;
	const labelY = barTop + constants.SEARCH_BAR_MARGIN_Y;
	drawEditorText(ide_state.font, label, labelX, labelY, undefined, constants.COLOR_SEARCH_TEXT);

	const blockActiveCarets = ide_state.problemsPanel.isVisible && ide_state.problemsPanel.isFocused;
	const active = !!ide_state.searchActive && !blockActiveCarets;
	const fieldText = field ? textFromLines(field.lines) : '';
	let queryText = fieldText;
	let queryColor = constants.COLOR_SEARCH_TEXT;
	if (queryText.length === 0 && !active) {
		queryText = 'TYPE TO SEARCH';
		queryColor = constants.COLOR_SEARCH_PLACEHOLDER;
	}
	const queryX = labelX + measureText(label) + ide_state.spaceAdvance;

	const decoration = measureInlineFieldDecoration(field, ide_state.inlineFieldMetricsRef, queryX);
	if (fieldText.length > 0 && decoration.hasSelection && decoration.selectionWidth > 0) {
		api.fill_rect_color(decoration.selectionLeft, labelY, decoration.selectionLeft + decoration.selectionWidth, labelY + ide_state.lineHeight, undefined, constants.SELECTION_OVERLAY);
	}

	drawEditorText(ide_state.font, queryText, queryX, labelY, undefined, queryColor);

	if (field) {
		const caretLeft = Math.floor(decoration.caretBaseX);
		const caretRight = Math.max(caretLeft + 1, Math.floor(decoration.caretBaseX + ide_state.charAdvance));
		drawInlineCaret(api, field, caretLeft, labelY, caretRight, labelY + ide_state.lineHeight, decoration.caretBaseX, active, constants.INLINE_CARET_COLOR, queryColor);
	}

	const infoX = ide_state.viewportWidth - 4;
	const total = activeSearchMatchCount();
	const current = ide_state.searchCurrentIndex ?? -1;
	const searchWorking = ide_state.searchScope === 'global'
		? ide_state.globalSearchJob !== null
		: ide_state.searchJob !== null;
	if (searchWorking) {
		const workingText = 'SEARCHING...';
		const workingWidth = measureText(workingText);
		drawEditorText(ide_state.font, workingText, infoX - workingWidth, labelY, undefined, constants.COLOR_SEARCH_TEXT);
	} else if (total > 0 || (ide_state.searchQuery && ide_state.searchQuery.length > 0)) {
		const infoText = total === 0 ? '0/0' : `${(current >= 0 ? current + 1 : 0)}/${total}`;
		const infoColor = total === 0 ? constants.COLOR_STATUS_WARNING : constants.COLOR_SEARCH_TEXT;
		const infoWidth = measureText(infoText);
		drawEditorText(ide_state.font, infoText, infoX - infoWidth, labelY, undefined, infoColor);
	}

	const visible = searchVisibleResultCount();
	if (visible <= 0) {
		return;
	}
	const baseHeight = ide_state.lineHeight + constants.SEARCH_BAR_MARGIN_Y * 2;
	const separatorTop = barTop + baseHeight;
	api.fill_rect(0, separatorTop, ide_state.viewportWidth, separatorTop + constants.SEARCH_RESULT_SPACING, undefined, constants.COLOR_SEARCH_OUTLINE);
	const resultsTop = separatorTop + constants.SEARCH_RESULT_SPACING;
	const rowHeight = searchResultEntryHeight();

	renderResultList(getVisibleSearchResultEntries(), visible, ide_state.searchDisplayOffset ?? 0, ide_state.searchDisplayOffset ?? 0, rowHeight, resultsTop, ide_state.viewportWidth, ide_state.searchCurrentIndex ?? -1, ide_state.searchHoverIndex ?? -1, drawSearchResultRow);
}

export function renderResourceSearchBar(): void {
	const height = getResourceSearchBarHeight();
	if (height <= 0) return;
	const barTop = ide_state.headerHeight + ide_state.tabBarHeight + getCreateResourceBarHeight() + getSearchBarHeight();
	const barBottom = barTop + height;
	api.fill_rect(0, barTop, ide_state.viewportWidth, barBottom, undefined, constants.COLOR_QUICK_OPEN_BACKGROUND);
	api.fill_rect(0, barTop, ide_state.viewportWidth, barTop + 1, undefined, constants.COLOR_QUICK_OPEN_OUTLINE);
	api.fill_rect(0, barBottom - 1, ide_state.viewportWidth, barBottom, undefined, constants.COLOR_QUICK_OPEN_OUTLINE);

	const field = ide_state.resourceSearchField as TextField;
	const label = 'FILE :';
	const labelX = 4;
	const labelY = barTop + constants.QUICK_OPEN_BAR_MARGIN_Y;
	drawEditorText(ide_state.font, label, labelX, labelY, undefined, constants.COLOR_QUICK_OPEN_TEXT);

	const active = !!ide_state.resourceSearchActive && !ide_state.problemsPanel.isVisible && !ide_state.problemsPanel.isFocused;
	const fieldText = field ? textFromLines(field.lines) : '';
	let queryText = fieldText;
	let queryColor = constants.COLOR_QUICK_OPEN_TEXT;
	if (queryText.length === 0 && !active) {
		queryText = 'TYPE TO FILTER (@/# PREFIX)';
		queryColor = constants.COLOR_QUICK_OPEN_PLACEHOLDER;
	}
	const queryX = labelX + measureText(label) + ide_state.spaceAdvance;
	const decoration = measureInlineFieldDecoration(field, ide_state.inlineFieldMetricsRef, queryX);
	if (fieldText.length > 0 && decoration.hasSelection && decoration.selectionWidth > 0) {
		api.fill_rect_color(decoration.selectionLeft, labelY, decoration.selectionLeft + decoration.selectionWidth, labelY + ide_state.lineHeight, undefined, constants.SELECTION_OVERLAY);
	}

	drawEditorText(ide_state.font, queryText, queryX, labelY, undefined, queryColor);

	if (field) {
		const caretLeft = Math.floor(decoration.caretBaseX);
		const caretRight = Math.max(caretLeft + 1, Math.floor(decoration.caretBaseX + ide_state.charAdvance));
		drawInlineCaret(api, field, caretLeft, labelY, caretRight, labelY + ide_state.lineHeight, decoration.caretBaseX, active, constants.INLINE_CARET_COLOR, queryColor);
	}

	const visible = resourceSearchVisibleResultCount();
	if (visible <= 0) return;
	const baseHeight = ide_state.lineHeight + constants.QUICK_OPEN_BAR_MARGIN_Y * 2;
	const separatorTop = barTop + baseHeight;
	api.fill_rect(0, separatorTop, ide_state.viewportWidth, separatorTop + constants.QUICK_OPEN_RESULT_SPACING, undefined, constants.COLOR_QUICK_OPEN_OUTLINE);
	const resultsTop = separatorTop + constants.QUICK_OPEN_RESULT_SPACING;
	const rowHeight = resourceSearchEntryHeight();

	renderResultList(ide_state.resourceSearchMatches, visible, ide_state.resourceSearchDisplayOffset ?? 0, 0, rowHeight, resultsTop, ide_state.viewportWidth, ide_state.resourceSearchSelectionIndex ?? -1, ide_state.resourceSearchHoverIndex ?? -1, drawResourceSearchResultRow);
}

export function renderSymbolSearchBar(): void {
	const height = getSymbolSearchBarHeight();
	if (height <= 0) return;
	const barTop = ide_state.headerHeight + ide_state.tabBarHeight + getCreateResourceBarHeight() + getSearchBarHeight() + getResourceSearchBarHeight();
	const barBottom = barTop + height;
	api.fill_rect(0, barTop, ide_state.viewportWidth, barBottom, undefined, constants.COLOR_SYMBOL_SEARCH_BACKGROUND);
	api.fill_rect(0, barTop, ide_state.viewportWidth, barTop + 1, undefined, constants.COLOR_SYMBOL_SEARCH_OUTLINE);
	api.fill_rect(0, barBottom - 1, ide_state.viewportWidth, barBottom, undefined, constants.COLOR_SYMBOL_SEARCH_OUTLINE);

	const field = ide_state.symbolSearchField as TextField;
	const mode = ide_state.symbolSearchMode ?? 'symbols';
	const label = mode === 'references' ? 'REFS :' : ide_state.symbolSearchGlobal ? 'SYMBOL #:' : 'SYMBOL @:';
	const labelX = 4;
	const labelY = barTop + constants.SYMBOL_SEARCH_BAR_MARGIN_Y;
	drawEditorText(ide_state.font, label, labelX, labelY, undefined, constants.COLOR_SYMBOL_SEARCH_TEXT);

	const active = !!ide_state.symbolSearchActive;
	const fieldText = field ? textFromLines(field.lines) : '';
	let queryText = fieldText;
	let queryColor = constants.COLOR_SYMBOL_SEARCH_TEXT;
	const placeholder = mode === 'references' ? 'FILTER REFERENCES' : 'TYPE TO FILTER';
	if (queryText.length === 0 && !active) {
		queryText = placeholder;
		queryColor = constants.COLOR_SYMBOL_SEARCH_PLACEHOLDER;
	}
	const queryX = labelX + measureText(label) + ide_state.spaceAdvance;
	const decoration = measureInlineFieldDecoration(field, ide_state.inlineFieldMetricsRef, queryX);
	if (fieldText.length > 0 && decoration.hasSelection && decoration.selectionWidth > 0) {
		api.fill_rect_color(decoration.selectionLeft, labelY, decoration.selectionLeft + decoration.selectionWidth, labelY + ide_state.lineHeight, undefined, constants.SELECTION_OVERLAY);
	}

	drawEditorText(ide_state.font, queryText, queryX, labelY, undefined, queryColor);

	if (field) {
		const caretLeft = Math.floor(decoration.caretBaseX);
		const caretRight = Math.max(caretLeft + 1, Math.floor(decoration.caretBaseX + ide_state.charAdvance));
		drawInlineCaret(api, field, caretLeft, labelY, caretRight, labelY + ide_state.lineHeight, decoration.caretBaseX, active, constants.INLINE_CARET_COLOR, queryColor);
	}

	const visible = symbolSearchVisibleResultCount();
	if (visible <= 0) {
		return;
	}
	const baseHeight = ide_state.lineHeight + constants.SYMBOL_SEARCH_BAR_MARGIN_Y * 2;
	const separatorTop = barTop + baseHeight;
	api.fill_rect(0, separatorTop, ide_state.viewportWidth, separatorTop + constants.SYMBOL_SEARCH_RESULT_SPACING, undefined, constants.COLOR_SYMBOL_SEARCH_OUTLINE);
	const resultsTop = separatorTop + constants.SYMBOL_SEARCH_RESULT_SPACING;
	const entryHeight = symbolSearchEntryHeight();
	renderResultList(ide_state.symbolSearchMatches, visible, ide_state.symbolSearchDisplayOffset ?? 0, 0, entryHeight, resultsTop, ide_state.viewportWidth, ide_state.symbolSearchSelectionIndex ?? -1, ide_state.symbolSearchHoverIndex ?? -1, drawSymbolSearchResultRow);
}

function renderResultList<T>(
	entries: readonly T[],
	visibleCount: number,
	displayOffset: number,
	entriesBaseOffset: number,
	rowHeight: number,
	rowTop: number,
	viewportWidth: number,
	selectionIndex: number,
	hoverIndex: number,
	drawRow: (entry: T, rowTop: number) => void,
): void {
	if (visibleCount <= 0) {
		return;
	}
	for (let i = 0; i < visibleCount; i += 1) {
		const matchIndex = displayOffset + i;
		const entryIndex = matchIndex - entriesBaseOffset;
		if (entryIndex < 0 || entryIndex >= entries.length) {
			continue;
		}
		const entry = entries[entryIndex];
		if (!entry) {
			continue;
		}
		const rowTopValue = rowTop + i * rowHeight;
		const rowBottom = rowTopValue + rowHeight;
		if (matchIndex === selectionIndex) {
			api.fill_rect_color(0, rowTopValue, viewportWidth, rowBottom, undefined, constants.SEARCH_RESULT_SELECTION_OVERLAY);
		} else if (matchIndex === hoverIndex) {
			api.fill_rect_color(0, rowTopValue, viewportWidth, rowBottom, undefined, constants.SEARCH_RESULT_HOVER_OVERLAY);
		}
		drawRow(entry, rowTopValue);
	}
}

export function renderRenameBar(): void {
	const height = getRenameBarHeight();
	if (height <= 0) return;
	const barTop = ide_state.headerHeight + ide_state.tabBarHeight
		+ getCreateResourceBarHeight()
		+ getSearchBarHeight()
		+ getResourceSearchBarHeight()
		+ getSymbolSearchBarHeight()
		+ getRenameBarHeight();
	const barBottom = barTop + height;
	api.fill_rect(0, barTop, ide_state.viewportWidth, barBottom, undefined, constants.COLOR_SEARCH_BACKGROUND);
	api.fill_rect(0, barTop, ide_state.viewportWidth, barTop + 1, undefined, constants.COLOR_SEARCH_OUTLINE);
	api.fill_rect(0, barBottom - 1, ide_state.viewportWidth, barBottom, undefined, constants.COLOR_SEARCH_OUTLINE);

	const field = ide_state.renameController.getField() as TextField;
	const label = 'RENAME:';
	const labelX = 4;
	const labelY = barTop + constants.SEARCH_BAR_MARGIN_Y;
	drawEditorText(ide_state.font, label, labelX, labelY, undefined, constants.COLOR_SEARCH_TEXT);

	const blockActiveCarets = ide_state.problemsPanel.isVisible && ide_state.problemsPanel.isFocused;
	const active = !!ide_state.renameController.isActive() && !blockActiveCarets;
	const fieldText = field ? textFromLines(field.lines) : '';
	let valueText = fieldText;
	let valueColor = constants.COLOR_SEARCH_TEXT;
	if (valueText.length === 0 && !active) {
		valueText = 'TYPE NEW NAME';
		valueColor = constants.COLOR_SEARCH_PLACEHOLDER;
	}
	const valueX = labelX + measureText(label) + ide_state.spaceAdvance;
	const decoration = measureInlineFieldDecoration(field, ide_state.inlineFieldMetricsRef, valueX);
	if (fieldText.length > 0 && decoration.hasSelection && decoration.selectionWidth > 0) {
		api.fill_rect_color(decoration.selectionLeft, labelY, decoration.selectionLeft + decoration.selectionWidth, labelY + ide_state.lineHeight, undefined, constants.SELECTION_OVERLAY);
	}

	drawEditorText(ide_state.font, valueText, valueX, labelY, undefined, valueColor);

	if (field) {
		const caretLeft = Math.floor(decoration.caretBaseX);
		const caretRight = Math.max(caretLeft + 1, Math.floor(decoration.caretBaseX + ide_state.charAdvance));
		drawInlineCaret(api, field, caretLeft, labelY, caretRight, labelY + ide_state.lineHeight, decoration.caretBaseX, active, constants.INLINE_CARET_COLOR, valueColor);
	}

	const matchCount = ide_state.renameController.getMatchCount() ?? 0;
	const expression = ide_state.renameController.getExpressionLabel() ?? ide_state.renameController.getOriginalName() ?? '';
	const valueWidth = measureText(valueText);
	let status = '';
	if (expression && expression.length > 0) {
		status = expression;
	}
	if (matchCount > 0) {
		const countLabel = matchCount === 1 ? '1 REF' : `${matchCount} REFS`;
		status = status.length > 0 ? `${status} · ${countLabel}` : countLabel;
	}
	if (status.length > 0) {
		const statusWidth = measureText(status);
		const statusX = Math.max(valueX + valueWidth + ide_state.spaceAdvance, ide_state.viewportWidth - statusWidth - 4);
		drawEditorText(ide_state.font, status, statusX, labelY, undefined, constants.COLOR_SEARCH_TEXT);
	}
}

export function renderLineJumpBar(): void {
	const height = getLineJumpBarHeight();
	if (height <= 0) return;
	const barTop = ide_state.headerHeight + ide_state.tabBarHeight
		+ getCreateResourceBarHeight()
		+ getSearchBarHeight()
		+ getResourceSearchBarHeight()
		+ getSymbolSearchBarHeight();
	const barBottom = barTop + height;
	api.fill_rect(0, barTop, ide_state.viewportWidth, barBottom, undefined, constants.COLOR_LINE_JUMP_BACKGROUND);
	api.fill_rect(0, barTop, ide_state.viewportWidth, barTop + 1, undefined, constants.COLOR_LINE_JUMP_OUTLINE);
	api.fill_rect(0, barBottom - 1, ide_state.viewportWidth, barBottom, undefined, constants.COLOR_LINE_JUMP_OUTLINE);

	const label = 'LINE #:';
	const labelX = 4;
	const labelY = barTop + constants.LINE_JUMP_BAR_MARGIN_Y;
	drawEditorText(ide_state.font, label, labelX, labelY, undefined, constants.COLOR_LINE_JUMP_TEXT);

	const field = ide_state.lineJumpField as TextField;
	const active = !!ide_state.lineJumpActive;
	const fieldText = field ? textFromLines(field.lines) : '';
	let valueText = fieldText;
	let valueColor = constants.COLOR_LINE_JUMP_TEXT;
	if (valueText.length === 0 && !active) {
		valueText = 'ENTER LINE NUMBER';
		valueColor = constants.COLOR_LINE_JUMP_PLACEHOLDER;
	}
	const valueX = labelX + measureText(label) + ide_state.spaceAdvance;
	const decoration = measureInlineFieldDecoration(field, ide_state.inlineFieldMetricsRef, valueX);
	if (fieldText.length > 0 && decoration.hasSelection && decoration.selectionWidth > 0) {
		api.fill_rect_color(decoration.selectionLeft, labelY, decoration.selectionLeft + decoration.selectionWidth, labelY + ide_state.lineHeight, undefined, constants.SELECTION_OVERLAY);
	}

	drawEditorText(ide_state.font, valueText, valueX, labelY, undefined, valueColor);

	if (field) {
		const caretLeft = Math.floor(decoration.caretBaseX);
		const caretRight = Math.max(caretLeft + 1, Math.floor(decoration.caretBaseX + ide_state.charAdvance));
		drawInlineCaret(api, field, caretLeft, labelY, caretRight, labelY + ide_state.lineHeight, decoration.caretBaseX, active, constants.INLINE_CARET_COLOR, valueColor);
	}
}
