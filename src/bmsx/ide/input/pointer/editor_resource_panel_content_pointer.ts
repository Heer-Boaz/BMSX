import { point_in_rect } from '../../../utils/rect_operations';
import { ide_state } from '../../core/ide_state';
import type { PointerSnapshot } from '../../core/types';
import { clearHoverTooltip, clearGotoHoverHighlight } from '../../contrib/intellisense/intellisense';
import { resetPointerClickTracking } from '../../ui/editor_view';

export function handleResourcePanelPointer(snapshot: PointerSnapshot, justPressed: boolean): boolean {
	const panelBounds = ide_state.resourcePanel.getBounds();
	const pointerInPanel = ide_state.resourcePanel.isVisible()
		&& panelBounds !== null
		&& point_in_rect(snapshot.viewportX, snapshot.viewportY, panelBounds);
	if (!pointerInPanel) {
		if (justPressed) {
			ide_state.resourcePanel.setFocused(false);
		}
		if (ide_state.resourcePanel.isVisible() && !snapshot.primaryPressed) {
			ide_state.resourcePanel.setHoverIndex(-1);
		}
		return false;
	}
	ide_state.resourcePanel.setFocused(true);
	resetPointerClickTracking();
	clearHoverTooltip();
	const margin = Math.max(4, ide_state.lineHeight);
	if (snapshot.viewportY < panelBounds.top + margin) {
		ide_state.resourcePanel.scrollBy(-1);
	} else if (snapshot.viewportY >= panelBounds.bottom - margin) {
		ide_state.resourcePanel.scrollBy(1);
	}
	const hoverIndex = ide_state.resourcePanel.indexAtPosition(snapshot.viewportX, snapshot.viewportY);
	ide_state.resourcePanel.setHoverIndex(hoverIndex);
	if (hoverIndex >= 0) {
		if (hoverIndex !== ide_state.resourcePanel.selectionIndex) {
			ide_state.resourcePanel.setSelectionIndex(hoverIndex);
		}
		if (justPressed) {
			openResourcePanelSelection(hoverIndex, snapshot.viewportX);
		}
	}
	if (!snapshot.primaryPressed && hoverIndex === -1) {
		ide_state.resourcePanel.setHoverIndex(-1);
	}
	ide_state.pointerSelecting = false;
	ide_state.pointerPrimaryWasPressed = snapshot.primaryPressed;
	clearGotoHoverHighlight();
	return true;
}

function openResourcePanelSelection(hoverIndex: number, pointerX: number): void {
	const mode = ide_state.resourcePanel.getMode();
	if (mode === 'call_hierarchy') {
		if (ide_state.resourcePanel.isCallHierarchyMarkerHit(hoverIndex, pointerX)) {
			ide_state.resourcePanel.openSelected();
		} else {
			ide_state.resourcePanel.openSelectedCallHierarchyLocation();
		}
		return;
	}
	ide_state.resourcePanel.openSelected();
	if (mode === 'resources') {
		ide_state.resourcePanel.setFocused(false);
	}
}
