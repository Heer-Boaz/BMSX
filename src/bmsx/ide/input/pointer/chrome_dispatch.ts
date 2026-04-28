import { consoleCore } from '../../../core/console';
import type { Runtime } from '../../../machine/runtime/runtime';
import type { PointerSnapshot } from '../../common/models';
import { handleInvalidEditorPointerSnapshot } from './invalid_snapshot';
import { handleEditorPanelResizePointer } from './panel';
import { handleEditorScrollbarPointer } from './scrollbar';
import { handleTabBarMiddleClick, handleTabBarPointer } from '../../workbench/input/pointer/tab_bar/pointer';
import { handleEditorTabDragPointer } from './tab_drag';
import { handleTopBarPointer } from '../../workbench/input/pointer/top_bar/pointer';

export function handleEditorChromePointerDispatch(
	runtime: Runtime,
	snapshot: PointerSnapshot,
	justPressed: boolean,
	pointerAuxJustPressed: boolean,
	playerInput: ReturnType<typeof consoleCore.input.getPlayerInput>
): boolean {
	if (handleEditorTabDragPointer(snapshot)) {
		return true;
	}
	if (handleEditorScrollbarPointer(runtime.editor.resourcePanel, snapshot, justPressed)) {
		return true;
	}
	if (justPressed && handleTopBarPointer(runtime.editor.commands, snapshot)) {
		return true;
	}
	if (handleEditorPanelResizePointer(runtime.editor.resourcePanel, snapshot, justPressed)) {
		return true;
	}
	if (handleInvalidEditorPointerSnapshot(snapshot)) {
		return true;
	}
	if (pointerAuxJustPressed && handleTabBarMiddleClick(runtime, snapshot, playerInput)) {
		return true;
	}
	if (justPressed && handleTabBarPointer(runtime, snapshot)) {
		return true;
	}
	return false;
}
