import { BmsxConsoleApi } from '../api';
import * as constants from './constants';

export interface InlineBarsHost {
	viewportWidth: number;
	headerHeight: number;
	tabBarHeight: number;
	lineHeight: number;
	spaceAdvance: number;
	charAdvance?: number;
	measureText: (text: string) => number;
	drawText: (api: BmsxConsoleApi, text: string, x: number, y: number, color: number) => void;
	inlineFieldMetrics: () => { spaceAdvance: number };
	createResourceActive: boolean;
	createResourceVisible: boolean;
	createResourceField: unknown;
	createResourceWorking: boolean;
	createResourceError: string | null;
	drawCreateResourceErrorDialog: (api: BmsxConsoleApi, errorText: string) => void;
	getCreateResourceBarHeight: () => number;
	// Additional height getters for other bars (editor will supply these)
	getSearchBarHeight: () => number;
	getResourceSearchBarHeight: () => number;
	getSymbolSearchBarHeight: () => number;
	getLineJumpBarHeight: () => number;
	drawInlineCaret: (
		api: BmsxConsoleApi,
		field: unknown,
		left: number,
		top: number,
		right: number,
		bottom: number,
		baseX: number,
		active: boolean,
		caretColor: { r: number; g: number; b: number; a: number },
		textColor: number,
	) => void;
	inlineFieldSelectionRange: (field: unknown) => { start: number; end: number } | null;
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

	// Resource search bar state and helpers
	resourceSearchActive?: boolean;
	resourceSearchField?: unknown;
	resourceSearchVisibleResultCount?: () => number;
	resourceSearchEntryHeight?: () => number;
	isResourceSearchCompactMode?: () => boolean;
	resourceSearchMatches?: Array<{ entry: { typeLabel: string; displayPath: string; assetLabel?: string | null } }>;
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
	symbolSearchMatches?: Array<{ entry: { kindLabel: string; displayName: string; line: number; sourceLabel?: string | null; symbol?: unknown } }>;
	symbolSearchSelectionIndex?: number;
	symbolSearchHoverIndex?: number;
	symbolSearchDisplayOffset?: number;

	// Line jump bar state
	lineJumpActive?: boolean;
	lineJumpField?: unknown;
}

export function renderCreateResourceBar(api: BmsxConsoleApi, host: InlineBarsHost): void {
	const height = host.getCreateResourceBarHeight();
	if (height <= 0) return;
	const barTop = host.headerHeight + host.tabBarHeight;
	const barBottom = barTop + height;
	api.rectfill(0, barTop, host.viewportWidth, barBottom, constants.COLOR_CREATE_RESOURCE_BACKGROUND);
	api.rectfill(0, barTop, host.viewportWidth, barTop + 1, constants.COLOR_CREATE_RESOURCE_OUTLINE);
	api.rectfill(0, barBottom - 1, host.viewportWidth, barBottom, constants.COLOR_CREATE_RESOURCE_OUTLINE);

	const label = 'NEW FILE:';
	const labelX = 4;
	const labelY = barTop + constants.CREATE_RESOURCE_BAR_MARGIN_Y;
	host.drawText(api, label, labelX, labelY, constants.COLOR_CREATE_RESOURCE_TEXT);

	const field = host.createResourceField as { text: string };
	const pathX = labelX + host.measureText(label + ' ');
	let displayPath = field.text;
	let pathColor = constants.COLOR_CREATE_RESOURCE_TEXT;
	if (displayPath.length === 0 && !host.createResourceActive) {
		displayPath = 'ENTER LUA PATH';
		pathColor = constants.COLOR_CREATE_RESOURCE_PLACEHOLDER;
	}

	const selection = host.inlineFieldSelectionRange(field);
	if (selection && field.text.length > 0) {
		const selectionLeft = pathX + host.inlineFieldMeasureRange(field, host.inlineFieldMetrics(), 0, selection.start);
		const selectionWidth = host.inlineFieldMeasureRange(field, host.inlineFieldMetrics(), selection.start, selection.end);
		if (selectionWidth > 0) {
			api.rectfill_color(selectionLeft, labelY, selectionLeft + selectionWidth, labelY + host.lineHeight, constants.SELECTION_OVERLAY);
		}
	}

	host.drawText(api, displayPath, pathX, labelY, pathColor);

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
		host.drawText(api, status, statusX, labelY, constants.COLOR_CREATE_RESOURCE_TEXT);
	} else if (host.createResourceError && host.createResourceError.length > 0) {
		host.drawCreateResourceErrorDialog(api, host.createResourceError);
	}
}

export function renderSearchBar(api: BmsxConsoleApi, host: InlineBarsHost): void {
	const height = host.getSearchBarHeight();
	if (height <= 0) return;
	const barTop = host.headerHeight + host.tabBarHeight + host.getCreateResourceBarHeight();
	const barBottom = barTop + height;
	api.rectfill(0, barTop, host.viewportWidth, barBottom, constants.COLOR_SEARCH_BACKGROUND);
	api.rectfill(0, barTop, host.viewportWidth, barTop + 1, constants.COLOR_SEARCH_OUTLINE);
	api.rectfill(0, barBottom - 1, host.viewportWidth, barBottom, constants.COLOR_SEARCH_OUTLINE);

	const field = host.searchField as { text: string } | undefined;
	const label = 'SEARCH:';
	const labelX = 4;
	const labelY = barTop + constants.SEARCH_BAR_MARGIN_Y;
	host.drawText(api, label, labelX, labelY, constants.COLOR_SEARCH_TEXT);

    const active = !!host.searchActive && !host.blockActiveCarets;
	let queryText = field?.text ?? '';
	let queryColor = constants.COLOR_SEARCH_TEXT;
	if (queryText.length === 0 && !active) {
		queryText = 'TYPE TO SEARCH';
		queryColor = constants.COLOR_SEARCH_PLACEHOLDER;
	}
	const queryX = labelX + host.measureText(label + ' ');

	const selection = field ? host.inlineFieldSelectionRange(field) : null;
	if (selection && field!.text.length > 0) {
		const selectionLeft = queryX + host.inlineFieldMeasureRange(field!, host.inlineFieldMetrics(), 0, selection.start);
		const selectionWidth = host.inlineFieldMeasureRange(field!, host.inlineFieldMetrics(), selection.start, selection.end);
		if (selectionWidth > 0) {
			api.rectfill_color(selectionLeft, labelY, selectionLeft + selectionWidth, labelY + host.lineHeight, constants.SELECTION_OVERLAY);
		}
	}

	host.drawText(api, queryText, queryX, labelY, queryColor);

	if (field) {
		const caretX = host.inlineFieldCaretX(field, queryX, host.measureText);
		const caretLeft = Math.floor(caretX);
		const caretRight = Math.max(caretLeft + 1, Math.floor(caretX + (host.charAdvance ?? host.spaceAdvance)));
		const caretTop = Math.floor(labelY);
		const caretBottom = caretTop + host.lineHeight;
    host.drawInlineCaret(api, field, caretLeft, caretTop, caretRight, caretBottom, caretX, active, constants.INLINE_CARET_COLOR, queryColor);
	}

	const total = host.searchMatchesCount ?? 0;
	const current = host.searchCurrentIndex ?? -1;
	if (total > 0 || (host.searchQuery && host.searchQuery.length > 0)) {
		const infoText = total === 0 ? '0/0' : `${(current >= 0 ? current + 1 : 0)}/${total}`;
		const infoColor = total === 0 ? constants.COLOR_STATUS_WARNING : constants.COLOR_SEARCH_TEXT;
		const infoWidth = host.measureText(infoText);
		host.drawText(api, infoText, host.viewportWidth - infoWidth - 4, labelY, infoColor);
	}
}

export function renderResourceSearchBar(api: BmsxConsoleApi, host: InlineBarsHost): void {
	const height = host.getResourceSearchBarHeight();
	if (height <= 0) return;
	const barTop = host.headerHeight + host.tabBarHeight + host.getCreateResourceBarHeight() + host.getSearchBarHeight();
	const barBottom = barTop + height;
	api.rectfill(0, barTop, host.viewportWidth, barBottom, constants.COLOR_QUICK_OPEN_BACKGROUND);
	api.rectfill(0, barTop, host.viewportWidth, barTop + 1, constants.COLOR_QUICK_OPEN_OUTLINE);
	api.rectfill(0, barBottom - 1, host.viewportWidth, barBottom, constants.COLOR_QUICK_OPEN_OUTLINE);

	const field = host.resourceSearchField as { text: string } | undefined;
	const label = 'FILE :';
	const labelX = 4;
	const labelY = barTop + constants.QUICK_OPEN_BAR_MARGIN_Y;
	host.drawText(api, label, labelX, labelY, constants.COLOR_QUICK_OPEN_TEXT);

    const active = !!host.resourceSearchActive && !host.blockActiveCarets;
	let queryText = field?.text ?? '';
	let queryColor = constants.COLOR_QUICK_OPEN_TEXT;
	if (queryText.length === 0 && !active) {
		queryText = 'TYPE TO FILTER (@/# PREFIX)';
		queryColor = constants.COLOR_QUICK_OPEN_PLACEHOLDER;
	}
	const queryX = labelX + host.measureText(label + ' ');

	const selection = field ? host.inlineFieldSelectionRange(field) : null;
	if (selection && field!.text.length > 0) {
		const selectionLeft = queryX + host.inlineFieldMeasureRange(field!, host.inlineFieldMetrics(), 0, selection.start);
		const selectionWidth = host.inlineFieldMeasureRange(field!, host.inlineFieldMetrics(), selection.start, selection.end);
		if (selectionWidth > 0) {
			api.rectfill_color(selectionLeft, labelY, selectionLeft + selectionWidth, labelY + host.lineHeight, constants.SELECTION_OVERLAY);
		}
	}

	host.drawText(api, queryText, queryX, labelY, queryColor);

	if (field) {
		const caretX = host.inlineFieldCaretX(field, queryX, host.measureText);
		const caretLeft = Math.floor(caretX);
		const caretRight = Math.max(caretLeft + 1, Math.floor(caretX + (host.charAdvance ?? host.spaceAdvance)));
		const caretTop = Math.floor(labelY);
		const caretBottom = caretTop + host.lineHeight;
	host.drawInlineCaret(api, field, caretLeft, caretTop, caretRight, caretBottom, caretX, active, constants.INLINE_CARET_COLOR, queryColor);
	}

	const visible = host.resourceSearchVisibleResultCount ? host.resourceSearchVisibleResultCount() : 0;
	if (visible <= 0) return;
	const baseHeight = host.lineHeight + constants.QUICK_OPEN_BAR_MARGIN_Y * 2;
	const separatorTop = barTop + baseHeight;
	api.rectfill(0, separatorTop, host.viewportWidth, separatorTop + constants.QUICK_OPEN_RESULT_SPACING, constants.COLOR_QUICK_OPEN_OUTLINE);
	const resultsTop = separatorTop + constants.QUICK_OPEN_RESULT_SPACING;
	const rowHeight = host.resourceSearchEntryHeight ? host.resourceSearchEntryHeight() : host.lineHeight * 2;
	const compactMode = host.isResourceSearchCompactMode ? host.isResourceSearchCompactMode() : false;
	for (let i = 0; i < visible; i += 1) {
		const matchIndex = (host.resourceSearchDisplayOffset ?? 0) + i;
		const match = host.resourceSearchMatches ? host.resourceSearchMatches[matchIndex] : undefined;
		const rowTop = resultsTop + i * rowHeight;
		const rowBottom = rowTop + rowHeight;
		const isSelected = matchIndex === (host.resourceSearchSelectionIndex ?? -1);
		const isHover = matchIndex === (host.resourceSearchHoverIndex ?? -1);
		if (isSelected) {
			api.rectfill_color(0, rowTop, host.viewportWidth, rowBottom, constants.HIGHLIGHT_OVERLAY);
		} else if (isHover) {
			api.rectfill_color(0, rowTop, host.viewportWidth, rowBottom, constants.SELECTION_OVERLAY);
		}
		let textX = constants.QUICK_OPEN_RESULT_PADDING_X;
		const kindText = match?.entry.typeLabel ?? '';
		const detail = match?.entry.assetLabel ?? '';
		if (kindText.length > 0) {
			host.drawText(api, kindText, textX, rowTop, constants.COLOR_QUICK_OPEN_KIND);
			textX += host.measureText(kindText + ' ');
		}
		host.drawText(api, match?.entry.displayPath ?? '', textX, rowTop, constants.COLOR_QUICK_OPEN_TEXT);
		if (compactMode) {
			const secondaryY = rowTop + host.lineHeight;
			if (detail.length > 0) {
				host.drawText(api, detail, constants.QUICK_OPEN_RESULT_PADDING_X, secondaryY, constants.COLOR_QUICK_OPEN_KIND);
			}
		} else if (detail.length > 0) {
			const detailWidth = host.measureText(detail);
			const detailX = host.viewportWidth - detailWidth - constants.QUICK_OPEN_RESULT_PADDING_X;
			host.drawText(api, detail, detailX, rowTop, constants.COLOR_QUICK_OPEN_KIND);
		}
	}
}

export function renderSymbolSearchBar(api: BmsxConsoleApi, host: InlineBarsHost): void {
	const height = host.getSymbolSearchBarHeight();
	if (height <= 0) return;
	const barTop = host.headerHeight + host.tabBarHeight + host.getCreateResourceBarHeight() + host.getSearchBarHeight() + host.getResourceSearchBarHeight();
	const barBottom = barTop + height;
	api.rectfill(0, barTop, host.viewportWidth, barBottom, constants.COLOR_SYMBOL_SEARCH_BACKGROUND);
	api.rectfill(0, barTop, host.viewportWidth, barTop + 1, constants.COLOR_SYMBOL_SEARCH_OUTLINE);
	api.rectfill(0, barBottom - 1, host.viewportWidth, barBottom, constants.COLOR_SYMBOL_SEARCH_OUTLINE);

	const field = host.symbolSearchField as { text: string } | undefined;
	const mode = host.symbolSearchMode ?? 'symbols';
	const label = mode === 'references' ? 'REFS :' : host.symbolSearchGlobal ? 'SYMBOL #:' : 'SYMBOL @:';
	const labelX = 4;
	const labelY = barTop + constants.SYMBOL_SEARCH_BAR_MARGIN_Y;
	host.drawText(api, label, labelX, labelY, constants.COLOR_SYMBOL_SEARCH_TEXT);

	const active = !!host.symbolSearchActive;
	let queryText = field?.text ?? '';
	let queryColor = constants.COLOR_SYMBOL_SEARCH_TEXT;
	const placeholder = mode === 'references' ? 'FILTER REFERENCES' : 'TYPE TO FILTER';
	if (queryText.length === 0 && !active) {
		queryText = placeholder;
		queryColor = constants.COLOR_SYMBOL_SEARCH_PLACEHOLDER;
	}
	const queryX = labelX + host.measureText(label + ' ');

	const selection = field ? host.inlineFieldSelectionRange(field) : null;
	if (selection && field!.text.length > 0) {
		const selectionLeft = queryX + host.inlineFieldMeasureRange(field!, host.inlineFieldMetrics(), 0, selection.start);
		const selectionWidth = host.inlineFieldMeasureRange(field!, host.inlineFieldMetrics(), selection.start, selection.end);
		if (selectionWidth > 0) {
			api.rectfill_color(selectionLeft, labelY, selectionLeft + selectionWidth, labelY + host.lineHeight, constants.SELECTION_OVERLAY);
		}
	}

	host.drawText(api, queryText, queryX, labelY, queryColor);

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
	api.rectfill(0, separatorTop, host.viewportWidth, separatorTop + constants.SYMBOL_SEARCH_RESULT_SPACING, constants.COLOR_SYMBOL_SEARCH_OUTLINE);
	const resultsTop = separatorTop + constants.SYMBOL_SEARCH_RESULT_SPACING;
	const entryHeight = host.symbolSearchEntryHeight ? host.symbolSearchEntryHeight() : host.lineHeight * 2;
	const compactMode = mode === 'references'
		? true
		: (host.symbolSearchGlobal && host.isSymbolSearchCompactMode ? host.isSymbolSearchCompactMode() : false) as boolean;
	for (let i = 0; i < visible; i += 1) {
		const matchIndex = (host.symbolSearchDisplayOffset ?? 0) + i;
		const match = host.symbolSearchMatches ? host.symbolSearchMatches[matchIndex] : undefined;
		const rowTop = resultsTop + i * entryHeight;
		const rowBottom = rowTop + entryHeight;
		const isSelected = matchIndex === (host.symbolSearchSelectionIndex ?? -1);
		const isHover = matchIndex === (host.symbolSearchHoverIndex ?? -1);
		if (isSelected) {
			api.rectfill_color(0, rowTop, host.viewportWidth, rowBottom, constants.HIGHLIGHT_OVERLAY);
		} else if (isHover) {
			api.rectfill_color(0, rowTop, host.viewportWidth, rowBottom, constants.SELECTION_OVERLAY);
		}
		let textX = constants.SYMBOL_SEARCH_RESULT_PADDING_X;
		const kindText = match?.entry.kindLabel ?? '';
		const symbol = match?.entry.symbol as { __referenceColumn?: number } | undefined;
		const referenceColumn = symbol?.__referenceColumn;
		const lineValue = match?.entry.line ?? 0;
		const lineText = mode === 'references' && typeof referenceColumn === 'number'
			? `:${lineValue}:${referenceColumn}`
			: `:${lineValue}`;
		const lineWidth = host.measureText(lineText);
		if (kindText.length > 0) {
			host.drawText(api, kindText, textX, rowTop, constants.COLOR_SYMBOL_SEARCH_KIND);
			textX += host.measureText(kindText + ' ');
		}
		host.drawText(api, match?.entry.displayName ?? '', textX, rowTop, constants.COLOR_SYMBOL_SEARCH_TEXT);
		if (compactMode) {
			const secondaryY = rowTop + host.lineHeight;
			const lineX = host.viewportWidth - lineWidth - constants.SYMBOL_SEARCH_RESULT_PADDING_X;
			host.drawText(api, lineText, lineX, secondaryY, constants.COLOR_SYMBOL_SEARCH_TEXT);
			const sourceLabel = match?.entry.sourceLabel ?? '';
			if (sourceLabel) {
				host.drawText(api, sourceLabel, constants.SYMBOL_SEARCH_RESULT_PADDING_X, secondaryY, constants.COLOR_SYMBOL_SEARCH_KIND);
			}
		} else {
			const lineX = host.viewportWidth - lineWidth - constants.SYMBOL_SEARCH_RESULT_PADDING_X;
			host.drawText(api, lineText, lineX, rowTop, constants.COLOR_SYMBOL_SEARCH_TEXT);
			const sourceLabel = match?.entry.sourceLabel ?? '';
			if (sourceLabel) {
				const sourceWidth = host.measureText(sourceLabel);
				const sourceX = Math.max(textX, lineX - host.spaceAdvance - sourceWidth);
				host.drawText(api, sourceLabel, sourceX, rowTop, constants.COLOR_SYMBOL_SEARCH_KIND);
			}
		}
	}
}

export function renderLineJumpBar(api: BmsxConsoleApi, host: InlineBarsHost): void {
	const height = host.getLineJumpBarHeight();
	if (height <= 0) return;
	const barTop = host.headerHeight + host.tabBarHeight
		+ host.getCreateResourceBarHeight()
		+ host.getSearchBarHeight()
		+ host.getResourceSearchBarHeight()
		+ host.getSymbolSearchBarHeight();
	const barBottom = barTop + height;
	api.rectfill(0, barTop, host.viewportWidth, barBottom, constants.COLOR_LINE_JUMP_BACKGROUND);
	api.rectfill(0, barTop, host.viewportWidth, barTop + 1, constants.COLOR_LINE_JUMP_OUTLINE);
	api.rectfill(0, barBottom - 1, host.viewportWidth, barBottom, constants.COLOR_LINE_JUMP_OUTLINE);

	const label = 'LINE #:';
	const labelX = 4;
	const labelY = barTop + constants.LINE_JUMP_BAR_MARGIN_Y;
	host.drawText(api, label, labelX, labelY, constants.COLOR_LINE_JUMP_TEXT);

	const field = host.lineJumpField as { text: string } | undefined;
	const active = !!host.lineJumpActive;
	let valueText = field?.text ?? '';
	let valueColor = constants.COLOR_LINE_JUMP_TEXT;
	if (valueText.length === 0 && !active) {
		valueText = 'ENTER LINE NUMBER';
		valueColor = constants.COLOR_LINE_JUMP_PLACEHOLDER;
	}
	const valueX = labelX + host.measureText(label + ' ');

	const selection = field ? host.inlineFieldSelectionRange(field) : null;
	if (selection && field!.text.length > 0) {
		const selectionLeft = valueX + host.inlineFieldMeasureRange(field!, host.inlineFieldMetrics(), 0, selection.start);
		const selectionWidth = host.inlineFieldMeasureRange(field!, host.inlineFieldMetrics(), selection.start, selection.end);
		if (selectionWidth > 0) {
			api.rectfill_color(selectionLeft, labelY, selectionLeft + selectionWidth, labelY + host.lineHeight, constants.SELECTION_OVERLAY);
		}
	}

	host.drawText(api, valueText, valueX, labelY, valueColor);

	if (field) {
		const caretX = host.inlineFieldCaretX(field, valueX, host.measureText);
		const caretLeft = Math.floor(caretX);
		const caretRight = Math.max(caretLeft + 1, Math.floor(caretX + (host.charAdvance ?? host.spaceAdvance)));
		const caretTop = Math.floor(labelY);
		const caretBottom = caretTop + host.lineHeight;
		host.drawInlineCaret(api, field, caretLeft, caretTop, caretRight, caretBottom, caretX, active, constants.INLINE_CARET_COLOR, valueColor);
	}
}
