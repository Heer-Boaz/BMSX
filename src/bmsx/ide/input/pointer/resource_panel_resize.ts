import type { PointerSnapshot } from '../../common/models';
import * as constants from '../../common/constants';
import { clearGotoHoverHighlight } from '../../editor/contrib/intellisense/engine';
import { editorViewState } from '../../editor/ui/view/state';
import { editorChromeState } from '../../workbench/ui/chrome_state';
import { editorPointerState, stopPointerSelectionAndResetClicks } from './state';
import type { ResourcePanelController } from '../../workbench/contrib/resources/panel/controller';

export function handleResourcePanelResizePointer(resourcePanel: ResourcePanelController, snapshot: PointerSnapshot, justPressed: boolean): boolean {
	if (editorChromeState.resourcePanelResizing) {
		updateResourcePanelResize(resourcePanel, snapshot);
		return true;
	}
	if (!justPressed) {
		return false;
	}
	if (!resourcePanel.isVisible() || !isPointerOverResourcePanelDivider(resourcePanel, snapshot.viewportX, snapshot.viewportY)) {
		return false;
	}
	const bounds = resourcePanel.getBounds();
	if (bounds && bounds.right > bounds.left) {
		editorChromeState.resourcePanelResizing = true;
		resourcePanel.setFocused(true);
		stopPointerSelectionAndResetClicks(snapshot);
	}
	clearGotoHoverHighlight();
	return true;
}

function updateResourcePanelResize(resourcePanel: ResourcePanelController, snapshot: PointerSnapshot): void {
	if (!snapshot.valid || !snapshot.primaryPressed) {
		editorChromeState.resourcePanelResizing = false;
		editorPointerState.pointerPrimaryWasPressed = snapshot.primaryPressed;
		clearGotoHoverHighlight();
		return;
	}
	const ok = resourcePanel.setRatioFromViewportX(snapshot.viewportX, editorViewState.viewportWidth);
	if (!ok) {
		editorChromeState.resourcePanelResizing = false;
	} else {
		editorViewState.layout.markVisualLinesDirty();
	}
	resourcePanel.setFocused(true);
	stopPointerSelectionAndResetClicks(snapshot);
	clearGotoHoverHighlight();
}

function isPointerOverResourcePanelDivider(resourcePanel: ResourcePanelController, x: number, y: number): boolean {
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
