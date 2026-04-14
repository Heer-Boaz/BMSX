import { getCodeAreaBounds } from '../../ui/editor_view';
import { ide_state } from '../../core/ide_state';
import { consumeIdeKey, shouldRepeatKeyFromPlayer } from './key_input';
import { clampResourceViewerScroll, getActiveResourceViewer, resourceViewerTextCapacity, setResourceViewerScroll } from '../../contrib/resources/resource_viewer';
import type { ResourceViewerState } from '../../core/types';
import { editorViewState } from '../../ui/editor_view_state';

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
		const capacity = resourceViewerTextCapacity(viewer, getCodeAreaBounds(), editorViewState.lineHeight);
		scrollResourceViewer(-Math.max(1, capacity));
		return;
	}
	if (shouldRepeatKeyFromPlayer('PageDown')) {
		consumeIdeKey('PageDown');
		const capacity = resourceViewerTextCapacity(viewer, getCodeAreaBounds(), editorViewState.lineHeight);
		scrollResourceViewer(Math.max(1, capacity));
		return;
	}
}

export function scrollResourceBrowserHorizontal(delta: number): void {
	if (!ide_state.resourcePanel.isVisible()) {
		return;
	}
	ide_state.resourcePanel.setHScroll(ide_state.resourcePanel.hscroll + delta);
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
