import { point_in_rect } from '../../../machine/ts/common/rect';
import { handleEditorScrollbarPointer } from './scrollbar';
import type { CartEditor } from '../../cart_editor';
import type { PlayerInput } from '../../../hosts/common/input/player';
import type { PointerSnapshot } from '../../common/models';
import { handleInvalidEditorPointerSnapshot } from './invalid_snapshot';
import { handleEditorPanelResizePointer } from './panel';
import { handleTabBarMiddleClick, handleTabBarPointer } from '../../workbench/input/pointer/tab_bar/pointer';
import { handleTopBarPointer } from '../../workbench/input/pointer/top_bar/pointer';
import type { RuntimeSourceState } from '../../runtime/sources';
import { editorRuntimeState } from '../../editor/common/runtime_state';
import { editorChromeState } from '../../workbench/ui/chrome_state';

const RESOURCE_SCROLLBARS = ['resourceVertical', 'resourceHorizontal'] as const;

export function handleEditorChromePointerDispatch(
	editor: CartEditor,
	sources: RuntimeSourceState,
	snapshot: PointerSnapshot,
	justPressed: boolean,
	pointerAuxJustPressed: boolean,
	playerInput: PlayerInput
): boolean {
	if (justPressed && !point_in_rect(snapshot.viewportX, snapshot.viewportY, editorChromeState.tabBarBounds)) editorChromeState.lastTabClickId = null;
	if (editor.resourcePanel.isVisible() && handleEditorScrollbarPointer(snapshot, justPressed, RESOURCE_SCROLLBARS)) return true;
	if (justPressed && handleTopBarPointer(editor.commands, snapshot)) {
		return true;
	}
	if (handleEditorPanelResizePointer(editor.resourcePanel, snapshot, justPressed)) {
		return true;
	}
	if (handleInvalidEditorPointerSnapshot(snapshot)) {
		return true;
	}
	if (pointerAuxJustPressed && handleTabBarMiddleClick(editor.editorPanes, sources, snapshot, playerInput)) {
		return true;
	}
	if (justPressed && handleTabBarPointer(editor.editorPanes, sources, snapshot, editorRuntimeState.currentTimeMs)) {
		return true;
	}
	return false;
}
