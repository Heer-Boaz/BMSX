import type { CartEditor } from '../../cart_editor';
import { point_in_rect } from '../../../machine/ts/common/rect';
import { problemsPanel, getProblemsPanelBounds } from '../../workbench/contrib/problems/panel/controller';
import type { ResourcePanelController } from '../../workbench/contrib/resources/panel/controller';
import type { WheelInputSnapshot } from '../../common/models';
import { isPointInHoverTooltip, pointerHitsHoverTarget, adjustHoverTooltipScroll } from '../../editor/ui/hover_tooltip';
import { isShiftDown } from '../keyboard/key_input';
import { scrollResourceBrowserHorizontal } from '../../workbench/input/keyboard/resource_viewer_input';
import { hoverState } from '../../editor/contrib/hover/state';
import { editorViewState } from '../../editor/ui/view/state';
import { editorChromeState } from '../../workbench/ui/chrome_state';
import { inputFocus } from '../focus';
import { getWorkbenchEditorBounds } from '../../workbench/common/layout';

/** Route each occurrence while its geometry, modifiers and UI owner are current. */
export function handleEditorWheelInput(editor: CartEditor, event: WheelInputSnapshot): boolean {
	if (!event.valid || !event.insideViewport || event.deltaX === 0 && event.deltaY === 0) return true;
	if (editor.quickInput.visible) {
		editor.quickInput.handleWheel(event.deltaY);
		return true;
	}
	if (editor.contextMenu.visible) {
		editor.contextMenu.handleWheel(event.deltaY);
		return true;
	}
	if (editorChromeState.openMenuId !== null) return true;
	if (handleHoverTooltipWheel(event)) return true;
	if (point_in_rect(event.viewportX, event.viewportY, editorChromeState.tabBarBounds)) {
		editorChromeState.tabScrollControl.cancelPointer();
		const bar = editorChromeState.tabScrollbar;
		const delta = event.deltaX === 0 ? event.deltaY : event.deltaX;
		bar.setScroll(bar.getScroll() + delta * editorViewState.charAdvance * 4);
		return true;
	}
	if (handleResourcePanelWheel(editor.resourcePanel, event) || handleProblemsPanelWheel(event)) return true;
	const guest = inputFocus.target?.guestInput;
	if (guest !== undefined && point_in_rect(event.viewportX, event.viewportY, guest.bounds)) return false;
	if (point_in_rect(event.viewportX, event.viewportY, getWorkbenchEditorBounds())) editor.editorPanes.activePane?.handleWheel(event);
	return true;
}

function handleHoverTooltipWheel(event: WheelInputSnapshot): boolean {
	const tooltip = hoverState.tooltip;
	if (tooltip === null) return false;
	const inside = isPointInHoverTooltip(event.viewportX, event.viewportY);
	if (inside || pointerHitsHoverTarget(event, tooltip)) {
		return adjustHoverTooltipScroll(event.deltaY) || inside;
	}
	return false;
}

function handleResourcePanelWheel(resourcePanel: ResourcePanelController, event: WheelInputSnapshot): boolean {
	const bounds = resourcePanel.getBounds();
	if (!resourcePanel.isVisible() || bounds === null || !point_in_rect(event.viewportX, event.viewportY, bounds)) return false;
	const horizontal = isShiftDown(event) && event.deltaX === 0;
	const deltaX = horizontal ? event.deltaY : event.deltaX;
	const deltaY = horizontal ? 0 : event.deltaY;
	if (deltaX !== 0) scrollResourceBrowserHorizontal(resourcePanel, deltaX * editorViewState.charAdvance * 4);
	if (deltaY !== 0) resourcePanel.setScroll(resourcePanel.scroll + deltaY);
	return true;
}

function handleProblemsPanelWheel(event: WheelInputSnapshot): boolean {
	if (!problemsPanel.isVisible) return false;
	const bounds = getProblemsPanelBounds();
	if (bounds === null || !point_in_rect(event.viewportX, event.viewportY, bounds)) return false;
	problemsPanel.handlePointerWheel(event.deltaY, bounds);
	return true;
}
