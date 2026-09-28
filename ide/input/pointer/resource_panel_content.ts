import { pointerHover } from './hover';
import type { ResourcePanelController } from '../../workbench/contrib/resources/panel/controller';
import { point_in_rect } from '../../../machine/ts/common/rect';
import type { PointerSnapshot } from '../../common/models';
import { editorPointerState, resetPointerClickTracking } from './state';

export function handleResourcePanelPointer(
	resourcePanel: ResourcePanelController,
	snapshot: PointerSnapshot,
	justPressed: boolean,
): boolean {
	const panelBounds = resourcePanel.getBounds();
	const pointerInPanel = snapshot.valid && snapshot.insideViewport && resourcePanel.isVisible()
		&& panelBounds !== null
		&& point_in_rect(snapshot.viewportX, snapshot.viewportY, panelBounds);
	if (!pointerInPanel) {
		if (justPressed) {
			resourcePanel.setFocused(false);
		}
		pointerHover.release(resourcePanel);
		return false;
	}
	pointerHover.visit(resourcePanel);
	const hoverIndex = resourcePanel.indexAtPosition(snapshot.viewportX, snapshot.viewportY);
	resourcePanel.hoverIndex = hoverIndex;
	if (justPressed) {
		resourcePanel.setFocused(true);
		resetPointerClickTracking();
		if (hoverIndex >= 0) {
			resourcePanel.setSelectionIndex(hoverIndex);
			openResourcePanelSelection(resourcePanel, hoverIndex, snapshot.viewportX);
		}
	}
	editorPointerState.pointerSelecting = false;
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
