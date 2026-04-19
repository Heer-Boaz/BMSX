import type { PointerSnapshot } from '../../../../common/models';
import { clearGotoHoverHighlight } from '../../../../editor/contrib/intellisense/engine';
import { editorChromeState } from '../../../ui/chrome_state';
import { getResourcePanelWidth, hideResourcePanel } from '../../../../editor/ui/view/view';
import * as constants from '../../../../common/constants';
import { editorPointerState, resetPointerClickTracking } from '../../../../editor/input/pointer/state';
import { editorViewState } from '../../../../editor/ui/view/state';
import { resourcePanel } from '../../../contrib/resources/panel/controller';

export function handleResourcePanelResizePointer(snapshot: PointerSnapshot, justPressed: boolean): boolean {
	if (editorChromeState.resourcePanelResizing) {
		updateResourcePanelResize(snapshot);
		return true;
	}
	if (!justPressed) {
		return false;
	}
	if (!resourcePanel.isVisible() || !isPointerOverResourcePanelDivider(snapshot.viewportX, snapshot.viewportY)) {
		return false;
	}
	if (getResourcePanelWidth() > 0) {
		editorChromeState.resourcePanelResizing = true;
		resourcePanel.setFocused(true);
		editorPointerState.pointerSelecting = false;
		resetPointerClickTracking();
		editorPointerState.pointerPrimaryWasPressed = snapshot.primaryPressed;
	}
	clearGotoHoverHighlight();
	return true;
}

function updateResourcePanelResize(snapshot: PointerSnapshot): void {
	if (!snapshot.valid || !snapshot.primaryPressed) {
		editorChromeState.resourcePanelResizing = false;
		editorPointerState.pointerPrimaryWasPressed = snapshot.primaryPressed;
		clearGotoHoverHighlight();
		return;
	}
	const ok = resourcePanel.setRatioFromViewportX(snapshot.viewportX, editorViewState.viewportWidth);
	if (!ok) {
		hideResourcePanel();
	} else {
		editorViewState.layout.markVisualLinesDirty();
	}
	resourcePanel.setFocused(true);
	editorPointerState.pointerSelecting = false;
	resetPointerClickTracking();
	editorPointerState.pointerPrimaryWasPressed = snapshot.primaryPressed;
	clearGotoHoverHighlight();
}

function isPointerOverResourcePanelDivider(x: number, y: number): boolean {
	if (!resourcePanel.isVisible()) {
		return false;
	}
	const bounds = resourcePanel.getBounds();
	if (!bounds) {
		return false;
	}
	const margin = constants.RESOURCE_PANEL_DIVIDER_DRAG_MARGIN;
	const left = bounds.right - margin;
	const right = bounds.right + margin;
	return y >= bounds.top && y <= bounds.bottom && x >= left && x <= right;
}
