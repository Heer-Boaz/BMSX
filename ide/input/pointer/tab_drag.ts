import type { PointerSnapshot } from '../../common/models';
import { clearGotoHoverHighlight } from '../../editor/contrib/intellisense/engine';
import { clearHoverTooltip } from '../../editor/contrib/hover/controller';
import { endTabDrag, updateTabDrag } from '../../workbench/ui/tab/drag';
import { editorChromeState } from '../../workbench/ui/chrome_state';
import { stopPointerSelection } from './state';

export function handleEditorTabDragPointer(snapshot: PointerSnapshot): boolean {
	if (!editorChromeState.tabDragState) {
		return false;
	}
	if (!snapshot.primaryPressed) {
		endTabDrag();
		stopPointerSelection(snapshot);
		clearGotoHoverHighlight();
		clearHoverTooltip();
		return true;
	}
	updateTabDrag(snapshot.viewportX, snapshot.viewportY);
	stopPointerSelection(snapshot);
	clearGotoHoverHighlight();
	clearHoverTooltip();
	return true;
}
