import { runtimeWorkbenchState } from '../../runtime/workbench_state';
import { machineManager } from '../../../machine/ts/core/machine_manager';
import type { PointerSnapshot } from '../../common/models';
import { handleInvalidEditorPointerSnapshot } from './invalid_snapshot';
import { handleEditorPanelResizePointer } from './panel';
import { handleEditorScrollbarPointer } from './scrollbar';
import { handleTabBarMiddleClick, handleTabBarPointer } from '../../workbench/input/pointer/tab_bar/pointer';
import { handleEditorTabDragPointer } from './tab_drag';
import { handleTopBarPointer } from '../../workbench/input/pointer/top_bar/pointer';

export function handleEditorChromePointerDispatch(
	snapshot: PointerSnapshot,
	justPressed: boolean,
	pointerAuxJustPressed: boolean,
	playerInput: ReturnType<typeof machineManager.input.getPlayerInput>
): boolean {
	if (handleEditorTabDragPointer(snapshot)) {
		return true;
	}
	if (handleEditorScrollbarPointer(runtimeWorkbenchState.ide.editor.resourcePanel, snapshot, justPressed)) {
		return true;
	}
	if (justPressed && handleTopBarPointer(runtimeWorkbenchState.ide.editor.commands, snapshot)) {
		return true;
	}
	if (handleEditorPanelResizePointer(runtimeWorkbenchState.ide.editor.resourcePanel, snapshot, justPressed)) {
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
