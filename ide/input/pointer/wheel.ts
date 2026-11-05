import type { CartEditor } from '../../cart_editor';
import type { WorkbenchSurfaceService } from '../../workbench/services/windows/service';
import type { WorkbenchSurface } from '../../workbench/services/windows/model';
import { point_in_rect } from '../../../machine/ts/common/rect';
import type { ResourcePanelController } from '../../workbench/contrib/resources/panel/controller';
import type { WheelInputSnapshot } from '../../common/models';
import { isShiftDown } from '../keyboard/key_input';
import { editorViewState } from '../../editor/ui/view/state';
import { inputFocus } from '../focus';
import type { WheelInputEvent } from '../../../hosts/common/input/pointer_event';
import { projectGuestPointer } from './guest';
import { DisplayPointMappingResult } from '../../../machine/ts/render/video_output';
import { pointerCapture } from './capture';

const guestPoint = { x: 0, y: 0 };

/** Pointer and wheel use the same retained paint/target structure. */
export function handleEditorWheelInput(surfaces: WorkbenchSurfaceService, event: WheelInputSnapshot, native: WheelInputEvent): boolean {
	if (!event.valid || event.deltaX === 0 && event.deltaY === 0) return true;
	if (pointerCapture.dispatchWheel(event, native.timestamp) || !event.insideViewport) return true;
	const surface = surfaces.hitTest(event.viewportX, event.viewportY);
	if (surface === null) return true;
	// Guest admission is an explicit focused viewport binding, never the meaning
	// of an unhandled UI event. Ancestor routing cannot discover another guest.
	const focused = inputFocus.admittedTarget;
	const guest = focused?.guestInput;
	if (guest !== undefined && focused!.scope.surfaceScope === surface.captureScope
		&& projectGuestPointer(guest, event.viewportX, event.viewportY, guestPoint) === DisplayPointMappingResult.Inside) {
		guest.recipient.pointerContribution.admitWheel(guestPoint.x, guestPoint.y, native.attachmentDeltaY);
		return true;
	}
	// Bubble only through the hit surface's presentation ancestry. A window or
	// popup is an input boundary; an unhandled wheel never hits a sibling behind it.
	for (let current: WorkbenchSurface | null | undefined = surface; current != null;) {
		const parent = current.presentationParent;
		if (current.handleWheel?.(event)) break;
		if (!current.published || current.presentationParent !== parent) break;
		switch (current.role) {
			case 'window': case 'modal': case 'transient': return true;
		}
		current = parent;
	}
	return true;
}

export function handleWorkbenchChromeWheel(editor: CartEditor, event: WheelInputSnapshot): boolean {
	return handleResourcePanelWheel(editor.resourcePanel, event);
}

function handleResourcePanelWheel(resourcePanel: ResourcePanelController, event: WheelInputSnapshot): boolean {
	const bounds = resourcePanel.getBounds();
	if (!resourcePanel.isVisible() || bounds === null || !point_in_rect(event.viewportX, event.viewportY, bounds)) return false;
	const horizontal = isShiftDown(event) && event.deltaX === 0;
	const deltaX = horizontal ? event.deltaY : event.deltaX;
	const deltaY = horizontal ? 0 : event.deltaY;
	const scrollLeft = resourcePanel.hscroll, scrollTop = resourcePanel.scroll;
	if (deltaX !== 0) resourcePanel.setHScroll(resourcePanel.hscroll + deltaX * editorViewState.charAdvance * 4);
	if (deltaY !== 0) resourcePanel.setScroll(resourcePanel.scroll + deltaY);
	return scrollLeft !== resourcePanel.hscroll || scrollTop !== resourcePanel.scroll;
}
