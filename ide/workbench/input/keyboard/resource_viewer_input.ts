import { getWorkbenchEditorBounds } from '../../common/layout';
import { consumeIdeKey, isKeyDown } from '../../../input/keyboard/key_input';
import { applyResourceViewerScroll, clampResourceViewerScroll, resourceViewerTextCapacity, setResourceViewerScroll } from '../../contrib/resources/viewer';
import type { ResourceViewerState } from '../../contrib/resources/model';
import { editorViewState } from '../../../editor/ui/view/state';
import type { ResourcePanelController } from '../../contrib/resources/panel/controller';
import type { KeyInputEvent } from '../../../../hosts/common/input/text';

export function handleResourceViewerInput(playerInput: KeyInputEvent, viewer: ResourceViewerState): void {
	if (isKeyDown('ArrowUp', playerInput)) {
		consumeIdeKey('ArrowUp', playerInput);
		scrollResourceViewer(viewer, -1);
		return;
	}
	if (isKeyDown('ArrowDown', playerInput)) {
		consumeIdeKey('ArrowDown', playerInput);
		scrollResourceViewer(viewer, 1);
		return;
	}
	if (isKeyDown('PageUp', playerInput)) {
		consumeIdeKey('PageUp', playerInput);
		const bounds = getWorkbenchEditorBounds();
		const capacity = resourceViewerTextCapacity(viewer, bounds, editorViewState.lineHeight);
		applyResourceViewerScroll(viewer, capacity, viewer.scroll - Math.max(1, capacity));
		return;
	}
	if (isKeyDown('PageDown', playerInput)) {
		consumeIdeKey('PageDown', playerInput);
		const bounds = getWorkbenchEditorBounds();
		const capacity = resourceViewerTextCapacity(viewer, bounds, editorViewState.lineHeight);
		applyResourceViewerScroll(viewer, capacity, viewer.scroll + Math.max(1, capacity));
		return;
	}
}

export function scrollResourceBrowserHorizontal(resourcePanel: ResourcePanelController, delta: number): void {
	if (!resourcePanel.isVisible()) {
		return;
	}
	resourcePanel.setHScroll(resourcePanel.hscroll + delta);
}

export function scrollResourceViewer(viewer: ResourceViewerState, amount: number): void {
	setResourceViewerScroll(viewer, getWorkbenchEditorBounds(), editorViewState.lineHeight, viewer.scroll + amount);
}

export function resourceViewerClampScroll(viewer: ResourceViewerState): void {
	clampResourceViewerScroll(viewer, getWorkbenchEditorBounds(), editorViewState.lineHeight);
}
