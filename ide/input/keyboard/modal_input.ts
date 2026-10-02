import { pointerHover } from '../pointer/hover';
import { runtimeErrorOverlayPointer } from '../../editor/contrib/runtime_error/pointer';
import type { EditorSearchController } from '../../workbench/contrib/code_editor/find/search';
import { editorFeedbackState } from '../../common/feedback_state';
import { closeLineJump } from '../../workbench/contrib/code_editor/find/line_jump';
import { runtimeErrorState } from '../../editor/contrib/runtime_error/state';
import { editorSearchState, lineJumpState } from '../../workbench/contrib/code_editor/find/widget_state';

export function handleEscapeKey(search: EditorSearchController): boolean {
	const overlay = runtimeErrorState.activeOverlay;
	if (lineJumpState.field.focusTarget.hasFocus || lineJumpState.visible) {
		closeLineJump(false);
		return true;
	}
	if (editorSearchState.field.focusTarget.hasFocus || editorSearchState.visible) {
		search.closeSearch(false);
		return true;
	}
	if (overlay) {
		pointerHover.release(runtimeErrorOverlayPointer);
		overlay.hidden = !overlay.hidden;
		overlay.hovered = false;
		overlay.hoverLine = -1;
		overlay.copyButtonHovered = false;
		overlay.layout = null;
		editorFeedbackState.message.visible = false;
		return true;
	}
	return false;
}
