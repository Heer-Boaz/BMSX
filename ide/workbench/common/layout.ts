import { writeWrappedOverlayLine } from '../../editor/common/text/layout';
import { editorViewState } from '../../editor/ui/view/state';
import { editorFeedbackState } from '../../common/feedback_state';
import { problemsPanel } from '../contrib/problems/panel/controller';
import * as constants from '../../common/constants';
import { computeSearchPageStats } from '../contrib/code_editor/find/search';
import { editorSearchState, lineJumpState } from '../contrib/code_editor/find/widget_state';
import { symbolSearchState } from '../contrib/code_editor/symbols/search/state';
import { renameController } from '../contrib/code_editor/rename/controller';
import { createResourceState, resourceSearchState } from '../contrib/resources/widget_state';
import type { EditorFont } from '../../editor/ui/view/font';

export type FullWidthWorkbenchLayout = {
	left: number;
	top: number;
	right: number;
	bottom: number;
	rowHeight: number;
	font: EditorFont | null;
	viewportWidth: number;
	viewportHeight: number;
	codeAreaTop: number;
	codeAreaBottom: number;
};

/** Writes shared full-width editor-input geometry only when its owner metrics advance. */
export function updateFullWidthWorkbenchLayout(layout: FullWidthWorkbenchLayout): boolean {
	const changed = layout.viewportWidth !== editorViewState.viewportWidth
		|| layout.viewportHeight !== editorViewState.viewportHeight
		|| layout.codeAreaTop !== editorViewState.codeAreaTop
		|| layout.codeAreaBottom !== editorViewState.codeAreaBottom
		|| layout.font !== editorViewState.font
		|| layout.rowHeight !== editorViewState.lineHeight;
	if (!changed) {
		return false;
	}
	layout.left = 0;
	layout.top = editorViewState.codeAreaTop;
	layout.right = editorViewState.viewportWidth;
	layout.bottom = editorViewState.codeAreaBottom;
	layout.rowHeight = editorViewState.lineHeight;
	layout.font = editorViewState.font;
	layout.viewportWidth = editorViewState.viewportWidth;
	layout.viewportHeight = editorViewState.viewportHeight;
	layout.codeAreaTop = editorViewState.codeAreaTop;
	layout.codeAreaBottom = editorViewState.codeAreaBottom;
	return true;
}

const statusMessageLines: string[] = [];
let statusMessageCachedVisible = false;
let statusMessageCachedText = '';
let statusMessageCachedMaxWidth = -1;

export function getTabBarTotalHeight(): number {
	const rowCount = editorViewState.tabBarRowCount > 1 ? editorViewState.tabBarRowCount : 1;
	return editorViewState.tabBarHeight * rowCount;
}

export function topMargin(): number {
	return editorViewState.headerHeight + getTabBarTotalHeight() + 2;
}

export function getStatusMessageLines(): string[] {
	writeStatusMessageLines();
	return statusMessageLines;
}

function writeStatusMessageLines(): void {
	const message = editorFeedbackState.message;
	const maxWidthCandidate = editorViewState.viewportWidth - 8;
	const maxWidth = maxWidthCandidate > editorViewState.charAdvance ? maxWidthCandidate : editorViewState.charAdvance;
	if (
		message.visible === statusMessageCachedVisible
		&& message.text === statusMessageCachedText
		&& maxWidth === statusMessageCachedMaxWidth
	) {
		return;
	}

	statusMessageCachedVisible = message.visible;
	statusMessageCachedText = message.text;
	statusMessageCachedMaxWidth = maxWidth;
	statusMessageLines.length = 0;

	if (!message.visible) {
		return;
	}

	const text = message.text;
	let lineStart = 0;
	for (let index = 0; index <= text.length; index += 1) {
		if (index !== text.length && text.charCodeAt(index) !== 10) {
			continue;
		}
		let lineEnd = index;
		if (lineEnd > lineStart && text.charCodeAt(lineEnd - 1) === 13) {
			lineEnd -= 1;
		}
		writeWrappedOverlayLine(statusMessageLines, text.slice(lineStart, lineEnd), maxWidth);
		lineStart = index + 1;
	}

	if (statusMessageLines.length === 0) {
		statusMessageLines.push('');
	}
}

export function statusAreaHeight(): number {
	if (!editorFeedbackState.message.visible) {
		return editorViewState.baseBottomMargin;
	}
	writeStatusMessageLines();
	const lineCount = statusMessageLines.length > 1 ? statusMessageLines.length : 1;
	return editorViewState.baseBottomMargin + lineCount * editorViewState.lineHeight + 4;
}

export function getVisibleProblemsPanelHeight(): number {
	if (!problemsPanel.isVisible) {
		return 0;
	}
	const planned = problemsPanel.visibleHeight;
	if (planned <= 0) {
		return 0;
	}
	const maxAvailable = editorViewState.viewportHeight - statusAreaHeight() - (editorViewState.headerHeight + getTabBarTotalHeight());
	if (maxAvailable <= 0) {
		return 0;
	}
	return planned < maxAvailable ? planned : maxAvailable;
}

export function bottomMargin(): number {
	return statusAreaHeight() + getVisibleProblemsPanelHeight();
}

export function searchVisibleResultCount(): number {
	return computeSearchPageStats().visible;
}

export function searchResultEntryHeight(): number {
	return editorViewState.lineHeight * 2;
}

export function isResourceSearchCompactMode(): boolean {
	return editorViewState.viewportWidth <= constants.SYMBOL_SEARCH_COMPACT_WIDTH;
}

export function resourceSearchEntryHeight(): number {
	return isResourceSearchCompactMode() ? editorViewState.lineHeight * 2 : editorViewState.lineHeight;
}

export function resourceSearchPageSize(): number {
	return isResourceSearchCompactMode() ? constants.QUICK_OPEN_COMPACT_MAX_RESULTS : constants.QUICK_OPEN_MAX_RESULTS;
}

export function resourceSearchWindowCapacity(): number {
	return resourceSearchState.visible ? resourceSearchPageSize() : 0;
}

export function resourceSearchVisibleResultCount(): number {
	if (!resourceSearchState.visible) {
		return 0;
	}
	const remainingCandidate = resourceSearchState.matches.length - resourceSearchState.displayOffset;
	const remaining = remainingCandidate > 0 ? remainingCandidate : 0;
	const capacity = resourceSearchWindowCapacity();
	if (capacity <= 0) {
		return remaining;
	}
	return remaining < capacity ? remaining : capacity;
}

export function isSymbolSearchCompactMode(): boolean {
	return editorViewState.viewportWidth <= constants.SYMBOL_SEARCH_COMPACT_WIDTH;
}

export function symbolSearchEntryHeight(): number {
	switch (symbolSearchState.mode) {
		case 'references':
		case 'definitions':
			return editorViewState.lineHeight * 2;
		case 'symbols':
			return symbolSearchState.global && isSymbolSearchCompactMode()
				? editorViewState.lineHeight * 2
				: editorViewState.lineHeight;
	}
}

export function symbolSearchPageSize(): number {
	switch (symbolSearchState.mode) {
		case 'references':
		case 'definitions':
			return constants.REFERENCE_SEARCH_MAX_RESULTS;
		case 'symbols':
			if (!symbolSearchState.global) {
				return constants.SYMBOL_SEARCH_MAX_RESULTS;
			}
			return isSymbolSearchCompactMode()
				? constants.SYMBOL_SEARCH_COMPACT_MAX_RESULTS
				: constants.SYMBOL_SEARCH_MAX_RESULTS;
	}
}

export function symbolSearchVisibleResultCount(): number {
	if (!symbolSearchState.visible) {
		return 0;
	}
	const remainingCandidate = symbolSearchState.matches.length - symbolSearchState.displayOffset;
	const remaining = remainingCandidate > 0 ? remainingCandidate : 0;
	const pageSize = symbolSearchPageSize();
	return remaining < pageSize ? remaining : pageSize;
}

export function getCreateResourceBarHeight(): number {
	if (!createResourceState.visible) {
		return 0;
	}
	return editorViewState.lineHeight + constants.CREATE_RESOURCE_BAR_MARGIN_Y * 2;
}

export function getSearchBarHeight(): number {
	if (!editorSearchState.visible) {
		return 0;
	}
	const baseHeight = editorViewState.lineHeight + constants.SEARCH_BAR_MARGIN_Y * 2;
	const visible = searchVisibleResultCount();
	if (visible <= 0) {
		return baseHeight;
	}
	return baseHeight + constants.SEARCH_RESULT_SPACING + visible * searchResultEntryHeight();
}

export function getResourceSearchBarHeight(): number {
	if (!resourceSearchState.visible) {
		return 0;
	}
	const baseHeight = editorViewState.lineHeight + constants.QUICK_OPEN_BAR_MARGIN_Y * 2;
	const visible = resourceSearchVisibleResultCount();
	if (visible <= 0) {
		return baseHeight;
	}
	return baseHeight + constants.QUICK_OPEN_RESULT_SPACING + visible * resourceSearchEntryHeight();
}

export function getSymbolSearchBarHeight(): number {
	if (!symbolSearchState.visible) {
		return 0;
	}
	const baseHeight = editorViewState.lineHeight + constants.SYMBOL_SEARCH_BAR_MARGIN_Y * 2;
	const visible = symbolSearchVisibleResultCount();
	if (visible <= 0) {
		return baseHeight;
	}
	return baseHeight + constants.SYMBOL_SEARCH_RESULT_SPACING + visible * symbolSearchEntryHeight();
}

export function getRenameBarHeight(): number {
	if (!renameController.isVisible()) {
		return 0;
	}
	return editorViewState.lineHeight + constants.SEARCH_BAR_MARGIN_Y * 2;
}

export function getLineJumpBarHeight(): number {
	if (!lineJumpState.visible) {
		return 0;
	}
	return editorViewState.lineHeight + constants.LINE_JUMP_BAR_MARGIN_Y * 2;
}

export type BarBounds = { top: number; bottom: number; left: number; right: number };

type InlineBarLayout = {
	codeViewportTop: number;
	barHeight: number[];
	barBounds: BarBounds[];
};

function createBarBounds(): BarBounds {
	return { top: 0, bottom: 0, left: 0, right: 0 };
}

const barHeightGetters = [
	getCreateResourceBarHeight,
	getSearchBarHeight,
	getResourceSearchBarHeight,
	getSymbolSearchBarHeight,
	getRenameBarHeight,
	getLineJumpBarHeight,
] as const;

const inlineBarLayout: InlineBarLayout = {
	codeViewportTop: 0,
	barHeight: [0, 0, 0, 0, 0, 0],
	barBounds: [
		createBarBounds(),
		createBarBounds(),
		createBarBounds(),
		createBarBounds(),
		createBarBounds(),
		createBarBounds(),
	],
};

let inlineBarLayoutStamp = 0;
let inlineBarLayoutValid = false;

function addLayoutStamp(stamp: number, value: number): number {
	return ((stamp * 33) ^ value) | 0;
}

function computeInlineBarLayoutStamp(): number {
	let stamp = 5381;
	stamp = addLayoutStamp(stamp, editorViewState.viewportWidth);
	stamp = addLayoutStamp(stamp, editorViewState.viewportHeight);
	stamp = addLayoutStamp(stamp, editorViewState.headerHeight);
	stamp = addLayoutStamp(stamp, editorViewState.tabBarHeight);
	stamp = addLayoutStamp(stamp, editorViewState.tabBarRowCount);
	stamp = addLayoutStamp(stamp, editorViewState.lineHeight);
	stamp = addLayoutStamp(stamp, createResourceState.visible ? 1 : 0);
	stamp = addLayoutStamp(stamp, editorSearchState.visible ? 1 : 0);
	stamp = addLayoutStamp(stamp, editorSearchState.scope === 'global' ? 2 : 1);
	stamp = addLayoutStamp(stamp, editorSearchState.matches.length);
	stamp = addLayoutStamp(stamp, editorSearchState.globalMatches.length);
	stamp = addLayoutStamp(stamp, editorSearchState.displayOffset);
	stamp = addLayoutStamp(stamp, resourceSearchState.visible ? 1 : 0);
	stamp = addLayoutStamp(stamp, resourceSearchState.matches.length);
	stamp = addLayoutStamp(stamp, resourceSearchState.displayOffset);
	stamp = addLayoutStamp(stamp, symbolSearchState.visible ? 1 : 0);
	stamp = addLayoutStamp(stamp, symbolSearchState.matches.length);
	stamp = addLayoutStamp(stamp, symbolSearchState.displayOffset);
	stamp = addLayoutStamp(stamp, symbolSearchState.global ? 1 : 0);
	switch (symbolSearchState.mode) {
		case 'symbols':
			stamp = addLayoutStamp(stamp, 1);
			break;
		case 'references':
			stamp = addLayoutStamp(stamp, 2);
			break;
		case 'definitions':
			stamp = addLayoutStamp(stamp, 3);
			break;
	}
	stamp = addLayoutStamp(stamp, renameController.isVisible() ? 1 : 0);
	stamp = addLayoutStamp(stamp, lineJumpState.visible ? 1 : 0);
	return stamp;
}

function writeInlineBarLayout(): void {
	const stamp = computeInlineBarLayoutStamp();
	if (inlineBarLayoutValid && stamp === inlineBarLayoutStamp) {
		return;
	}
	inlineBarLayoutValid = true;
	inlineBarLayoutStamp = stamp;
	let top = topMargin();
	for (let index = 0; index < barHeightGetters.length; index += 1) {
		const height = barHeightGetters[index]();
		const bounds = inlineBarLayout.barBounds[index];
		inlineBarLayout.barHeight[index] = height;
		if (height <= 0) {
			bounds.left = 0;
			bounds.top = top;
			bounds.right = 0;
			bounds.bottom = top;
			continue;
		}
		bounds.left = 0;
		bounds.top = top;
		bounds.right = editorViewState.viewportWidth;
		bounds.bottom = top + height;
		top = bounds.bottom;
	}
	inlineBarLayout.codeViewportTop = top;
}

export function refreshWorkbenchLayout(): void {
	writeInlineBarLayout();
	editorViewState.codeAreaTop = inlineBarLayout.codeViewportTop;
	editorViewState.codeAreaBottom = editorViewState.viewportHeight - bottomMargin();
}

function getInlineBarBounds(barIndex: number): BarBounds | null {
	if (inlineBarLayout.barHeight[barIndex] <= 0) {
		return null;
	}
	return inlineBarLayout.barBounds[barIndex];
}

export function getCreateResourceBarBounds(): BarBounds | null { return getInlineBarBounds(0); }
export function getSearchBarBounds(): BarBounds | null { return getInlineBarBounds(1); }
export function getResourceSearchBarBounds(): BarBounds | null { return getInlineBarBounds(2); }
export function getSymbolSearchBarBounds(): BarBounds | null { return getInlineBarBounds(3); }
export function getRenameBarBounds(): BarBounds | null { return getInlineBarBounds(4); }
export function getLineJumpBarBounds(): BarBounds | null { return getInlineBarBounds(5); }
