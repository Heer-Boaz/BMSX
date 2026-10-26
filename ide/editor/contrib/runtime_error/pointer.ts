import { pointerHover, type PointerHoverTarget } from '../../../input/pointer/hover';
import { point_in_rect } from '../../../../machine/ts/common/rect';
import * as constants from '../../../common/constants';
import { computeRuntimeErrorOverlayMaxWidth } from '../../common/text/layout';
import type { PointerSnapshot } from '../../../common/models';
import type { CodeEditorControl } from '../../ui/code_editor_control';
import {
	computeRuntimeErrorOverlayGeometry,
	computeRuntimeErrorOverlayLayout,
	findRuntimeErrorOverlayLineAtPosition,
	resolveRuntimeErrorOverlayAnchor,
} from '../../render/error_overlay';

export const RUNTIME_ERROR_OVERLAY_POINTER_NONE = 0;
export const RUNTIME_ERROR_OVERLAY_POINTER_OUTSIDE = 1;
export const RUNTIME_ERROR_OVERLAY_POINTER_BODY = 2;
export const RUNTIME_ERROR_OVERLAY_POINTER_COPY_BUTTON = 3;

export function updateRuntimeErrorOverlayPointerHover(
	code: CodeEditorControl,
	snapshot: PointerSnapshot,
	codeTop: number,
	codeRight: number,
	textLeft: number,
	contentBottom: number
): number {
	const overlay = code.runtimeError.activeOverlay;
	if (!overlay || overlay.hidden) {
		pointerHover.release(code.runtimeErrorPointer);
		return RUNTIME_ERROR_OVERLAY_POINTER_NONE;
	}
	const geometry = computeRuntimeErrorOverlayGeometry(code, codeRight, textLeft, contentBottom);
	const anchor = resolveRuntimeErrorOverlayAnchor(code, overlay, codeTop, textLeft, geometry.contentRight, geometry.availableBottom);
	if (!anchor) {
		overlay.layout = null;
		pointerHover.release(code.runtimeErrorPointer);
		return RUNTIME_ERROR_OVERLAY_POINTER_NONE;
	}
	const layout = computeRuntimeErrorOverlayLayout(code,
		overlay,
		anchor,
		codeTop,
		geometry.contentRight,
		textLeft,
		constants.ERROR_OVERLAY_PADDING_X,
		constants.ERROR_OVERLAY_PADDING_Y,
		computeRuntimeErrorOverlayMaxWidth(code)
	);
	if (!layout) {
		overlay.layout = null;
		pointerHover.release(code.runtimeErrorPointer);
		return RUNTIME_ERROR_OVERLAY_POINTER_NONE;
	}
	if (!snapshot.valid || !snapshot.insideViewport) {
		pointerHover.release(code.runtimeErrorPointer);
		return RUNTIME_ERROR_OVERLAY_POINTER_NONE;
	}
	if (!point_in_rect(snapshot.viewportX, snapshot.viewportY, layout.bounds)) {
		pointerHover.release(code.runtimeErrorPointer);
		return RUNTIME_ERROR_OVERLAY_POINTER_OUTSIDE;
	}
	pointerHover.visit(code.runtimeErrorPointer);
	overlay.hovered = true;
	overlay.copyButtonHovered = point_in_rect(snapshot.viewportX, snapshot.viewportY, layout.copyButtonRect);
	if (overlay.copyButtonHovered) {
		overlay.hoverLine = -1;
		return RUNTIME_ERROR_OVERLAY_POINTER_COPY_BUTTON;
	}
	overlay.hoverLine = findRuntimeErrorOverlayLineAtPosition(overlay, snapshot.viewportX, snapshot.viewportY);
	return RUNTIME_ERROR_OVERLAY_POINTER_BODY;
}

export class RuntimeErrorOverlayPointer implements PointerHoverTarget {
	public constructor(private readonly code: CodeEditorControl) {}
	public onPointerLeave(): void {
		const overlay = this.code.runtimeError.activeOverlay;
		overlay.hovered = false;
		overlay.hoverLine = -1;
		overlay.copyButtonHovered = false;
	}
}
