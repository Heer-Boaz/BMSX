import { writeClipboard } from '../../../editing/text_editing_and_selection';
import { buildRuntimeErrorOverlayCopyText } from '../../../contrib/runtime_error/overlay';
import type { PointerSnapshot } from '../../../../common/models';
import { handleRuntimeErrorOverlayPointerClick, setRuntimeErrorOverlayExpanded } from './pointer/actions';
import { editorPointerState, resetPointerClickTracking } from '../../../../input/pointer/state';
import { runtimeErrorState } from '../../../contrib/runtime_error/state';
import type { Runtime } from '../../../../../machine/runtime/runtime';
import {
	RUNTIME_ERROR_OVERLAY_POINTER_BODY,
	RUNTIME_ERROR_OVERLAY_POINTER_COPY_BUTTON,
	RUNTIME_ERROR_OVERLAY_POINTER_NONE,
	RUNTIME_ERROR_OVERLAY_POINTER_OUTSIDE,
	updateRuntimeErrorOverlayPointerHover,
} from './pointer/hover';

export function processRuntimeErrorOverlayPointer(runtime: Runtime, snapshot: PointerSnapshot, justPressed: boolean, codeTop: number, codeRight: number, textLeft: number, contentBottom: number): boolean {
	const pointerHit = updateRuntimeErrorOverlayPointerHover(snapshot, codeTop, codeRight, textLeft, contentBottom);
	if (pointerHit === RUNTIME_ERROR_OVERLAY_POINTER_NONE) {
		return false;
	}
	const overlay = runtimeErrorState.activeOverlay;
	if (pointerHit === RUNTIME_ERROR_OVERLAY_POINTER_OUTSIDE) {
		if (justPressed && overlay.expanded) {
			setRuntimeErrorOverlayExpanded(overlay, false);
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
		handleRuntimeErrorOverlayPointerClick(runtime, overlay, overlay.hoverLine);
	}
	return true;
}
