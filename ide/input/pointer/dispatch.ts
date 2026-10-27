import type { PointerInputSnapshot } from '../../common/models';
import { PointerButton, type PointerInputEvent } from '../../../hosts/common/input/pointer_event';
import { handleEditorPanelPointer } from './panel';
import { handleEditorChromePointerDispatch } from './chrome_dispatch';
import type { CartEditor } from '../../cart_editor';
import type { WorkbenchSurfaceService } from '../../workbench/services/windows/service';
import { pointerCapture, WORKBENCH_POINTER_SCOPE } from './capture';
import { pointerHover } from './hover';
import { point_in_rect } from '../../../machine/ts/common/rect';
import { inputFocus } from '../focus';
import { projectGuestPointer } from './guest';
import { DisplayPointMappingResult } from '../../../machine/ts/render/video_output';

const guestPoint = { x: 0, y: 0 };

/** One structural target owns the occurrence, or the existing gesture continues. */
export function handleTextEditorPointerInput(snapshot: PointerInputSnapshot, event: PointerInputEvent, surfaces: WorkbenchSurfaceService): void {
	const now = event.timestamp;
	const focused = inputFocus.target;
	if (pointerCapture.guestBinding === undefined && focused?.guestInput !== undefined && snapshot.valid && snapshot.justPressedButtons !== 0
		&& (!snapshot.insideViewport || !point_in_rect(snapshot.viewportX, snapshot.viewportY, focused.guestInput.bounds))) {
		focused.release();
	}
	const routeScope = pointerCapture.routeScope;
	const routed = routeScope === undefined ? undefined : surfaces.findByScope(routeScope);
	if (routeScope !== undefined && (!snapshot.valid || routed === undefined || !surfaces.isAdmitted(routed))) {
		pointerCapture.cancelScope(routeScope);
	}
	const target = pointerCapture.routeScope !== undefined ? routed
		: snapshot.valid && snapshot.insideViewport ? surfaces.hitTest(snapshot.viewportX, snapshot.viewportY) : null;
	const scope = target?.captureScope ?? WORKBENCH_POINTER_SCOPE;
	pointerHover.beginDispatch(target?.captureScope);
	try {
		if (pointerCapture.dispatch(snapshot, false, now, scope)) return;
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
		return;
	}
	if (handleEditorChromePointerDispatch(editor, snapshot, justPressed)) return;
	handleEditorPanelPointer(editor.resourcePanel, editor.editorParts, snapshot, justPressed,
		(snapshot.justReleasedButtons & PointerButton.Primary) !== 0);
}
