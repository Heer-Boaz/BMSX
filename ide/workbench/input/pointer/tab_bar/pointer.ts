import { pointerHover, type PointerHoverTarget } from '../../../../input/pointer/hover';
import type { PlayerInput } from '../../../../../hosts/common/input/player';
import { point_in_rect } from '../../../../../machine/ts/common/rect';
import { editorChromeState } from '../../../ui/chrome_state';
import type { PointerSnapshot } from '../../../../common/models';
import { closeTab, setActiveTab } from '../../../ui/tabs';
import { beginTabDrag, endTabDrag } from '../../../ui/tab/drag';
import { consumeChromePointerPress } from '../../../../input/pointer/chrome_press';
import { editorTabGroup } from '../../../ui/tab/group_model';
import type { RuntimeSourceState } from '../../../../runtime/sources';
import type { EditorPanes } from '../../../services/editor/editor_panes';
import type { EditorTabId } from '../../../ui/tab/id';
import { DOUBLE_CLICK_MAX_INTERVAL_MS } from '../../../../common/constants';

export function handleTabBarPointer(
	editorPanes: EditorPanes,
	sources: RuntimeSourceState,
	snapshot: PointerSnapshot,
	now: number,
): boolean {
	const x = snapshot.viewportX;
	const y = snapshot.viewportY;
	if (!point_in_rect(x, y, editorChromeState.tabBarBounds)) {
		editorChromeState.lastTabClickId = null;
		return false;
	}
	if (editorChromeState.tabScrollControl.begin(snapshot)) {
		editorChromeState.lastTabClickId = null;
		consumeChromePointerPress();
		return true;
	}
	const tabs = editorTabGroup.tabs;
	for (let index = 0; index < tabs.length; index += 1) {
		const tab = tabs[index];
		const closeBounds = editorChromeState.tabCloseButtonBounds.get(tab.id);
		if (closeBounds && point_in_rect(x, y, closeBounds)) {
			editorChromeState.lastTabClickId = null;
			endTabDrag();
			closeTab(editorPanes, sources, tab.id);
			editorChromeState.tabHoverId = null;
			consumeChromePointerPress();
			return true;
		}
		const tabBounds = editorChromeState.tabButtonBounds.get(tab.id);
		if (tabBounds && point_in_rect(x, y, tabBounds)) {
			const twice = editorChromeState.lastTabClickId === tab.id
				&& now - editorChromeState.lastTabClickTime <= DOUBLE_CLICK_MAX_INTERVAL_MS;
			if (twice) editorTabGroup.pin(tab);
			editorChromeState.lastTabClickId = twice ? null : tab.id;
			editorChromeState.lastTabClickTime = now;
			setActiveTab(editorPanes, tab.id);
			beginTabDrag(tab.id, snapshot, now);
			consumeChromePointerPress();
			return true;
		}
	}
	editorChromeState.lastTabClickId = null;
	return false;
}

export function handleTabBarMiddleClick(
	editorPanes: EditorPanes,
	sources: RuntimeSourceState,
	snapshot: PointerSnapshot,
	playerInput: PlayerInput,
): boolean {
	const x = snapshot.viewportX;
	const y = snapshot.viewportY;
	if (!point_in_rect(x, y, editorChromeState.tabBarBounds)) {
		return false;
	}
	const tabs = editorTabGroup.tabs;
	for (let index = 0; index < tabs.length; index += 1) {
		const tab = tabs[index];
		if (!tab.closable) {
			continue;
		}
		const bounds = editorChromeState.tabButtonBounds.get(tab.id);
		if (!bounds) {
			continue;
		}
		if (point_in_rect(x, y, bounds)) {
			closeTab(editorPanes, sources, tab.id);
			playerInput.inputHandlers.pointer?.consumeButton('pointer_aux');
			consumeChromePointerPress();
			return true;
		}
	}
	return false;
}

const tabBarHover: PointerHoverTarget = { onPointerLeave: () => { editorChromeState.tabHoverId = null; } };

export function updateTabHoverState(snapshot: PointerSnapshot): boolean {
	if (!snapshot.valid || !snapshot.insideViewport) {
		pointerHover.release(tabBarHover);
		return false;
	}
	const x = snapshot.viewportX;
	const y = snapshot.viewportY;
	if (!point_in_rect(x, y, editorChromeState.tabBarBounds)) {
		pointerHover.release(tabBarHover);
		return false;
	}
	pointerHover.visit(tabBarHover);
	let hovered: EditorTabId | null = null;
	const tabs = editorTabGroup.tabs;
	for (let index = 0; index < tabs.length; index += 1) {
		const tab = tabs[index];
		const bounds = editorChromeState.tabButtonBounds.get(tab.id);
		if (bounds && point_in_rect(x, y, bounds)) {
			hovered = tab.id;
			break;
		}
	}
	editorChromeState.tabHoverId = hovered;
	return true;
}
