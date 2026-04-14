import { applyScrollbarScroll } from '../../ui/scrollbar';
import { clearHoverTooltip, clearGotoHoverHighlight } from '../../contrib/intellisense/intellisense';
import { bottomMargin } from '../../../workbench/common/layout';
import type { PointerSnapshot } from '../../../common/types';
import { editorPointerState } from './editor_pointer_state';
import { editorViewState } from '../../ui/editor_view_state';

export function handleEditorScrollbarPointer(snapshot: PointerSnapshot, justPressed: boolean): boolean {
	if (!justPressed) {
		return false;
	}
	if (!editorViewState.scrollbarController.begin(snapshot.viewportX, snapshot.viewportY, snapshot.primaryPressed, bottomMargin(), (kind, scroll) => applyScrollbarScroll(kind, scroll))) {
		return false;
	}
	editorPointerState.pointerSelecting = false;
	clearHoverTooltip();
	clearGotoHoverHighlight();
	editorPointerState.pointerPrimaryWasPressed = snapshot.primaryPressed;
	return true;
}
