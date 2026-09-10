import { PointerButton } from './buttons';
import type { PointerSnapshot } from '../../common/models';
import { clearGotoHoverHighlight } from '../../editor/contrib/intellisense/engine';
import { clearHoverTooltip } from '../../editor/contrib/hover/controller';
import { endTabDrag, updateTabDrag } from '../../workbench/ui/tab/drag';
import { editorChromeState } from '../../workbench/ui/chrome_state';
import { editorPointerState } from './state';

export function handleEditorTabDragPointer(snapshot: PointerSnapshot): boolean {
	if (!editorChromeState.tabDragState) {
		return false;
	}
	if ((snapshot.pressedButtons & PointerButton.Primary) === 0) {
		endTabDrag();
		editorPointerState.pointerSelecting = false;
		clearGotoHoverHighlight();
		clearHoverTooltip();
		return true;
	}
	updateTabDrag(snapshot.viewportX, snapshot.viewportY);
	editorPointerState.pointerSelecting = false;
	clearGotoHoverHighlight();
	clearHoverTooltip();
	return true;
}
