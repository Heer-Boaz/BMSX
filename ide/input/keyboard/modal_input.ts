import { closeSearch } from '../../workbench/contrib/code_editor/find/search';
import { editorFeedbackState } from '../../common/feedback_state';
import { closeBlockingWorkbenchModal, hasBlockingWorkbenchModal } from '../../workbench/contrib/modal/blocking_modal';
import { closeCreateResourcePrompt } from '../../workbench/contrib/resources/create/index';
import { closeLineJump } from '../../workbench/contrib/code_editor/find/line_jump';
import { closeSymbolSearch } from '../../workbench/contrib/code_editor/symbols/shared';
import { runtimeErrorState } from '../../editor/contrib/runtime_error/state';
import { editorSearchState, lineJumpState } from '../../workbench/contrib/code_editor/find/widget_state';
import { symbolSearchState } from '../../workbench/contrib/code_editor/symbols/search/state';
import { createResourceState } from '../../workbench/contrib/resources/widget_state';

export function handleEscapeKey(): boolean {
	if (hasBlockingWorkbenchModal()) {
		closeBlockingWorkbenchModal();
		return true;
	}
	const overlay = runtimeErrorState.activeOverlay;
	if (createResourceState.visible) {
		closeCreateResourcePrompt(true);
		return true;
	}
	if (symbolSearchState.field.focusTarget.hasFocus || symbolSearchState.visible) {
		closeSymbolSearch(false);
		return true;
	}
	if (lineJumpState.field.focusTarget.hasFocus || lineJumpState.visible) {
		closeLineJump(false);
		return true;
	}
	if (editorSearchState.field.focusTarget.hasFocus || editorSearchState.visible) {
		closeSearch(false, true);
		return true;
	}
	if (overlay) {
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
