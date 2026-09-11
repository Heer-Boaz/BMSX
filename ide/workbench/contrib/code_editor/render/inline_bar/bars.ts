import * as constants from '../../../../../common/constants';
import { api } from '../../../../../runtime/overlay_api';
import { drawEditorText } from '../../../../../editor/render/text_renderer';
import { drawCreateResourceErrorDialog } from '../../../../render/resource_panel';
import { activeSearchMatchCount, getVisibleSearchResultEntries } from '../../find/search';
import { editorViewState } from '../../../../../editor/ui/view/state';
import { editorSearchState, lineJumpState } from '../../find/widget_state';
import {
	getCreateResourceBarBounds,
	getLineJumpBarBounds,
	getRenameBarBounds,
	getSearchBarBounds,
	searchResultEntryHeight,
	searchVisibleResultCount,
} from '../../../../common/layout';
import { measureText } from '../../../../../editor/common/text/layout';
import { renderInlineBarField, renderInlineBarFrame } from './common';
import { renameController } from '../../rename/controller';
import { createResourceState } from '../../../resources/widget_state';

type InlineSearchResultEntry = {
	primary: string;
	secondary?: string;
	detail?: string;
};

const drawSearchResultRow = (entry: InlineSearchResultEntry, rowTop: number): void => {
	const paddingX = constants.QUICK_OPEN_RESULT_PADDING_X;
	const secondaryY = rowTop + editorViewState.lineHeight;
	if (entry.primary) {
		drawEditorText(editorViewState.font, entry.primary, paddingX, rowTop, 0, constants.COLOR_SEARCH_TEXT);
	}
	if (entry.detail) {
		const detailWidth = measureText(entry.detail);
		const detailX = editorViewState.viewportWidth - detailWidth - paddingX;
		drawEditorText(editorViewState.font, entry.detail, detailX, rowTop, 0, constants.COLOR_SEARCH_SECONDARY_TEXT);
	}
	if (entry.secondary) {
		drawEditorText(editorViewState.font, entry.secondary, paddingX, secondaryY, 0, constants.COLOR_SEARCH_SECONDARY_TEXT);
	}
};

export function renderCreateResourceBar(): void {
	const bounds = getCreateResourceBarBounds();
	if (!bounds) return;
	renderInlineBarFrame(bounds.left, bounds.top, bounds.right, bounds.bottom, constants.COLOR_CREATE_RESOURCE_BACKGROUND, constants.COLOR_CREATE_RESOURCE_OUTLINE);

	const fieldState = renderInlineBarField(
		createResourceState.field,
		'NEW FILE:',
		4,
		bounds.top + constants.CREATE_RESOURCE_BAR_MARGIN_Y,
		createResourceState.field.focusTarget.hasFocus,
		createResourceState.field.focusTarget.hasFocus,
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
		drawEditorText(editorViewState.font, status, statusX, bounds.top + constants.CREATE_RESOURCE_BAR_MARGIN_Y, 0, constants.COLOR_CREATE_RESOURCE_TEXT);
	} else if (createResourceState.error && createResourceState.error.length > 0) {
		drawCreateResourceErrorDialog(createResourceState.error);
	}
}

export function renderSearchBar(): void {
	const bounds = getSearchBarBounds();
	if (!bounds) return;
	renderInlineBarFrame(bounds.left, bounds.top, bounds.right, bounds.bottom, constants.COLOR_SEARCH_BACKGROUND, constants.COLOR_SEARCH_OUTLINE);
	const active = editorSearchState.field.focusTarget.hasFocus;
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
		drawEditorText(editorViewState.font, workingText, infoX - workingWidth, labelY, 0, constants.COLOR_SEARCH_TEXT);
	} else if (total > 0 || (editorSearchState.query && editorSearchState.query.length > 0)) {
		const infoText = total === 0 ? '0/0' : `${(current >= 0 ? current + 1 : 0)}/${total}`;
		const infoColor = total === 0 ? constants.COLOR_STATUS_WARNING : constants.COLOR_SEARCH_TEXT;
		const infoWidth = measureText(infoText);
		drawEditorText(editorViewState.font, infoText, infoX - infoWidth, labelY, 0, infoColor);
	}

	const visible = searchVisibleResultCount();
	if (visible <= 0) {
		return;
	}
	const baseHeight = editorViewState.lineHeight + constants.SEARCH_BAR_MARGIN_Y * 2;
	const separatorTop = bounds.top + baseHeight;
	api.fill_rect(bounds.left, separatorTop, bounds.right, separatorTop + constants.SEARCH_RESULT_SPACING, 0, constants.COLOR_SEARCH_OUTLINE);
	const resultsTop = separatorTop + constants.SEARCH_RESULT_SPACING;
	const rowHeight = searchResultEntryHeight();

	renderResultList(getVisibleSearchResultEntries(), visible, editorSearchState.displayOffset ?? 0, editorSearchState.displayOffset ?? 0, rowHeight, resultsTop, bounds.right, editorSearchState.currentIndex ?? -1, editorSearchState.hoverIndex ?? -1, drawSearchResultRow);
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
			api.fill_rect(0, rowTopValue, viewportWidth, rowBottom, 0, constants.SEARCH_RESULT_SELECTION_OVERLAY);
		} else if (matchIndex === hoverIndex) {
			api.fill_rect(0, rowTopValue, viewportWidth, rowBottom, 0, constants.SEARCH_RESULT_HOVER_OVERLAY);
		}
		drawRow(entry, rowTopValue);
	}
}

export function renderRenameBar(): void {
	const bounds = getRenameBarBounds();
	if (!bounds) return;
	renderInlineBarFrame(bounds.left, bounds.top, bounds.right, bounds.bottom, constants.COLOR_SEARCH_BACKGROUND, constants.COLOR_SEARCH_OUTLINE);
	const active = renameController.isActive();
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
		drawEditorText(editorViewState.font, status, statusX, labelY, 0, constants.COLOR_SEARCH_TEXT);
	}
}

export function renderLineJumpBar(): void {
	const bounds = getLineJumpBarBounds();
	if (!bounds) return;
	renderInlineBarFrame(bounds.left, bounds.top, bounds.right, bounds.bottom, constants.COLOR_LINE_JUMP_BACKGROUND, constants.COLOR_LINE_JUMP_OUTLINE);
	const active = lineJumpState.field.focusTarget.hasFocus;
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
