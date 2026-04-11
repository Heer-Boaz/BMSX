import { closeSearch } from '../../contrib/find/editor_search';
import { ide_state } from '../../core/ide_state';
import { closeCreateResourcePrompt } from '../../contrib/resources/create_resource';
import { closeResourceSearch } from '../../contrib/resources/resource_search';
import { closeLineJump } from '../../contrib/find/line_jump';
import { closeSymbolSearch } from '../../contrib/symbols/symbol_search_shared';
import { resetActionPromptState } from '../overlays/action_prompt';
import { closeEditorContextMenu } from '../../render/render_context_menu';

export function handleEscapeKey(): boolean {
	if (ide_state.actionPrompt) {
		resetActionPromptState();
		return true;
	}
	if (ide_state.contextMenu.visible) {
		closeEditorContextMenu();
		return true;
	}
	const overlay = ide_state.runtimeErrorOverlay;
	if (ide_state.createResource.visible) {
		closeCreateResourcePrompt(true);
		return true;
	}
	if (ide_state.symbolSearch.active || ide_state.symbolSearch.visible) {
		closeSymbolSearch(false);
		return true;
	}
	if (ide_state.resourceSearch.active || ide_state.resourceSearch.visible) {
		closeResourceSearch(false);
		return true;
	}
	if (ide_state.lineJump.active || ide_state.lineJump.visible) {
		closeLineJump(false);
		return true;
	}
	if (ide_state.search.active || ide_state.search.visible) {
		closeSearch(false, true);
		return true;
	}
	if (overlay) {
		overlay.hidden = !overlay.hidden;
		overlay.hovered = false;
		overlay.hoverLine = -1;
		overlay.copyButtonHovered = false;
		overlay.layout = null;
		ide_state.message.visible = false;
		return true;
	}
	return false;
}
