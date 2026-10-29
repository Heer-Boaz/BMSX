import { create_rect_bounds, write_rect_bounds, type RectBounds } from '../../../machine/ts/common/rect';
import { measureText } from '../../editor/common/text/layout';
import { editorViewState } from '../../editor/ui/view/state';
import { RESOURCE_PANEL_DIVIDER_DRAG_MARGIN } from '../../common/constants';
import { editorChromeState } from '../ui/chrome_state';
import type { EditorFont } from '../../editor/ui/view/font';

/** A view supplies readable content constraints; its container owns placement and overflow. */
export type WorkbenchViewSizeConstraints = { minimumWidth: number; preferredWidth: number; minimumHeight: number };

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
	context: create_rect_bounds(),
	hostFault: create_rect_bounds(),
	guestHint: create_rect_bounds(),
	guestHintText: '',
	windowRestore: create_rect_bounds(),
};
let statusLayoutFont: EditorFont | undefined;
let statusLayoutGuestInput = false, statusLayoutHostFailed = false;
let hostFailureWidth = 0, statusWindowWidth = 0, statusLayoutWidth = -1, statusLayoutTop = -1;

export type WorkbenchStatusLayout = {
	readonly bounds: Readonly<RectBounds>;
	readonly connection: Readonly<RectBounds>;
	readonly context: Readonly<RectBounds>;
	readonly hostFault: Readonly<RectBounds>;
	readonly guestHint: Readonly<RectBounds>;
	readonly guestHintText: string;
	readonly windowRestore: Readonly<RectBounds>;
};

export type WorkbenchChromeLayout = {
	readonly viewportWidth: number;
	readonly lineHeight: number;
	readonly tabBarHeight: number;
	measureText(text: string): number;
};

/** Content geometry belongs to the workbench; a text gutter is a code-pane detail. */
export function getWorkbenchEditorBounds(): Readonly<RectBounds> { return editorBounds; }

/** Outer window/popup placement excludes reserved navigation and menu/status, not Main's temporary clients. */
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

/** One shell row reserves navigation and safety guidance independently of the current status source. */
export function getWorkbenchStatusLayout(guestInput: boolean, hostFailed: boolean, windowWidth = 0): WorkbenchStatusLayout {
	const bounds = getWorkbenchStatusBounds(), rowTop = getWorkbenchConnectionBounds().top;
	const font = editorViewState.font;
	if (statusLayoutFont === font && statusLayoutGuestInput === guestInput && statusLayoutHostFailed === hostFailed && statusWindowWidth === windowWidth
		&& statusLayoutWidth === bounds.right && statusLayoutTop === rowTop
		&& statusLayout.context.bottom === bounds.bottom) return statusLayout;
	if (statusLayoutFont !== font) {
		for (let index = 0; index < GUEST_FOCUS_HINTS.length; index++) guestFocusHintWidths[index] = measureText(GUEST_FOCUS_HINTS[index]) + 8;
		hostFailureWidth = measureText(HOST_FAILURE_STATUS) + 8;
		statusLayoutFont = font;
	}
	statusLayoutWidth = bounds.right; statusLayoutTop = rowTop;
	statusLayoutGuestInput = guestInput; statusLayoutHostFailed = hostFailed; statusWindowWidth = windowWidth;
	const windowLeft = hostFailed ? Math.min(bounds.right, bounds.left + hostFailureWidth) : bounds.left;
	const contextLeft = Math.min(bounds.right, windowLeft + windowWidth);
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
	write_rect_bounds(statusLayout.hostFault, bounds.left, rowTop, windowLeft, bounds.bottom);
	write_rect_bounds(statusLayout.windowRestore, windowLeft, rowTop, contextLeft, bounds.bottom);
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

export function topMargin(): number {
	return Math.max(editorChromeState.menuBarHeight, editorChromeState.menuButtonBounds.bottom) + 2;
}

/** Transient feedback is status content, not another workbench inset. */
export function statusAreaHeight(): number { return editorViewState.baseBottomMargin; }

/** Root chrome excludes only permanent status; temporary clients allocate inside Main. */
export function bottomMargin(): number { return statusAreaHeight(); }

export function refreshWorkbenchLayout(): boolean {
	const inset = editorViewState.editorAreaLeft;
	const left = inset > 0 ? inset + RESOURCE_PANEL_DIVIDER_DRAG_MARGIN : 0, top = topMargin();
	const right = Math.max(left, editorViewState.viewportWidth);
	const bottom = Math.max(top, editorViewState.viewportHeight - bottomMargin());
	editorViewState.editorAreaTop = top;
	editorViewState.editorAreaBottom = bottom;
	const workRight = editorViewState.viewportWidth, workBottom = Math.max(top, editorViewState.viewportHeight - statusAreaHeight());
	const workChanged = workArea.left !== left || workArea.top !== top || workArea.right !== workRight || workArea.bottom !== workBottom;
	write_rect_bounds(workArea, left, top, workRight, workBottom);
	const changed = workChanged || editorBounds.left !== left || editorBounds.top !== top || editorBounds.right !== right || editorBounds.bottom !== bottom;
	write_rect_bounds(editorBounds, left, top, right, bottom);
	return changed;
}
