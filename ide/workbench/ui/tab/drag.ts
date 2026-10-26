import * as constants from '../../../common/constants';
import type { PointerSnapshot } from '../../../common/models';
import type { EditorTabId } from './id';
import { point_in_rect } from '../../../../machine/ts/common/rect';
import { pointerCapture, type PointerCaptureTarget } from '../../../input/pointer/capture';
import { PointerButton } from '../../../../hosts/common/input/pointer_event';
import { editorChromeState } from '../chrome_state';
import { resetPointerClickTracking } from '../../../input/pointer/state';
import { dragScrollSpeed } from '../drag_scroll';
import { editorTabGroup } from './group_model';
import { tabBarItems, tabBarLayoutRevision } from './layout';
import type { TabDragState } from './model';

const dragCapture: PointerCaptureTarget = {
	handleCapturedPointer(snapshot, now) { updateTabDrag(snapshot, now, true); },
	releaseCapturedPointer(snapshot, now) {
		updateTabDrag(snapshot, now, false);
		const state = editorChromeState.tabDragState;
		if (state === null) return; // A group change ended this gesture.
		const from = editorTabGroup.indexOf(editorTabGroup.findById(state.tabId)!);
		const to = state.targetIndex;
		endTabDrag();
		if (to >= 0) editorTabGroup.move(from, to);
	},
	cancelPointer: endTabDrag,
};

/** Tab drag is a captured gesture; the group changes order only on an accepted drop. */
export function beginTabDrag(tabId: EditorTabId, snapshot: PointerSnapshot, now: number): void {
	if (editorTabGroup.tabs.length <= 1) return;
	pointerCapture.capture(dragCapture);
	editorChromeState.tabDragState = {
		tabId, startX: snapshot.viewportX, startY: snapshot.viewportY,
		pointerX: snapshot.viewportX, pointerY: snapshot.viewportY,
		hasDragged: false, pointerTime: now, revision: editorTabGroup.revision,
		targetDirty: true, targetLayoutRevision: -1, targetScroll: 0, targetIndex: -1, markerX: 0,
	};
	if ((snapshot.justReleasedButtons & PointerButton.Primary) !== 0) dragCapture.releaseCapturedPointer(snapshot, now);
}

function updateTabDrag(snapshot: PointerSnapshot, now: number, scroll: boolean): void {
	const state = editorChromeState.tabDragState!;
	if (state.revision !== editorTabGroup.revision) { endTabDrag(); return; }
	const x = snapshot.viewportX, y = snapshot.viewportY;
	if (!state.hasDragged) {
		if (Math.max(Math.abs(x - state.startX), Math.abs(y - state.startY)) < constants.POINTER_DRAG_ACTIVATION_THRESHOLD) return;
		state.hasDragged = true;
		editorChromeState.lastTabClickId = null;
		editorTabGroup.pin(editorTabGroup.findById(state.tabId)!);
		state.revision = editorTabGroup.revision;
		state.pointerTime = now;
		resetPointerClickTracking();
	} else if (scroll) scrollTabDrag(state, now);
	state.targetDirty ||= state.pointerX !== x || state.pointerY !== y;
	state.pointerX = x; state.pointerY = y;
	updateTabDragTarget(state);
}

/** Host-time scrolling precedes layout, independently of physical pointer motion. */
export function advanceTabDrag(now: number): void {
	const state = editorChromeState.tabDragState;
	if (state === null) return;
	if (state.revision !== editorTabGroup.revision) { endTabDrag(); return; }
	if (state.hasDragged) scrollTabDrag(state, now);
}

function scrollTabDrag(state: TabDragState, now: number): void {
	const elapsed = (now - state.pointerTime) / 1000;
	state.pointerTime = now;
	const viewport = editorChromeState.tabViewportBounds;
	if (elapsed === 0 || !point_in_rect(state.pointerX, state.pointerY, viewport)) return;
	const speed = dragScrollSpeed(state.pointerX, viewport.left, viewport.right);
	if (speed === 0) return;
	const scrollbar = editorChromeState.tabScrollbar, scroll = scrollbar.getScroll();
	scrollbar.setScroll(scroll + speed * elapsed);
}

/** Consume the layout published for this frame, including viewport/font changes. */
export function refreshTabDragTarget(): void {
	const state = editorChromeState.tabDragState;
	if (state === null) return;
	if (state.revision !== editorTabGroup.revision) { endTabDrag(); return; }
	if (state.hasDragged) updateTabDragTarget(state);
}

function updateTabDragTarget(state: TabDragState): void {
	const scroll = Math.round(editorChromeState.tabScrollbar.getScroll());
	if (!state.targetDirty && state.targetLayoutRevision === tabBarLayoutRevision && state.targetScroll === scroll) return;
	state.targetDirty = false;
	state.targetLayoutRevision = tabBarLayoutRevision;
	state.targetScroll = scroll;
	state.targetIndex = -1;
	if (!point_in_rect(state.pointerX, state.pointerY, editorChromeState.tabViewportBounds)) return;
	const tabs = editorTabGroup.tabs;
	const x = state.pointerX + scroll;
	let insertion = 0;
	for (let index = 0; index < tabs.length; index++) {
		const item = tabBarItems.peek(index);
		if (x < item.contentLeft + item.tabWidth / 2) break;
		insertion += 1;
	}
	const from = editorTabGroup.indexOf(editorTabGroup.findById(state.tabId)!);
	const to = insertion > from ? insertion - 1 : insertion;
	if (to !== from) {
		const item = tabBarItems.peek(insertion === tabs.length ? insertion - 1 : insertion);
		state.markerX = item.contentLeft + (insertion === tabs.length ? item.tabWidth : 0);
		state.targetIndex = to;
	}
}

export function endTabDrag(): void {
	pointerCapture.release(dragCapture);
	editorChromeState.tabDragState = null;
}
