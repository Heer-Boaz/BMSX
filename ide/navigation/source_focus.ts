import { closeLineJump } from '../workbench/contrib/code_editor/find/line_jump';
import { closeSearch } from '../workbench/contrib/code_editor/find/search';
import { resetBlink } from '../editor/render/caret';
import type { ResourcePanelController } from '../workbench/contrib/resources/panel/controller';

export function releaseResourcePanelFocus(resourcePanel: ResourcePanelController): void {
	if (!resourcePanel.isFocused()) {
		return;
	}
	resourcePanel.setFocused(false);
	resetBlink();
}

export function prepareEditorForSourceFocus(): void {
	closeLineJump(true);
	closeSearch(true);
}
