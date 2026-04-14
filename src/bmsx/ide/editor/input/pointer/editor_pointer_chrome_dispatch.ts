import { $ } from '../../../../core/engine_core';
import { handleEditorPanelResizePointer } from './editor_panel_pointer';
import { handleInvalidEditorPointerSnapshot } from './editor_pointer_invalid_snapshot';
import { handleEditorScrollbarPointer } from './editor_scrollbar_pointer';
import { handleTopBarPointer } from '../../../workbench/input/pointer/top_bar_pointer';
import { handleTabBarMiddleClick, handleTabBarPointer } from '../../../workbench/input/pointer/tab_bar_pointer';
import { handleEditorTabDragPointer } from '../../../workbench/input/pointer/tab_drag_pointer';
import type { PointerSnapshot } from '../../../common/types';

export function handleEditorChromePointerDispatch(
	snapshot: PointerSnapshot,
	justPressed: boolean,
	pointerAuxJustPressed: boolean,
	playerInput: ReturnType<typeof $.input.getPlayerInput>
): boolean {
	if (handleEditorTabDragPointer(snapshot)) {
		return true;
	}
	if (handleEditorScrollbarPointer(snapshot, justPressed)) {
		return true;
	}
	if (justPressed && handleTopBarPointer(snapshot)) {
		return true;
	}
	if (handleEditorPanelResizePointer(snapshot, justPressed)) {
		return true;
	}
	if (handleInvalidEditorPointerSnapshot(snapshot)) {
		return true;
	}
	if (pointerAuxJustPressed && handleTabBarMiddleClick(snapshot, playerInput)) {
		return true;
	}
	if (justPressed && handleTabBarPointer(snapshot)) {
		return true;
	}
	return false;
}
