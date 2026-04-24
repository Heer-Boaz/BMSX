import { engineCore } from '../../../../../core/engine';
import { handleEditorPanelResizePointer } from '../panel';
import { handleInvalidEditorPointerSnapshot } from '../invalid_snapshot';
import { handleEditorScrollbarPointer } from '../scrollbar';
import { handleTopBarPointer } from '../../../../workbench/input/pointer/top_bar/pointer';
import { handleTabBarMiddleClick, handleTabBarPointer } from '../../../../workbench/input/pointer/tab_bar/pointer';
import { handleEditorTabDragPointer } from '../../../../workbench/input/pointer/tab_drag/pointer';
import type { PointerSnapshot } from '../../../../common/models';

export function handleEditorChromePointerDispatch(
	snapshot: PointerSnapshot,
	justPressed: boolean,
	pointerAuxJustPressed: boolean,
	playerInput: ReturnType<typeof engineCore.input.getPlayerInput>
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
