import { closeSearch } from '../../contrib/find/editor_search';
import { editorFeedbackState } from '../../../workbench/common/feedback_state';
import { closeCreateResourcePrompt } from '../../../workbench/contrib/resources/create_resource';
import { closeResourceSearch } from '../../../workbench/contrib/resources/resource_search';
import { closeLineJump } from '../../contrib/find/line_jump';
import { closeSymbolSearch } from '../../contrib/symbols/symbol_search_shared';
import { resetActionPromptState } from '../overlays/action_prompt';
import { actionPromptState } from '../overlays/action_prompt_state';
import { closeEditorContextMenu } from '../../../workbench/render/render_context_menu';
import { editorContextMenuState } from '../../../workbench/contrib/context_menu/context_menu_state';
import { runtimeErrorState } from '../../contrib/runtime_error/runtime_error_state';
import { editorFeatureState } from '../../common/editor_feature_state';

export function handleEscapeKey(): boolean {
	if (actionPromptState.prompt) {
		resetActionPromptState();
		return true;
	}
	if (editorContextMenuState.visible) {
		closeEditorContextMenu();
		return true;
	}
	const overlay = runtimeErrorState.activeOverlay;
	if (editorFeatureState.createResource.visible) {
		closeCreateResourcePrompt(true);
		return true;
	}
	if (editorFeatureState.symbolSearch.active || editorFeatureState.symbolSearch.visible) {
		closeSymbolSearch(false);
		return true;
	}
	if (editorFeatureState.resourceSearch.active || editorFeatureState.resourceSearch.visible) {
		closeResourceSearch(false);
		return true;
	}
	if (editorFeatureState.lineJump.active || editorFeatureState.lineJump.visible) {
		closeLineJump(false);
		return true;
	}
	if (editorFeatureState.search.active || editorFeatureState.search.visible) {
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
