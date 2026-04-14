import type { PointerSnapshot } from '../../core/types';
import { clearGotoHoverHighlight } from '../../contrib/intellisense/intellisense';
import { editorChromeState } from '../../ui/editor_chrome_state';
import { getResourcePanelWidth, hideResourcePanel } from '../../ui/editor_view';
import * as constants from '../../core/constants';
import { editorPointerState, resetPointerClickTracking } from './editor_pointer_state';
import { editorViewState } from '../../ui/editor_view_state';
import { resourcePanel } from '../../contrib/resources/resource_panel_controller';

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
