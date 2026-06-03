import { point_in_rect } from '../../../common/rect';
import type { PointerSnapshot } from '../../common/models';
import { clearHoverTooltip, clearGotoHoverHighlight } from '../../editor/contrib/intellisense/engine';
import type { Runtime } from '../../../machine/runtime/runtime';
import { editorPointerState, resetPointerClickTracking } from './state';

export function handleResourcePanelPointer(runtime: Runtime, snapshot: PointerSnapshot, justPressed: boolean): boolean {
	const resourcePanel = runtime.editor.resourcePanel;
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
	const margin = resourcePanel.lineHeight;
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
				openResourcePanelSelection(runtime, hoverIndex, snapshot.viewportX);
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

function openResourcePanelSelection(runtime: Runtime, hoverIndex: number, pointerX: number): void {
	const resourcePanel = runtime.editor.resourcePanel;
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
