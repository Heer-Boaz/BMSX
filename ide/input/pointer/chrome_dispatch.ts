import type { CartEditor } from '../../cart_editor';
import type { PlayerInput } from '../../../hosts/common/input/player';
import type { PointerSnapshot } from '../../common/models';
import { handleInvalidEditorPointerSnapshot } from './invalid_snapshot';
import { handleEditorPanelResizePointer } from './panel';
import { handleEditorScrollbarPointer } from './scrollbar';
import { handleTabBarMiddleClick, handleTabBarPointer } from '../../workbench/input/pointer/tab_bar/pointer';
import { handleEditorTabDragPointer } from './tab_drag';
import { handleTopBarPointer } from '../../workbench/input/pointer/top_bar/pointer';
import type { RuntimeSourceState } from '../../runtime/sources';

export function handleEditorChromePointerDispatch(
	editor: CartEditor,
	sources: RuntimeSourceState,
	snapshot: PointerSnapshot,
	justPressed: boolean,
	pointerAuxJustPressed: boolean,
	playerInput: PlayerInput
): boolean {
	if (handleEditorTabDragPointer(snapshot)) {
		return true;
	}
	if (handleEditorScrollbarPointer(editor.resourcePanel, snapshot, justPressed)) {
		return true;
	}
	if (justPressed && handleTopBarPointer(editor.commands, snapshot)) {
		return true;
	}
	if (handleEditorPanelResizePointer(editor.resourcePanel, snapshot, justPressed)) {
		return true;
	}
	if (handleInvalidEditorPointerSnapshot(snapshot)) {
		return true;
	}
	if (pointerAuxJustPressed && handleTabBarMiddleClick(editor.resourcePanel, sources, snapshot, playerInput)) {
		return true;
	}
	if (justPressed && handleTabBarPointer(editor.resourcePanel, sources, snapshot)) {
		return true;
	}
	return false;
}
