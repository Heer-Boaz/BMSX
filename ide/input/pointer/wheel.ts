import type { CartEditor } from '../../cart_editor';
import type { WorkbenchSurfaceService } from '../../workbench/services/windows/service';
import { point_in_rect } from '../../../machine/ts/common/rect';
import { problemsPanel, getProblemsPanelBounds } from '../../workbench/contrib/problems/panel/controller';
import type { ResourcePanelController } from '../../workbench/contrib/resources/panel/controller';
import type { WheelInputSnapshot } from '../../common/models';
import { isShiftDown } from '../keyboard/key_input';
import { editorViewState } from '../../editor/ui/view/state';
import { inputFocus } from '../focus';
import type { WheelInputEvent } from '../../../hosts/common/input/pointer_event';
import { projectGuestPointer } from './guest';
import { DisplayPointMappingResult } from '../../../machine/ts/render/video_output';

const guestPoint = { x: 0, y: 0 };

/** Pointer and wheel use the same retained paint/target structure. */
export function handleEditorWheelInput(surfaces: WorkbenchSurfaceService, event: WheelInputSnapshot, native: WheelInputEvent): boolean {
	if (!event.valid || !event.insideViewport || event.deltaX === 0 && event.deltaY === 0) return true;
	const surface = surfaces.hitTest(event.viewportX, event.viewportY);
	// A selected opaque surface owns an unhandled wheel too. Only its actual
	// controller can explicitly admit this occurrence to a guest viewport.
	if (surface?.handleWheel?.(event) !== false) return true;
	const focused = inputFocus.admittedTarget;
	const guest = focused?.guestInput;
	if (guest !== undefined && focused!.scope.surfaceScope === surface.captureScope
		&& projectGuestPointer(guest, event.viewportX, event.viewportY, guestPoint) === DisplayPointMappingResult.Inside) {
		guest.recipient.pointerContribution.admitWheel(guestPoint.x, guestPoint.y, native.attachmentDeltaY);
	}
	return true;
}

export function handleWorkbenchChromeWheel(editor: CartEditor, event: WheelInputSnapshot): boolean {
	if (handleResourcePanelWheel(editor.resourcePanel, event) || handleProblemsPanelWheel(event)) return true;
	const guest = inputFocus.admittedTarget?.guestInput;
	return guest === undefined || !point_in_rect(event.viewportX, event.viewportY, guest.bounds);
}

function handleResourcePanelWheel(resourcePanel: ResourcePanelController, event: WheelInputSnapshot): boolean {
	const bounds = resourcePanel.getBounds();
	if (!resourcePanel.isVisible() || bounds === null || !point_in_rect(event.viewportX, event.viewportY, bounds)) return false;
	const horizontal = isShiftDown(event) && event.deltaX === 0;
	const deltaX = horizontal ? event.deltaY : event.deltaX;
	const deltaY = horizontal ? 0 : event.deltaY;
	if (deltaX !== 0) resourcePanel.setHScroll(resourcePanel.hscroll + deltaX * editorViewState.charAdvance * 4);
	if (deltaY !== 0) resourcePanel.setScroll(resourcePanel.scroll + deltaY);
	return true;
}

function handleProblemsPanelWheel(event: WheelInputSnapshot): boolean {
	if (!problemsPanel.isVisible) return false;
	const bounds = getProblemsPanelBounds();
	if (bounds === null || !point_in_rect(event.viewportX, event.viewportY, bounds)) return false;
	problemsPanel.handlePointerWheel(event.deltaY, bounds);
	return true;
}
