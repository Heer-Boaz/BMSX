import { clamp } from '../../../../utils/clamp';
import { getCodeAreaBounds } from '../../browser/editor_view';
import { ide_state } from '../../ide_state';
import { consumeIdeKey, shouldRepeatKeyFromPlayer } from './key_input';
import { clampResourceViewerScroll, getActiveResourceViewer, resourceViewerTextCapacity } from '../../contrib/resources/resource_viewer';
import type { ResourceViewerState } from '../../types';

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
		const capacity = resourceViewerTextCapacity(viewer, getCodeAreaBounds(), ide_state.lineHeight);
		scrollResourceViewer(-Math.max(1, capacity));
		return;
	}
	if (shouldRepeatKeyFromPlayer('PageDown')) {
		consumeIdeKey('PageDown');
		const capacity = resourceViewerTextCapacity(viewer, getCodeAreaBounds(), ide_state.lineHeight);
		scrollResourceViewer(Math.max(1, capacity));
		return;
	}
}

export function scrollResourceBrowserHorizontal(delta: number): void {
	if (!ide_state.resourcePanelVisible) {
		return;
	}
	const state = ide_state.resourcePanel.getStateForRender();
	ide_state.resourcePanel.setHScroll(state.hscroll + delta);
}

export function scrollResourceViewer(amount: number): void {
	const viewer = getActiveResourceViewer();
	if (!viewer) {
		return;
	}
	const capacity = resourceViewerTextCapacity(viewer, getCodeAreaBounds(), ide_state.lineHeight);
	if (capacity <= 0) {
		viewer.scroll = 0;
		return;
	}
	const maxScroll = Math.max(0, viewer.lines.length - capacity);
	viewer.scroll = clamp(viewer.scroll + amount, 0, maxScroll);
	resourceViewerClampScroll(viewer);
}

export function resourceViewerClampScroll(viewer: ResourceViewerState): void {
	clampResourceViewerScroll(viewer, getCodeAreaBounds(), ide_state.lineHeight);
}
