import * as constants from '../../../common/constants';
import type { PointerSnapshot } from '../../../common/models';
import type { EditorTabId } from './id';
import { point_in_rect } from '../../../../machine/ts/common/rect';
import { pointerCapture, type PointerCaptureTarget } from '../../../input/pointer/capture';
import { PointerButton } from '../../../input/pointer/buttons';
import { editorChromeState } from '../chrome_state';
import { resetPointerClickTracking } from '../../../input/pointer/state';
import { dragScrollSpeed } from '../drag_scroll';
import { editorTabGroup } from './group_model';

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
		hasDragged: false, pointerTime: now, revision: editorTabGroup.revision,
		targetIndex: -1, markerX: 0,
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
	}
	const elapsed = (now - state.pointerTime) / 1000;
	state.pointerTime = now;
	state.targetIndex = -1;
	if (!point_in_rect(x, y, editorChromeState.tabBarBounds)) return;
	const tabs = editorTabGroup.tabs;
	const scrollbar = editorChromeState.tabScrollbar;
	// Hit the last published geometry; scrolling is applied after finding this drop target.
	let insertion = 0;
	for (const tab of tabs) {
		const bounds = editorChromeState.tabButtonBounds.get(tab.id)!;
		if (x < (bounds.left + bounds.right) / 2) break;
		insertion += 1;
	}
	const from = editorTabGroup.indexOf(editorTabGroup.findById(state.tabId)!);
	const to = insertion > from ? insertion - 1 : insertion;
	if (to !== from) {
		const bounds = editorChromeState.tabButtonBounds.get(tabs[insertion === tabs.length ? insertion - 1 : insertion].id)!;
		state.markerX = (insertion === tabs.length ? bounds.right : bounds.left) + Math.round(scrollbar.getScroll());
		state.targetIndex = to;
	}
	if (scroll) scrollbar.setScroll(scrollbar.getScroll() + dragScrollSpeed(x, 0, editorChromeState.tabBarBounds.right) * elapsed);
}

export function endTabDrag(): void {
	pointerCapture.release(dragCapture);
	editorChromeState.tabDragState = null;
}
