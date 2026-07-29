import { point_in_rect } from '../../../../../../../../machine/ts/common/rect';
import * as constants from '../../../../../../../common/constants';
import { computeRuntimeErrorOverlayMaxWidth } from '../../../../../../../editor/common/text/layout';
import type { PointerSnapshot } from '../../../../../../../common/models';
import type { RuntimeErrorOverlay } from '../../../../../../../editor/contrib/runtime_error/model';
import { runtimeErrorState } from '../../../../../../../editor/contrib/runtime_error/state';
import {
	computeRuntimeErrorOverlayGeometry,
	computeRuntimeErrorOverlayLayout,
	findRuntimeErrorOverlayLineAtPosition,
	resolveRuntimeErrorOverlayAnchor,
} from '../../../../../../../editor/render/error_overlay';

export const RUNTIME_ERROR_OVERLAY_POINTER_NONE = 0;
export const RUNTIME_ERROR_OVERLAY_POINTER_OUTSIDE = 1;
export const RUNTIME_ERROR_OVERLAY_POINTER_BODY = 2;
export const RUNTIME_ERROR_OVERLAY_POINTER_COPY_BUTTON = 3;

export function updateRuntimeErrorOverlayPointerHover(
	snapshot: PointerSnapshot,
	codeTop: number,
	codeRight: number,
	textLeft: number,
	contentBottom: number
): number {
	const overlay = runtimeErrorState.activeOverlay;
	if (!overlay || overlay.hidden) {
		return RUNTIME_ERROR_OVERLAY_POINTER_NONE;
	}
	const geometry = computeRuntimeErrorOverlayGeometry(codeRight, textLeft, contentBottom);
	const anchor = resolveRuntimeErrorOverlayAnchor(overlay, codeTop, textLeft, geometry.contentRight, geometry.availableBottom);
	if (!anchor) {
		overlay.layout = null;
		clearRuntimeErrorOverlayPointerHoverState(overlay);
		return RUNTIME_ERROR_OVERLAY_POINTER_NONE;
	}
	const layout = computeRuntimeErrorOverlayLayout(
		overlay,
		anchor,
		codeTop,
		geometry.contentRight,
		textLeft,
		constants.ERROR_OVERLAY_PADDING_X,
		constants.ERROR_OVERLAY_PADDING_Y,
		computeRuntimeErrorOverlayMaxWidth()
	);
	if (!layout) {
		overlay.layout = null;
		clearRuntimeErrorOverlayPointerHoverState(overlay);
		return RUNTIME_ERROR_OVERLAY_POINTER_NONE;
	}
	if (!snapshot.valid || !snapshot.insideViewport) {
		clearRuntimeErrorOverlayPointerHoverState(overlay);
		return RUNTIME_ERROR_OVERLAY_POINTER_NONE;
	}
	if (!point_in_rect(snapshot.viewportX, snapshot.viewportY, layout.bounds)) {
		clearRuntimeErrorOverlayPointerHoverState(overlay);
		return RUNTIME_ERROR_OVERLAY_POINTER_OUTSIDE;
	}
	overlay.hovered = true;
	overlay.copyButtonHovered = point_in_rect(snapshot.viewportX, snapshot.viewportY, layout.copyButtonRect);
	if (overlay.copyButtonHovered) {
		overlay.hoverLine = -1;
		return RUNTIME_ERROR_OVERLAY_POINTER_COPY_BUTTON;
	}
	overlay.hoverLine = findRuntimeErrorOverlayLineAtPosition(overlay, snapshot.viewportX, snapshot.viewportY);
	return RUNTIME_ERROR_OVERLAY_POINTER_BODY;
}

function clearRuntimeErrorOverlayPointerHoverState(overlay: RuntimeErrorOverlay): void {
	overlay.hovered = false;
	overlay.hoverLine = -1;
	overlay.copyButtonHovered = false;
}
