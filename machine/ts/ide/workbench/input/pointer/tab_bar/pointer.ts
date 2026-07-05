import { machineManager } from '../../../../../core/machine_manager';
import { point_in_rect } from '../../../../../common/rect';
import { editorChromeState } from '../../../ui/chrome_state';
import type { PointerSnapshot } from '../../../../common/models';
import { closeTab, setActiveTab } from '../../../ui/tabs';
import { beginTabDrag, endTabDrag } from '../../../ui/tab/drag';
import { consumeChromePointerPress } from '../../../../input/pointer/chrome_press';
import { tabSessionState } from '../../../ui/tab/session_state';

export function handleTabBarPointer(snapshot: PointerSnapshot): boolean {
	const x = snapshot.viewportX;
	const y = snapshot.viewportY;
	if (!point_in_rect(x, y, editorChromeState.tabBarBounds)) {
		return false;
	}
	for (let index = 0; index < tabSessionState.tabs.length; index += 1) {
		const tab = tabSessionState.tabs[index];
		const closeBounds = editorChromeState.tabCloseButtonBounds.get(tab.id);
		if (closeBounds && point_in_rect(x, y, closeBounds)) {
			endTabDrag();
			closeTab(tab.id);
			editorChromeState.tabHoverId = null;
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

export function handleTabBarMiddleClick(snapshot: PointerSnapshot, playerInput: ReturnType<typeof machineManager.input.getPlayerInput>): boolean {
	const x = snapshot.viewportX;
	const y = snapshot.viewportY;
	if (!point_in_rect(x, y, editorChromeState.tabBarBounds)) {
		return false;
	}
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
		editorChromeState.tabHoverId = null;
		return;
	}
	const x = snapshot.viewportX;
	const y = snapshot.viewportY;
	if (!point_in_rect(x, y, editorChromeState.tabBarBounds)) {
		editorChromeState.tabHoverId = null;
		return;
	}
	let hovered: string = null;
	for (let index = 0; index < tabSessionState.tabs.length; index += 1) {
		const tab = tabSessionState.tabs[index];
		const bounds = editorChromeState.tabButtonBounds.get(tab.id);
		if (bounds && point_in_rect(x, y, bounds)) {
			hovered = tab.id;
			break;
		}
	}
	editorChromeState.tabHoverId = hovered;
}
