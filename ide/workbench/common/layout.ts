import { create_rect_bounds, write_rect_bounds, type RectBounds } from '../../../machine/ts/common/rect';
import { measureText, writeWrappedOverlayLine } from '../../editor/common/text/layout';
import { editorViewState } from '../../editor/ui/view/state';
import { editorFeedbackState } from '../../common/feedback_state';
import { problemsPanel } from '../contrib/problems/panel/controller';
import { editorChromeState } from '../ui/chrome_state';
import * as constants from '../../common/constants';
import { editorSearchState, lineJumpState } from '../contrib/code_editor/find/widget_state';
import { renameController } from '../contrib/code_editor/rename/controller';
import type { EditorFont } from '../../editor/ui/view/font';

const editorBounds = create_rect_bounds();
const workArea = create_rect_bounds();
const statusBounds = create_rect_bounds();
const connectionBounds = create_rect_bounds();
export const STATUS_BAR_CONNECTION_WIDTH = 14;
export const HOST_FAILURE_STATUS = 'HOST ERROR |';
const GUEST_FOCUS_HINTS = ['SHIFT+F1: RELEASE INPUT', 'SHIFT+F1: STUDIO', 'SHIFT+F1'] as const;
const guestFocusHintWidths = [0, 0, 0];
const statusLayout = {
	bounds: statusBounds,
	connection: connectionBounds,
	message: create_rect_bounds(),
	context: create_rect_bounds(),
	hostFault: create_rect_bounds(),
	guestHint: create_rect_bounds(),
	guestHintText: '',
};
let statusLayoutFont: EditorFont | undefined;
let statusLayoutGuestInput = false, statusLayoutHostFailed = false;
let hostFailureWidth = 0;

export type WorkbenchStatusLayout = {
	readonly bounds: Readonly<RectBounds>;
	readonly connection: Readonly<RectBounds>;
	readonly message: Readonly<RectBounds>;
	readonly context: Readonly<RectBounds>;
	readonly hostFault: Readonly<RectBounds>;
	readonly guestHint: Readonly<RectBounds>;
	readonly guestHintText: string;
};

export type WorkbenchChromeLayout = {
	readonly viewportWidth: number;
	readonly lineHeight: number;
	readonly tabBarHeight: number;
	measureText(text: string): number;
};

/** Content geometry belongs to the workbench; a text gutter is a code-pane detail. */
export function getWorkbenchEditorBounds(): Readonly<RectBounds> { return editorBounds; }

/** Stable layout-owned work area: root windows may cover panels, never header/status chrome. */
export function getWorkbenchWorkArea(): Readonly<RectBounds> { return workArea; }

/** Permanent connection chrome has its own slot, independent of the active editor or feedback. */
export function getWorkbenchStatusBounds(): RectBounds {
	write_rect_bounds(statusBounds, STATUS_BAR_CONNECTION_WIDTH, editorViewState.viewportHeight - statusAreaHeight(),
		editorViewState.viewportWidth, editorViewState.viewportHeight);
	return statusBounds;
}

/** The permanent connection control stays on the context row, below any feedback. */
export function getWorkbenchConnectionBounds(): Readonly<RectBounds> {
	write_rect_bounds(connectionBounds, 0, editorViewState.viewportHeight - editorViewState.baseBottomMargin,
		STATUS_BAR_CONNECTION_WIDTH, editorViewState.viewportHeight);
	return connectionBounds;
}

/** Feedback keeps its full-width rows; context and release guidance share the existing bottom row. */
export function getWorkbenchStatusLayout(guestInput: boolean, hostFailed: boolean): WorkbenchStatusLayout {
	const bounds = getWorkbenchStatusBounds(), rowTop = getWorkbenchConnectionBounds().top;
	const font = editorViewState.font;
	if (statusLayoutFont === font && statusLayoutGuestInput === guestInput && statusLayoutHostFailed === hostFailed
		&& statusLayout.message.left === bounds.left && statusLayout.message.right === bounds.right
		&& statusLayout.message.top === bounds.top && statusLayout.context.top === rowTop
		&& statusLayout.context.bottom === bounds.bottom) return statusLayout;
	if (statusLayoutFont !== font) {
		for (let index = 0; index < GUEST_FOCUS_HINTS.length; index++) guestFocusHintWidths[index] = measureText(GUEST_FOCUS_HINTS[index]) + 8;
		hostFailureWidth = measureText(HOST_FAILURE_STATUS) + 8;
		statusLayoutFont = font;
	}
	statusLayoutGuestInput = guestInput; statusLayoutHostFailed = hostFailed;
	const contextLeft = hostFailed ? Math.min(bounds.right, bounds.left + hostFailureWidth) : bounds.left;
	let hintWidth = 0;
	statusLayout.guestHintText = '';
	if (guestInput) {
		const available = bounds.right - contextLeft, minimumContext = editorViewState.charAdvance * 8 + 8;
		for (let index = 0; index < GUEST_FOCUS_HINTS.length; index++) {
			const width = guestFocusHintWidths[index];
			if (width + minimumContext <= available || index === GUEST_FOCUS_HINTS.length - 1 && width <= available) {
				hintWidth = width; statusLayout.guestHintText = GUEST_FOCUS_HINTS[index];
				break;
			}
		}
	}
	write_rect_bounds(statusLayout.message, bounds.left, bounds.top, bounds.right, rowTop);
	write_rect_bounds(statusLayout.hostFault, bounds.left, rowTop, contextLeft, bounds.bottom);
	write_rect_bounds(statusLayout.context, contextLeft, rowTop, bounds.right - hintWidth, bounds.bottom);
	write_rect_bounds(statusLayout.guestHint, bounds.right - hintWidth, rowTop, bounds.right, bounds.bottom);
	return statusLayout;
}

export type FullWidthWorkbenchLayout = {
	left: number;
	top: number;
	right: number;
	bottom: number;
	rowHeight: number;
	font: EditorFont | null;
};

/** Writes shared full-width editor-input geometry only when its owner metrics advance. */
export function updateFullWidthWorkbenchLayout(layout: FullWidthWorkbenchLayout, bounds: Readonly<RectBounds>): boolean {
	const changed = layout.left !== bounds.left || layout.top !== bounds.top
		|| layout.right !== bounds.right || layout.bottom !== bounds.bottom
		|| layout.font !== editorViewState.font
		|| layout.rowHeight !== editorViewState.lineHeight;
	if (!changed) return false;
	layout.left = bounds.left;
	layout.top = bounds.top;
	layout.right = bounds.right;
	layout.bottom = bounds.bottom;
	layout.rowHeight = editorViewState.lineHeight;
	layout.font = editorViewState.font;
	return true;
}

const statusMessageLines: string[] = [];
let statusMessageCachedVisible = false;
let statusMessageCachedText = '';
let statusMessageCachedMaxWidth = -1;
let statusMessageCachedFont: EditorFont | undefined;

export function topMargin(): number {
	return editorChromeState.menuBarHeight + editorViewState.tabBarTotalHeight + 2;
}

export function getStatusMessageLines(): string[] {
	writeStatusMessageLines();
	return statusMessageLines;
}

function writeStatusMessageLines(): void {
	const message = editorFeedbackState.message;
	const maxWidthCandidate = editorViewState.viewportWidth - STATUS_BAR_CONNECTION_WIDTH - 8;
	const maxWidth = maxWidthCandidate > editorViewState.charAdvance ? maxWidthCandidate : editorViewState.charAdvance;
	if (
		message.visible === statusMessageCachedVisible
		&& message.text === statusMessageCachedText
		&& maxWidth === statusMessageCachedMaxWidth
		&& editorViewState.font === statusMessageCachedFont
	) {
		return;
	}

	statusMessageCachedVisible = message.visible;
	statusMessageCachedText = message.text;
	statusMessageCachedMaxWidth = maxWidth;
	statusMessageCachedFont = editorViewState.font;
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
	const maxAvailable = editorViewState.viewportHeight - statusAreaHeight() - (editorChromeState.menuBarHeight + editorViewState.tabBarTotalHeight);
	if (maxAvailable <= 0) {
		return 0;
	}
	return planned < maxAvailable ? planned : maxAvailable;
}

export function bottomMargin(): number {
	return statusAreaHeight() + getVisibleProblemsPanelHeight() + editorChromeState.runtimeTimelineHeight;
}

export function searchVisibleResultCount(): number {
	refreshWorkbenchLayout();
	return inlineBarLayout.visibleResults;
}

export function searchResultEntryHeight(): number {
	return editorViewState.lineHeight * 2;
}

export function getSearchBarHeight(): number {
	refreshWorkbenchLayout();
	return inlineBarLayout.barHeight[0];
}

export function getRenameBarHeight(): number {
	refreshWorkbenchLayout();
	return inlineBarLayout.barHeight[1];
}

export function getLineJumpBarHeight(): number {
	refreshWorkbenchLayout();
	return inlineBarLayout.barHeight[2];
}

/** Physical result rows share the same pane budget as the bars and source viewport. */
export function getSearchResultCapacity(): number {
	refreshWorkbenchLayout();
	return inlineBarLayout.resultCapacity;
}

export type BarBounds = { top: number; bottom: number; left: number; right: number };

type InlineBarLayout = {
	left: number;
	top: number;
	right: number;
	bottom: number;
	lineHeight: number;
	searchVisible: boolean;
	renameVisible: boolean;
	lineJumpVisible: boolean;
	resultCount: number;
	resultCapacity: number;
	visibleResults: number;
	codeViewportTop: number;
	barHeight: number[];
	barBounds: BarBounds[];
};

const inlineBarLayout: InlineBarLayout = {
	left: 0, top: 0, right: 0, bottom: 0, lineHeight: 0,
	searchVisible: false, renameVisible: false, lineJumpVisible: false,
	resultCount: 0, resultCapacity: 0, visibleResults: 0,
	codeViewportTop: 0,
	barHeight: [0, 0, 0],
	barBounds: [
		create_rect_bounds(),
		create_rect_bounds(),
		create_rect_bounds(),
	],
};

let inlineBarLayoutValid = false;

function writeInlineBarLayout(left: number, top: number, right: number, bottom: number): boolean {
	const lineHeight = editorViewState.lineHeight;
	const searchVisible = editorSearchState.visible, renameVisible = renameController.isVisible(), lineJumpVisible = lineJumpState.visible;
	const resultCount = searchVisible
		? (editorSearchState.scope === 'global' ? editorSearchState.globalMatches.length : editorSearchState.matches.length)
		: 0;
	if (inlineBarLayoutValid && inlineBarLayout.left === left && inlineBarLayout.top === top
		&& inlineBarLayout.right === right && inlineBarLayout.bottom === bottom && inlineBarLayout.lineHeight === lineHeight
		&& inlineBarLayout.searchVisible === searchVisible && inlineBarLayout.renameVisible === renameVisible
		&& inlineBarLayout.lineJumpVisible === lineJumpVisible && inlineBarLayout.resultCount === resultCount) {
		return false;
	}
	inlineBarLayoutValid = true;
	inlineBarLayout.left = left; inlineBarLayout.top = top; inlineBarLayout.right = right; inlineBarLayout.bottom = bottom;
	inlineBarLayout.lineHeight = lineHeight;
	inlineBarLayout.searchVisible = searchVisible; inlineBarLayout.renameVisible = renameVisible; inlineBarLayout.lineJumpVisible = lineJumpVisible;
	inlineBarLayout.resultCount = resultCount;
	const searchFieldHeight = searchVisible ? lineHeight + constants.SEARCH_BAR_MARGIN_Y * 2 : 0;
	const renameHeight = renameVisible ? lineHeight + constants.SEARCH_BAR_MARGIN_Y * 2 : 0;
	const lineJumpHeight = lineJumpVisible ? lineHeight + constants.LINE_JUMP_BAR_MARGIN_Y * 2 : 0;
	const resultSpace = bottom - top - searchFieldHeight - renameHeight - lineJumpHeight
		- constants.SEARCH_RESULT_SPACING - lineHeight * 6;
	inlineBarLayout.resultCapacity = searchVisible
		? Math.max(0, Math.min(constants.GLOBAL_SEARCH_RESULT_LIMIT, Math.trunc(resultSpace / searchResultEntryHeight())))
		: 0;
	const visibleResults = Math.min(resultCount, inlineBarLayout.resultCapacity);
	inlineBarLayout.visibleResults = visibleResults;
	const searchHeight = searchFieldHeight + (visibleResults > 0 ? constants.SEARCH_RESULT_SPACING + visibleResults * searchResultEntryHeight() : 0);
	let changed = false;
	for (let index = 0; index < inlineBarLayout.barBounds.length; index += 1) {
		const desiredHeight = index === 0 ? searchHeight : index === 1 ? renameHeight : lineJumpHeight;
		const height = Math.min(desiredHeight, bottom - top);
		const bounds = inlineBarLayout.barBounds[index];
		changed ||= bounds.left !== left || bounds.top !== top || bounds.right !== right || bounds.bottom !== top + height;
		inlineBarLayout.barHeight[index] = height;
		write_rect_bounds(bounds, left, top, right, top + height);
		top = bounds.bottom;
	}
	inlineBarLayout.codeViewportTop = top;
	return changed;
}

export function refreshWorkbenchLayout(): boolean {
	const left = editorViewState.codeAreaLeft, top = topMargin();
	const right = Math.max(left, editorViewState.viewportWidth - editorChromeState.editorRightInset);
	const bottom = Math.max(top, editorViewState.viewportHeight - bottomMargin());
	const barsChanged = writeInlineBarLayout(left, top, right, bottom);
	editorViewState.codeAreaTop = inlineBarLayout.codeViewportTop;
	editorViewState.codeAreaBottom = bottom;
	const workBottom = Math.max(top, editorViewState.viewportHeight - statusAreaHeight());
	const workChanged = workArea.top !== top || workArea.right !== editorViewState.viewportWidth || workArea.bottom !== workBottom;
	write_rect_bounds(workArea, 0, top, editorViewState.viewportWidth, workBottom);
	const changed = barsChanged || workChanged || editorBounds.left !== left || editorBounds.top !== top || editorBounds.right !== right || editorBounds.bottom !== bottom;
	write_rect_bounds(editorBounds, left, top, right, bottom);
	return changed;
}

function getInlineBarBounds(barIndex: number): BarBounds | null {
	refreshWorkbenchLayout();
	if (inlineBarLayout.barHeight[barIndex] === 0 || inlineBarLayout.left === inlineBarLayout.right) {
		return null;
	}
	return inlineBarLayout.barBounds[barIndex];
}

export function getSearchBarBounds(): BarBounds | null { return getInlineBarBounds(0); }
export function getRenameBarBounds(): BarBounds | null { return getInlineBarBounds(1); }
export function getLineJumpBarBounds(): BarBounds | null { return getInlineBarBounds(2); }
