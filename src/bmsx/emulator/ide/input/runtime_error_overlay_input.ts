import { ide_state } from '../ide_state';
import { resetPointerClickTracking } from '../editor_view';
import { writeClipboard } from '../text_editing_and_selection';
import { buildRuntimeErrorOverlayCopyText } from '../runtime_error_overlay';
import type { PointerSnapshot } from '../types';
import { collapseRuntimeErrorOverlay, handleRuntimeErrorOverlayPointerClick } from './runtime_error_overlay_pointer_actions';
import {
	RUNTIME_ERROR_OVERLAY_POINTER_BODY,
	RUNTIME_ERROR_OVERLAY_POINTER_COPY_BUTTON,
	RUNTIME_ERROR_OVERLAY_POINTER_NONE,
	RUNTIME_ERROR_OVERLAY_POINTER_OUTSIDE,
	updateRuntimeErrorOverlayPointerHover,
} from './runtime_error_overlay_pointer_hover';

export function processRuntimeErrorOverlayPointer(snapshot: PointerSnapshot, justPressed: boolean, codeTop: number, codeRight: number, textLeft: number): boolean {
	const pointerHit = updateRuntimeErrorOverlayPointerHover(snapshot, codeTop, codeRight, textLeft);
	if (pointerHit === RUNTIME_ERROR_OVERLAY_POINTER_NONE) {
		return false;
	}
	const overlay = ide_state.runtimeErrorOverlay;
	if (pointerHit === RUNTIME_ERROR_OVERLAY_POINTER_OUTSIDE) {
		if (justPressed && overlay.expanded) {
			collapseRuntimeErrorOverlay(overlay);
		}
		return false;
	}
	if (!justPressed) {
		return true;
	}
	ide_state.pointerSelecting = false;
	ide_state.pointerPrimaryWasPressed = snapshot.primaryPressed;
	resetPointerClickTracking();
	if (pointerHit === RUNTIME_ERROR_OVERLAY_POINTER_COPY_BUTTON) {
		const payload = buildRuntimeErrorOverlayCopyText(overlay);
		void writeClipboard(payload, 'Copied runtime error to clipboard');
		return true;
	}
	if (pointerHit === RUNTIME_ERROR_OVERLAY_POINTER_BODY) {
		handleRuntimeErrorOverlayPointerClick(overlay, overlay.hoverLine);
	}
	return true;
}
