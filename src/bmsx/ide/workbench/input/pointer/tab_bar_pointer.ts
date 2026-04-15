import { $ } from '../../../../core/engine_core';
import { point_in_rect } from '../../../../utils/rect_operations';
import { editorChromeState } from '../../ui/chrome_state';
import type { PointerSnapshot } from '../../../common/types';
import { closeTab, setActiveTab } from '../../ui/tabs';
import { beginTabDrag, endTabDrag } from '../../ui/tab_drag';
import { getTabBarTotalHeight } from '../../common/layout';
import { consumeChromePointerPress } from '../../../editor/input/pointer/editor_chrome_pointer_press';
import { editorPointerState } from '../../../editor/input/pointer/editor_pointer_state';
import { editorViewState } from '../../../editor/ui/editor_view_state';
import { tabSessionState } from '../../ui/tab_session_state';

export function handleTabBarPointer(snapshot: PointerSnapshot): boolean {
	const tabTop = editorViewState.headerHeight;
	const tabBottom = tabTop + getTabBarTotalHeight();
	const y = snapshot.viewportY;
	if (y < tabTop || y >= tabBottom) {
		return false;
	}
	const x = snapshot.viewportX;
	for (let index = 0; index < tabSessionState.tabs.length; index += 1) {
		const tab = tabSessionState.tabs[index];
		const closeBounds = editorChromeState.tabCloseButtonBounds.get(tab.id);
		if (closeBounds && point_in_rect(x, y, closeBounds)) {
			endTabDrag();
			closeTab(tab.id);
			editorPointerState.tabHoverId = null;
			consumeChromePointerPress(snapshot);
			return true;
		}
		const tabBounds = editorChromeState.tabButtonBounds.get(tab.id);
		if (tabBounds && point_in_rect(x, y, tabBounds)) {
			beginTabDrag(tab.id, x);
			setActiveTab(tab.id);
			consumeChromePointerPress(snapshot);
			return true;
		}
	}
	return false;
}

export function handleTabBarMiddleClick(snapshot: PointerSnapshot, playerInput: ReturnType<typeof $.input.getPlayerInput>): boolean {
	const tabTop = editorViewState.headerHeight;
	const tabBottom = tabTop + getTabBarTotalHeight();
	const y = snapshot.viewportY;
	if (y < tabTop || y >= tabBottom) {
		return false;
	}
	const x = snapshot.viewportX;
	for (let index = 0; index < tabSessionState.tabs.length; index += 1) {
		const tab = tabSessionState.tabs[index];
		if (!tab.closable) {
			continue;
		}
		const bounds = editorChromeState.tabButtonBounds.get(tab.id);
		if (!bounds) {
			continue;
		}
		if (point_in_rect(x, y, bounds)) {
			closeTab(tab.id);
			playerInput.consumeRawButton('pointer_aux', 'pointer');
			consumeChromePointerPress(snapshot);
			return true;
		}
	}
	return false;
}

export function updateTabHoverState(snapshot: PointerSnapshot): void {
	if (!snapshot.valid || !snapshot.insideViewport) {
		editorPointerState.tabHoverId = null;
		return;
	}
	const tabTop = editorViewState.headerHeight;
	const tabBottom = tabTop + getTabBarTotalHeight();
	const y = snapshot.viewportY;
	if (y < tabTop || y >= tabBottom) {
		editorPointerState.tabHoverId = null;
		return;
	}
	const x = snapshot.viewportX;
	let hovered: string = null;
	for (const [tabId, bounds] of editorChromeState.tabButtonBounds) {
		if (point_in_rect(x, y, bounds)) {
			hovered = tabId;
			break;
		}
	}
	editorPointerState.tabHoverId = hovered;
}
