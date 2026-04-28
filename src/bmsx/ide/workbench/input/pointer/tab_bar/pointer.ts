import { engineCore } from '../../../../../core/engine';
import { point_in_rect } from '../../../../../common/rect';
import { editorChromeState } from '../../../ui/chrome_state';
import type { PointerSnapshot } from '../../../../common/models';
import { closeTab, setActiveTab } from '../../../ui/tabs';
import { beginTabDrag, endTabDrag } from '../../../ui/tab/drag';
import { consumeChromePointerPress } from '../../../../input/pointer/chrome_press';
import { tabSessionState } from '../../../ui/tab/session_state';
import type { Runtime } from '../../../../../machine/runtime/runtime';

export function handleTabBarPointer(runtime: Runtime, snapshot: PointerSnapshot): boolean {
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
			closeTab(runtime, tab.id);
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

export function handleTabBarMiddleClick(runtime: Runtime, snapshot: PointerSnapshot, playerInput: ReturnType<typeof engineCore.input.getPlayerInput>): boolean {
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
			closeTab(runtime, tab.id);
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
