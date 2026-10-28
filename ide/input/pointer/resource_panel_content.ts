import { pointerHover } from './hover';
import type { ResourcePanelController } from '../../workbench/contrib/resources/panel/controller';
import { point_in_rect } from '../../../machine/ts/common/rect';
import type { PointerInputSnapshot } from '../../common/models';
import { PointerButton } from '../../../hosts/common/input/pointer_event';
import { isAltDown } from '../keyboard/key_input';

export function handleResourcePanelPointer(
	resourcePanel: ResourcePanelController,
	snapshot: PointerInputSnapshot,
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
	if ((snapshot.justPressedButtons & PointerButton.Secondary) !== 0) {
		resourcePanel.showContextMenu(hoverIndex, snapshot.viewportX, snapshot.viewportY, false);
		return true;
	}
	if (justPressed) {
		const mode = resourcePanel.getMode(), revision = resourcePanel.files.revision;
		const context = resourcePanel.focusTarget.scope.contextGeneration;
		resourcePanel.setFocused(true);
		// Outgoing blur may retire the exact tree presentation that produced this hit.
		if (!resourcePanel.isFocused() || resourcePanel.getMode() !== mode
			|| resourcePanel.focusTarget.scope.contextGeneration !== context
			|| mode === 'resources' && resourcePanel.files.revision !== revision) return true;
		if (hoverIndex >= 0) {
			const kind = mode === 'resources' ? resourcePanel.files.tree.rows[hoverIndex].element.kind : undefined;
			if ((kind === 'file' || kind === 'definition') && !resourcePanel.isDisclosureHit(hoverIndex, snapshot.viewportX)) {
				resourcePanel.beginResourceDrag(hoverIndex, snapshot);
			} else {
				resourcePanel.setSelectionIndex(hoverIndex);
				openResourcePanelSelection(resourcePanel, hoverIndex, snapshot.viewportX, isAltDown(snapshot));
			}
		}
	}
	return true;
}

function openResourcePanelSelection(
	resourcePanel: ResourcePanelController,
	hoverIndex: number,
	pointerX: number,
	toSide: boolean,
): void {
	const mode = resourcePanel.getMode();
	if (resourcePanel.isDisclosureHit(hoverIndex, pointerX)) {
		if (mode === 'resources') resourcePanel.toggleSelectedFileDisclosure();
		else resourcePanel.openSelected();
	} else if (mode === 'command') resourcePanel.openSelectedCallHierarchyLocation();
	else {
		const kind = resourcePanel.files.selectedNode!.element.kind;
		resourcePanel.openSelected(toSide && (kind === 'file' || kind === 'definition') ? 'side' : 'default');
	}
}
