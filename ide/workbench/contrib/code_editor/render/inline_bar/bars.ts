import * as constants from '../../../../../common/constants';
import { renderInlineBarField, renderInlineBarFrame } from './common';
import { api } from '../../../../../runtime/overlay_api';
import { drawEditorText } from '../../../../../editor/render/text_renderer';
import type { EditorSearchController } from '../../find/search';
import type { CodeEditorLineJump } from '../../find/line_jump';
import type { RenameController } from '../../rename/controller';
import type { SourceInlineBars } from '../../inline_bar/source_inline_bars';
import type { CodeEditorControl } from '../../../../../editor/ui/code_editor_control';
import type { RectBounds } from '../../../../../../machine/ts/common/rect';

type InlineSearchResultEntry = {
	primary: string;
	secondary?: string;
	detail?: string;
};

const drawSearchResultRow = (code: CodeEditorControl, entry: InlineSearchResultEntry, rowTop: number, bounds: Readonly<RectBounds>, selected: boolean, hovered: boolean): void => {
	const paddingX = bounds.left + constants.QUICK_OPEN_RESULT_PADDING_X;
	const secondaryY = rowTop + code.lineHeight;
	const text = selected ? constants.COLOR_SEARCH_SELECTION_TEXT : hovered ? constants.COLOR_SEARCH_HOVER_TEXT : constants.COLOR_SEARCH_TEXT;
	const secondary = selected || hovered ? text : constants.COLOR_SEARCH_SECONDARY_TEXT;
	if (entry.primary) {
		drawEditorText(code.font, entry.primary, paddingX, rowTop, 0, text);
	}
	if (entry.detail) {
		const detailWidth = code.font.measure(entry.detail);
		const detailX = bounds.right - detailWidth - constants.QUICK_OPEN_RESULT_PADDING_X;
		drawEditorText(code.font, entry.detail, detailX, rowTop, 0, secondary);
	}
	if (entry.secondary) {
		drawEditorText(code.font, entry.secondary, paddingX, secondaryY, 0, secondary);
	}
};

export function renderSearchBar(code: CodeEditorControl, find: EditorSearchController, bars: SourceInlineBars): void {
	const bounds = bars.searchBounds;
	if (!bounds) return;
	renderInlineBarFrame(bounds.left, bounds.top, bounds.right, bounds.bottom, constants.COLOR_SEARCH_BACKGROUND, constants.COLOR_SEARCH_OUTLINE);
	renderInlineBarField(find.fieldLayout, constants.COLOR_SEARCH_TEXT, 'FIND', constants.COLOR_SEARCH_PLACEHOLDER);

	const visible = bars.visibleSearchResults;
	if (visible <= 0) {
		return;
	}
	const baseHeight = code.lineHeight + constants.SEARCH_BAR_MARGIN_Y * 2;
	const separatorTop = bounds.top + baseHeight;
	api.fill_rect(bounds.left, separatorTop, bounds.right, separatorTop + constants.SEARCH_RESULT_SPACING, 0, constants.COLOR_SEARCH_OUTLINE);
	const resultsTop = separatorTop + constants.SEARCH_RESULT_SPACING;
	const rowHeight = bars.searchResultEntryHeight;

	const entries = find.getVisibleSearchResultEntries();
	api.pushClipRect(bounds.left, resultsTop, bounds.right, bounds.bottom);
	for (let index = 0; index < entries.length; index++) {
		const matchIndex = find.state.displayOffset + index;
		const rowTop = resultsTop + index * rowHeight;
		const selected = matchIndex === find.state.currentIndex, hovered = matchIndex === find.state.hoverIndex;
		if (selected || hovered) {
			api.fill_rect(bounds.left, rowTop, bounds.right, rowTop + rowHeight, 0,
				selected ? constants.SEARCH_RESULT_SELECTION_OVERLAY : constants.SEARCH_RESULT_HOVER_OVERLAY);
		}
		drawSearchResultRow(code, entries[index], rowTop, bounds, selected, hovered);
	}
	api.popClipRect();
}

export function renderRenameBar(rename: RenameController, bars: SourceInlineBars): void {
	const bounds = bars.renameBounds;
	if (!bounds) return;
	renderInlineBarFrame(bounds.left, bounds.top, bounds.right, bounds.bottom, constants.COLOR_SEARCH_BACKGROUND, constants.COLOR_SEARCH_OUTLINE);
	renderInlineBarField(rename.fieldLayout, constants.COLOR_SEARCH_TEXT, 'RENAME', constants.COLOR_SEARCH_PLACEHOLDER);
}

export function renderLineJumpBar(lineJump: CodeEditorLineJump, bars: SourceInlineBars): void {
	const bounds = bars.lineJumpBounds;
	if (!bounds) return;
	renderInlineBarFrame(bounds.left, bounds.top, bounds.right, bounds.bottom, constants.COLOR_LINE_JUMP_BACKGROUND, constants.COLOR_LINE_JUMP_OUTLINE);
	renderInlineBarField(lineJump.fieldLayout, constants.COLOR_LINE_JUMP_TEXT, 'LINE', constants.COLOR_LINE_JUMP_PLACEHOLDER);
}
