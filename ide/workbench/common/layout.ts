import { writeWrappedOverlayLine } from '../../editor/common/text/layout';
import { editorViewState } from '../../editor/ui/view/state';
import { editorFeedbackState } from '../../common/feedback_state';
import { problemsPanel } from '../contrib/problems/panel/controller';
import * as constants from '../../common/constants';
import { computeSearchPageStats } from '../contrib/code_editor/find/search';
import { editorSearchState, lineJumpState } from '../contrib/code_editor/find/widget_state';
import { renameController } from '../contrib/code_editor/rename/controller';
import { createResourceState } from '../contrib/resources/widget_state';
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

export function topMargin(): number {
	return editorViewState.headerHeight + editorViewState.tabBarTotalHeight + 2;
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
	const maxAvailable = editorViewState.viewportHeight - statusAreaHeight() - (editorViewState.headerHeight + editorViewState.tabBarTotalHeight);
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
	getRenameBarHeight,
	getLineJumpBarHeight,
] as const;

const inlineBarLayout: InlineBarLayout = {
	codeViewportTop: 0,
	barHeight: [0, 0, 0, 0],
	barBounds: [
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
	stamp = addLayoutStamp(stamp, editorViewState.tabBarTotalHeight);
	stamp = addLayoutStamp(stamp, editorViewState.lineHeight);
	stamp = addLayoutStamp(stamp, createResourceState.visible ? 1 : 0);
	stamp = addLayoutStamp(stamp, editorSearchState.visible ? 1 : 0);
	stamp = addLayoutStamp(stamp, editorSearchState.scope === 'global' ? 2 : 1);
	stamp = addLayoutStamp(stamp, editorSearchState.matches.length);
	stamp = addLayoutStamp(stamp, editorSearchState.globalMatches.length);
	stamp = addLayoutStamp(stamp, editorSearchState.displayOffset);
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
export function getRenameBarBounds(): BarBounds | null { return getInlineBarBounds(2); }
export function getLineJumpBarBounds(): BarBounds | null { return getInlineBarBounds(3); }
