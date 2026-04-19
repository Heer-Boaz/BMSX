import { getCodeAreaBounds } from '../../../editor/ui/view/view';
import { resourcePanel } from '../../contrib/resources/panel/controller';
import { consumeIdeKey, shouldRepeatKeyFromPlayer } from '../../../editor/input/keyboard/key_input';
import { applyResourceViewerScroll, clampResourceViewerScroll, resourceViewerTextCapacity, setResourceViewerScroll } from '../../contrib/resources/viewer';
import { getActiveResourceViewer } from '../../contrib/resources/view_tabs';
import type { ResourceViewerState } from '../../../common/models';
import { editorViewState } from '../../../editor/ui/view/state';

export function handleResourceViewerInput(): void {
	const viewer = getActiveResourceViewer();
	if (!viewer) {
		return;
	}
	if (shouldRepeatKeyFromPlayer('ArrowUp')) {
		consumeIdeKey('ArrowUp');
		scrollResourceViewer(-1);
		return;
	}
	if (shouldRepeatKeyFromPlayer('ArrowDown')) {
		consumeIdeKey('ArrowDown');
		scrollResourceViewer(1);
		return;
	}
	if (shouldRepeatKeyFromPlayer('PageUp')) {
		consumeIdeKey('PageUp');
		const bounds = getCodeAreaBounds();
		const capacity = resourceViewerTextCapacity(viewer, bounds, editorViewState.lineHeight);
		applyResourceViewerScroll(viewer, capacity, viewer.scroll - Math.max(1, capacity));
		return;
	}
	if (shouldRepeatKeyFromPlayer('PageDown')) {
		consumeIdeKey('PageDown');
		const bounds = getCodeAreaBounds();
		const capacity = resourceViewerTextCapacity(viewer, bounds, editorViewState.lineHeight);
		applyResourceViewerScroll(viewer, capacity, viewer.scroll + Math.max(1, capacity));
		return;
	}
}

export function scrollResourceBrowserHorizontal(delta: number): void {
	if (!resourcePanel.isVisible()) {
		return;
	}
	resourcePanel.setHScroll(resourcePanel.hscroll + delta);
}

export function scrollResourceViewer(amount: number): void {
	const viewer = getActiveResourceViewer();
	if (!viewer) {
		return;
	}
	setResourceViewerScroll(viewer, getCodeAreaBounds(), editorViewState.lineHeight, viewer.scroll + amount);
}

export function resourceViewerClampScroll(viewer: ResourceViewerState): void {
	clampResourceViewerScroll(viewer, getCodeAreaBounds(), editorViewState.lineHeight);
}
