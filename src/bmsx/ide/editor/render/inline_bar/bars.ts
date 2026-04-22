import * as constants from '../../../common/constants';
import { api } from '../../ui/view/overlay_api';
import { drawEditorText } from '../text_renderer';
import { drawCreateResourceErrorDialog } from '../../../workbench/render/resource_panel';
import { activeSearchMatchCount, getVisibleSearchResultEntries } from '../../contrib/find/search';
import { editorViewState } from '../../ui/view/state';
import { editorSearchState, lineJumpState } from '../../contrib/find/widget_state';
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
} from '../../ui/view/view';
import { measureText } from '../../common/text/layout';
import { renderInlineBarField, renderInlineBarFrame } from './common';
import { problemsPanel } from '../../../workbench/contrib/problems/panel/controller';
import { renameController } from '../../contrib/rename/controller';
import { symbolSearchState } from '../../contrib/symbols/search/state';
import { createResourceState, resourceSearchState } from '../../../workbench/contrib/resources/widget_state';

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
	const secondaryY = rowTop + editorViewState.lineHeight;
	if (entry.primary) {
		drawEditorText(editorViewState.font, entry.primary, paddingX, rowTop, undefined, constants.COLOR_SEARCH_TEXT);
	}
	if (entry.detail) {
		const detailWidth = measureText(entry.detail);
		const detailX = editorViewState.viewportWidth - detailWidth - paddingX;
		drawEditorText(editorViewState.font, entry.detail, detailX, rowTop, undefined, constants.COLOR_SEARCH_SECONDARY_TEXT);
	}
	if (entry.secondary) {
		drawEditorText(editorViewState.font, entry.secondary, paddingX, secondaryY, undefined, constants.COLOR_SEARCH_SECONDARY_TEXT);
	}
};

const drawResourceSearchResultRow = (match: InlineResourceSearchResult, rowTop: number): void => {
	let textX = constants.QUICK_OPEN_RESULT_PADDING_X;
	const kindText = match.entry.typeLabel;
	const detail = match.entry.assetLabel ?? '';
	if (kindText.length > 0) {
		drawEditorText(editorViewState.font, kindText, textX, rowTop, undefined, constants.COLOR_QUICK_OPEN_KIND);
		textX += measureText(kindText) + editorViewState.spaceAdvance;
	}
	drawEditorText(editorViewState.font, match.entry.displayPath, textX, rowTop, undefined, constants.COLOR_QUICK_OPEN_TEXT);
	if (isResourceSearchCompactMode()) {
		const secondaryY = rowTop + editorViewState.lineHeight;
		if (detail.length > 0) {
			drawEditorText(editorViewState.font, detail, constants.QUICK_OPEN_RESULT_PADDING_X, secondaryY, undefined, constants.COLOR_QUICK_OPEN_KIND);
		}
	} else if (detail.length > 0) {
		const detailWidth = measureText(detail);
		const detailX = editorViewState.viewportWidth - detailWidth - constants.QUICK_OPEN_RESULT_PADDING_X;
		drawEditorText(editorViewState.font, detail, detailX, rowTop, undefined, constants.COLOR_QUICK_OPEN_KIND);
	}
};

const drawSymbolSearchResultRow = (match: InlineSymbolSearchResult, rowTop: number): void => {
	const mode = symbolSearchState.mode ?? 'symbols';
	const compactMode = mode === 'references'
		? true
		: (symbolSearchState.global && isSymbolSearchCompactMode());
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
		drawEditorText(editorViewState.font, kindText, textX, rowTop, undefined, constants.COLOR_SYMBOL_SEARCH_KIND);
		textX += measureText(kindText) + editorViewState.spaceAdvance;
	}
	drawEditorText(editorViewState.font, match.entry.displayName, textX, rowTop, undefined, constants.COLOR_SYMBOL_SEARCH_TEXT);
	if (compactMode) {
		const secondaryY = rowTop + editorViewState.lineHeight;
		const lineX = editorViewState.viewportWidth - lineWidth - constants.SYMBOL_SEARCH_RESULT_PADDING_X;
		drawEditorText(editorViewState.font, lineText, lineX, secondaryY, undefined, constants.COLOR_SYMBOL_SEARCH_TEXT);
		const sourceLabel = match.entry.sourceLabel ?? '';
		if (sourceLabel) {
			drawEditorText(editorViewState.font, sourceLabel, constants.SYMBOL_SEARCH_RESULT_PADDING_X, secondaryY, undefined, constants.COLOR_SYMBOL_SEARCH_KIND);
		}
	} else {
		const lineX = editorViewState.viewportWidth - lineWidth - constants.SYMBOL_SEARCH_RESULT_PADDING_X;
		drawEditorText(editorViewState.font, lineText, lineX, rowTop, undefined, constants.COLOR_SYMBOL_SEARCH_TEXT);
		const sourceLabel = match.entry.sourceLabel ?? '';
		if (sourceLabel) {
			const sourceWidth = measureText(sourceLabel);
			const sourceXCandidate = lineX - editorViewState.spaceAdvance - sourceWidth;
			const sourceX = sourceXCandidate > textX ? sourceXCandidate : textX;
			drawEditorText(editorViewState.font, sourceLabel, sourceX, rowTop, undefined, constants.COLOR_SYMBOL_SEARCH_KIND);
		}
	}
};

export function renderCreateResourceBar(): void {
	const bounds = getCreateResourceBarBounds();
	if (!bounds) return;
	renderInlineBarFrame(bounds.left, bounds.top, bounds.right, bounds.bottom, constants.COLOR_CREATE_RESOURCE_BACKGROUND, constants.COLOR_CREATE_RESOURCE_OUTLINE);

	const blockActiveCarets = problemsPanel.isVisible && problemsPanel.isFocused;
	const fieldState = renderInlineBarField(
		createResourceState.field,
		'NEW FILE:',
		4,
		bounds.top + constants.CREATE_RESOURCE_BAR_MARGIN_Y,
		createResourceState.active && !blockActiveCarets,
		createResourceState.active,
		constants.COLOR_CREATE_RESOURCE_TEXT,
		'ENTER LUA PATH',
		constants.COLOR_CREATE_RESOURCE_PLACEHOLDER,
		editorViewState.spaceAdvance,
	);

	// Status or error overlay on the right
	if (createResourceState.working) {
		const status = 'CREATING...';
		const statusWidth = measureText(status);
		const fieldRight = fieldState.textX + fieldState.displayWidth + editorViewState.spaceAdvance;
		const statusRightX = bounds.right - statusWidth - 4;
		const statusX = fieldRight > statusRightX ? fieldRight : statusRightX;
		drawEditorText(editorViewState.font, status, statusX, bounds.top + constants.CREATE_RESOURCE_BAR_MARGIN_Y, undefined, constants.COLOR_CREATE_RESOURCE_TEXT);
	} else if (createResourceState.error && createResourceState.error.length > 0) {
		drawCreateResourceErrorDialog(createResourceState.error);
	}
}

export function renderSearchBar(): void {
	const bounds = getSearchBarBounds();
	if (!bounds) return;
	renderInlineBarFrame(bounds.left, bounds.top, bounds.right, bounds.bottom, constants.COLOR_SEARCH_BACKGROUND, constants.COLOR_SEARCH_OUTLINE);
	const blockActiveCarets = problemsPanel.isVisible && problemsPanel.isFocused;
	const active = !!editorSearchState.active && !blockActiveCarets;
	const labelY = bounds.top + constants.SEARCH_BAR_MARGIN_Y;
	renderInlineBarField(
		editorSearchState.field,
		editorSearchState.scope === 'global' ? 'SEARCH ALL:' : 'SEARCH:',
		4,
		labelY,
		active,
		active,
		constants.COLOR_SEARCH_TEXT,
		'TYPE TO SEARCH',
		constants.COLOR_SEARCH_PLACEHOLDER,
		editorViewState.charAdvance,
	);

	const infoX = bounds.right - 4;
	const total = activeSearchMatchCount();
	const current = editorSearchState.currentIndex ?? -1;
	const searchWorking = editorSearchState.scope === 'global'
		? editorSearchState.globalJob !== null
		: editorSearchState.job !== null;
	if (searchWorking) {
		const workingText = 'SEARCHING...';
		const workingWidth = measureText(workingText);
		drawEditorText(editorViewState.font, workingText, infoX - workingWidth, labelY, undefined, constants.COLOR_SEARCH_TEXT);
	} else if (total > 0 || (editorSearchState.query && editorSearchState.query.length > 0)) {
		const infoText = total === 0 ? '0/0' : `${(current >= 0 ? current + 1 : 0)}/${total}`;
		const infoColor = total === 0 ? constants.COLOR_STATUS_WARNING : constants.COLOR_SEARCH_TEXT;
		const infoWidth = measureText(infoText);
		drawEditorText(editorViewState.font, infoText, infoX - infoWidth, labelY, undefined, infoColor);
	}

	const visible = searchVisibleResultCount();
	if (visible <= 0) {
		return;
	}
	const baseHeight = editorViewState.lineHeight + constants.SEARCH_BAR_MARGIN_Y * 2;
	const separatorTop = bounds.top + baseHeight;
	api.fill_rect(bounds.left, separatorTop, bounds.right, separatorTop + constants.SEARCH_RESULT_SPACING, undefined, constants.COLOR_SEARCH_OUTLINE);
	const resultsTop = separatorTop + constants.SEARCH_RESULT_SPACING;
	const rowHeight = searchResultEntryHeight();

	renderResultList(getVisibleSearchResultEntries(), visible, editorSearchState.displayOffset ?? 0, editorSearchState.displayOffset ?? 0, rowHeight, resultsTop, bounds.right, editorSearchState.currentIndex ?? -1, editorSearchState.hoverIndex ?? -1, drawSearchResultRow);
}

export function renderResourceSearchBar(): void {
	const bounds = getResourceSearchBarBounds();
	if (!bounds) return;
	renderInlineBarFrame(bounds.left, bounds.top, bounds.right, bounds.bottom, constants.COLOR_QUICK_OPEN_BACKGROUND, constants.COLOR_QUICK_OPEN_OUTLINE);
	const active = !!resourceSearchState.active && !problemsPanel.isVisible && !problemsPanel.isFocused;
	renderInlineBarField(
		resourceSearchState.field,
		'FILE :',
		4,
		bounds.top + constants.QUICK_OPEN_BAR_MARGIN_Y,
		active,
		active,
		constants.COLOR_QUICK_OPEN_TEXT,
		'TYPE TO FILTER (@/# PREFIX)',
		constants.COLOR_QUICK_OPEN_PLACEHOLDER,
		editorViewState.charAdvance,
	);

	const visible = resourceSearchVisibleResultCount();
	if (visible <= 0) return;
	const baseHeight = editorViewState.lineHeight + constants.QUICK_OPEN_BAR_MARGIN_Y * 2;
	const separatorTop = bounds.top + baseHeight;
	api.fill_rect(bounds.left, separatorTop, bounds.right, separatorTop + constants.QUICK_OPEN_RESULT_SPACING, undefined, constants.COLOR_QUICK_OPEN_OUTLINE);
	const resultsTop = separatorTop + constants.QUICK_OPEN_RESULT_SPACING;
	const rowHeight = resourceSearchEntryHeight();

	renderResultList(resourceSearchState.matches, visible, resourceSearchState.displayOffset ?? 0, 0, rowHeight, resultsTop, bounds.right, resourceSearchState.selectionIndex ?? -1, resourceSearchState.hoverIndex ?? -1, drawResourceSearchResultRow);
}

export function renderSymbolSearchBar(): void {
	const bounds = getSymbolSearchBarBounds();
	if (!bounds) return;
	renderInlineBarFrame(bounds.left, bounds.top, bounds.right, bounds.bottom, constants.COLOR_SYMBOL_SEARCH_BACKGROUND, constants.COLOR_SYMBOL_SEARCH_OUTLINE);
	const mode = symbolSearchState.mode ?? 'symbols';
	const active = !!symbolSearchState.active;
	const placeholder = mode === 'references' ? 'FILTER REFERENCES' : 'TYPE TO FILTER';
	renderInlineBarField(
		symbolSearchState.field,
		mode === 'references' ? 'REFS :' : symbolSearchState.global ? 'SYMBOL #:' : 'SYMBOL @:',
		4,
		bounds.top + constants.SYMBOL_SEARCH_BAR_MARGIN_Y,
		active,
		active,
		constants.COLOR_SYMBOL_SEARCH_TEXT,
		placeholder,
		constants.COLOR_SYMBOL_SEARCH_PLACEHOLDER,
		editorViewState.charAdvance,
	);

	const visible = symbolSearchVisibleResultCount();
	if (visible <= 0) {
		return;
	}
	const baseHeight = editorViewState.lineHeight + constants.SYMBOL_SEARCH_BAR_MARGIN_Y * 2;
	const separatorTop = bounds.top + baseHeight;
	api.fill_rect(bounds.left, separatorTop, bounds.right, separatorTop + constants.SYMBOL_SEARCH_RESULT_SPACING, undefined, constants.COLOR_SYMBOL_SEARCH_OUTLINE);
	const resultsTop = separatorTop + constants.SYMBOL_SEARCH_RESULT_SPACING;
	const entryHeight = symbolSearchEntryHeight();
	renderResultList(symbolSearchState.matches, visible, symbolSearchState.displayOffset ?? 0, 0, entryHeight, resultsTop, bounds.right, symbolSearchState.selectionIndex ?? -1, symbolSearchState.hoverIndex ?? -1, drawSymbolSearchResultRow);
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
	const blockActiveCarets = problemsPanel.isVisible && problemsPanel.isFocused;
	const active = !!renameController.isActive() && !blockActiveCarets;
	const labelY = bounds.top + constants.SEARCH_BAR_MARGIN_Y;
	const fieldState = renderInlineBarField(
		renameController.getField(),
		'RENAME:',
		4,
		labelY,
		active,
		active,
		constants.COLOR_SEARCH_TEXT,
		'TYPE NEW NAME',
		constants.COLOR_SEARCH_PLACEHOLDER,
		editorViewState.charAdvance,
	);

	const matchCount = renameController.getMatchCount() ?? 0;
	const expression = renameController.getExpressionLabel() ?? renameController.getOriginalName() ?? '';
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
		const fieldRight = fieldState.textX + fieldState.displayWidth + editorViewState.spaceAdvance;
		const statusRightX = bounds.right - statusWidth - 4;
		const statusX = fieldRight > statusRightX ? fieldRight : statusRightX;
		drawEditorText(editorViewState.font, status, statusX, labelY, undefined, constants.COLOR_SEARCH_TEXT);
	}
}

export function renderLineJumpBar(): void {
	const bounds = getLineJumpBarBounds();
	if (!bounds) return;
	renderInlineBarFrame(bounds.left, bounds.top, bounds.right, bounds.bottom, constants.COLOR_LINE_JUMP_BACKGROUND, constants.COLOR_LINE_JUMP_OUTLINE);
	const active = !!lineJumpState.active;
	renderInlineBarField(
		lineJumpState.field,
		'LINE #:',
		4,
		bounds.top + constants.LINE_JUMP_BAR_MARGIN_Y,
		active,
		active,
		constants.COLOR_LINE_JUMP_TEXT,
		'ENTER LINE NUMBER',
		constants.COLOR_LINE_JUMP_PLACEHOLDER,
		editorViewState.charAdvance,
	);
}
