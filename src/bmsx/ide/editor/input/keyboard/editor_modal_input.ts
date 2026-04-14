import { closeSearch } from '../../contrib/find/editor_search';
import { editorFeedbackState } from '../../../workbench/common/feedback_state';
import { closeBlockingWorkbenchModal, hasBlockingWorkbenchModal } from '../../../workbench/contrib/modal/blocking_modal';
import { closeCreateResourcePrompt } from '../../../workbench/contrib/resources/create_resource';
import { closeResourceSearch } from '../../../workbench/contrib/resources/resource_search';
import { closeLineJump } from '../../contrib/find/line_jump';
import { closeSymbolSearch } from '../../contrib/symbols/symbol_search_shared';
import { closeEditorContextMenu } from '../../../workbench/contrib/context_menu/context_menu_widget';
import { editorContextMenuState } from '../../../workbench/contrib/context_menu/context_menu_state';
import { runtimeErrorState } from '../../contrib/runtime_error/runtime_error_state';
import { editorSearchState, lineJumpState } from '../../contrib/find/find_widget_state';
import { symbolSearchState } from '../../contrib/symbols/symbol_search_state';
import { createResourceState, resourceSearchState } from '../../../workbench/contrib/resources/resource_widget_state';

export function handleEscapeKey(): boolean {
	if (hasBlockingWorkbenchModal()) {
		closeBlockingWorkbenchModal();
		return true;
	}
	if (editorContextMenuState.visible) {
		closeEditorContextMenu();
		return true;
	}
	const overlay = runtimeErrorState.activeOverlay;
	if (createResourceState.visible) {
		closeCreateResourcePrompt(true);
		return true;
	}
	if (symbolSearchState.active || symbolSearchState.visible) {
		closeSymbolSearch(false);
		return true;
	}
	if (resourceSearchState.active || resourceSearchState.visible) {
		closeResourceSearch(false);
		return true;
	}
	if (lineJumpState.active || lineJumpState.visible) {
		closeLineJump(false);
		return true;
	}
	if (editorSearchState.active || editorSearchState.visible) {
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
