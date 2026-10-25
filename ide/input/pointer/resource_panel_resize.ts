import type { PointerSnapshot } from '../../common/models';
import * as constants from '../../common/constants';
import { clearGotoHoverHighlight } from '../../editor/contrib/intellisense/engine';
import { clearEditorPointerSelectionState } from './state';
import type { ResourcePanelController } from '../../workbench/contrib/resources/panel/controller';

export function handleResourcePanelResizePointer(resourcePanel: ResourcePanelController, snapshot: PointerSnapshot, justPressed: boolean): boolean {
	if (!justPressed) {
		return false;
	}
	if (!resourcePanel.isVisible() || !isPointerOverResourcePanelDivider(resourcePanel, snapshot.viewportX, snapshot.viewportY)) {
		return false;
	}
	const bounds = resourcePanel.getBounds();
	if (bounds && bounds.right > bounds.left) {
		resourcePanel.beginResize(snapshot);
		clearEditorPointerSelectionState();
	}
	clearGotoHoverHighlight();
	return true;
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
