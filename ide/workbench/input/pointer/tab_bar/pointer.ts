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

export function handleTabBarPointer(
	editorPanes: EditorPanes,
	sources: RuntimeSourceState,
	snapshot: PointerSnapshot,
): boolean {
	const x = snapshot.viewportX;
	const y = snapshot.viewportY;
	if (!point_in_rect(x, y, editorChromeState.tabBarBounds)) {
		return false;
	}
	const tabs = editorTabGroup.tabs;
	for (let index = 0; index < tabs.length; index += 1) {
		const tab = tabs[index];
		const closeBounds = editorChromeState.tabCloseButtonBounds.get(tab.id);
		if (closeBounds && point_in_rect(x, y, closeBounds)) {
			endTabDrag();
			closeTab(editorPanes, sources, tab.id);
			editorChromeState.tabHoverId = null;
			consumeChromePointerPress(snapshot);
			return true;
		}
		const tabBounds = editorChromeState.tabButtonBounds.get(tab.id);
		if (tabBounds && point_in_rect(x, y, tabBounds)) {
			beginTabDrag(tab.id, x);
			setActiveTab(editorPanes, tab.id);
			consumeChromePointerPress(snapshot);
			return true;
		}
	}
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
}
