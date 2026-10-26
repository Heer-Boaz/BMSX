import { create_rect_bounds, write_rect_bounds, type RectBounds } from '../../../machine/ts/common/rect';
import { measureText, writeWrappedOverlayLine } from '../../editor/common/text/layout';
import { editorViewState } from '../../editor/ui/view/state';
import { editorFeedbackState } from '../../common/feedback_state';
import { problemsPanel } from '../contrib/problems/panel/controller';
import { editorChromeState } from '../ui/chrome_state';
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

export function refreshWorkbenchLayout(): boolean {
	const left = editorViewState.editorAreaLeft, top = topMargin();
	const right = Math.max(left, editorViewState.viewportWidth - editorChromeState.editorRightInset);
	const bottom = Math.max(top, editorViewState.viewportHeight - bottomMargin());
	editorViewState.editorAreaTop = top;
	editorViewState.editorAreaBottom = bottom;
	const workBottom = Math.max(top, editorViewState.viewportHeight - statusAreaHeight());
	const workChanged = workArea.top !== top || workArea.right !== editorViewState.viewportWidth || workArea.bottom !== workBottom;
	write_rect_bounds(workArea, 0, top, editorViewState.viewportWidth, workBottom);
	const changed = workChanged || editorBounds.left !== left || editorBounds.top !== top || editorBounds.right !== right || editorBounds.bottom !== bottom;
	write_rect_bounds(editorBounds, left, top, right, bottom);
	return changed;
}
