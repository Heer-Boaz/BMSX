import { getCodeAreaBounds } from '../../../editor/ui/view/view';
import { consumeIdeKey, shouldRepeatKeyFromPlayer } from '../../../input/keyboard/key_input';
import { applyResourceViewerScroll, clampResourceViewerScroll, resourceViewerTextCapacity, setResourceViewerScroll } from '../../contrib/resources/viewer';
import type { ResourceViewerState } from '../../contrib/resources/model';
import { editorViewState } from '../../../editor/ui/view/state';
import type { ResourcePanelController } from '../../contrib/resources/panel/controller';
import type { PlayerInput } from '../../../../hosts/common/input/player';

export function handleResourceViewerInput(playerInput: PlayerInput, viewer: ResourceViewerState): void {
	if (shouldRepeatKeyFromPlayer('ArrowUp', playerInput)) {
		consumeIdeKey('ArrowUp', playerInput);
		scrollResourceViewer(viewer, -1);
		return;
	}
	if (shouldRepeatKeyFromPlayer('ArrowDown', playerInput)) {
		consumeIdeKey('ArrowDown', playerInput);
		scrollResourceViewer(viewer, 1);
		return;
	}
	if (shouldRepeatKeyFromPlayer('PageUp', playerInput)) {
		consumeIdeKey('PageUp', playerInput);
		const bounds = getCodeAreaBounds();
		const capacity = resourceViewerTextCapacity(viewer, bounds, editorViewState.lineHeight);
		applyResourceViewerScroll(viewer, capacity, viewer.scroll - Math.max(1, capacity));
		return;
	}
	if (shouldRepeatKeyFromPlayer('PageDown', playerInput)) {
		consumeIdeKey('PageDown', playerInput);
		const bounds = getCodeAreaBounds();
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
	setResourceViewerScroll(viewer, getCodeAreaBounds(), editorViewState.lineHeight, viewer.scroll + amount);
}

export function resourceViewerClampScroll(viewer: ResourceViewerState): void {
	clampResourceViewerScroll(viewer, getCodeAreaBounds(), editorViewState.lineHeight);
}
