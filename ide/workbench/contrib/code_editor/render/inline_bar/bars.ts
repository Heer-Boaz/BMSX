import * as constants from '../../../../../common/constants';
import { api } from '../../../../../runtime/overlay_api';
import { drawEditorText } from '../../../../../editor/render/text_renderer';
import { getVisibleSearchResultEntries } from '../../find/search';
import { editorViewState } from '../../../../../editor/ui/view/state';
import { editorSearchState } from '../../find/widget_state';
import {
	getLineJumpBarBounds,
	getRenameBarBounds,
	getSearchBarBounds,
	searchResultEntryHeight,
	searchVisibleResultCount,
} from '../../../../common/layout';
import { measureText } from '../../../../../editor/common/text/layout';
import { renderInlineBarField, renderInlineBarFrame } from './common';
import { getSearchFieldLayout, getRenameFieldLayout, getLineJumpFieldLayout } from '../../inline_bar/layout';
import type { RectBounds } from '../../../../../../machine/ts/common/rect';

type InlineSearchResultEntry = {
	primary: string;
	secondary?: string;
	detail?: string;
};

const drawSearchResultRow = (entry: InlineSearchResultEntry, rowTop: number, bounds: Readonly<RectBounds>, selected: boolean, hovered: boolean): void => {
	const paddingX = bounds.left + constants.QUICK_OPEN_RESULT_PADDING_X;
	const secondaryY = rowTop + editorViewState.lineHeight;
	const text = selected ? constants.COLOR_SEARCH_SELECTION_TEXT : hovered ? constants.COLOR_SEARCH_HOVER_TEXT : constants.COLOR_SEARCH_TEXT;
	const secondary = selected || hovered ? text : constants.COLOR_SEARCH_SECONDARY_TEXT;
	if (entry.primary) {
		drawEditorText(editorViewState.font, entry.primary, paddingX, rowTop, 0, text);
	}
	if (entry.detail) {
		const detailWidth = measureText(entry.detail);
		const detailX = bounds.right - detailWidth - constants.QUICK_OPEN_RESULT_PADDING_X;
		drawEditorText(editorViewState.font, entry.detail, detailX, rowTop, 0, secondary);
	}
	if (entry.secondary) {
		drawEditorText(editorViewState.font, entry.secondary, paddingX, secondaryY, 0, secondary);
	}
};

export function renderSearchBar(): void {
	const bounds = getSearchBarBounds();
	if (!bounds) return;
	renderInlineBarFrame(bounds.left, bounds.top, bounds.right, bounds.bottom, constants.COLOR_SEARCH_BACKGROUND, constants.COLOR_SEARCH_OUTLINE);
	renderInlineBarField(getSearchFieldLayout(), constants.COLOR_SEARCH_TEXT, 'FIND', constants.COLOR_SEARCH_PLACEHOLDER);

	const visible = searchVisibleResultCount();
	if (visible <= 0) {
		return;
	}
	const baseHeight = editorViewState.lineHeight + constants.SEARCH_BAR_MARGIN_Y * 2;
	const separatorTop = bounds.top + baseHeight;
	api.fill_rect(bounds.left, separatorTop, bounds.right, separatorTop + constants.SEARCH_RESULT_SPACING, 0, constants.COLOR_SEARCH_OUTLINE);
	const resultsTop = separatorTop + constants.SEARCH_RESULT_SPACING;
	const rowHeight = searchResultEntryHeight();

	renderResultList(getVisibleSearchResultEntries(), visible, editorSearchState.displayOffset, editorSearchState.displayOffset, rowHeight, resultsTop, bounds, editorSearchState.currentIndex, editorSearchState.hoverIndex, drawSearchResultRow);
}

function renderResultList<T>(
	entries: readonly T[],
	visibleCount: number,
	displayOffset: number,
	entriesBaseOffset: number,
	rowHeight: number,
	rowTop: number,
	bounds: Readonly<RectBounds>,
	selectionIndex: number,
	hoverIndex: number,
	drawRow: (entry: T, rowTop: number, bounds: Readonly<RectBounds>, selected: boolean, hovered: boolean) => void,
): void {
	if (visibleCount <= 0) {
		return;
	}
	api.pushClipRect(bounds.left, rowTop, bounds.right, bounds.bottom);
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
			api.fill_rect(bounds.left, rowTopValue, bounds.right, rowBottom, 0, constants.SEARCH_RESULT_SELECTION_OVERLAY);
		} else if (matchIndex === hoverIndex) {
			api.fill_rect(bounds.left, rowTopValue, bounds.right, rowBottom, 0, constants.SEARCH_RESULT_HOVER_OVERLAY);
		}
		drawRow(entry, rowTopValue, bounds, matchIndex === selectionIndex, matchIndex === hoverIndex);
	}
	api.popClipRect();
}

export function renderRenameBar(): void {
	const bounds = getRenameBarBounds();
	if (!bounds) return;
	renderInlineBarFrame(bounds.left, bounds.top, bounds.right, bounds.bottom, constants.COLOR_SEARCH_BACKGROUND, constants.COLOR_SEARCH_OUTLINE);
	renderInlineBarField(getRenameFieldLayout(), constants.COLOR_SEARCH_TEXT, 'RENAME', constants.COLOR_SEARCH_PLACEHOLDER);
}

export function renderLineJumpBar(): void {
	const bounds = getLineJumpBarBounds();
	if (!bounds) return;
	renderInlineBarFrame(bounds.left, bounds.top, bounds.right, bounds.bottom, constants.COLOR_LINE_JUMP_BACKGROUND, constants.COLOR_LINE_JUMP_OUTLINE);
	renderInlineBarField(getLineJumpFieldLayout(), constants.COLOR_LINE_JUMP_TEXT, 'LINE', constants.COLOR_LINE_JUMP_PLACEHOLDER);
}
