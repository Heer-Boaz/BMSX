import { point_in_rect } from '../../../utils/rect_operations';
import * as constants from '../constants';
import { navigateToRuntimeErrorFrameTarget } from '../ide_debugger';
import { ide_state } from '../ide_state';
import { resetPointerClickTracking } from '../editor_view';
import { writeClipboard } from '../text_editing_and_selection';
import { buildRuntimeErrorOverlayCopyText, rebuildRuntimeErrorOverlayView } from '../runtime_error_overlay';
import type { PointerSnapshot, RuntimeErrorOverlay } from '../types';
import { computeRuntimeErrorOverlayMaxWidth } from '../text_utils';
import {
	computeRuntimeErrorOverlayGeometry,
	computeRuntimeErrorOverlayLayout,
	findRuntimeErrorOverlayLineAtPosition,
	resolveRuntimeErrorOverlayAnchor,
	RuntimeErrorOverlayClickResult,
} from '../render/render_error_overlay';

export function processRuntimeErrorOverlayPointer(snapshot: PointerSnapshot, justPressed: boolean, codeTop: number, codeRight: number, textLeft: number): boolean {
	const overlay = ide_state.runtimeErrorOverlay;
	if (!overlay || overlay.hidden) {
		return false;
	}
	const geometry = computeRuntimeErrorOverlayGeometry(codeRight, textLeft);
	const anchor = resolveRuntimeErrorOverlayAnchor(overlay, codeTop, textLeft, geometry.contentRight, geometry.availableBottom);
	if (!anchor) {
		overlay.layout = null;
		overlay.hovered = false;
		overlay.hoverLine = -1;
		overlay.copyButtonHovered = false;
		return false;
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
		overlay.hovered = false;
		overlay.hoverLine = -1;
		overlay.copyButtonHovered = false;
		return false;
	}
	if (!snapshot.valid || !snapshot.insideViewport) {
		overlay.hovered = false;
		overlay.hoverLine = -1;
		overlay.copyButtonHovered = false;
		return false;
	}
	const insideBubble = point_in_rect(snapshot.viewportX, snapshot.viewportY, layout.bounds);
	if (!insideBubble) {
		overlay.hovered = false;
		overlay.hoverLine = -1;
		overlay.copyButtonHovered = false;
		if (justPressed && overlay.expanded) {
			overlay.expanded = false;
			rebuildRuntimeErrorOverlayView(overlay);
		}
		return false;
	}
	overlay.hovered = true;
	overlay.copyButtonHovered = point_in_rect(snapshot.viewportX, snapshot.viewportY, layout.copyButtonRect);
	if (overlay.copyButtonHovered) {
		overlay.hoverLine = -1;
		if (!justPressed) {
			return true;
		}
		ide_state.pointerSelecting = false;
		ide_state.pointerPrimaryWasPressed = snapshot.primaryPressed;
		resetPointerClickTracking();
		const payload = buildRuntimeErrorOverlayCopyText(overlay);
		void writeClipboard(payload, 'Copied runtime error to clipboard');
		return true;
	}
	overlay.hoverLine = findRuntimeErrorOverlayLineAtPosition(overlay, snapshot.viewportX, snapshot.viewportY);
	if (!justPressed) {
		return true;
	}
	ide_state.pointerSelecting = false;
	ide_state.pointerPrimaryWasPressed = snapshot.primaryPressed;
	resetPointerClickTracking();
	const clickResult = evaluateRuntimeErrorOverlayClick(overlay, overlay.hoverLine);
	switch (clickResult.kind) {
		case 'expand':
			overlay.expanded = true;
			rebuildRuntimeErrorOverlayView(overlay);
			return true;
		case 'collapse':
			overlay.expanded = false;
			rebuildRuntimeErrorOverlayView(overlay);
			return true;
		case 'navigate':
			overlay.expanded = false;
			rebuildRuntimeErrorOverlayView(overlay);
			navigateToRuntimeErrorFrameTarget(clickResult.frame);
			return true;
		case 'noop':
		default:
			return true;
	}
}

export function evaluateRuntimeErrorOverlayClick(
	overlay: RuntimeErrorOverlay,
	hoverLine: number
): RuntimeErrorOverlayClickResult {
	if (!overlay.expanded) {
		return { kind: 'expand' };
	}
	if (hoverLine < 0 || hoverLine >= overlay.lineDescriptors.length) {
		return { kind: 'collapse' };
	}
	const descriptor = overlay.lineDescriptors[hoverLine];
	if (descriptor.role === 'frame' && descriptor.frame) {
		if (descriptor.frame.origin === 'lua') {
			return { kind: 'navigate', frame: descriptor.frame };
		}
		return { kind: 'noop' };
	}
	return { kind: 'collapse' };
}
