import type { PointerInputSnapshot } from '../../common/models';
import { PointerButton, type PointerInputEvent } from '../../../hosts/common/input/pointer_event';
import { prepareEditorPointerFrame } from './frame';
import { handleEditorPanelPointer, handleEditorPanelResizePointer } from './panel';
import { clearEditorPointerSelectionState, editorPointerState } from './state';
import { isCtrlDown, isMetaDown } from '../keyboard/key_input';
import { handleEditorChromePointerDispatch } from './chrome_dispatch';
import type { CartEditor } from '../../cart_editor';
import { pointerCapture, WORKBENCH_POINTER_SCOPE } from './capture';
import { pointerHover } from './hover';
import { point_in_rect } from '../../../machine/ts/common/rect';
import { inputFocus } from '../focus';
import { projectGuestPointer } from './guest';
import { DisplayPointMappingResult } from '../../../machine/ts/render/video_output';

const guestPoint = { x: 0, y: 0 };

/** One structural target owns the occurrence, or the existing gesture continues. */
export function handleTextEditorPointerInput(snapshot: PointerInputSnapshot, event: PointerInputEvent, editor: CartEditor): void {
	const now = event.timestamp;
	pointerHover.beginDispatch();
	try {
		const focused = inputFocus.target;
		if (pointerCapture.guestBinding === undefined && focused?.guestInput !== undefined && snapshot.valid && snapshot.justPressedButtons !== 0
			&& (!snapshot.insideViewport || !point_in_rect(snapshot.viewportX, snapshot.viewportY, focused.guestInput.bounds))) {
			focused.release();
		}
		editorPointerState.lastPointerSnapshot = snapshot.valid ? snapshot : null;
		const routeScope = pointerCapture.routeScope;
		const routed = routeScope === undefined ? undefined : editor.surfaces.findByScope(routeScope);
		if (routeScope !== undefined && (!snapshot.valid || routed === undefined || !editor.surfaces.isAdmitted(routed))) {
			pointerCapture.cancelScope(routeScope);
		}
		const target = pointerCapture.routeScope !== undefined ? routed
			: snapshot.valid && snapshot.insideViewport ? editor.surfaces.hitTest(snapshot.viewportX, snapshot.viewportY) : null;
		const scope = target?.captureScope ?? WORKBENCH_POINTER_SCOPE;
		if (pointerCapture.dispatch(snapshot, false, now, scope)) return;
		const gotoModifierActive = isCtrlDown(snapshot) || isMetaDown(snapshot);
		prepareEditorPointerFrame(snapshot, gotoModifierActive, target !== null && target !== undefined && target.role !== 'content');
		if (target === null || target === undefined) return;
		pointerCapture.beginRoute(scope, snapshot);
		let guest = pointerCapture.guestBinding;
		if (guest === undefined) {
			target.handlePointer?.(snapshot, now);
			// The focus press is also the first guest press. An existing UI gesture
			// cannot turn into a guest gesture by crossing a focused preview.
			const focused = inputFocus.admittedTarget;
			const binding = focused?.guestInput;
			if (routeScope === undefined && (snapshot.justPressedButtons === 0 || pointerCapture.routeScope === scope)
				&& binding !== undefined && focused!.scope.surfaceScope === scope
				&& snapshot.insideViewport && point_in_rect(snapshot.viewportX, snapshot.viewportY, binding.bounds)) {
				guest = binding;
				if (snapshot.justPressedButtons !== 0) pointerCapture.captureGuest(binding);
			}
		}
		if (guest !== undefined) {
			if (projectGuestPointer(guest, snapshot.viewportX, snapshot.viewportY, guestPoint) === DisplayPointMappingResult.Invalid) {
				pointerCapture.cancelGuest(guest);
			} else {
				guest.recipient.pointerContribution.admit(event, guestPoint.x, guestPoint.y);
			}
		}
		// A complete short click may create and release capture in this same host poll.
		if (snapshot.justReleasedButtons !== 0) pointerCapture.dispatch(snapshot, false, now, scope);
	} finally {
		pointerCapture.endRoute(snapshot);
		pointerHover.endDispatch();
	}
}

/** Ordinary workbench parts remain responsible for their own nonoverlapping controls. */
export function handleWorkbenchChromePointer(editor: CartEditor, snapshot: PointerInputSnapshot): void {
	const justPressed = (snapshot.justPressedButtons & PointerButton.Primary) !== 0;
	if (editor.menubar.handlePointer(snapshot)) {
		clearEditorPointerSelectionState();
		return;
	}
	if (handleEditorChromePointerDispatch(editor, snapshot, justPressed)) return;
	handleEditorPanelPointer(editor.resourcePanel, editor.editorGroup, snapshot, justPressed,
		(snapshot.justReleasedButtons & PointerButton.Primary) !== 0);
}

/** The selected pane receives only occurrences admitted by its retained surface. */
export function handleWorkbenchPanePointer(editor: CartEditor, snapshot: PointerInputSnapshot, now: number): void {
	// Splitter grab margins cross the layout boundary by a few pixels. Their
	// existing geometry owner admits that part of the pane's content route too.
	if (handleEditorPanelResizePointer(editor.resourcePanel, snapshot, (snapshot.justPressedButtons & PointerButton.Primary) !== 0)) return;
	editor.editorGroup.panes.activePane?.handlePointer(snapshot,
		(snapshot.justPressedButtons & PointerButton.Primary) !== 0,
		(snapshot.justPressedButtons & PointerButton.Secondary) !== 0,
		now, isCtrlDown(snapshot) || isMetaDown(snapshot));
}
