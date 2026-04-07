import { point_in_rect } from '../../../utils/rect_operations';
import { ide_state } from '../ide_state';
import type { PointerSnapshot } from '../types';
import { getProblemsPanelBounds, isPointerOverProblemsPanelDivider, setProblemsPanelHeightFromViewportY } from '../problems_panel';
import { clearHoverTooltip, clearGotoHoverHighlight } from '../intellisense';
import { hideResourcePanel, resetPointerClickTracking, getResourcePanelWidth } from '../editor_view';
import { isPointerOverResourcePanelDivider } from './editor_chrome_input';

export function handleEditorPanelResizePointer(snapshot: PointerSnapshot, justPressed: boolean): boolean {
	if (ide_state.resourcePanelResizing) {
		handleResourcePanelResize(snapshot);
		return true;
	}
	if (ide_state.problemsPanelResizing) {
		handleProblemsPanelResize(snapshot);
		return true;
	}
	if (!justPressed) {
		return false;
	}
	if (ide_state.resourcePanelVisible && isPointerOverResourcePanelDivider(snapshot.viewportX, snapshot.viewportY)) {
		if (getResourcePanelWidth() > 0) {
			ide_state.resourcePanelResizing = true;
			ide_state.resourcePanelFocused = true;
			ide_state.pointerSelecting = false;
			resetPointerClickTracking();
			ide_state.pointerPrimaryWasPressed = snapshot.primaryPressed;
		}
		clearGotoHoverHighlight();
		return true;
	}
	if (!ide_state.problemsPanel.isVisible || !isPointerOverProblemsPanelDivider(snapshot.viewportX, snapshot.viewportY)) {
		return false;
	}
	ide_state.problemsPanelResizing = true;
	ide_state.pointerSelecting = false;
	resetPointerClickTracking();
	ide_state.pointerPrimaryWasPressed = snapshot.primaryPressed;
	clearGotoHoverHighlight();
	return true;
}

export function handleEditorPanelPointer(snapshot: PointerSnapshot, justPressed: boolean, justReleased: boolean): boolean {
	if (handleResourcePanelPointer(snapshot, justPressed)) {
		return true;
	}
	return handleProblemsPanelPointer(snapshot, justPressed, justReleased);
}

function handleResourcePanelResize(snapshot: PointerSnapshot): void {
	if (!snapshot.valid || !snapshot.primaryPressed) {
		ide_state.resourcePanelResizing = false;
		ide_state.pointerPrimaryWasPressed = snapshot.primaryPressed;
		clearGotoHoverHighlight();
		return;
	}
	const ok = ide_state.resourcePanel.setRatioFromViewportX(snapshot.viewportX, ide_state.viewportWidth);
	if (!ok) {
		hideResourcePanel();
	} else {
		ide_state.layout.markVisualLinesDirty();
	}
	ide_state.resourcePanelFocused = true;
	ide_state.pointerSelecting = false;
	resetPointerClickTracking();
	ide_state.pointerPrimaryWasPressed = snapshot.primaryPressed;
	clearGotoHoverHighlight();
}

function handleProblemsPanelResize(snapshot: PointerSnapshot): void {
	if (!snapshot.valid || !snapshot.primaryPressed) {
		ide_state.problemsPanelResizing = false;
		ide_state.pointerPrimaryWasPressed = snapshot.primaryPressed;
		clearGotoHoverHighlight();
		return;
	}
	setProblemsPanelHeightFromViewportY(snapshot.viewportY);
	ide_state.pointerSelecting = false;
	resetPointerClickTracking();
	ide_state.pointerPrimaryWasPressed = snapshot.primaryPressed;
	clearGotoHoverHighlight();
}

function handleResourcePanelPointer(snapshot: PointerSnapshot, justPressed: boolean): boolean {
	const panelBounds = ide_state.resourcePanel.getBounds();
	const pointerInPanel = ide_state.resourcePanelVisible
		&& panelBounds !== null
		&& point_in_rect(snapshot.viewportX, snapshot.viewportY, panelBounds);
	if (!pointerInPanel) {
		if (justPressed) {
			ide_state.resourcePanel.setFocused(false);
		}
		if (ide_state.resourcePanelVisible && !snapshot.primaryPressed) {
			ide_state.resourcePanel.setHoverIndex(-1);
		}
		return false;
	}
	ide_state.resourcePanel.setFocused(true);
	resetPointerClickTracking();
	clearHoverTooltip();
	const margin = Math.max(4, ide_state.lineHeight);
	if (snapshot.viewportY < panelBounds.top + margin) {
		ide_state.resourcePanel.scrollBy(-1);
	} else if (snapshot.viewportY >= panelBounds.bottom - margin) {
		ide_state.resourcePanel.scrollBy(1);
	}
	const hoverIndex = ide_state.resourcePanel.indexAtPosition(snapshot.viewportX, snapshot.viewportY);
	ide_state.resourcePanel.setHoverIndex(hoverIndex);
	if (hoverIndex >= 0) {
		if (hoverIndex !== ide_state.resourceBrowserSelectionIndex) {
			ide_state.resourcePanel.setSelectionIndex(hoverIndex);
		}
		if (justPressed) {
			const mode = ide_state.resourcePanel.getMode();
			if (mode === 'call_hierarchy') {
				if (ide_state.resourcePanel.isCallHierarchyMarkerHit(hoverIndex, snapshot.viewportX)) {
					ide_state.resourcePanel.openSelected();
				} else {
					ide_state.resourcePanel.openSelectedCallHierarchyLocation();
				}
			} else if (mode !== 'resources') {
				ide_state.resourcePanel.openSelected();
			} else {
				ide_state.resourcePanel.openSelected();
				ide_state.resourcePanel.setFocused(false);
			}
		}
	}
	if (!snapshot.primaryPressed && hoverIndex === -1) {
		ide_state.resourcePanel.setHoverIndex(-1);
	}
	ide_state.pointerSelecting = false;
	ide_state.pointerPrimaryWasPressed = snapshot.primaryPressed;
	clearGotoHoverHighlight();
	const state = ide_state.resourcePanel.getStateForRender();
	ide_state.resourcePanelFocused = state.focused;
	ide_state.resourceBrowserSelectionIndex = state.selectionIndex;
	return true;
}

function handleProblemsPanelPointer(snapshot: PointerSnapshot, justPressed: boolean, justReleased: boolean): boolean {
	const problemsBounds = getProblemsPanelBounds();
	if (!ide_state.problemsPanel.isVisible || !problemsBounds) {
		return false;
	}
	const insideProblems = point_in_rect(snapshot.viewportX, snapshot.viewportY, problemsBounds);
	if (!insideProblems) {
		if (justPressed) {
			ide_state.problemsPanel.setFocused(false);
		}
		return false;
	}
	if (!ide_state.problemsPanel.handlePointer(snapshot, justPressed, justReleased, problemsBounds)) {
		return false;
	}
	ide_state.pointerSelecting = false;
	ide_state.pointerPrimaryWasPressed = snapshot.primaryPressed;
	resetPointerClickTracking();
	clearHoverTooltip();
	clearGotoHoverHighlight();
	return true;
}
