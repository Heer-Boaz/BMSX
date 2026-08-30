import type { ResourcePanelController } from '../../workbench/contrib/resources/panel/controller';
import { point_in_rect } from '../../../machine/ts/common/rect';
import type { PointerSnapshot } from '../../common/models';
import { clearHoverTooltip, clearGotoHoverHighlight } from '../../editor/contrib/intellisense/engine';
import { editorPointerState, resetPointerClickTracking } from './state';

export function handleResourcePanelPointer(
	resourcePanel: ResourcePanelController,
	snapshot: PointerSnapshot,
	justPressed: boolean,
): boolean {
	const panelBounds = resourcePanel.getBounds();
	const pointerInPanel = resourcePanel.isVisible()
		&& panelBounds !== null
		&& point_in_rect(snapshot.viewportX, snapshot.viewportY, panelBounds);
	if (!pointerInPanel) {
		if (justPressed) {
			resourcePanel.setFocused(false);
		}
		if (resourcePanel.isVisible() && !snapshot.primaryPressed) {
			resourcePanel.hoverIndex = -1;
		}
		return false;
	}
	resourcePanel.setFocused(true);
	resetPointerClickTracking();
	clearHoverTooltip();
	const margin = resourcePanel.lineHeight;
	if (snapshot.viewportY < panelBounds.top + margin) {
		resourcePanel.scrollBy(-1);
	} else if (snapshot.viewportY >= panelBounds.bottom - margin) {
		resourcePanel.scrollBy(1);
	}
	const hoverIndex = resourcePanel.indexAtPosition(snapshot.viewportX, snapshot.viewportY);
	resourcePanel.hoverIndex = hoverIndex;
	if (hoverIndex >= 0) {
		if (hoverIndex !== resourcePanel.selectionIndex) {
			resourcePanel.setSelectionIndex(hoverIndex);
		}
			if (justPressed) {
				openResourcePanelSelection(resourcePanel, hoverIndex, snapshot.viewportX);
			}
	}
	if (!snapshot.primaryPressed && hoverIndex === -1) {
		resourcePanel.hoverIndex = -1;
	}
	editorPointerState.pointerSelecting = false;
	editorPointerState.pointerPrimaryWasPressed = snapshot.primaryPressed;
	clearGotoHoverHighlight();
	return true;
}

function openResourcePanelSelection(
	resourcePanel: ResourcePanelController,
	hoverIndex: number,
	pointerX: number,
): void {
	const mode = resourcePanel.getMode();
	if (mode === 'command') {
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
