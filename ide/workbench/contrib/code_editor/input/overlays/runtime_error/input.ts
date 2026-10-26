import { writeClipboard } from '../../../../../../input/clipboard';
import { buildRuntimeErrorOverlayCopyText } from '../../../../../../editor/contrib/runtime_error/overlay';
import type { PointerSnapshot } from '../../../../../../common/models';
import { handleRuntimeErrorOverlayPointerClick, setRuntimeErrorOverlayExpanded } from './pointer/actions';
import { resetPointerClickTracking } from '../../../../../../input/pointer/state';
import {
	RUNTIME_ERROR_OVERLAY_POINTER_BODY,
	RUNTIME_ERROR_OVERLAY_POINTER_COPY_BUTTON,
	RUNTIME_ERROR_OVERLAY_POINTER_NONE,
	RUNTIME_ERROR_OVERLAY_POINTER_OUTSIDE,
	updateRuntimeErrorOverlayPointerHover,
} from '../../../../../../editor/contrib/runtime_error/pointer';
import type { CodeEditorPane } from '../../../editor_pane';

export function processRuntimeErrorOverlayPointer(
	pane: CodeEditorPane,
	snapshot: PointerSnapshot,
	justPressed: boolean,
	codeTop: number,
	codeRight: number,
	textLeft: number,
	contentBottom: number,
): boolean {
	const code = pane.code;
	const pointerHit = updateRuntimeErrorOverlayPointerHover(code, snapshot, codeTop, codeRight, textLeft, contentBottom);
	if (pointerHit === RUNTIME_ERROR_OVERLAY_POINTER_NONE) {
		return false;
	}
	const overlay = code.runtimeError.activeOverlay;
	if (pointerHit === RUNTIME_ERROR_OVERLAY_POINTER_OUTSIDE) {
		if (justPressed && overlay.expanded) {
			setRuntimeErrorOverlayExpanded(overlay, false);
		}
		return false;
	}
	if (!justPressed) {
		return true;
	}
	code.pointer.pointerSelecting = false;
	resetPointerClickTracking(code);
	if (pointerHit === RUNTIME_ERROR_OVERLAY_POINTER_COPY_BUTTON) {
		const payload = buildRuntimeErrorOverlayCopyText(overlay);
		void writeClipboard(pane.clipboard, payload, 'Copied runtime error to clipboard');
		return true;
	}
	if (pointerHit === RUNTIME_ERROR_OVERLAY_POINTER_BODY) {
		handleRuntimeErrorOverlayPointerClick(pane, overlay, overlay.hoverLine);
	}
	return true;
}
