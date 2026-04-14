import { point_in_rect } from '../../../../utils/rect_operations';
import type { PointerSnapshot } from '../../../common/types';
import { clearHoverTooltip, clearGotoHoverHighlight } from '../../../editor/contrib/intellisense/intellisense';
import { editorPointerState, resetPointerClickTracking } from '../../../editor/input/pointer/editor_pointer_state';
import { editorViewState } from '../../../editor/ui/editor_view_state';
import { resourcePanel } from '../../contrib/resources/resource_panel_controller';

export function handleResourcePanelPointer(snapshot: PointerSnapshot, justPressed: boolean): boolean {
	const panelBounds = resourcePanel.getBounds();
	const pointerInPanel = resourcePanel.isVisible()
		&& panelBounds !== null
		&& point_in_rect(snapshot.viewportX, snapshot.viewportY, panelBounds);
	if (!pointerInPanel) {
		if (justPressed) {
			resourcePanel.setFocused(false);
		}
		if (resourcePanel.isVisible() && !snapshot.primaryPressed) {
			resourcePanel.setHoverIndex(-1);
		}
		return false;
	}
	resourcePanel.setFocused(true);
	resetPointerClickTracking();
	clearHoverTooltip();
	const margin = Math.max(4, editorViewState.lineHeight);
	if (snapshot.viewportY < panelBounds.top + margin) {
		resourcePanel.scrollBy(-1);
	} else if (snapshot.viewportY >= panelBounds.bottom - margin) {
		resourcePanel.scrollBy(1);
	}
	const hoverIndex = resourcePanel.indexAtPosition(snapshot.viewportX, snapshot.viewportY);
	resourcePanel.setHoverIndex(hoverIndex);
	if (hoverIndex >= 0) {
		if (hoverIndex !== resourcePanel.selectionIndex) {
			resourcePanel.setSelectionIndex(hoverIndex);
		}
		if (justPressed) {
			openResourcePanelSelection(hoverIndex, snapshot.viewportX);
		}
	}
	if (!snapshot.primaryPressed && hoverIndex === -1) {
		resourcePanel.setHoverIndex(-1);
	}
	editorPointerState.pointerSelecting = false;
	editorPointerState.pointerPrimaryWasPressed = snapshot.primaryPressed;
	clearGotoHoverHighlight();
	return true;
}

function openResourcePanelSelection(hoverIndex: number, pointerX: number): void {
	const mode = resourcePanel.getMode();
	if (mode === 'call_hierarchy') {
		if (resourcePanel.isCallHierarchyMarkerHit(hoverIndex, pointerX)) {
			resourcePanel.openSelected();
		} else {
			resourcePanel.openSelectedCallHierarchyLocation();
		}
		return;
	}
	resourcePanel.openSelected();
	if (mode === 'resources') {
		resourcePanel.setFocused(false);
	}
}
