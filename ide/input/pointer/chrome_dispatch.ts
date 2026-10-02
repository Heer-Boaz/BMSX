import { getWorkbenchStatusBounds } from '../../workbench/common/layout';
import { point_in_rect } from '../../../machine/ts/common/rect';
import { handleEditorScrollbarPointer } from './scrollbar';
import type { CartEditor } from '../../cart_editor';
import type { PlayerInput } from '../../../hosts/common/input/player';
import type { PointerSnapshot } from '../../common/models';
import { handleEditorPanelResizePointer } from './panel';
import { handleTabBarMiddleClick, handleTabBarPointer, updateTabHoverState } from '../../workbench/input/pointer/tab_bar/pointer';
import { handleTopBarPointer } from '../../workbench/input/pointer/top_bar/pointer';
import { editorRuntimeState } from '../../editor/common/runtime_state';
import { editorChromeState } from '../../workbench/ui/chrome_state';

const RESOURCE_SCROLLBARS = ['resourceVertical', 'resourceHorizontal'] as const;

export function handleEditorChromePointerDispatch(
	editor: CartEditor,
	snapshot: PointerSnapshot,
	justPressed: boolean,
	pointerAuxJustPressed: boolean,
	playerInput: PlayerInput
): boolean {
	if (justPressed && !point_in_rect(snapshot.viewportX, snapshot.viewportY, editorChromeState.tabBarBounds)) editorChromeState.lastTabClickId = null;
	if (editorChromeState.openMenuId === null && editor.runtimeTimeline.handlePointer(snapshot)) {
		if (justPressed) playerInput.inputHandlers.pointer?.consumeButton('pointer_primary');
		return true;
	}
	if (handleTopBarPointer(editor.commands, snapshot, justPressed)) {
		return true;
	}
	if (editor.gamePanel.handlePointer(snapshot)) {
		if (justPressed) playerInput.inputHandlers.pointer?.consumeButton('pointer_primary');
		return true;
	}
	if (editor.resourcePanel.isVisible() && handleEditorScrollbarPointer(snapshot, RESOURCE_SCROLLBARS)) return true;
	if (handleEditorPanelResizePointer(editor.resourcePanel, snapshot, justPressed)) {
		return true;
	}
	if (!snapshot.valid) return true;
	const status = getWorkbenchStatusBounds();
	if (snapshot.viewportX >= 0 && snapshot.viewportX < status.left && snapshot.viewportY >= status.top && snapshot.viewportY < status.bottom) {
		if (justPressed) editor.commands.execute('server.connection');
		return true;
	}
	const overTabs = updateTabHoverState(snapshot);
	if (editor.tabBar.handlePointer(snapshot)) {
		if (justPressed) playerInput.inputHandlers.pointer?.consumeButton('pointer_primary');
		return true;
	}
	if (pointerAuxJustPressed && handleTabBarMiddleClick(editor.editorPanes, snapshot, playerInput)) {
		return true;
	}
	if (justPressed && handleTabBarPointer(editor.editorPanes, snapshot, editorRuntimeState.currentTimeMs)) {
		return true;
	}
	return overTabs;
}
