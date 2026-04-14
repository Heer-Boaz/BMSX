import { ide_state } from '../../core/ide_state';
import type { PointerSnapshot } from '../../core/types';
import { clearGotoHoverHighlight } from '../../contrib/intellisense/intellisense';
import { getResourcePanelWidth, hideResourcePanel, resetPointerClickTracking } from '../../ui/editor_view';
import * as constants from '../../core/constants';

export function handleResourcePanelResizePointer(snapshot: PointerSnapshot, justPressed: boolean): boolean {
	if (ide_state.resourcePanelResizing) {
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
		ide_state.resourcePanelResizing = true;
		ide_state.resourcePanel.setFocused(true);
		ide_state.pointerSelecting = false;
		resetPointerClickTracking();
		ide_state.pointerPrimaryWasPressed = snapshot.primaryPressed;
	}
	clearGotoHoverHighlight();
	return true;
}

function updateResourcePanelResize(snapshot: PointerSnapshot): void {
	if (!snapshot.valid || !snapshot.primaryPressed) {
		ide_state.resourcePanelResizing = false;
		ide_state.pointerPrimaryWasPressed = snapshot.primaryPressed;
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
	ide_state.pointerSelecting = false;
	resetPointerClickTracking();
	ide_state.pointerPrimaryWasPressed = snapshot.primaryPressed;
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
