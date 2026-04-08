import { closeSearch } from '../editor_search';
import { ide_state } from '../ide_state';
import { closeCreateResourcePrompt } from '../create_resource';
import { closeResourceSearch } from '../resource_search';
import { closeLineJump } from '../line_jump';
import { closeSymbolSearch } from '../symbol_search_shared';
import { resetActionPromptState } from './action_prompt';
import { closeEditorContextMenu } from '../render/render_context_menu';

export function handleEscapeKey(): boolean {
	if (ide_state.pendingActionPrompt) {
		resetActionPromptState();
		return true;
	}
	if (ide_state.contextMenu.visible) {
		closeEditorContextMenu();
		return true;
	}
	const overlay = ide_state.runtimeErrorOverlay;
	if (ide_state.createResourceVisible) {
		closeCreateResourcePrompt(true);
		return true;
	}
	if (ide_state.symbolSearchActive || ide_state.symbolSearchVisible) {
		closeSymbolSearch(false);
		return true;
	}
	if (ide_state.resourceSearchActive || ide_state.resourceSearchVisible) {
		closeResourceSearch(false);
		return true;
	}
	if (ide_state.lineJumpActive || ide_state.lineJumpVisible) {
		closeLineJump(false);
		return true;
	}
	if (ide_state.searchActive || ide_state.searchVisible) {
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
