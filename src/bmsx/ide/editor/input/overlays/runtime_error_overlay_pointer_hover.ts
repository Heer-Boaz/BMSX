import { point_in_rect } from '../../../../common/rect_operations';
import * as constants from '../../../common/constants';
import { computeRuntimeErrorOverlayMaxWidth } from '../../common/text_layout';
import type { PointerSnapshot, RuntimeErrorOverlay } from '../../../common/types';
import { runtimeErrorState } from '../../contrib/runtime_error/runtime_error_state';
import {
	computeRuntimeErrorOverlayGeometry,
	computeRuntimeErrorOverlayLayout,
	findRuntimeErrorOverlayLineAtPosition,
	resolveRuntimeErrorOverlayAnchor,
} from '../../render/render_error_overlay';

export const RUNTIME_ERROR_OVERLAY_POINTER_NONE = 0;
export const RUNTIME_ERROR_OVERLAY_POINTER_OUTSIDE = 1;
export const RUNTIME_ERROR_OVERLAY_POINTER_BODY = 2;
export const RUNTIME_ERROR_OVERLAY_POINTER_COPY_BUTTON = 3;

export function updateRuntimeErrorOverlayPointerHover(
	snapshot: PointerSnapshot,
	codeTop: number,
	codeRight: number,
	textLeft: number
): number {
	const overlay = runtimeErrorState.activeOverlay;
	if (!overlay || overlay.hidden) {
		return RUNTIME_ERROR_OVERLAY_POINTER_NONE;
	}
	const geometry = computeRuntimeErrorOverlayGeometry(codeRight, textLeft);
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
