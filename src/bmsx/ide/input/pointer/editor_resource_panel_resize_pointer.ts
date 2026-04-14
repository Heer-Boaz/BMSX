import { ide_state } from '../../core/ide_state';
import type { PointerSnapshot } from '../../core/types';
import { clearGotoHoverHighlight } from '../../contrib/intellisense/intellisense';
import { editorChromeState } from '../../ui/editor_chrome_state';
import { getResourcePanelWidth, hideResourcePanel } from '../../ui/editor_view';
import * as constants from '../../core/constants';
import { editorPointerState, resetPointerClickTracking } from './editor_pointer_state';

export function handleResourcePanelResizePointer(snapshot: PointerSnapshot, justPressed: boolean): boolean {
	if (editorChromeState.resourcePanelResizing) {
		updateResourcePanelResize(snapshot);
		return true;
	}
	if (!justPressed) {
		return false;
	}
	if (!ide_state.resourcePanel.isVisible() || !isPointerOverResourcePanelDivider(snapshot.viewportX, snapshot.viewportY)) {
		return false;
	}
	if (getResourcePanelWidth() > 0) {
		editorChromeState.resourcePanelResizing = true;
		ide_state.resourcePanel.setFocused(true);
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
	const ok = ide_state.resourcePanel.setRatioFromViewportX(snapshot.viewportX, ide_state.viewportWidth);
	if (!ok) {
		hideResourcePanel();
	} else {
		ide_state.layout.markVisualLinesDirty();
	}
	ide_state.resourcePanel.setFocused(true);
	editorPointerState.pointerSelecting = false;
	resetPointerClickTracking();
	editorPointerState.pointerPrimaryWasPressed = snapshot.primaryPressed;
	clearGotoHoverHighlight();
}

function isPointerOverResourcePanelDivider(x: number, y: number): boolean {
	if (!ide_state.resourcePanel.isVisible()) {
		return false;
	}
	const bounds = ide_state.resourcePanel.getBounds();
	if (!bounds) {
		return false;
	}
	const margin = constants.RESOURCE_PANEL_DIVIDER_DRAG_MARGIN;
	const left = bounds.right - margin;
	const right = bounds.right + margin;
	return y >= bounds.top && y <= bounds.bottom && x >= left && x <= right;
}
