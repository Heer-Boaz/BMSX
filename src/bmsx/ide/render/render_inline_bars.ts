import * as constants from '../core/constants';
import { ide_state } from '../core/ide_state';
import { api } from '../ui/view/overlay_api';
import { drawEditorText } from './text_renderer';
import { drawCreateResourceErrorDialog } from './render_resource_panel';
import { activeSearchMatchCount, getVisibleSearchResultEntries } from '../contrib/find/editor_search';
import {
	getCreateResourceBarBounds,
	getLineJumpBarBounds,
	getRenameBarBounds,
	getResourceSearchBarBounds,
	getSearchBarBounds,
	getSymbolSearchBarBounds,
	isResourceSearchCompactMode,
	isSymbolSearchCompactMode,
	resourceSearchEntryHeight,
	resourceSearchVisibleResultCount,
	searchResultEntryHeight,
	searchVisibleResultCount,
	symbolSearchEntryHeight,
	symbolSearchVisibleResultCount,
} from '../ui/editor_view';
import { measureText } from '../core/text_utils';
import { renderInlineBarField, renderInlineBarFrame } from './render_inline_bar_common';

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
	const mode = ide_state.symbolSearch.mode ?? 'symbols';
	const compactMode = mode === 'references'
		? true
		: (ide_state.symbolSearch.global && isSymbolSearchCompactMode());
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
	const bounds = getCreateResourceBarBounds();
	if (!bounds) return;
	renderInlineBarFrame(bounds.left, bounds.top, bounds.right, bounds.bottom, constants.COLOR_CREATE_RESOURCE_BACKGROUND, constants.COLOR_CREATE_RESOURCE_OUTLINE);

	const blockActiveCarets = ide_state.problemsPanel.isVisible && ide_state.problemsPanel.isFocused;
	const fieldState = renderInlineBarField(
		ide_state.createResource.field,
		'NEW FILE:',
		4,
		bounds.top + constants.CREATE_RESOURCE_BAR_MARGIN_Y,
		ide_state.createResource.active && !blockActiveCarets,
		ide_state.createResource.active,
		constants.COLOR_CREATE_RESOURCE_TEXT,
		'ENTER LUA PATH',
		constants.COLOR_CREATE_RESOURCE_PLACEHOLDER,
		ide_state.spaceAdvance,
	);

	// Status or error overlay on the right
	if (ide_state.createResource.working) {
		const status = 'CREATING...';
		const statusWidth = measureText(status);
		const statusX = Math.max(fieldState.textX + fieldState.displayWidth + ide_state.spaceAdvance, bounds.right - statusWidth - 4);
		drawEditorText(ide_state.font, status, statusX, bounds.top + constants.CREATE_RESOURCE_BAR_MARGIN_Y, undefined, constants.COLOR_CREATE_RESOURCE_TEXT);
	} else if (ide_state.createResource.error && ide_state.createResource.error.length > 0) {
		drawCreateResourceErrorDialog(ide_state.createResource.error);
	}
}

export function renderSearchBar(): void {
	const bounds = getSearchBarBounds();
	if (!bounds) return;
	renderInlineBarFrame(bounds.left, bounds.top, bounds.right, bounds.bottom, constants.COLOR_SEARCH_BACKGROUND, constants.COLOR_SEARCH_OUTLINE);
	const blockActiveCarets = ide_state.problemsPanel.isVisible && ide_state.problemsPanel.isFocused;
	const active = !!ide_state.search.active && !blockActiveCarets;
	const labelY = bounds.top + constants.SEARCH_BAR_MARGIN_Y;
	renderInlineBarField(
		ide_state.search.field,
		ide_state.search.scope === 'global' ? 'SEARCH ALL:' : 'SEARCH:',
		4,
		labelY,
		active,
		active,
		constants.COLOR_SEARCH_TEXT,
		'TYPE TO SEARCH',
		constants.COLOR_SEARCH_PLACEHOLDER,
		ide_state.charAdvance,
	);

	const infoX = bounds.right - 4;
	const total = activeSearchMatchCount();
	const current = ide_state.search.currentIndex ?? -1;
	const searchWorking = ide_state.search.scope === 'global'
		? ide_state.search.globalJob !== null
		: ide_state.search.job !== null;
	if (searchWorking) {
		const workingText = 'SEARCHING...';
		const workingWidth = measureText(workingText);
		drawEditorText(ide_state.font, workingText, infoX - workingWidth, labelY, undefined, constants.COLOR_SEARCH_TEXT);
	} else if (total > 0 || (ide_state.search.query && ide_state.search.query.length > 0)) {
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
	const separatorTop = bounds.top + baseHeight;
	api.fill_rect(bounds.left, separatorTop, bounds.right, separatorTop + constants.SEARCH_RESULT_SPACING, undefined, constants.COLOR_SEARCH_OUTLINE);
	const resultsTop = separatorTop + constants.SEARCH_RESULT_SPACING;
	const rowHeight = searchResultEntryHeight();

	renderResultList(getVisibleSearchResultEntries(), visible, ide_state.search.displayOffset ?? 0, ide_state.search.displayOffset ?? 0, rowHeight, resultsTop, bounds.right, ide_state.search.currentIndex ?? -1, ide_state.search.hoverIndex ?? -1, drawSearchResultRow);
}

export function renderResourceSearchBar(): void {
	const bounds = getResourceSearchBarBounds();
	if (!bounds) return;
	renderInlineBarFrame(bounds.left, bounds.top, bounds.right, bounds.bottom, constants.COLOR_QUICK_OPEN_BACKGROUND, constants.COLOR_QUICK_OPEN_OUTLINE);
	const active = !!ide_state.resourceSearch.active && !ide_state.problemsPanel.isVisible && !ide_state.problemsPanel.isFocused;
	renderInlineBarField(
		ide_state.resourceSearch.field,
		'FILE :',
		4,
		bounds.top + constants.QUICK_OPEN_BAR_MARGIN_Y,
		active,
		active,
		constants.COLOR_QUICK_OPEN_TEXT,
		'TYPE TO FILTER (@/# PREFIX)',
		constants.COLOR_QUICK_OPEN_PLACEHOLDER,
		ide_state.charAdvance,
	);

	const visible = resourceSearchVisibleResultCount();
	if (visible <= 0) return;
	const baseHeight = ide_state.lineHeight + constants.QUICK_OPEN_BAR_MARGIN_Y * 2;
	const separatorTop = bounds.top + baseHeight;
	api.fill_rect(bounds.left, separatorTop, bounds.right, separatorTop + constants.QUICK_OPEN_RESULT_SPACING, undefined, constants.COLOR_QUICK_OPEN_OUTLINE);
	const resultsTop = separatorTop + constants.QUICK_OPEN_RESULT_SPACING;
	const rowHeight = resourceSearchEntryHeight();

	renderResultList(ide_state.resourceSearch.matches, visible, ide_state.resourceSearch.displayOffset ?? 0, 0, rowHeight, resultsTop, bounds.right, ide_state.resourceSearch.selectionIndex ?? -1, ide_state.resourceSearch.hoverIndex ?? -1, drawResourceSearchResultRow);
}

export function renderSymbolSearchBar(): void {
	const bounds = getSymbolSearchBarBounds();
	if (!bounds) return;
	renderInlineBarFrame(bounds.left, bounds.top, bounds.right, bounds.bottom, constants.COLOR_SYMBOL_SEARCH_BACKGROUND, constants.COLOR_SYMBOL_SEARCH_OUTLINE);
	const mode = ide_state.symbolSearch.mode ?? 'symbols';
	const active = !!ide_state.symbolSearch.active;
	const placeholder = mode === 'references' ? 'FILTER REFERENCES' : 'TYPE TO FILTER';
	renderInlineBarField(
		ide_state.symbolSearch.field,
		mode === 'references' ? 'REFS :' : ide_state.symbolSearch.global ? 'SYMBOL #:' : 'SYMBOL @:',
		4,
		bounds.top + constants.SYMBOL_SEARCH_BAR_MARGIN_Y,
		active,
		active,
		constants.COLOR_SYMBOL_SEARCH_TEXT,
		placeholder,
		constants.COLOR_SYMBOL_SEARCH_PLACEHOLDER,
		ide_state.charAdvance,
	);

	const visible = symbolSearchVisibleResultCount();
	if (visible <= 0) {
		return;
	}
	const baseHeight = ide_state.lineHeight + constants.SYMBOL_SEARCH_BAR_MARGIN_Y * 2;
	const separatorTop = bounds.top + baseHeight;
	api.fill_rect(bounds.left, separatorTop, bounds.right, separatorTop + constants.SYMBOL_SEARCH_RESULT_SPACING, undefined, constants.COLOR_SYMBOL_SEARCH_OUTLINE);
	const resultsTop = separatorTop + constants.SYMBOL_SEARCH_RESULT_SPACING;
	const entryHeight = symbolSearchEntryHeight();
	renderResultList(ide_state.symbolSearch.matches, visible, ide_state.symbolSearch.displayOffset ?? 0, 0, entryHeight, resultsTop, bounds.right, ide_state.symbolSearch.selectionIndex ?? -1, ide_state.symbolSearch.hoverIndex ?? -1, drawSymbolSearchResultRow);
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
	const bounds = getRenameBarBounds();
	if (!bounds) return;
	renderInlineBarFrame(bounds.left, bounds.top, bounds.right, bounds.bottom, constants.COLOR_SEARCH_BACKGROUND, constants.COLOR_SEARCH_OUTLINE);
	const blockActiveCarets = ide_state.problemsPanel.isVisible && ide_state.problemsPanel.isFocused;
	const active = !!ide_state.renameController.isActive() && !blockActiveCarets;
	const labelY = bounds.top + constants.SEARCH_BAR_MARGIN_Y;
	const fieldState = renderInlineBarField(
		ide_state.renameController.getField(),
		'RENAME:',
		4,
		labelY,
		active,
		active,
		constants.COLOR_SEARCH_TEXT,
		'TYPE NEW NAME',
		constants.COLOR_SEARCH_PLACEHOLDER,
		ide_state.charAdvance,
	);

	const matchCount = ide_state.renameController.getMatchCount() ?? 0;
	const expression = ide_state.renameController.getExpressionLabel() ?? ide_state.renameController.getOriginalName() ?? '';
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
		const statusX = Math.max(fieldState.textX + fieldState.displayWidth + ide_state.spaceAdvance, bounds.right - statusWidth - 4);
		drawEditorText(ide_state.font, status, statusX, labelY, undefined, constants.COLOR_SEARCH_TEXT);
	}
}

export function renderLineJumpBar(): void {
	const bounds = getLineJumpBarBounds();
	if (!bounds) return;
	renderInlineBarFrame(bounds.left, bounds.top, bounds.right, bounds.bottom, constants.COLOR_LINE_JUMP_BACKGROUND, constants.COLOR_LINE_JUMP_OUTLINE);
	const active = !!ide_state.lineJump.active;
	renderInlineBarField(
		ide_state.lineJump.field,
		'LINE #:',
		4,
		bounds.top + constants.LINE_JUMP_BAR_MARGIN_Y,
		active,
		active,
		constants.COLOR_LINE_JUMP_TEXT,
		'ENTER LINE NUMBER',
		constants.COLOR_LINE_JUMP_PLACEHOLDER,
		ide_state.charAdvance,
	);
}
