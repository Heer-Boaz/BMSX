import { writeClipboard } from '../../../editing/text_editing_and_selection';
import { buildRuntimeErrorOverlayCopyText } from '../../../contrib/runtime_error/overlay';
import type { PointerSnapshot } from '../../../../common/models';
import { collapseRuntimeErrorOverlay, handleRuntimeErrorOverlayPointerClick } from './pointer/actions';
import { editorPointerState, resetPointerClickTracking } from '../../pointer/state';
import { runtimeErrorState } from '../../../contrib/runtime_error/state';
import {
	RUNTIME_ERROR_OVERLAY_POINTER_BODY,
	RUNTIME_ERROR_OVERLAY_POINTER_COPY_BUTTON,
	RUNTIME_ERROR_OVERLAY_POINTER_NONE,
	RUNTIME_ERROR_OVERLAY_POINTER_OUTSIDE,
	updateRuntimeErrorOverlayPointerHover,
} from './pointer/hover';

export function processRuntimeErrorOverlayPointer(snapshot: PointerSnapshot, justPressed: boolean, codeTop: number, codeRight: number, textLeft: number): boolean {
	const pointerHit = updateRuntimeErrorOverlayPointerHover(snapshot, codeTop, codeRight, textLeft);
	if (pointerHit === RUNTIME_ERROR_OVERLAY_POINTER_NONE) {
		return false;
	}
	const overlay = runtimeErrorState.activeOverlay;
	if (pointerHit === RUNTIME_ERROR_OVERLAY_POINTER_OUTSIDE) {
		if (justPressed && overlay.expanded) {
			collapseRuntimeErrorOverlay(overlay);
		}
		return false;
	}
	if (!justPressed) {
		return true;
	}
	editorPointerState.pointerSelecting = false;
	editorPointerState.pointerPrimaryWasPressed = snapshot.primaryPressed;
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
